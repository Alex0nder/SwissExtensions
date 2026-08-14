# Swiss Extensions

Chrome MV3 extension: Swiss Command, Page Capture, Tab Hibernate, Memory Cleaner, Site Blocker, and Site Data Clear.

**Version:** see `manifest.json` (current: 1.5.49).

## Structure

| Path | Purpose |
|------|---------|
| `manifest.json` | Extension manifest |
| `service_worker.js` | Background: hibernate, blocker DNR, recovery, backups |
| `../frontend/apps/swiss-ui/` | React/Vite sources for Side Panel, History, Capture Result, and Suspended Page |
| `ui-dist/` | Built extension UI referenced by the manifest and service worker |
| `core_logic.js` | Pure, testable hibernation and restore rules |
| `tests/` | Node tests and service-worker contracts |
| `blocker/` | Declarative Net Request rulesets |
| `icons/` | Extension and UI icons |
| `scripts/package-swiss-extensions-store.sh` | Store ZIP build |

## Build for Chrome Web Store

```bash
./scripts/package-swiss-extensions-store.sh
```

Output: `dist/SwissExtensions-v<version>-chrome-store.zip` and `../downloads/SwissExtensions-v<version>.zip` (no `.md`, `_metadata/`, `scripts/`, `tests/`, or `dist/`).

## Docs

- `STORE_LISTING.md` — Web Store copy (EN/RU)
- `PUBLISHING_CHECKLIST.md` — release checklist
- `UPDATE_INSTRUCTIONS.md` — user-facing update notes

## Dev notes

- `_metadata/` is created by Chrome on “Load unpacked” — do not commit; listed in `.gitignore`.
- Landing page for the site lives in the parent `Extensions/` repo (`index.html` + `css/`), not in this folder.
