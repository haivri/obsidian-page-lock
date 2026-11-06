/** Destination-only gallery updates. Kept identical in Page Lock and Simple Gallery. */
export interface GalleryReference {
  from: number;
  to: number;
  expected: string;
  path: string;
  form: 'wiki' | 'markdown' | 'plain';
  remote: boolean;
}
export interface GalleryLinkUpdate { from: number; to: number; expected: string; replacement: string }
export type GalleryUpdateStatus = 'applied' | 'unchanged' | 'blocked' | 'stale';
export interface GallerySourceBlock {
  from: number; to: number; lineStart: number; lineEnd: number;
  bodyFrom: number; bodyTo: number; body: string; prefix: string; eol: string;
  references: GalleryReference[];
}

export function parseGalleryReference(raw: string): GalleryReference | null {
  const text = raw.trim();
  const leading = raw.indexOf(text);
  let from = 0, to = text.length;
  let form: GalleryReference['form'] = 'plain';
  const wiki = /^!?\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/.exec(text);
  if (wiki) {
    form = 'wiki'; from = text.indexOf('[[') + 2; to = from + wiki[1].length;
  } else if (text.startsWith('![')) {
    const head = /^!\[(?:\\.|[^\]\\])*\]\(/.exec(text);
    if (!head) return null;
    form = 'markdown'; from = head[0].length;
    if (text[from] === '<') {
      from++; to = text.indexOf('>', from);
      if (to < 0 || !/^(?:\s+(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'))?\)$/.test(text.slice(to + 1))) return null;
    } else {
      let depth = 0; to = from;
      for (; to < text.length; to++) {
        const ch = text[to];
        if (ch === '\\' && to + 1 < text.length) { to++; continue; }
        if (ch === '(') depth++;
        else if (ch === ')') { if (depth === 0) break; depth--; }
        else if (/\s/.test(ch) && depth === 0) break;
      }
      if (!/^(?:\s+(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'))?\)$/.test(text.slice(to))) return null;
    }
  } else if (/[[\]\r\n]/.test(text)) return null;
  const destination = text.slice(from, to);
  from += destination.length - destination.trimStart().length;
  to -= destination.length - destination.trimEnd().length;
  const remoteDestination = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(text.slice(from, to));
  const hash = text.slice(from, to).indexOf('#');
  if (!remoteDestination && hash >= 0) to = from + hash;
  if (to <= from) return null;
  const expected = text.slice(from, to);
  let path = expected;
  if (form === 'markdown') {
    path = path.replace(/\\([\\()<> ])/g, '$1');
    if (!remoteDestination) {
      try { path = decodeURIComponent(path); } catch { /* Retain malformed escapes. */ }
    }
  }
  return { from: leading + from, to: leading + to, expected, path, form,
    remote: /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(path) };
}

/** Scan real fences, ignoring gallery-looking examples inside other code fences or YAML. */
export function gallerySourceBlocks(content: string): GallerySourceBlock[] {
  const blocks: GallerySourceBlock[] = [];
  const lines = content.match(/[^\n]*(?:\n|$)/g)?.filter(Boolean) ?? [];
  let offset = 0;
  let frontmatter = false;
  let open: { marker: string; size: number; quote: string; indent: string; gallery: boolean;
    from: number; lineStart: number; bodyFrom: number; body: string[]; refs: GalleryReference[]; eol: string } | null = null;
  lines.forEach((fullLine, lineNumber) => {
    const line = fullLine.replace(/\r?\n$/, '');
    const lineOffset = offset; offset += fullLine.length;
    if (lineNumber === 0 && line === '---') { frontmatter = true; return; }
    if (frontmatter) { if (/^(---|\.\.\.)\s*$/.test(line)) frontmatter = false; return; }
    const quote = /^(?: {0,3}>[ \t]?)+/.exec(line)?.[0] ?? '';
    const rest = line.slice(quote.length);
    if (open) {
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(rest);
      if (quote === open.quote && close && close[1][0] === open.marker && close[1].length >= open.size) {
        if (open.gallery) blocks.push({ from: open.from, to: lineOffset + line.length,
          lineStart: open.lineStart, lineEnd: lineNumber, bodyFrom: open.bodyFrom, bodyTo: lineOffset,
          body: open.body.join('\n'), prefix: open.quote + open.indent, eol: open.eol, references: open.refs });
        open = null; return;
      }
      if (!open.gallery || quote !== open.quote) return;
      const strip = rest.startsWith(open.indent) ? open.indent.length : 0;
      const bodyLine = rest.slice(strip); open.body.push(bodyLine);
      const item = /^-\s+(.+?)[ \t]*$/.exec(bodyLine);
      if (item) {
        const ref = parseGalleryReference(item[1]);
        if (ref) {
          const start = lineOffset + quote.length + strip + bodyLine.indexOf(item[1], 1);
          open.refs.push({ ...ref, from: start + ref.from, to: start + ref.to });
        }
      }
      return;
    }
    const fence = /^( {0,3})(`{3,}|~{3,})([^\r\n]*)$/.exec(rest);
    if (!fence) return;
    open = { marker: fence[2][0], size: fence[2].length, quote, indent: fence[1], gallery: fence[3].trim() === 'simple-gallery',
      from: lineOffset, lineStart: lineNumber, bodyFrom: offset, body: [], refs: [], eol: fullLine.endsWith('\r\n') ? '\r\n' : '\n' };
  });
  return blocks;
}

export function applyGalleryLinkUpdates(content: string, updates: GalleryLinkUpdate[]): string | null {
  if (!Array.isArray(updates) || updates.some(edit => !edit || !Number.isInteger(edit.from) || !Number.isInteger(edit.to))) return null;
  const refs = gallerySourceBlocks(content).reduce<GalleryReference[]>((all, block) => all.concat(block.references), []);
  const edits = updates.slice().sort((a, b) => b.from - a.from);
  let boundary = content.length;
  for (const edit of edits) {
    const ref = refs.find(r => r.from === edit.from && r.to === edit.to);
    if (!ref || ref.remote || ref.expected !== edit.expected || content.slice(edit.from, edit.to) !== edit.expected ||
      edit.to > boundary || typeof edit.replacement !== 'string' || !edit.replacement ||
      [...edit.replacement].some(c => c.charCodeAt(0) < 32)) return null;
    // Reparse the original item after replacing its destination. The replacement
    // must remain exactly one destination; no injected aliases, titles or syntax.
    const block = gallerySourceBlocks(content).find(b => b.references.some(r => r.from === edit.from && r.to === edit.to));
    if (!block) return null;
    const changed = content.slice(0, edit.from) + edit.replacement + content.slice(edit.to);
    const changedRef = gallerySourceBlocks(changed).reduce<GalleryReference[]>((all, b) => all.concat(b.references), [])
      .find(r => r.from === edit.from);
    if (!changedRef || changedRef.to !== edit.from + edit.replacement.length || changedRef.remote || changedRef.form !== ref.form) return null;
    let decoded = changedRef.path;
    try { decoded = decodeURIComponent(decoded); } catch { /* Literal percent names are allowed. */ }
    if ([...decoded].some(c => c.charCodeAt(0) < 32) || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(decoded)) return null;
    content = changed; boundary = edit.from;
  }
  return content;
}

export function galleryForEdit(content: string, lineStart: number, lineEnd: number, expected: string): GallerySourceBlock | null {
  const normalize = (text: string) => text.replace(/\r\n/g, '\n').replace(/\n$/, '');
  return gallerySourceBlocks(content).find(b => b.lineStart === lineStart && b.lineEnd === lineEnd && normalize(b.body) === normalize(expected)) ?? null;
}
