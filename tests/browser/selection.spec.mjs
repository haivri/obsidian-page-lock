import { test, expect } from '@playwright/test';
import { buildSync } from 'esbuild';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const bundle = buildSync({ stdin: { contents: "export { default as NoteLock } from './src/main'; export { EditorState, Prec } from '@codemirror/state'; export { EditorView } from '@codemirror/view'; export { TFile, editorInfoField } from 'obsidian';", resolveDir: root }, bundle: true, platform: 'browser', format: 'iife', globalName: 'Fixture', write: false, alias: { obsidian: root + 'tests/browser/obsidian-stub.mjs' } }).outputFiles[0].text;

test('locked CodeMirror remains selectable and copyable under Obsidian body CSS, with edits blocked', async ({ page }) => {
  await page.setContent('<style>body { user-select: none; -webkit-user-select: none; } .cm-editor {font:20px monospace;width:600px;} </style><main></main><textarea id="clipboard"></textarea>');
  await page.addStyleTag({ content: readFileSync(root + 'styles.css', 'utf8') });
  await page.addScriptTag({ content: bundle });
  await page.evaluate(async () => {
    const { NoteLock, EditorState, EditorView, TFile, editorInfoField, Prec } = Fixture;
    window.testFile = new TFile('note.md'); window.locked = true;
    window.plugin = new NoteLock();
    plugin.app = {
      vault: { modify: async () => {}, append: async () => {}, process: async (_, fn) => fn('original'), on() {} },
      fileManager: { processFrontMatter: async () => {} },
      metadataCache: { getFileCache: () => ({ frontmatter: { locked } }), on() {} },
      workspace: { on() {}, onLayoutReady() {} },
    };
    await plugin.onload();
    window.editor = new EditorView({ parent: document.querySelector('main'), state: EditorState.create({ doc: 'Copy these locked words\nSecond line stays safe', extensions: [editorInfoField, plugin.extensions, Prec.high(EditorView.contentAttributes.of({ contenteditable: 'true' }))] }) });
  });
  const content = page.locator('.cm-content');
  await expect(content).toHaveAttribute('contenteditable', 'false');
  await expect(content).toHaveCSS('user-select', 'text');
  const line = page.locator('.cm-line').first(); const box = await line.evaluate(el => { const range = document.createRange(); range.selectNodeContents(el); const r = range.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
  await page.mouse.move(box.x + 1, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width + 2, box.y + box.height / 2, { steps: 15 }); await page.mouse.up();
  const selected = await page.evaluate(() => window.getSelection().toString());
  expect(selected).toBe('Copy these locked words');
  await page.keyboard.press('ControlOrMeta+c');
  await page.locator('#clipboard').focus(); await page.keyboard.press('ControlOrMeta+v');
  await expect(page.locator('#clipboard')).toHaveValue(selected);
  await line.click(); await page.keyboard.type('SHOULD NOT APPEAR');
  await page.keyboard.press('Backspace'); await page.keyboard.press('Delete'); await page.keyboard.press('ControlOrMeta+v');
  await page.mouse.move(box.x + 1, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width + 2, box.y + box.height / 2, { steps: 10 }); await page.mouse.up();
  await page.keyboard.press('ControlOrMeta+x');
  await expect(content).toHaveText('Copy these locked wordsSecond line stays safe');
  expect(await page.evaluate(() => { editor.dispatch({ changes: { from: 1, to: 4, insert: 'bad' }, userEvent: 'input' }); return editor.state.doc.toString(); })).toBe('Copy these locked words\nSecond line stays safe');
  await page.evaluate(() => { locked = false; plugin.lockStates.clear(); editor.dispatch({ effects: plugin.setLockedEffect.of(false) }); editor.focus(); });
  await expect(content).toHaveAttribute('contenteditable', 'true'); await expect(content).not.toHaveAttribute('data-page-lock');
  await page.keyboard.type('Editable'); await expect(content).toContainText('Editable');
});


for (const mode of ['Live Preview', 'Reading view']) {
  test(`locked YAML Properties text can be selected and copied in ${mode}`, async ({ page }) => {
    await page.setContent(`<style>
      body { user-select: none; -webkit-user-select: none; }
      .metadata-container { user-select: none; -webkit-user-select: none; }
      .yaml-properties-yaml-readonly { white-space: pre; font: 18px monospace; }
    </style><main class="note-lock-images-locked">
      <section class="${mode === 'Live Preview' ? 'markdown-source-view is-live-preview' : 'markdown-reading-view'}">
        <div class="metadata-container yaml-properties-managed">
          <div class="metadata-properties-heading">Properties</div>
          <div class="yaml-properties-yaml"><div class="yaml-properties-yaml-readonly"><span class="yaml-key">title</span>: <span class="yaml-string">Copy this property</span>\n<span class="yaml-key">locked</span>: <span class="yaml-boolean">true</span></div></div>
        </div>
        <input type="checkbox" checked><textarea class="other-widget">Protected widget</textarea>
      </section>
    </main><textarea id="clipboard"></textarea>`);
    await page.addStyleTag({ content: readFileSync(root + 'styles.css', 'utf8') });
    await page.addScriptTag({ content: bundle });
    await page.evaluate(async () => {
      window.plugin = new Fixture.NoteLock();
      window.testFile = new Fixture.TFile('note.md');
      window.saved = 'original';
      plugin.app = {
        vault: { modify: async () => {}, append: async () => {}, process: async (_, fn) => { saved = fn(saved); }, on() {} },
        fileManager: { processFrontMatter: async () => {} },
        metadataCache: { getFileCache: () => ({ frontmatter: { locked: true } }), on() {} },
        workspace: { on() {}, onLayoutReady() {} },
      };
      await plugin.onload();
      plugin.installControlGuard({ file: testFile, contentEl: document.querySelector('main') });
    });
    const yaml = page.locator('.yaml-properties-yaml-readonly');
    await expect(yaml).toHaveCSS('user-select', 'text');
    expect(await yaml.evaluate(el => el.isContentEditable)).toBe(false);
    await expect(page.locator('.metadata-properties-heading')).toHaveCSS('user-select', 'none');
    const value = page.locator('.yaml-string');
    const box = await value.boundingBox();
    await page.mouse.move(box.x + 1, box.y + box.height / 2); await page.mouse.down();
    await page.mouse.move(box.x + box.width + 1, box.y + box.height / 2, { steps: 12 }); await page.mouse.up();
    expect(await page.evaluate(() => getSelection().toString())).toBe('Copy this property');
    await page.keyboard.press('ControlOrMeta+c');
    await page.locator('#clipboard').focus(); await page.keyboard.press('ControlOrMeta+v');
    await expect(page.locator('#clipboard')).toHaveValue('Copy this property');
    await value.dblclick();
    expect(await page.evaluate(() => getSelection().toString().length)).toBeGreaterThan(0);
    await page.keyboard.type('BAD'); await page.keyboard.press('Backspace');
    await page.keyboard.press('Delete'); await page.keyboard.press('ControlOrMeta+x'); await page.keyboard.press('ControlOrMeta+v');
    await expect(yaml).toHaveText('title: Copy this property\nlocked: true');
    await page.locator('input[type=checkbox]').click();
    await expect(page.locator('input[type=checkbox]')).toBeChecked();
    expect(await page.evaluate(async () => {
      try { await plugin.app.vault.process(testFile, () => 'BAD'); return 'write allowed'; }
      catch { return saved; }
    })).toBe('original');
    // Removing lock decorations restores the original host styling.
    await page.evaluate(() => {
      document.querySelector('main').classList.remove('note-lock-images-locked');
      for (const cleanup of plugin.cleanups) cleanup();
    });
    await expect(yaml).toHaveCSS('user-select', 'none');
  });
}
