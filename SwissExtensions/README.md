# Swiss Extensions

Chrome MV3 extension: Page Capture, Tab Hibernate, Memory Cleaner, Site Blocker, Site Data Clear.

**Version:** see `manifest.json` (current: 1.5.8).

## Structure

| Path | Purpose |
|------|---------|
| `manifest.json` | Extension manifest |
| `service_worker.js` | Background: hibernate, blocker DNR, recovery, backups |
| `side_panel.html` / `side_panel.js` | Main UI |
| `history.html` / `history.js` | Closed tabs, backups, Site Blocker saved tabs, Chrome history recover |
| `blocker/` | Declarative Net Request rulesets |
| `icons/` | Extension and UI icons |
| `scripts/package-swiss-extensions-store.sh` | Store ZIP build |

## Build for Chrome Web Store

```bash
./scripts/package-swiss-extensions-store.sh
```

Output: `dist/SwissExtensions-v<version>-chrome-store.zip` (no `.md`, `_metadata/`, `scripts/`, `dist/`).

## Docs

- `STORE_LISTING.md` — Web Store copy (EN/RU)
- `PUBLISHING_CHECKLIST.md` — release checklist
- `UPDATE_INSTRUCTIONS.md` — user-facing update notes

## Dev notes

- `_metadata/` is created by Chrome on “Load unpacked” — do not commit; listed in `.gitignore`.
- Landing page for the site lives in the parent `Extensions/` repo (`index.html` + `css/`), not in this folder.
