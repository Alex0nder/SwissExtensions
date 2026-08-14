# Update Swiss Extensions without losing tabs

Suspended placeholder tabs belong to a specific extension installation. A manual removal or reinstall can change the unpacked extension ID, making placeholders from the previous installation unavailable. Back up your tabs before updating.

## Before clicking Reload or reinstalling

1. Open **Side Panel → Tab Hibernate**.
2. Select **Backup all tabs now** or **Backup to bookmarks**.
3. Optionally select **Restore all** to turn placeholders back into normal tabs, then create one more backup.
4. Only after the backup completes, reload or reinstall the extension from `chrome://extensions/`.

Swiss Extensions also creates an automatic snapshot before supported updates. Recovery searches local extension storage and the **Tab Hibernate → Emergency Recovery** and **Tab Backup** bookmark folders.

## Recover tabs after an update

If suspended tabs were closed or their placeholders no longer work:

1. Open **Side Panel → Tab Hibernate**.
2. Select **Recover lost tabs**.
3. Review the recovered URLs from local storage and bookmarks.
4. Restore the required tabs. Recovered tabs may first open as lightweight placeholders so pages do not all load at once.

## Recover after a browser crash or force quit

- Open **Tab Hibernate → History** and check the saved tab list.
- Check the **Emergency Recovery** and **Tab Backup** bookmark folders.
- If the extension is disabled, open `chrome://extensions/`, enable Swiss Extensions, and select **Reload**.
- Restore very large sessions in batches to avoid loading hundreds of pages simultaneously.

## Important limitations

- Removing an unpacked extension can remove its local extension storage.
- A bookmark backup is safer than relying on local storage alone when reinstalling.
- Unsaved form data and in-page application state may be lost when a tab is suspended, discarded, or restored.
