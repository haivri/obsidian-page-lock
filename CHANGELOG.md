# Changelog

## 1.0.4 - 2026-09-02

- Locked notes no longer show a text cursor: the editable facet could lose to Obsidian's own
  higher-precedence provider, so the editor's contenteditable attribute never flipped. It is now
  asserted directly (and only while locked). This also lets YAML Properties detect the read-only
  state and swap its frontmatter editor to the read-only view.

## 1.0.3 - 2026-09-02

- Editors are now re-synced immediately when a note is locked, instead of only ~100ms after the
  vault write, so plugins reacting to the frontmatter change never see a stale editor.
- Unlocking a note whose only frontmatter property was the lock no longer leaves an empty `---`
  block (a phantom un-deletable first line) behind.

## 1.0.2 - 2026-09-02

- Fixed stale editors on locked notes: Obsidian sometimes reloads an editor from disk as a
  cursor-preserving diff rather than a full-document replacement, which the lock filter blocked.
  The plugin now re-syncs any stale editor to disk content after a locked note is written
  (fixes the remaining "failed to save" on mode switches and frontmatter not appearing after
  locking).
- `vault.process` writes that leave content unchanged now succeed as no-ops, matching the
  `vault.modify` behavior.

## 1.0.1 - 2026-09-02

- Fixed "failed to save" notices piling up and Reading view being unreachable on locked notes:
  Obsidian's own saves of unchanged content now succeed as no-ops instead of being rejected.
- Locked the inline title, so a locked note can no longer be renamed from the editor.
- The view header now always shows a lock toggle: an open lock to lock the note, a closed lock
  to unlock it.
- Restyled the banner as a rounded, accent-tinted pill.
- Removed the "Dim locked notes" setting.

## 1.0.0 - 2026-09-02

Initial release.

- Lock notes against every edit via a frontmatter property that syncs with the note.
- Editor-level read-only enforcement plus a vault-API guard that blocks writes from other plugins.
- Theme-aware unlock banner in editing views; clean Reading view for untouched PDF exports.
- Lock icon view action, command palette command, and file-menu items on desktop and mobile.
- Settings: lock property name, dim locked notes, confirm before unlocking.
