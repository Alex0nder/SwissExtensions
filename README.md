# Swiss Extensions

Swiss Extensions is an all-in-one Chrome productivity toolkit built around a clean Side Panel workflow.

It combines five focused tools:

1. **Page Capture** - capture long pages by viewport tiles and export to PNG or PDF.
2. **Tab Hibernate** - suspend inactive tabs and restore them when needed.
3. **Memory Cleaner** - discard background tabs to reduce RAM usage.
4. **Site Blocker** - block distracting domains with built-in and custom rules.
5. **Site Data Clear** - clear cookies and storage for the current site on demand.

## Installation (developer mode)

1. Open `chrome://extensions/`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this project folder.

## Main workflows

- **Page Capture:** scan page -> open result page -> export PNG/PDF.
- **Tab Hibernate:** backup tabs to bookmarks, suspend current/all, restore all, recover lost tabs.
- **Memory Cleaner:** discard background tabs with optional pinned-tab protection.
- **Site Blocker:** enable/disable blocker, manage blocked domains.
- **Site Data Clear:** clear cookies, localStorage, and sessionStorage for the active site.

## Permissions and purpose

- `tabs`, `activeTab`, `<all_urls>`: capture pages, manage tabs, apply domain blocking.
- `history`: optional blocked-from-history helper flow.
- `browsingData`: clear site data on user action.
- `bookmarks`: backup and restore hibernated tabs.
- `declarativeNetRequest`: static and dynamic blocking rules.
- `downloads`: export capture files.
- `scripting`: inject helper scripts for capture/clear actions.
- `sidePanel`, `alarms`, `storage`: side panel UI, periodic checks, settings persistence.

## Technical notes

- Manifest V3 with one service worker.
- Capture data is stored in IndexedDB `PdfCaptureDB`.
- Blocker uses static rulesets (`blocker/ruleset_*.json`) plus dynamic user rules.

## Privacy Policy

- https://github.com/Alex0nder/SwissExtensions/blob/main/PRIVACY_POLICY.md

## License

MIT
