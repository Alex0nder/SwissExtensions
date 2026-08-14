# Publishing Swiss Extensions to the Chrome Web Store

The package is configured as a Manifest V3 extension. Complete every section below before submitting a new release.

## 1. Verify the release configuration

- Confirm that `manifest.json` has the intended version and does not contain a development-only `key`.
- Confirm that extension icons are available in 16, 32, 48, and 128 pixel sizes.
- Confirm that `minimum_chrome_version` is compatible with the Side Panel API.
- Review every permission and host permission against the features in the submitted build.
- Build the React/Vite interface from `frontend/apps/swiss-ui` into `SwissExtensions/ui-dist`.

## 2. Build the package

From the `SwissExtensions` directory, run:

```bash
./scripts/package-swiss-extensions-store.sh
```

The Store archive is written to `dist/SwissExtensions-v<version>-chrome-store.zip`. The script excludes development files such as Markdown documentation, tests, scripts, `_metadata/`, and nested build artifacts.

Verify that `manifest.json` is at the root of the ZIP and that the package contains:

- `manifest.json`, `service_worker.js`, `core_logic.js`, and `content.js`
- `ui-dist/side_panel.html`, `history.html`, `result.html`, and `suspended.html`
- `ui-dist/assets/`
- `icons/`
- `blocker/*.json`

## 3. Test the packaged build

1. Extract the generated Store ZIP into a temporary directory.
2. Open `chrome://extensions/` and enable **Developer mode**.
3. Select **Load unpacked** and choose the extracted directory.
4. Confirm that the extension page reports no errors.
5. Test all six tools:
   - Swiss Command searches tabs, bookmarks, and history.
   - Page Capture exports a complete page or fixed-size tiles.
   - Tab Hibernate backs up, suspends, restores, and recovers tabs.
   - Memory Cleaner discards eligible background tabs.
   - Site Blocker enables and disables its rules correctly.
   - Site Data Clear removes only the selected data for the current site.

## 4. Prepare the Store listing

Use [STORE_LISTING.md](STORE_LISTING.md) as the maintained source for:

- the short and full descriptions
- release notes
- screenshots and promotional-image guidance
- permission justifications
- privacy disclosures

Also prepare the Productivity category, a support email or website, and a public Privacy Policy URL.

## 5. Complete privacy disclosures

Swiss Extensions can access tabs, browsing history, bookmarks, site data, tab groups, and pages matching `<all_urls>`. The Store declaration must match the actual behavior of the submitted build.

- State which browser data each feature accesses.
- State that data is processed locally when that remains true for the submitted build.
- State that data is not sold or transferred to third parties when that remains true.
- Explain each requested permission in terms of a user-visible feature.
- Use the detailed, Store-ready permission text in [STORE_LISTING.md](STORE_LISTING.md), including the explanations for `webNavigation` and `tabGroups`.

## 6. Final submission checks

- The version in `manifest.json`, the archive name, and the release notes agree.
- The Privacy Policy URL is public and points to the current repository.
- Screenshots show the current interface and all advertised features.
- No development files, secrets, `_metadata/`, or obsolete bundles are included.
- The ZIP uploaded to the Store is the same archive that passed the packaged-build test.
