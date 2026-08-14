# Swiss Extensions

A family of private, local-first Chrome extensions for tab management, page capture, focus, and site-data cleanup.

This repository provides two ways to use the tools:

- **`SwissExtensions/`** is the all-in-one Side Panel package. It contains every tool, but requires broader permissions.
- **Standalone extension folders** contain one focused tool each, with the narrowest practical permission set. These packages are easier to review and publish separately in the Chrome Web Store.

## Available extensions

| Folder | Extension | What it does |
| --- | --- | --- |
| [SwissCommand/](SwissCommand/) | Swiss Command | Searches open tabs, bookmarks, and browsing history locally. |
| [SwissLens/](SwissLens/) | Swiss Lens | Applies local readability and accessibility preferences per site. |
| [PdfExtensions/](PdfExtensions/) | Page Capture | Captures long pages as fixed-size PNG tiles or a multipage PDF. |
| [TabHibernate/](TabHibernate/) | Tab Hibernate | Suspends inactive tabs and backs up their URLs to bookmarks and local storage. |
| [TabMemoryCleaner/](TabMemoryCleaner/) | Tab Memory Cleaner | Discards background tabs to free memory without closing them. |
| [SiteBlocker/](SiteBlocker/) | Site Blocker | Blocks distracting sites and provides lightweight ad/tracker filtering. |
| [SiteDataClear/](SiteDataClear/) | Site Data Clear | Clears cookies and browser storage for the current site on demand. |
| [SwissExtensions/](SwissExtensions/) | Swiss Extensions | Combines the browser tools in one Chrome Side Panel. |

Each folder contains its own `README.md` with feature details and limitations.

## Install in Developer mode

1. Clone or download this repository.
2. Open `chrome://extensions/` in Chrome.
3. Enable **Developer mode**.
4. Select **Load unpacked**.
5. Choose one extension folder, such as `SwissCommand`, `PdfExtensions`, or `SwissExtensions`. Do not select the repository root.

Chrome 114 or newer is recommended for extensions that use the Side Panel API.

## Updating without losing suspended tabs

Before manually reloading or reinstalling Swiss Extensions, back up your tabs from **Side Panel → Tab Hibernate → Backup all tabs now**. See [UPDATE_INSTRUCTIONS.md](SwissExtensions/UPDATE_INSTRUCTIONS.md) for the complete recovery procedure.

## Building the all-in-one Store package

Run the packaging script from the suite directory:

```bash
cd SwissExtensions
./scripts/package-swiss-extensions-store.sh
```

The script creates the Chrome Web Store archive in `SwissExtensions/dist/` and a developer-mode archive in `downloads/`.

Before publishing, follow the [Chrome Web Store checklist](SwissExtensions/PUBLISHING_CHECKLIST.md). Store copy and permission explanations are maintained in [STORE_LISTING.md](SwissExtensions/STORE_LISTING.md).

## Privacy and license

- [Privacy Policy](PRIVACY_POLICY.md)
- MIT licenses are included in the applicable extension folders.

The extensions are designed to process browser data locally. Review each extension's manifest and privacy disclosures before publishing.
