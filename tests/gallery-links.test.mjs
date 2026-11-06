import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { transformSync } from 'esbuild';
const module = { exports: {} };
runInNewContext(transformSync(readFileSync(new URL('../src/gallery-links.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs' }).code, { module, exports: module.exports });
const { gallerySourceBlocks: blocks, applyGalleryLinkUpdates: apply, parseGalleryReference: parse, galleryForEdit } = module.exports;
const fence = body => '```simple-gallery\n' + body + '\n```';
const changes = (content, replacement = 'new.png') => blocks(content).flatMap(b => b.references).map(r => ({ ...r, replacement }));

test('destination updates preserve aliases, fragments, titles, captions, comments, whitespace and CRLF', () => {
  const content = '---\r\nlocked: true # untouched\r\n---\r\nHeading\r\n' + fence('- ![[old.png#fragment|200]]\n  caption: Keep old.png\n# comment\n- ![alt](old.png "title")\n- old.png').replaceAll('\n', '\r\n') + '\r\nTail';
  assert.equal(apply(content, changes(content)), content.replace('[[old.png', '[[new.png').replace('(old.png', '(new.png').replace('- old.png', '- new.png'));
});

test('only real gallery fences count, including quotes and longer tilde fences', () => {
  const content = '---\nexample: |\n  ```simple-gallery\n  - old.png\n  ```\n---\n````markdown\n' + fence('- old.png') + '\n````\n> ~~~~simple-gallery\n> - ![[old.png]]\n> ~~~~\n';
  assert.equal(blocks(content).length, 1);
  assert.equal(apply(content, changes(content)), content.replace('> - ![[old.png]]', '> - ![[new.png]]'));
  assert.equal(blocks('```simple-gallery\n- old.png').length, 0);
});

test('Markdown destinations support spaces, escaped parentheses, titles, fragments and remote detection', () => {
  for (const [raw, expected] of [['![a](<My image.png> "t")', 'My image.png'], ['![a](My%20image.png#page=2)', 'My image.png'], ['![a](a\\(b\\).png)', 'a(b).png'], ['![a](a(b).png)', 'a(b).png']]) assert.equal(parse(raw).path, expected);
  for (const raw of ['https://example.com/a.png', '![[https://example.com/a.png]]', '![a](https://example.com/a.png)', '//example.com/a.png']) assert.equal(parse(raw).remote, true);
});

test('stale, overlapping, non-destination and syntax-injecting updates fail closed', () => {
  const content = fence('- ![[old.png|Alias]]\n  caption: old.png');
  const [edit] = changes(content);
  for (const replacement of ['x|changed', 'x]]', 'x\n- injected', 'https://example.com/a', '%0aevil', 'x#changed']) assert.equal(apply(content, [{ ...edit, replacement }]), null, replacement);
  assert.equal(apply(content, [edit, edit]), null);
  assert.equal(apply(content, [{ ...edit, expected: 'stale' }]), null);
  assert.equal(apply(content, [{ ...edit, from: content.lastIndexOf('old.png'), to: content.lastIndexOf('old.png') + 7 }]), null);
  assert.equal(apply(content, [null]), null);
  assert.equal(apply(content, changes(content.replace('old.png|', 'https://example.com/a|'))), null);
});

test('stale source bodies and shifted ranges are rejected for edits and deletion', () => {
  const body = '- ![[old.png]]'; const content = fence(body);
  assert.ok(galleryForEdit(content, 0, 2, body + '\n'));
  assert.equal(galleryForEdit(content.replace('old.png', 'new.png'), 0, 2, body), null);
  assert.equal(galleryForEdit('\n' + content, 0, 2, body), null);
});


test('remote destinations retain their percent encoding and URL fragments', () => {
  const url = 'https://example.com/a%2Fb%20c.svg#view';
  assert.equal(parse(url).path, url);
  assert.equal(parse(`![alt](${url})`).path, url);
  const content = fence('- ' + url);
  assert.equal(apply(content, changes(content)), null);
});
