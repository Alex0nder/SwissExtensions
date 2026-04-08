# Privacy Policy for Swiss Extensions

Effective date: 2026-03-21

Swiss Extensions is a Chrome extension focused on browser productivity (page capture, tab hibernation, memory cleanup, site blocking, and site-data clearing).

## Summary

- Swiss Extensions does **not** sell personal data.
- Swiss Extensions does **not** transfer personal data to third parties for advertising.
- Core functionality is processed locally in the browser.

## Data we access

Depending on features used by the user, the extension may access:

- Tab and URL metadata (`tabs`, `activeTab`)
- Browsing history entries (`history`) for optional helper flows
- Bookmark data (`bookmarks`) for backup/restore workflows
- Site storage and cookies (`browsingData`) when the user requests a clear action
- Local extension settings/state (`storage`)

## How data is used

Data is used only to provide user-requested features:

- Capture pages to PNG/PDF
- Suspend/restore tabs and maintain backup entries
- Discard background tabs to reduce memory usage
- Block configured domains
- Clear site data for the current site

## Data sharing

Swiss Extensions does not sell, rent, or broker user data.
Swiss Extensions does not share user data with third parties except when required by law.

## Data retention

- Extension settings and feature state are stored locally in `chrome.storage.local`.
- Some backup/session information may be saved to local bookmarks and local extension storage for restore flows.
- Users can remove extension data by uninstalling the extension and/or clearing extension storage and created bookmarks.

## Security

The extension follows Chrome Extension Manifest V3 restrictions.
Executable code is packaged with the extension bundle; no remote executable code is used for core functionality.

## User controls

Users can:

- Enable/disable features from the extension UI
- Remove blocked domains
- Clear saved history/backup entries from extension workflows
- Uninstall the extension at any time

## Changes to this policy

This policy may be updated to reflect product or legal changes. The latest version is published at this URL.

## Contact

Repository and contact point:
https://github.com/Alex0nder/SwissExtensions

