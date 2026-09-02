import {
  App,
  MarkdownView,
  Modal,
  Notice,
  Platform,
  Plugin,
  PluginSettingTab,
  Setting,
  SettingDefinitionItem,
  TFile,
  editorInfoField,
  setIcon
} from 'obsidian';
import { EditorState, Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

// --- Settings ---------------------------------------------------------------

interface NoteLockSettings {
  propertyName: string;
  dimLocked: boolean;
  confirmUnlock: boolean;
}

const DEFAULT_SETTINGS: NoteLockSettings = {
  propertyName: 'locked',
  dimLocked: true,
  confirmUnlock: false
};

// --- Constants --------------------------------------------------------------

const BANNER_CLASS = 'note-lock-banner';
const HAS_BANNER_CLASS = 'note-lock-has-banner';
const DIM_CLASS = 'note-lock-dim';
const ACTION_CLASS = 'note-lock-action';
const NOTICE_DEBOUNCE_MS = 2000;

const PROPERTY_NAME_DESC =
  'Frontmatter property that marks a note as locked. The lock travels with the note, ' +
  'so it syncs to other devices. Existing notes keep any previously used property.';
const DIM_DESC =
  'Slightly fade the editor content of locked notes so their read-only state is visible at a glance.';
const CONFIRM_DESC =
  'Ask for confirmation before unlocking a note, preventing accidental unlocks from a stray tap.';

// --- Helpers ----------------------------------------------------------------

/** Small confirmation dialog used when "Confirm before unlocking" is enabled. */
class ConfirmUnlockModal extends Modal {
  private resolved = false;

  static confirm(app: App, noteName: string): Promise<boolean> {
    return new Promise((resolve) => {
      new ConfirmUnlockModal(app, noteName, resolve).open();
    });
  }

  constructor(
    app: App,
    private readonly noteName: string,
    private readonly resolve: (confirmed: boolean) => void
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle(`Unlock "${this.noteName}"?`);
    this.contentEl.createEl('p', { text: 'The note will become editable again.' });
    new Setting(this.contentEl)
      .addButton((button) => button
        .setButtonText('Unlock')
        .setCta()
        .onClick(() => {
          this.settle(true);
          this.close();
        }))
      .addButton((button) => button
        .setButtonText('Cancel')
        .onClick(() => this.close()));
  }

  onClose(): void {
    this.settle(false);
    this.contentEl.empty();
  }

  private settle(confirmed: boolean): void {
    if (this.resolved) return;
    this.resolved = true;
    this.resolve(confirmed);
  }
}

// --- Plugin -----------------------------------------------------------------

export default class NoteLockPlugin extends Plugin {
  settings: NoteLockSettings = DEFAULT_SETTINGS;

  /**
   * Last-known lock state per file path. Written optimistically in setLocked()
   * so the editor filter and vault guard are correct in the window before
   * metadataCache re-parses the frontmatter, and used to detect actual lock
   * flips (workspace.updateOptions() is expensive and must only run on flips).
   */
  private readonly lockStates = new Map<string, boolean>();

  /** Path allowed through the vault guard while our own lock/unlock write runs. */
  private bypassPath: string | null = null;

  private readonly noticeTimes = new Map<string, number>();

  async onload(): Promise<void> {
    await this.loadSettings();

    this.registerEditorExtension([
      EditorState.transactionFilter.of((tr) => {
        if (!tr.docChanged) return tr;
        const file = tr.startState.field(editorInfoField, false)?.file;
        if (!file || !this.isFileLocked(file)) return tr;
        // Obsidian reloads an editor from disk as one full-document replacement
        // with no userEvent annotation; sync updates and our own frontmatter
        // write must still render. Anything else is an edit — block it.
        if (this.isFullDocReplace(tr)) return tr;
        this.notifyBlocked(file);
        return [];
      }),
      EditorView.editable.compute([editorInfoField], (state) => !this.stateIsLocked(state)),
      EditorState.readOnly.compute([editorInfoField], (state) => this.stateIsLocked(state))
    ]);

    this.installVaultGuard();

    this.addCommand({
      id: 'toggle-lock',
      name: 'Toggle lock on current note',
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== 'md') return false;
        if (!checking) {
          if (this.isFileLocked(file)) void this.unlockFlow(file);
          else void this.setLocked(file, true);
        }
        return true;
      }
    });

    this.registerEvent(this.app.workspace.on('file-menu', (menu, abstractFile) => {
      if (!(abstractFile instanceof TFile) || abstractFile.extension !== 'md') return;
      const locked = this.isFileLocked(abstractFile);
      menu.addItem((item) => item
        .setTitle(locked ? 'Unlock note' : 'Lock note')
        .setIcon(locked ? 'lock-open' : 'lock')
        .setSection('action')
        .onClick(() => {
          if (locked) void this.unlockFlow(abstractFile);
          else void this.setLocked(abstractFile, true);
        }));
    }));

    this.registerEvent(this.app.metadataCache.on('changed', (file) => {
      this.handleMetadataChanged(file);
    }));

    this.registerEvent(this.app.vault.on('rename', (abstractFile, oldPath) => {
      const state = this.lockStates.get(oldPath);
      this.lockStates.delete(oldPath);
      this.noticeTimes.delete(oldPath);
      if (state !== undefined) this.lockStates.set(abstractFile.path, state);
    }));

    this.registerEvent(this.app.vault.on('delete', (abstractFile) => {
      this.lockStates.delete(abstractFile.path);
      this.noticeTimes.delete(abstractFile.path);
    }));

    this.registerEvent(this.app.workspace.on('file-open', () => this.refreshAllViews()));
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.refreshAllViews()));
    this.registerEvent(this.app.workspace.on('layout-change', () => this.refreshAllViews()));
    this.app.workspace.onLayoutReady(() => this.refreshAllViews());

    this.addSettingTab(new NoteLockSettingTab(this.app, this));
  }

  onunload(): void {
    for (const view of this.allMarkdownViews()) this.clearViewDecorations(view);
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, (await this.loadData()) as Partial<NoteLockSettings> | null);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /** Re-evaluates every open editor and view after a settings change. */
  applySettingsChange(clearStates: boolean): void {
    if (clearStates) this.lockStates.clear();
    this.app.workspace.updateOptions();
    this.refreshAllViews();
  }

  // --- Lock state ---

  isFileLocked(file: TFile): boolean {
    if (file.extension !== 'md') return false;
    const cached = this.lockStates.get(file.path);
    if (cached !== undefined) return cached;
    return this.readFrontmatterLock(file);
  }

  private readFrontmatterLock(file: TFile): boolean {
    const value: unknown = this.app.metadataCache.getFileCache(file)?.frontmatter?.[this.settings.propertyName];
    return value === true || value === 'true';
  }

  private stateIsLocked(state: EditorState): boolean {
    const file = state.field(editorInfoField, false)?.file;
    return !!file && this.isFileLocked(file);
  }

  private isFullDocReplace(tr: Transaction): boolean {
    if (tr.annotation(Transaction.userEvent) !== undefined) return false;
    let changeCount = 0;
    let coversWholeDoc = false;
    tr.changes.iterChanges((fromA, toA) => {
      changeCount += 1;
      if (fromA === 0 && toA === tr.startState.doc.length) coversWholeDoc = true;
    });
    return changeCount === 1 && coversWholeDoc;
  }

  private handleMetadataChanged(file: TFile): void {
    if (file.extension !== 'md') return;
    const locked = this.readFrontmatterLock(file);
    const previous = this.lockStates.get(file.path);
    if (previous === locked) return;
    this.lockStates.set(file.path, locked);
    // Refresh on any flip, and on a lock first seen via sync/external edit.
    if (previous !== undefined || locked) {
      this.app.workspace.updateOptions();
      this.refreshAllViews();
    }
  }

  // --- Lock toggle (the single write path) ---

  async setLocked(file: TFile, locked: boolean): Promise<void> {
    if (locked) {
      // Flush pending debounced saves so the vault guard can never strand
      // keystrokes typed just before locking.
      for (const view of this.allMarkdownViews()) {
        if (view.file?.path === file.path) await view.save();
      }
    }
    this.lockStates.set(file.path, locked);
    this.bypassPath = file.path;
    try {
      await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
        if (locked) frontmatter[this.settings.propertyName] = true;
        else delete frontmatter[this.settings.propertyName];
      });
      new Notice(locked ? `Locked "${file.basename}"` : `Unlocked "${file.basename}"`);
    } catch (error) {
      this.lockStates.delete(file.path);
      new Notice(`Note Lock: could not update "${file.basename}"`);
      console.error('Note Lock: failed to update frontmatter', error);
    } finally {
      this.bypassPath = null;
    }
    this.app.workspace.updateOptions();
    this.refreshAllViews();
  }

  private async unlockFlow(file: TFile): Promise<void> {
    if (this.settings.confirmUnlock) {
      const confirmed = await ConfirmUnlockModal.confirm(this.app, file.basename);
      if (!confirmed) return;
    }
    await this.setLocked(file, false);
  }

  // --- Vault guard (blocks writes from any plugin, not just the editor) ---

  private installVaultGuard(): void {
    const vault = this.app.vault;
    const originalModify = vault.modify.bind(vault);
    const originalAppend = vault.append.bind(vault);
    const originalProcess = vault.process.bind(vault);
    const guard = (file: TFile): Promise<never> | null => this.guardRejection(file);

    vault.modify = (file, data, options) => guard(file) ?? originalModify(file, data, options);
    vault.append = (file, data, options) => guard(file) ?? originalAppend(file, data, options);
    vault.process = (file, fn, options) => guard(file) ?? originalProcess(file, fn, options);

    this.register(() => {
      vault.modify = originalModify;
      vault.append = originalAppend;
      vault.process = originalProcess;
    });
  }

  private guardRejection(file: TFile): Promise<never> | null {
    if (!(file instanceof TFile) || file.extension !== 'md') return null;
    if (file.path === this.bypassPath || !this.isFileLocked(file)) return null;
    this.notifyBlocked(file);
    return Promise.reject(new Error(`Note Lock: "${file.path}" is locked`));
  }

  private notifyBlocked(file: TFile): void {
    const now = Date.now();
    const last = this.noticeTimes.get(file.path) ?? 0;
    if (now - last < NOTICE_DEBOUNCE_MS) return;
    this.noticeTimes.set(file.path, now);
    new Notice(`"${file.basename}" is locked — unlock to edit`);
  }

  // --- View decorations (banner, dim, view action) ---

  private allMarkdownViews(): MarkdownView[] {
    const views: MarkdownView[] = [];
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.view instanceof MarkdownView) views.push(leaf.view);
    });
    return views;
  }

  refreshAllViews(): void {
    for (const view of this.allMarkdownViews()) this.refreshView(view);
  }

  private clearViewDecorations(view: MarkdownView): void {
    view.contentEl.querySelectorAll(`.${BANNER_CLASS}`).forEach((el) => el.remove());
    view.containerEl.querySelectorAll(`.${ACTION_CLASS}`).forEach((el) => el.remove());
    view.contentEl.querySelector<HTMLElement>('.markdown-source-view')
      ?.removeClasses([HAS_BANNER_CLASS, DIM_CLASS]);
  }

  private refreshView(view: MarkdownView): void {
    this.clearViewDecorations(view);
    const file = view.file;
    if (!file || !this.isFileLocked(file)) return;

    const sourceView = view.contentEl.querySelector<HTMLElement>('.markdown-source-view');
    if (sourceView) {
      sourceView.addClass(HAS_BANNER_CLASS);
      if (this.settings.dimLocked) sourceView.addClass(DIM_CLASS);

      const banner = sourceView.createDiv({
        cls: BANNER_CLASS,
        attr: { role: 'button', tabindex: '0', 'aria-label': 'Unlock note' }
      });
      setIcon(banner.createSpan({ cls: 'note-lock-banner-icon' }), 'lock');
      banner.createSpan({
        cls: 'note-lock-banner-text',
        text: `Locked — ${Platform.isMobile ? 'tap' : 'click'} to unlock`
      });
      banner.addEventListener('click', () => void this.unlockFlow(file));
      banner.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        void this.unlockFlow(file);
      });
      sourceView.prepend(banner);
    }

    const action = view.addAction('lock', 'Unlock note', () => void this.unlockFlow(file));
    action.addClass(ACTION_CLASS);
  }
}

// --- Settings tab -----------------------------------------------------------

class NoteLockSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: NoteLockPlugin) {
    super(app, plugin);
  }

  /** Declarative settings (Obsidian 1.13+): makes settings appear in Obsidian's settings search. */
  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        name: 'Lock property name',
        desc: PROPERTY_NAME_DESC,
        aliases: ['frontmatter', 'property', 'locked'],
        control: {
          type: 'text',
          key: 'propertyName',
          defaultValue: DEFAULT_SETTINGS.propertyName,
          placeholder: DEFAULT_SETTINGS.propertyName
        }
      },
      {
        name: 'Dim locked notes',
        desc: DIM_DESC,
        aliases: ['fade', 'opacity'],
        control: {
          type: 'toggle',
          key: 'dimLocked',
          defaultValue: DEFAULT_SETTINGS.dimLocked
        }
      },
      {
        name: 'Confirm before unlocking',
        desc: CONFIRM_DESC,
        aliases: ['confirmation', 'accidental unlock'],
        control: {
          type: 'toggle',
          key: 'confirmUnlock',
          defaultValue: DEFAULT_SETTINGS.confirmUnlock
        }
      }
    ];
  }

  getControlValue(key: string): unknown {
    switch (key) {
      case 'propertyName': return this.plugin.settings.propertyName;
      case 'dimLocked': return this.plugin.settings.dimLocked;
      case 'confirmUnlock': return this.plugin.settings.confirmUnlock;
      default: return undefined;
    }
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    switch (key) {
      case 'propertyName':
        if (typeof value === 'string') await this.applyPropertyName(value);
        return;
      case 'dimLocked':
        if (typeof value !== 'boolean') return;
        this.plugin.settings.dimLocked = value;
        await this.plugin.saveSettings();
        this.plugin.refreshAllViews();
        return;
      case 'confirmUnlock':
        if (typeof value !== 'boolean') return;
        this.plugin.settings.confirmUnlock = value;
        await this.plugin.saveSettings();
        return;
    }
  }

  private async applyPropertyName(raw: string): Promise<void> {
    const name = raw.trim() || DEFAULT_SETTINGS.propertyName;
    if (name === this.plugin.settings.propertyName) return;
    this.plugin.settings.propertyName = name;
    await this.plugin.saveSettings();
    this.plugin.applySettingsChange(true);
  }

  /**
   * Imperative fallback for Obsidian versions older than 1.13.0, where
   * getSettingDefinitions() isn't recognized. Not called at all on 1.13+,
   * where the declarative definitions above render instead.
   */
  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('Lock property name')
      .setDesc(PROPERTY_NAME_DESC)
      .addText((text) => text
        .setPlaceholder(DEFAULT_SETTINGS.propertyName)
        .setValue(this.plugin.settings.propertyName)
        .onChange(async (value) => {
          await this.applyPropertyName(value);
        }));

    new Setting(containerEl)
      .setName('Dim locked notes')
      .setDesc(DIM_DESC)
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.dimLocked)
        .onChange(async (value) => {
          this.plugin.settings.dimLocked = value;
          await this.plugin.saveSettings();
          this.plugin.refreshAllViews();
        }));

    new Setting(containerEl)
      .setName('Confirm before unlocking')
      .setDesc(CONFIRM_DESC)
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.confirmUnlock)
        .onChange(async (value) => {
          this.plugin.settings.confirmUnlock = value;
          await this.plugin.saveSettings();
        }));
  }
}
