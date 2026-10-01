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
obsidian.getFrontMatterInfo = (content) => {
  const match = /^(---\r?\n)([\s\S]*?)(^---(?:\r?\n|$))/m.exec(content);
  if (!match || match.index !== 0) return { exists: false, contentStart: 0 };
  return { exists: true, from: match[1].length, to: match[1].length + match[2].length,
    contentStart: match[0].length, frontmatter: match[2] };
};
const module = { exports: {} };
runInNewContext(readFileSync(new URL('../main.js', import.meta.url), 'utf8'), {
  module, exports: module.exports,
  require: (name) => name === 'obsidian' ? obsidian : require(name),
  console, Date, window: {},
});
const NoteLock = module.exports.default;

function renameSetup(content, options = {}) {
  const { plugin, file } = setup();
  plugin.settings = { ...plugin.settings, ...options };
  const unlocked = new TFile('unlocked.md');
  const contents = new Map([[file.path, content], [unlocked.path, '[[Old]]']]);
  const delegated = [];
  const cache = plugin.app.metadataCache;
  cache.getFileCache = (f) => ({ frontmatter: { locked: f === file } });
  const vault = plugin.app.vault;
  vault.getAbstractFileByPath = (path) => [file, unlocked].find((f) => f.path === path);
  vault.cachedRead = async (f) => contents.get(f.path);
  vault.process = async (f, fn) => {
    const next = fn(contents.get(f.path));
    contents.set(f.path, next);
    return next;
  };
  cache.updateInternalLinks = async (batch) => {
    for (const path of batch.keys()) {
      delegated.push(path);
      await vault.process(vault.getAbstractFileByPath(path), (text) => {
        for (const { reference: { original }, change } of batch.get(path)) text = text.replace(original, change);
        return text;
      });
    }
  };
  const original = cache.updateInternalLinks;
  plugin.installVaultGuard();
  const run = (updates, extra = []) => cache.updateInternalLinks(new Map([[file.path, updates], ...extra]));
  return { plugin, file, unlocked, vault, cache, contents, delegated, run, original };
}

function linkReplacement(content, original, change, from = 0) {
  const offset = content.indexOf(original, from);
  assert.ok(offset >= 0);
  return { reference: { original, position: { start: { offset }, end: { offset: offset + original.length } } }, change };
}

test('existing installations enable link updates by default and retain an explicit opt-out', async () => {
  const plugin = new NoteLock();
  plugin.loadData = async () => ({ propertyName: 'protected', showLockBanner: false });
  await plugin.loadSettings();
  assert.equal(plugin.settings.allowLinkUpdates, true);
  assert.equal(plugin.settings.propertyName, 'protected');
  assert.equal(plugin.settings.showLockBanner, false);
  plugin.loadData = async () => ({ allowLinkUpdates: false });
  await plugin.loadSettings();
  assert.equal(plugin.settings.allowLinkUpdates, false);
});

test('native rename updates only planned wikilinks, embeds, Markdown links and references', async () => {
  const content = '---\nlocked: true\n---\n# Keep heading\n[[Old]] [[Old#Heading|My alias]] ![[Old#^block]]\n[Old](Old.md) ![photo](Old%20image.png)\n[ref]: Old.md\n- [ ] Keep task\nOld prose and `[[Old]]` stay.\n';
  const pairs = [
    ['[[Old]]', '[[New]]'], ['[[Old#Heading|My alias]]', '[[New#Heading|My alias]]'],
    ['![[Old#^block]]', '![[New#^block]]'], ['[Old](Old.md)', '[New](New.md)'],
    ['![photo](Old%20image.png)', '![photo](New%20image.png)'], ['[ref]: Old.md', '[ref]: New.md'],
  ];
  const { run, contents, file, plugin, vault } = renameSetup(content);
  await run(pairs.map(([before, after]) => linkReplacement(content, before, after)));
  assert.equal(contents.get(file.path), pairs.reduce((text, [before, after]) => text.replace(before, after), content));
  assert.equal(plugin.isFileLocked(file), true);
  await assert.rejects(vault.modify(file, content + 'unrelated'), /locked/);
  await assert.rejects(vault.process(file, (text) => text.replace('Keep task', 'Changed task')), /locked/);
  await assert.rejects(plugin.app.fileManager.processFrontMatter(file, () => {}), /locked/);
});

test('property link replacements preserve other YAML, comments, whitespace, CRLF and body', async () => {
  const content = '---\r\nlocked: true # keep\r\nrelated: \'[[Old]]\' # link\r\nlist: ["[[Old#Heading|Alias]]", untouched]\r\nnested:\r\n  link: "[[Old]]"\r\nother:   "keep quotes"\r\n---\r\nBody [[Old]]\r\n';
  const { run, contents, file } = renameSetup(content);
  await run([
    { reference: { key: 'related', original: '[[Old]]' }, change: '[[New]]' },
    { reference: { key: 'list.0', original: '[[Old#Heading|Alias]]' }, change: '[[New#Heading|Alias]]' },
    { reference: { key: 'nested.link', original: '[[Old]]' }, change: '[[New]]' },
    linkReplacement(content, '[[Old]]', '[[New]]', content.indexOf('Body')),
  ]);
  assert.equal(contents.get(file.path), content.replace("'[[Old]]'", '"[[New]]"')
    .replace('[[Old#Heading|Alias]]', '[[New#Heading|Alias]]')
    .replace('link: "[[Old]]"', 'link: "[[New]]"').replace('Body [[Old]]', 'Body [[New]]'));
});

test('property block scalars keep the following line separate', async () => {
  const content = '---\nlocked: true\nrelated: >-\n  [[Old]]\nkeep: true\n---\nBody';
  const { run, contents, file } = renameSetup(content);
  await run([{ reference: { key: 'related', original: '[[Old]]' }, change: '[[New]]' }]);
  assert.equal(contents.get(file.path), content.replace('>-\n  [[Old]]\n', '"[[New]]"\n'));
});

test('opt-out skips locked links but still updates unlocked notes in the same batch', async () => {
  const { run, contents, file, unlocked, delegated } = renameSetup('[[Old]]', { allowLinkUpdates: false });
  const updates = [linkReplacement('[[Old]]', '[[Old]]', '[[New]]')];
  await run(updates, [[unlocked.path, updates]]);
  assert.equal(contents.get(file.path), '[[Old]]');
  assert.equal(contents.get(unlocked.path), '[[New]]');
  assert.deepEqual(delegated, [unlocked.path]);
});

test('stale or overlapping references fail without partial changes', async () => {
  for (const content of ['[[Old]] keep [[Second]]', '---\nlocked: true\nrelated: "[[Other]]"\n---\n[[Old]]']) {
    const { run, contents, file } = renameSetup(content);
    const valid = linkReplacement(content, '[[Old]]', '[[New]]');
    const invalid = content.startsWith('---')
      ? { reference: { key: 'related', original: '[[Old]]' }, change: '[[New]]' }
      : { reference: { original: '[[Second]]', position: { start: { offset: 0 }, end: { offset: 10 } } }, change: '[[New]]' };
    await run([valid, invalid]);
    assert.equal(contents.get(file.path), content);
    await run([valid, valid]);
    assert.equal(contents.get(file.path), content);
  }
});

test('concurrent edits stay blocked while a native link update is pending; unload restores hook', async () => {
  const { plugin, vault, cache, original, file, contents, run } = renameSetup('[[Old]]');
  // Delay the trusted atomic process independently of the public guarded API.
  let resume;
  let began;
  const started = new Promise((resolve) => { began = resolve; });
  for (const cleanup of plugin.cleanups) cleanup();
  plugin.cleanups = [];
  const atomic = vault.process;
  vault.process = async (...args) => {
    began();
    await new Promise((resolve) => { resume = resolve; });
    return atomic(...args);
  };
  plugin.installVaultGuard();
  const pending = run([linkReplacement('[[Old]]', '[[Old]]', '[[New]]')]);
  await started;
  await assert.rejects(vault.modify(file, 'unrelated'), /locked/);
  await assert.rejects(vault.process(file, () => 'unrelated'), /locked/);
  await assert.rejects(vault.append(file, 'unrelated'), /locked/);
  resume();
  await pending;
  assert.equal(contents.get(file.path), '[[New]]');
  for (const cleanup of plugin.cleanups) cleanup();
  assert.equal(cache.updateInternalLinks, original);
});

test('external changes before the atomic update do not get overwritten', async () => {
  const { run, contents, file } = renameSetup('[[Old]]');
  const update = linkReplacement('[[Old]]', '[[Old]]', '[[New]]');
  contents.set(file.path, 'External prefix [[Old]]');
  await run([update]);
  assert.equal(contents.get(file.path), 'External prefix [[Old]]');
});

test('opt-out applies immediately and can be turned back on without unlocking', async () => {
  const { plugin, run, contents, file } = renameSetup('[[Old]]');
  const updates = [linkReplacement('[[Old]]', '[[Old]]', '[[New]]')];
  plugin.settings.allowLinkUpdates = false;
  await run(updates);
  assert.equal(contents.get(file.path), '[[Old]]');
  plugin.settings.allowLinkUpdates = true;
  await run(updates);
  assert.equal(contents.get(file.path), '[[New]]');
  assert.equal(plugin.isFileLocked(file), true);
});

test('ambiguous property paths and invalid YAML leave the entire note unchanged', async () => {
  for (const content of [
    '---\nlocked: true\nrelated: "[[Old]]"\nrelated: other\n---\n[[Old]]',
    '---\nlocked: true\nrelated: [broken\n---\n[[Old]]',
    '---\nlocked: true\n"related.link": "[[Old]]"\n---\n[[Old]]',
  ]) {
    const { run, contents, file } = renameSetup(content);
    await run([{ reference: { key: content.includes('related.link') ? 'related.link' : 'related', original: '[[Old]]' }, change: '[[New]]' }]);
    assert.equal(contents.get(file.path), content);
  }
});

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

test('locked images block display mutations before handlers run while viewing stays available', () => {
  const { plugin, file } = setup();
  const dom = new JSDOM('<main><div class="image-embed"><img width="240"><div class="image-resize-corner"></div><button class="ik-edit-btn"></button><div class="edit-block-button"></div><div class="embed-action zoom"></div></div><figure class="simple-gallery-item"><img><button class="simple-gallery-item-menu"></button><figcaption class="simple-gallery-caption">Caption</figcaption></figure></main>');
  const { document, Event, KeyboardEvent } = dom.window;
  const view = { file, contentEl: document.querySelector('main') };
  plugin.installControlGuard(view);
  const img = document.querySelector('img');
  const corner = document.querySelector('.image-resize-corner');
  corner.addEventListener('pointerdown', () => img.setAttribute('width', '500'));
  const fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
  for (const selector of ['.image-resize-corner', '.ik-edit-btn', '.edit-block-button', '.simple-gallery-item-menu', '.simple-gallery-caption']) {
    for (const type of ['pointerdown', 'mousedown', 'touchstart', 'click']) assert.equal(fire(document.querySelector(selector), type), false);
  }
  assert.equal(img.getAttribute('width'), '240');
  for (const type of ['dragstart', 'drop', 'contextmenu', 'dblclick']) assert.equal(fire(img, type), false);
  assert.equal(img.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })), false);
  assert.equal(fire(img, 'click'), true);
  assert.equal(fire(document.querySelector('.zoom'), 'click'), true);
  plugin.lockStates.set(file.path, false);
  assert.equal(fire(corner, 'pointerdown'), true);
  assert.equal(img.getAttribute('width'), '500');
  for (const cleanup of plugin.cleanups) cleanup();
  dom.window.close();
});

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
  plugin.settings = { ...plugin.settings, showLockBanner: false };
  plugin.refreshView(view);
  assert.equal(document.querySelector('.note-lock-banner'), null);
  assert.ok(header.querySelector('.note-lock-action'));
  assert.equal(plugin.isFileLocked(file), true);
  assert.equal(document.querySelector('.inline-title').contentEditable, 'false');
  plugin.settings.showLockBanner = true;
  plugin.refreshView(view);
  assert.ok(document.querySelector('.note-lock-banner'));
  plugin.lockStates.set(file.path, false);
  plugin.refreshView(view);
  assert.equal(document.querySelector('.note-lock-banner'), null);
  assert.equal(container.firstElementChild, header);
  for (const cleanup of plugin.cleanups) cleanup();
  dom.window.close();
});
