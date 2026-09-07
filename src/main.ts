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
import { Annotation, EditorState, Prec, StateEffect, StateField, Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

/** Marks note-lock's own editor re-sync transactions so the filter lets them through. */
const reloadAnnotation = Annotation.define<boolean>();

// --- Settings ---------------------------------------------------------------

interface NoteLockSettings {
  propertyName: string;
  confirmUnlock: boolean;
}

const DEFAULT_SETTINGS: NoteLockSettings = {
  propertyName: 'locked',
  confirmUnlock: false
};

// --- Constants --------------------------------------------------------------

const BANNER_CLASS = 'note-lock-banner';
const HAS_BANNER_CLASS = 'note-lock-has-banner';
const ACTION_CLASS = 'note-lock-action';
const TITLE_LOCKED_CLASS = 'note-lock-title-locked';
const NOTICE_DEBOUNCE_MS = 2000;

const PROPERTY_NAME_DESC =
  'Frontmatter property that marks a note as locked. The lock travels with the note, ' +
  'so it syncs to other devices. Existing notes keep any previously used property.';
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

  /**
   * Per-editor lock state. Initialized when an editor is created and updated
   * by dispatching setLockedEffect from the refresh pass — computed facets are
   * only evaluated at editor creation and workspace.updateOptions() does not
   * reliably re-evaluate them, which left unlocked notes read-only until the
   * editor was recreated.
   */
  private readonly setLockedEffect = StateEffect.define<boolean>();

  private readonly lockedField = StateField.define<boolean>({
    create: (state) => this.stateIsLocked(state),
    update: (value, tr) => {
      for (const effect of tr.effects) {
        if (effect.is(this.setLockedEffect)) return effect.value;
      }
      return value;
    }
  });

  private readonly guardedViews = new WeakSet<MarkdownView>();

  private readonly noticeTimes = new Map<string, number>();

  async onload(): Promise<void> {
    await this.loadSettings();

    this.registerEditorExtension([
      EditorState.transactionFilter.of((tr) => {
        if (!tr.docChanged) return tr;
        const file = tr.startState.field(editorInfoField, false)?.file;
        if (!file || !this.isFileLocked(file)) return tr;
        if (tr.annotation(reloadAnnotation)) return tr;
        // Obsidian reloads an editor from disk as one full-document replacement
        // with no userEvent annotation; sync updates and our own frontmatter
        // write must still render. Anything else is an edit — block it.
        // (Obsidian sometimes reloads as a diff instead; syncEditorsToDisk
        // repairs those after the vault 'modify' event.)
        if (this.isFullDocReplace(tr)) return tr;
        this.notifyBlocked(file);
        return [];
      }),
      this.lockedField,
      EditorView.editable.from(this.lockedField, (locked) => !locked),
      EditorState.readOnly.from(this.lockedField, (locked) => locked),
      // The editable facet above can lose to Obsidian's own higher-precedence
      // provider, leaving a live cursor on locked notes. Attribute sources are
      // applied lowest-precedence first and plugin extensions sit at the
      // bottom of that stack, so the assertion must carry highest precedence
      // to actually land on the DOM. Asserted only while locked so unlocked
      // notes stay entirely Obsidian-managed.
      Prec.highest(EditorView.contentAttributes.from(this.lockedField, (locked): Record<string, string> =>
        locked ? { contenteditable: 'false' } : {}))
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

    // Obsidian's disk->editor reload is not always the full-document replacement
    // the transaction filter allows — it can apply a cursor-preserving diff,
    // which the filter blocks, leaving the editor stale after our frontmatter
    // write or a sync update. Re-sync stale editors ourselves.
    this.registerEvent(this.app.vault.on('modify', (abstractFile) => {
      if (abstractFile instanceof TFile && this.isFileLocked(abstractFile)) {
        window.setTimeout(() => void this.syncEditorsToDisk(abstractFile), 100);
      }
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
      if (!locked) await this.removeEmptyFrontmatter(file);
      new Notice(locked ? `Locked "${file.basename}"` : `Unlocked "${file.basename}"`);
    } catch (error) {
      this.lockStates.delete(file.path);
      new Notice(`Note Lock: could not update "${file.basename}"`);
      console.error('Note Lock: failed to update frontmatter', error);
    } finally {
      this.bypassPath = null;
    }
    // Re-sync immediately (not only via the delayed vault-modify path) so
    // anything reacting to the metadata change sees a fresh editor.
    if (locked) await this.syncEditorsToDisk(file);
    this.refreshAllViews();
  }

  /**
   * processFrontMatter can leave an empty `---` block behind when the lock was
   * the note's only property; strip it so no phantom lines remain after unlock.
   */
  private async removeEmptyFrontmatter(file: TFile): Promise<void> {
    const content = await this.app.vault.read(file);
    const match = content.match(/^---[ \t]*\n(?:[ \t]*\n)*---[ \t]*\r?\n?/);
    if (!match) return;
    await this.app.vault.modify(file, content.slice(match[0].length));
  }

  private async syncEditorsToDisk(file: TFile): Promise<void> {
    if (!this.isFileLocked(file)) return;
    let content: string;
    try {
      content = await this.app.vault.cachedRead(file);
    } catch {
      return;
    }
    for (const view of this.allMarkdownViews()) {
      if (view.file?.path !== file.path) continue;
      const cm = (view.editor as unknown as { cm?: EditorView }).cm;
      if (!cm || cm.state.doc.toString() === content) continue;
      cm.dispatch({
        changes: { from: 0, to: cm.state.doc.length, insert: content },
        annotations: reloadAnnotation.of(true)
      });
    }
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
    const fileManager = this.app.fileManager;
    const originalFrontMatter = fileManager.processFrontMatter.bind(fileManager);
    const guard = (file: TFile): Promise<never> | null => this.guardRejection(file);

    // The read-only editor still flushes saves (mode switches, interval saves);
    // those carry unchanged content and must succeed as no-ops, or Obsidian
    // shows "failed to save" and refuses to switch to reading mode.
    vault.modify = async (file, data, options) => {
      if (this.isGuarded(file)) {
        if (data === await vault.cachedRead(file)) return;
        this.notifyBlocked(file);
        throw new Error(`Note Lock: "${file.path}" is locked`);
      }
      return originalModify(file, data, options);
    };
    vault.append = (file, data, options) => guard(file) ?? originalAppend(file, data, options);
    // Same no-op tolerance for process: a transform that leaves the content
    // unchanged is not an edit, and some Obsidian save paths go through here.
    vault.process = async (file, fn, options) => {
      if (this.isGuarded(file)) {
        const current = await vault.cachedRead(file);
        const result = fn(current);
        if (result === current) return result;
        this.notifyBlocked(file);
        throw new Error(`Note Lock: "${file.path}" is locked`);
      }
      return originalProcess(file, fn, options);
    };

    // Meta Bind and property widgets can use this path without going through
    // the public vault methods. Reject before their callback changes metadata.
    fileManager.processFrontMatter = (file, fn, options) =>
      guard(file) ?? originalFrontMatter(file, fn, options);

    this.register(() => {
      fileManager.processFrontMatter = originalFrontMatter;
      vault.modify = originalModify;
      vault.append = originalAppend;
      vault.process = originalProcess;
    });
  }

  private isGuarded(file: TFile): boolean {
    if (!(file instanceof TFile) || file.extension !== 'md') return false;
    return file.path !== this.bypassPath && this.isFileLocked(file);
  }

  private guardRejection(file: TFile): Promise<never> | null {
    if (!this.isGuarded(file)) return null;
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

  /** Stop widgets before their handlers update local state or queue a save. */
  private installControlGuard(view: MarkdownView): void {
    if (this.guardedViews.has(view)) return;
    this.guardedViews.add(view);
    const intercept = (event: Event): void => {
      // Use the event path so controls also work in detached Obsidian windows.
      const target = event.composedPath()[0] as Element | undefined;
      if (!target || typeof target.closest !== 'function') return;
      if (target.closest(`.${BANNER_CLASS}, .${ACTION_CLASS}`)) return;
      const control = target.closest([
        'input', 'textarea', 'select',
        '[role="checkbox"]', '[role="switch"]', '[role="slider"]',
        '[role="spinbutton"]', '[role="combobox"]',
        '.checkbox-container', '.task-list-item-checkbox',
        '.mb-input', '.mb-input-wrapper', '.mb-button',
        '.metadata-property-value',
        '[contenteditable="true"]:not(.cm-content)'
      ].join(', '));
      // Clicking an associated label activates its input too.
      const label = target.closest('label');
      if (!control && !label?.control) return;
      let file = view.file;
      const embed = target.closest('.internal-embed[src]');
      const source = embed?.getAttribute('src');
      if (source && file) {
        const embeddedFile = this.app.metadataCache.getFirstLinkpathDest(source.split('#')[0], file.path);
        // A locked host also protects controls bound to other notes.
        if (!this.isFileLocked(file) && embeddedFile) file = embeddedFile;
      }
      if (!file || !this.isFileLocked(file)) return;
      if (event.type === 'keydown') {
        const key = event as KeyboardEvent;
        // Preserve keyboard navigation and copying values from locked fields.
        if (key.key === 'Tab' || key.key === 'Escape' ||
          ((key.ctrlKey || key.metaKey) && ['a', 'c'].includes(key.key.toLowerCase()))) return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      this.notifyBlocked(file);
    };
    // Capture on the view, before native checkbox activation, Meta Bind's
    // handlers, and CodeMirror widgets. Delegation covers subsequent renders.
    for (const name of ['pointerdown', 'mousedown', 'touchstart', 'click', 'dblclick',
      'keydown', 'beforeinput', 'input', 'change', 'paste', 'cut', 'drop']) {
      this.registerDomEvent(view.contentEl, name as keyof HTMLElementEventMap, intercept,
        { capture: true, passive: false });
    }
  }

  private clearViewDecorations(view: MarkdownView): void {
    view.contentEl.querySelectorAll(`.${BANNER_CLASS}`).forEach((el) => el.remove());
    view.containerEl.querySelectorAll(`.${ACTION_CLASS}`).forEach((el) => el.remove());
    view.contentEl.querySelector<HTMLElement>('.markdown-source-view')
      ?.removeClasses([HAS_BANNER_CLASS]);
    view.contentEl.querySelectorAll<HTMLElement>(`.inline-title.${TITLE_LOCKED_CLASS}`).forEach((el) => {
      el.contentEditable = 'true';
      el.removeClass(TITLE_LOCKED_CLASS);
    });
  }

  private refreshView(view: MarkdownView): void {
    this.installControlGuard(view);
    this.clearViewDecorations(view);
    const file = view.file;
    if (!file || file.extension !== 'md') return;
    const locked = this.isFileLocked(file);

    const cm = (view.editor as unknown as { cm?: EditorView }).cm;
    if (cm && cm.state.field(this.lockedField, false) !== locked) {
      cm.dispatch({ effects: this.setLockedEffect.of(locked) });
    }

    const action = locked
      ? view.addAction('lock', 'Unlock note', () => void this.unlockFlow(file))
      : view.addAction('lock-open', 'Lock note', () => void this.setLocked(file, true));
    action.addClass(ACTION_CLASS);

    if (!locked) return;

    // The inline title is a contenteditable element outside CodeMirror; left
    // alone it would still allow renaming a locked note.
    view.contentEl.querySelectorAll<HTMLElement>('.inline-title').forEach((el) => {
      el.contentEditable = 'false';
      el.addClass(TITLE_LOCKED_CLASS);
    });

    const sourceView = view.contentEl.querySelector<HTMLElement>('.markdown-source-view');
    if (sourceView) {
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
      // Mobile places the toolbar over the editor. Put our banner in the
      // note's existing content inset, before the inline title, so we reuse
      // Obsidian's safe-area spacing without moving its floating controls.
      const title = Platform.isMobile ? sourceView.querySelector('.inline-title') : null;
      const sizer = Platform.isMobile ? sourceView.querySelector('.cm-sizer') : null;
      if (title?.parentElement) {
        title.before(banner);
      } else if (sizer) {
        sizer.prepend(banner);
      } else {
        sourceView.addClass(HAS_BANNER_CLASS);
        if (Platform.isMobile) banner.addClass('note-lock-banner-fallback');
        sourceView.prepend(banner);
      }
    }
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
      case 'confirmUnlock': return this.plugin.settings.confirmUnlock;
      default: return undefined;
    }
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    switch (key) {
      case 'propertyName':
        if (typeof value === 'string') await this.applyPropertyName(value);
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
