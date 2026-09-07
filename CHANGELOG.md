# Changelog

## 1.0.9 - 2026-09-07

- Removed the mobile whole-view padding that displaced Obsidian’s floating toolbar. The unlock banner now sits immediately above the inline title inside the note’s existing content inset, avoiding duplicated top spacing.
- Added a regression test for banner placement, repeated refreshes, and cleanup on unlock.

## 1.0.8 - 2026-09-07

- Added mobile safe-area spacing to the locked view so the unlock control, header, and title sit below screen cutouts. The banner reserves space above the editor and provides a 44px touch target. Spacing is removed when the note is unlocked or the plugin unloads.

## 1.0.7 - 2026-09-07

- Locked notes now block rendered checkboxes, Meta Bind inputs/buttons, and property controls before their event handlers can change local state, in Reading view and Live Preview.
- Guarded FileManager.processFrontMatter so bound-field writes cannot bypass the vault write guards.
- Added DOM and file-write regression tests covering locked/unlocked controls, navigation, and cleanup.

## 1.0.6 - 2026-09-02

- Fixed unlocking not taking effect until the note was reopened: the read-only facets were
  computed only at editor creation, so an unlock never reached an already-open editor. Lock state
  now lives in a per-editor state field that the plugin updates explicitly on every lock flip,
  making both lock and unlock apply instantly.

## 1.0.5 - 2026-09-02

- The contenteditable=false assertion on locked notes now carries highest CodeMirror precedence.
  Attribute sources apply lowest-precedence first and plugin extensions sit at the bottom of that
  stack, so the 1.0.4 assertion never reached the DOM — the cursor stayed visible and read-only
  detection by other plugins (YAML Properties) still saw an editable editor.

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
