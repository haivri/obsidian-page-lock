import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';

const require = createRequire(import.meta.url);
class TFile {
  extension = 'md';
  constructor(path) { this.path = path; this.basename = path; }
}
class Plugin {
  cleanups = [];
  register(fn) { this.cleanups.push(fn); }
  registerDomEvent(el, name, fn, options) {
    el.addEventListener(name, fn, options);
    this.register(() => el.removeEventListener(name, fn, options));
  }
}
const obsidian = { Plugin, TFile, Modal: class {}, PluginSettingTab: class {}, Notice: class {} };
const module = { exports: {} };
runInNewContext(readFileSync(new URL('../main.js', import.meta.url), 'utf8'), {
  module, exports: module.exports,
  require: (name) => name === 'obsidian' ? obsidian : require(name),
  console, Date, window: {},
});
const NoteLock = module.exports.default;

function setup(locked = true) {
  const plugin = new NoteLock();
  const file = new TFile('note.md');
  const calls = [];
  const vault = {
    cachedRead: async () => 'original',
    modify: async (...args) => calls.push(['modify', ...args]),
    append: async (...args) => calls.push(['append', ...args]),
    process: async (_file, fn) => fn('original'),
  };
  plugin.app = {
    vault,
    fileManager: { processFrontMatter: async (_file, fn) => { calls.push(['frontmatter']); fn({}); } },
    metadataCache: { getFileCache: () => ({ frontmatter: { locked } }), getFirstLinkpathDest: () => null },
  };
  return { plugin, file, calls };
}

test('locked metadata rejects before invoking the plugin callback; unlock writes still work', async () => {
  const { plugin, file, calls } = setup();
  plugin.installVaultGuard();
  let invoked = false;
  await assert.rejects(plugin.app.fileManager.processFrontMatter(file, () => { invoked = true; }), /locked/);
  assert.equal(invoked, false);
  assert.equal(calls.length, 0);
  plugin.bypassPath = file.path;
  await plugin.app.fileManager.processFrontMatter(file, () => { invoked = true; });
  assert.equal(invoked, true);
  plugin.bypassPath = null;
  await assert.rejects(plugin.app.vault.modify(file, 'changed'), /locked/);
  await plugin.app.vault.modify(file, 'original');
  await assert.rejects(plugin.app.vault.append(file, 'changed'), /locked/);
  await assert.rejects(plugin.app.vault.process(file, () => 'changed'), /locked/);
  for (const cleanup of plugin.cleanups) cleanup();
  await plugin.app.fileManager.processFrontMatter(file, () => {});
  assert.equal(calls.length, 2);
});

test('unlocked metadata remains editable', async () => {
  const { plugin, file, calls } = setup(false);
  plugin.installVaultGuard();
  await plugin.app.fileManager.processFrontMatter(file, (fm) => { fm.value = 1; });
  assert.equal(calls.length, 1);
});

for (const locked of [true, false]) {
  test(`rendered controls ${locked ? 'block' : 'allow'} interactions and keep navigation available`, () => {
    const { plugin, file } = setup(locked);
    const dom = new JSDOM(`<main>
      <input id="check" type="checkbox"><label for="check" id="label">Task</label>
      <div class="mb-input"><div id="bound" role="checkbox">Toggle</div></div>
      <div class="mb-input"><input id="text"></div>
      <div class="metadata-property-value"><span id="property">Value</span></div>
      <a id="link" href="#destination">Link</a>
      <button class="note-lock-banner" id="unlock">Unlock</button>
    </main>`);
    const { document, MouseEvent, KeyboardEvent, Event } = dom.window;
    const root = document.querySelector('main');
    const view = { contentEl: root, file };
    plugin.installControlGuard(view);
    plugin.installControlGuard(view);
    const click = (id) => document.getElementById(id).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    let boundChanges = 0;
    document.getElementById('bound').addEventListener('click', () => boundChanges++);
    assert.equal(click('check'), !locked);
    assert.equal(document.getElementById('check').checked, !locked);
    assert.equal(click('label'), !locked);
    assert.equal(document.getElementById('check').checked, false);
    assert.equal(click('bound'), !locked);
    assert.equal(boundChanges, locked ? 0 : 1);
    assert.equal(click('property'), !locked);
    for (const type of ['pointerdown', 'touchstart', 'beforeinput', 'paste', 'drop']) {
      assert.equal(document.getElementById('text').dispatchEvent(new Event(type, { bubbles: true, cancelable: true })), !locked);
    }
    const key = (key, options = {}) => document.getElementById('text').dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options }));
    assert.equal(key(' '), !locked);
    assert.equal(key('Tab'), true);
    assert.equal(key('c', { metaKey: true }), true);
    assert.equal(click('link'), true);
    assert.equal(click('unlock'), true);
    // A reused view must consult its current file, not the file at registration.
    plugin.lockStates.set(file.path, false);
    assert.equal(click('bound'), true);
    for (const cleanup of plugin.cleanups) cleanup();
    plugin.lockStates.set(file.path, true);
    assert.equal(click('bound'), true);
    dom.window.close();
  });
}
