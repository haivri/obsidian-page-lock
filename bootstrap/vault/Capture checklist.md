# Capture checklist

## Start here

Open these notes from `Plugin Showcase`. Enable the relevant plugins; Simple Gallery plus Fullscreen Image gives the combined gallery-to-viewer experience. Use a neutral theme, close private tabs and sidebars, and avoid personal filenames, paths, account details, or notifications in published images. Capture the actual UI, not this checklist. Desktop: roughly 1200–1600 px wide. Mobile: normal device width; keep the status bar visible for safe-area checks. PNG preferred.

## Priority shots — one useful image per plugin, plus mobile

| Save in repository | Filename | Open / action | What the image should show |
| --- | --- | --- | --- |
| simple-gallery/screenshots | 01-justified.png | Gallery - Justified, Reading view | The entire four-photo gallery: clean rows, varied image proportions, readable captions. |
| simple-gallery/screenshots | 02-photo-settings-mobile.png | Photo settings lab, Live Preview; tap first caption | Caption editor, visibly selected Right alignment, override/source label, sizing, and accessible Cancel/Done buttons. Use two captures if scrolling is needed. |
| fullscreen-image/screenshots | 04-viewer.png | Fullscreen - Quiet details; tap the lotus | A large photo, navigation and zoom controls. Also verify opening an image from the gallery. |
| page-lock/screenshots | 01-notion-style-lock.png | Page Lock - A protected routine, Live Preview | Header lock and readable routine. Keep Show lock banner off for the clean default presentation. |
| page-lock/screenshots | 02-mobile-lock.png | Same note on mobile | Header lock below the safe area; normal toolbar/title spacing and unobstructed content. |
| yaml-properties/screenshots | 01-expanded.png | YAML - Practice journal; expand properties | Readable raw YAML above the journal, including list, boolean, and nested resource data. |
| vault-git-sync/screenshots | 01-manual-tools.png | Open manual Git tools or plugin settings | Plain explanations paired with traditional Git button labels. No operation needs to run. |

## Optional supporting shots

- Simple Gallery: `03-masonry.png` and `04-grid.png` from their matching notes. The lotus is featured/larger. `05-gallery-settings.png`: gallery gear with layout, size/spacing presets and inherited/overridden appearance. `06-plugin-settings.png`: global alignment buttons and selected state.
- Simple Gallery: `07-long-caption.png` from Photo settings lab, Reading view. Confirm the very long caption stays bounded and the grid remains stable. Compare the first photo’s explicit Right setting with the second photo’s inherited Center setting in the dialog; `08-inherited-settings.png` can show the latter.
- Fullscreen Image: `05-mobile-viewer.png`, with image navigation and pinch zoom checked. Retain existing README images until new ones are approved.
- Page Lock: `03-banner-optional.png`, temporarily enable Show lock banner, then restore your previous preference. A short GIF/video can demonstrate a checkbox refusing a change, followed by header unlock and a successful edit. Re-lock afterward. A still alone does not prove protection. This is accidental-edit protection, not encryption or access control.
- YAML Properties: `02-collapsed.png` from the same note, showing more room for writing.
- Vault Git Sync: `02-status-feedback.png` only if you voluntarily run Check status with your normal configured remote. Crop private details. Do not run Force merge or change real notes just to get a screenshot.

## Before calling the mobile shots done

- Gallery dialog stays below the status area; footer actions remain reachable while the form scrolls.
- Selected alignment is obvious without hover, including inherited versus explicit values.
- Locked-note checkbox does not change in either Live Preview or Reading view; unlock permits editing. Restore the sample checklist afterward.
- Page Lock does not push the native toolbar or title far down the screen.

## Handoff

Place captures in each repository’s `screenshots` folder using the filenames above, or provide them together with those names. Next pass: choose the best hero shot for each README, add descriptive alt text, check light/mobile readability, update the release audit, and only then commit/push/release. No screenshot placeholders are embedded in the READMEs.

The themed notes link to organizations the author appreciates. [[Photo credits]] records sources; the Buy Me a Coffee buttons support the plugin author separately.
