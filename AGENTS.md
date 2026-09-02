# Note Lock development

- This directory is the authoritative source repository. Do not develop from the installed copy in an Obsidian vault.
- `origin` is the private Forgejo repository; `github` is the public GitHub repository (`obsidian-note-lock`).
- Keep `main` clean and release the exact same commit to both remotes.
- Run lint and the production build before publishing.
- Publish through `/Users/robertfleming/vaults/obsidian-vault/_obsidian-os/scripts/release-obsidian-plugin note-lock`.
- The publisher installs only runtime artifacts into the primary vault and preserves its existing `data.json` settings.
- Never add a vault's `data.json` or other user-specific settings to this source repository.
- `npm run publish:vault` builds and installs the runtime artifacts into the
  primary vault (`/Users/robertfleming/vaults/obsidian-vault`, overridable via
  `OBSIDIAN_VAULT`), preserving the vault's `data.json` and writing a
  `.release.json` provenance record. `npm run ship` does that and then pushes
  `origin`. Neither command touches the `github` remote — GitHub remains a
  deliberate, manual release push.

## Design notes

- Lock state is the frontmatter property (default `locked`); `lockStates` in `src/main.ts` is
  only an optimistic cache for flip detection — frontmatter is the source of truth.
- The editor transaction filter allows one escape hatch: a single full-document replacement with
  no `userEvent` annotation (Obsidian's disk→editor reload). A plugin doing a programmatic
  full-document replace can therefore transiently change the display, but the vault guard blocks
  persistence — accepted trade-off.
- The vault guard patches `vault.modify`/`append`/`process` only. The adapter is deliberately
  untouched so Obsidian Sync and external tools can always update locked files.
- `workspace.updateOptions()` is expensive; call it only on actual lock flips.
