import { FrontmatterLinkCache, ReferenceCache, getFrontMatterInfo } from 'obsidian';
import { isScalar, parseDocument } from 'yaml';

/** The replacements Obsidian calculates after resolving a rename or move. */
export interface LinkUpdate {
  reference: ReferenceCache | FrontmatterLinkCache;
  change: string;
}

export interface LinkUpdateBatch {
  keys(): string[];
  get(path: string): LinkUpdate[];
}

/**
 * Apply only the supplied references. Stale offsets/values fail closed rather
 * than replacing some unrelated text. YAML scalar ranges preserve comments,
 * whitespace, and every other property (Obsidian normally reserializes YAML).
 */
export function applyLinkUpdates(content: string, updates: LinkUpdate[]): string | null {
  const edits: { from: number; to: number; text: string }[] = [];
  const frontmatter = getFrontMatterInfo(content);
  const yaml = updates.some(({ reference }) => 'key' in reference) && frontmatter.exists
    ? parseDocument(frontmatter.frontmatter, { uniqueKeys: true }) : null;
  for (const { reference, change } of updates) {
    if (typeof change !== 'string' || !reference.original) return null;
    if ('position' in reference) {
      const from = reference.position.start.offset;
      const to = reference.position.end.offset;
      if (!Number.isInteger(from) || !Number.isInteger(to) || from < frontmatter.contentStart ||
          to <= from || to > content.length || content.slice(from, to) !== reference.original) return null;
      edits.push({ from, to, text: change });
    } else {
      if (!yaml || yaml.errors.length) return null;
      const scalar = yaml.getIn(reference.key.split('.'), true);
      if (!isScalar(scalar) || !scalar.range || scalar.value !== reference.original) return null;
      const from = frontmatter.from + scalar.range[0];
      const to = frontmatter.from + scalar.range[1];
      // A block scalar's value range includes its final newline. Keep the
      // following property on its own line when replacing it with a string.
      const newline = content.slice(from, to).match(/\r?\n$/)?.[0] ?? '';
      edits.push({ from, to, text: JSON.stringify(change) + newline });
    }
  }
  edits.sort((a, b) => b.from - a.from);
  let boundary = content.length;
  for (const { from, to, text } of edits) {
    if (to > boundary) return null;
    content = content.slice(0, from) + text + content.slice(to);
    boundary = from;
  }
  return content;
}
