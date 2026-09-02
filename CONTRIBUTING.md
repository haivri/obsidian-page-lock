# Contributing

Bug reports and pull requests are welcome.

Before submitting a change:

1. Run `npm ci`.
2. Run `npm run build`.
3. Run `npm run lint`.
4. Test locking and unlocking in Live Preview, Source mode, and Reading view, in both light and
   dark themes.
5. Verify a locked note blocks typing, paste, drop, cut, and undo, that the banner never appears
   in Reading view, and that unlocking works from the banner, view-header icon, command, and
   file menu. Test on mobile where available.

Keep the plugin simple and local-first. New functionality must not transmit vault content without
explicit user action and clear documentation. Do not include vault content or `data.json` in commits.
