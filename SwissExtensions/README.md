# Swiss Extensions

Four tools in one extension:

1. **Page Capture** — screenshot by viewport tiles, export to PNG
2. **Tab Hibernate** — suspend inactive tabs, backup to bookmarks, Side Panel
3. **Site Blocker** — block ads, trackers, miners + custom domain list
4. **Site Data Clear** — clear cookies, localStorage, sessionStorage for current site

## Installation

1. Open `chrome://extensions/`
2. Enable Developer mode
3. Load unpacked → select `SwissExtensions` folder

## Usage

Click extension icon to open **Side Panel** with four tabs:
- **Capture** — Scan page, opens result.html for PNG
- **Tabs** — Tab Hibernate settings (timeout, mode, backup, suspend/restore)
- **Blocker** — Toggle and domain blocklist
- **Clear** — Cookies/localStorage/sessionStorage checkboxes and clear button

## Tip — Updating without losing tabs

1. **Before update:** Use "Restore all" to unsuspend tabs, then update.
2. **After update (if tabs closed):** Use "Recover lost tabs" — restores from bookmarks.
3. **Fixed ID:** Manifest includes `key` so extension ID stays the same across future updates (Remove + Load unpacked).

## Technical

- Manifest V3, single service worker
- Storage: `settings`, `blocked`, `enabled` — separate keys per tool
- Page Capture: IndexedDB `PdfCaptureDB`, content.js for scroll and hide fixed elements
- Site Blocker: static rulesets (blocker/ruleset_*.json) + dynamic user rules (ID >= 10000)
