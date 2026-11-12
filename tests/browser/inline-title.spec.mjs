import { test, expect } from '@playwright/test';
import { buildSync } from 'esbuild';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const bundle = buildSync({
  stdin: { contents: "export { default as NoteLock } from './src/main'; export { TFile } from 'obsidian';", resolveDir: root },
  bundle: true, platform: 'browser', format: 'iife', globalName: 'Fixture', write: false,
  alias: { obsidian: root + 'tests/browser/obsidian-stub.mjs' }
}).outputFiles[0].text;

async function selectTitle(page) {
  const box = await page.locator('.inline-title').evaluate(el => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const rect = range.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  await page.mouse.move(box.x + 1, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width + 2, box.y + box.height / 2, { steps: 15 });
  await page.mouse.up();
}

for (const theme of ['light', 'dark']) {
  for (const mode of ['Live Preview', 'Source', 'Reading view']) {
    test(`locked inline title stays copyable without permitting rename in ${mode}, ${theme} theme`, async ({ page }) => {
      await page.setContent(`<style>
        body { user-select: none; -webkit-user-select: none; }
        .theme-dark { background: #222; color: #eee; }
        .inline-title { font: 24px monospace; margin: 20px; }
      </style><div id="pane"><main class="view-content">
        <section class="${mode === 'Reading view' ? 'markdown-reading-view' : `markdown-source-view${mode === 'Live Preview' ? ' is-live-preview' : ''}`}">
          <div class="inline-title" contenteditable="true">Copy this locked title</div>
          <div class="metadata-properties-heading">Properties</div>
          <input type="checkbox" checked>
        </section>
      </main></div><textarea id="clipboard"></textarea>`);
      await page.locator('body').evaluate((el, themeName) => el.classList.add(`theme-${themeName}`), theme);
      await page.addStyleTag({ content: readFileSync(root + 'styles.css', 'utf8') });
      await page.addScriptTag({ content: bundle });
      await page.evaluate(async () => {
        // Exercise the real refresh/cleanup code with Obsidian's DOM helpers.
        HTMLElement.prototype.addClass = function (name) { this.classList.add(name); };
        HTMLElement.prototype.removeClass = function (name) { this.classList.remove(name); };
        HTMLElement.prototype.removeClasses = function (names) { this.classList.remove(...names); };
        window.testFile = new Fixture.TFile('Copy this locked title.md');
        window.locked = true;
        window.titleInputs = 0;
        window.plugin = new Fixture.NoteLock();
        plugin.app = {
          vault: { modify: async () => {}, append: async () => {}, process: async (_, fn) => fn('original'), on() {} },
          fileManager: { processFrontMatter: async () => {} },
          metadataCache: { getFileCache: () => ({ frontmatter: { locked } }), on() {} },
          workspace: { on() {}, onLayoutReady() {} }
        };
        await plugin.onload();
        plugin.settings = { ...plugin.settings, showLockBanner: false };
        window.view = {
          file: testFile, editor: {}, contentEl: document.querySelector('main'),
          containerEl: document.querySelector('#pane'),
          addAction: () => document.querySelector('#pane').appendChild(document.createElement('button'))
        };
        document.querySelector('.inline-title').addEventListener('input', () => titleInputs++);
        plugin.refreshView(view);
        plugin.refreshView(view);
      });
      const title = page.locator('.inline-title');
      await expect(title).toHaveAttribute('contenteditable', 'false');
      await expect(title).toHaveClass(/note-lock-title-locked/);
      await expect(title).toHaveCSS('user-select', 'text');
      await expect(page.locator('.metadata-properties-heading')).toHaveCSS('user-select', 'none');
      await expect(page.locator('.note-lock-banner')).toHaveCount(0);
      await selectTitle(page);
      expect(await page.evaluate(() => getSelection().toString())).toBe('Copy this locked title');
      await page.keyboard.press('ControlOrMeta+c');
      await page.locator('#clipboard').focus();
      await page.keyboard.press('ControlOrMeta+v');
      await expect(page.locator('#clipboard')).toHaveValue('Copy this locked title');
      await title.dblclick();
      expect(await page.evaluate(() => getSelection().toString().length)).toBeGreaterThan(0);
      await page.keyboard.type('BAD');
      for (const key of ['Backspace', 'Delete', 'Enter', 'ControlOrMeta+x', 'ControlOrMeta+v', 'ControlOrMeta+z']) {
        await page.keyboard.press(key);
      }
      await expect(title).toHaveText('Copy this locked title');
      expect(await page.evaluate(() => titleInputs)).toBe(0);
      await page.locator('input[type="checkbox"]').click();
      await expect(page.locator('input[type="checkbox"]')).toBeChecked();
      expect(await page.evaluate(() => testFile.path)).toBe('Copy this locked title.md');

      // Unlock restores the native editing host, then relocking restores selection only.
      await page.evaluate(() => { locked = false; plugin.lockStates.clear(); plugin.refreshView(view); });
      await expect(title).toHaveAttribute('contenteditable', 'true');
      await expect(title).not.toHaveClass(/note-lock-title-locked/);
      await expect(title).toHaveCSS('user-select', 'none');
      await title.fill('Renamed after unlock');
      expect(await page.evaluate(() => titleInputs)).toBeGreaterThan(0);
      await page.evaluate(() => { locked = true; plugin.lockStates.clear(); plugin.refreshView(view); });
      await expect(title).toHaveAttribute('contenteditable', 'false');
      await expect(title).toHaveCSS('user-select', 'text');
      await selectTitle(page);
      expect(await page.evaluate(() => getSelection().toString())).toBe('Renamed after unlock');
      await page.keyboard.press('Delete');
      await expect(title).toHaveText('Renamed after unlock');

      await page.evaluate(() => plugin.clearViewDecorations(view));
      await expect(title).not.toHaveClass(/note-lock-title-locked/);
      await expect(title).toHaveAttribute('contenteditable', 'true');
      await expect(title).toHaveCSS('user-select', 'none');
    });
  }
}
