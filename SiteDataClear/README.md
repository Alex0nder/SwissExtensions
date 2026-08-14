# Site Data Clear

A Chrome extension that clears selected cookies and browser storage for the current site. Nothing is removed until the user chooses the data types and confirms the action.

## Install

1. Open `chrome://extensions/`.
2. Enable **Developer mode**.
3. Select **Load unpacked** and choose the `SiteDataClear` folder.

## Use

1. Open the site whose data you want to clear.
2. Select the extension icon.
3. Choose the data types to remove, such as cookies, local storage, session storage, or cache storage.
4. Confirm the action. The selected data is removed for the current site and the page reloads.

## Technical details

- Cookies and supported storage types are removed with `chrome.browsingData.remove()` using the current origin as a filter.
- Session storage is cleared by running `sessionStorage.clear()` in the current page.
- At least one data type must be selected.
- The extension cannot operate on `chrome://` pages or other protected browser pages.
