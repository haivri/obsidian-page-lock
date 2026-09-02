# Note Lock

Lock a note so it cannot be edited until you unlock it — like Notion's "lock page", but for
Obsidian. A locked note shows a slim banner and a lock icon in the view header; unlock with a
click, a command, or the file menu.

Note Lock is deliberately small and local-first. It does not collect telemetry or make network
requests. The only thing it ever writes to a note is the lock property itself.

## Features

- Locks a note against every edit: typing, paste, drag-and-drop, cut, and undo are all blocked
  in Live Preview and Source mode.
- Blocks writes from other plugins too (Templater, linters, formatters) while a note is locked.
- Stores the lock as a frontmatter property (`locked: true` by default), so it syncs to your
  other devices along with the note itself.
- Locks the inline title too, so a locked note cannot be renamed from the editor.
- Theme-aware pill banner at the top of the editor with a one-click/tap unlock.
- Lock/unlock icon in the view header of every note — an open lock to lock, a closed lock to
  unlock — visible in Reading view too.
- Reading view stays completely clean: no banner, so PDF exports are untouched.
- Lock or unlock via the command palette (hotkeyable), the file menu / three-dots menu, the
  banner, or the view-header icon.
- Works on desktop and mobile; the keyboard does not pop up on a locked note.
- Optional confirmation prompt before unlocking.

## Usage

- **Lock** — click/tap the open-lock icon in the view header, run *Toggle lock on current note*
  from the command palette, or choose **Lock note** from the three-dots menu or the file
  explorer's context menu.
- **Unlock** — click/tap the banner, the lock icon in the view header, or use the same command
  or menu item again.
- Assign a hotkey to *Toggle lock on current note* under **Settings → Hotkeys** for one-keystroke
  locking.

## How it works

The lock lives in the note's frontmatter (default property: `locked`). While it is set:

- The editor becomes read-only at the CodeMirror level, so no edit can reach the document.
- Obsidian's file-write API refuses changes to the note from any plugin, with a notice.
- Sync and external tools can still update the file — locking protects against edits inside
  Obsidian, not against your sync service.

Unlocking simply removes the property. Because the lock is a plain frontmatter property, it
travels with the note through sync, backups, and vault moves.

## Scope

Markdown notes only. The lock applies wherever the note is edited — tabs, split panes, popout
windows, and embedded editors. Canvas files and other non-markdown files are not affected.

## Settings

- **Lock property name** — the frontmatter property that marks a note as locked
  (default `locked`).
- **Confirm before unlocking** — ask before unlocking, preventing accidental unlocks from a
  stray tap (default off).

## Installation

### Community Plugins

Once accepted, install **Note Lock** from **Settings → Community plugins → Browse**.

### Manual installation

Copy `main.js`, `manifest.json`, and `styles.css` from a release into:

```text
<vault>/.obsidian/plugins/note-lock/
```

Then reload Obsidian and enable **Note Lock** under Community plugins.

## Development

Requires Node.js 20 or newer.

```bash
npm install
npm run dev     # esbuild watch mode
npm run build   # type-check + production build
npm run lint
```

## Release checklist

1. Run `npm run build` and `npm run lint`.
2. Test locking and unlocking in Live Preview, Source mode, and Reading view, on desktop and
   mobile if available.
3. Run `npm version patch`, `npm version minor`, or `npm version major`. The version script keeps
   `manifest.json` and `versions.json` in sync.
4. Push the resulting numeric tag (for example `1.0.1`). GitHub Actions builds the plugin and
   attaches `main.js`, `manifest.json`, and `styles.css` to the GitHub Release.

On the maintainer workstation, use the USA OS plugin release command. It pushes the exact
`main` commit to private Forgejo and public GitHub, verifies both tips, and atomically updates
the primary vault's runtime copy while preserving its settings.

## Contributing

Bug reports and pull requests are welcome. Please keep the plugin focused: it should remain a
simple, dependable note lock that respects local-first Obsidian workflows. Before opening a
pull request, run `npm run build` and `npm run lint`.

## Support

If Note Lock improves your workflow, you can support its continued development on
[Buy Me a Coffee](https://www.buymeacoffee.com/robertfleming).

## License

MIT
