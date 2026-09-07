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

test('mobile banner uses the note inset without moving the toolbar and disappears on unlock', () => {
  const { plugin, file } = setup();
  const dom = new JSDOM('<main><header>Toolbar</header><section><div class="markdown-source-view"><div class="cm-editor"><div class="cm-scroller"><div class="cm-sizer"><div class="inline-title">Title</div><div class="cm-content">Note</div></div></div></div></div></section></main>');
  const { document, HTMLElement } = dom.window;
  HTMLElement.prototype.addClass = function (name) { this.classList.add(name); };
  HTMLElement.prototype.removeClass = function (name) { this.classList.remove(name); };
  HTMLElement.prototype.removeClasses = function (names) { this.classList.remove(...names); };
  HTMLElement.prototype.createEl = function (tag, options = {}) {
    const el = document.createElement(tag);
    if (options.cls) el.className = options.cls;
    if (options.text) el.textContent = options.text;
    for (const [key, value] of Object.entries(options.attr ?? {})) el.setAttribute(key, value);
    this.append(el); return el;
  };
  HTMLElement.prototype.createDiv = function (options) { return this.createEl('div', options); };
  HTMLElement.prototype.createSpan = function (options) { return this.createEl('span', options); };
  obsidian.Platform = { isMobile: true };
  obsidian.setIcon = () => {};
  const container = document.querySelector('main');
  const header = document.querySelector('header');
  const view = { containerEl: container, contentEl: document.querySelector('section'), file, editor: {},
    addAction: () => header.createEl('button') };
  plugin.refreshView(view);
  assert.equal(container.firstElementChild, header);
  assert.equal(container.getAttribute('style'), null);
  assert.equal(document.querySelector('.note-lock-banner').nextElementSibling, document.querySelector('.inline-title'));
  assert.equal(document.querySelector('.markdown-source-view').classList.contains('note-lock-has-banner'), false);
  plugin.refreshView(view);
  assert.equal(document.querySelectorAll('.note-lock-banner').length, 1);
  plugin.lockStates.set(file.path, false);
  plugin.refreshView(view);
  assert.equal(document.querySelector('.note-lock-banner'), null);
  assert.equal(container.firstElementChild, header);
  for (const cleanup of plugin.cleanups) cleanup();
  dom.window.close();
});
