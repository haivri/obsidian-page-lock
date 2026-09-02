# Changelog

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
