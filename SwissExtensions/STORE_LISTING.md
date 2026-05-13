# Swiss Extensions — тексты и ответы для Chrome Web Store

Используй при заполнении [Developer Dashboard](https://chrome.google.com/webstore/devconsole). Privacy Policy URL: `https://github.com/Alex0nder/SwissExtensions/blob/main/PRIVACY_POLICY.md` (или зеркало на своём домене, если вынесешь политику туда).

## Short description (≤132 символов)

**EN:** All-in-one: full-page capture, tab hibernate with restore, RAM discard, site blocker, clear site data — runs locally.

**RU:** Всё в одном: скан страницы, сон вкладок с восстановлением, очистка RAM, блокировка сайтов, сброс данных сайта — локально в браузере.

## Full description (карточка)

**EN (черновик):**

Swiss Extensions bundles five productivity tools in one side panel:

1. **Page Capture** — Scrolls the active page and stitches viewport screenshots; export PNG (tiles or whole). Uses your Downloads folder or a picked directory.
2. **Tab Hibernate** — After a timeout, suspends inactive background tabs (Placeholder stub with Restore, or Discard). Backs up URLs to bookmarks and local storage; History for closed-and-saved lists.
3. **Memory Cleaner** — One-click discard of background tabs with optional skips (pinned, audible, incognito, tab groups).
4. **Site Blocker** — Schedule + blocklist/whitelist; built-in declarative rulesets plus optional ad ruleset toggle.
5. **Site Data Clear** — On your action only: clear cookies, localStorage, sessionStorage (and related) for the current site.

No accounts required. No data sold to third parties — see Privacy Policy. Keyboard shortcuts: suspend current tab (Alt+Shift+H), discard background tabs (Alt+Shift+K).

**RU (черновик):**

Пять инструментов в боковой панели: захват длинной страницы в PNG; гибернация неактивных вкладок с заглушкой и восстановлением или режимом Discard; сброс фоновых вкладок для экономии RAM; блокировка сайтов по расписанию и спискам; очистка данных текущего сайта по кнопке. Учётные записи не нужны; данные не продаются — см. Privacy Policy.

## Single purpose

Расширение имеет **несколько** явных целей (multi-tool). В поле Single purpose / justification укажи: *«Productivity suite: capture, tab lifecycle, network blocking, and site data tools sharing one side panel and one service worker for a unified UX.»*

## Permission justifications (вставка в форму review)

Скопируй по полям или одним блоком, если Store даёт одно поле:

- **tabs** — Read/update tab URLs and indices for capture scroll, hibernate/suspend/restore, memory discard, and opening result/history pages in the correct window.
- **activeTab** — Temporary access to the active tab when the user invokes capture or site-data clear, without persistent broad access until action.
- **host_permissions (`<all_urls>`)** — Page capture and content helpers run on user-visited pages; tab hibernate and blocker apply to navigable URLs the user chooses to load.
- **scripting** — Inject the scroll/capture helper (`content.js`) and optional flows only when the user starts capture or clear actions.
- **downloads** — Save PNG exports from Page Capture to the user’s Downloads path or chosen folder.
- **storage** — Persist settings, blocklists, capture export folder preference, and hibernate backup metadata locally.
- **bookmarks** — Tab Hibernate writes dated backup folders and suspended-tab recovery bookmarks only as part of user-requested backup/restore.
- **alarms** — Periodic inactivity checks for Tab Hibernate and schedule checks for Site Blocker.
- **history** — Optional Site Blocker helper to pick domains from recent history when the user uses that flow (no bulk upload).
- **browsingData** — Site Data Clear removes cookies/storage/cache for the **current** site only when the user confirms the action.
- **sidePanel** — Hosts the unified settings and actions UI.
- **declarativeNetRequest** — Applies static filter rulesets and user-defined block rules in the browser’s network stack; no remote rule fetching in this package.

## Data safety (Data usage / Privacy practices)

Отметь в консоли Store (по факту кода):

- **Does not handle user data** — неверно; лучше честно: handling limited to on-device.
- Или используй формулировки: данные **не продаются**, **не передаются** на ваши серверы (если нет телеметрии — укажи «No remote servers»).
- **Local only:** settings in `chrome.storage.local`, capture tiles briefly in IndexedDB for handoff to `result.html`, bookmarks created only by user-triggered backup.

## Скриншоты (сделай вручную перед submit)

1. Боковая панель — главный экран с блоками инструментов.
2. Вкладка Capture / результат с плитками.
3. Tabs — режим Placeholder, таймаут.
4. Blocker — список доменов.
5. Clear — чекбоксы очистки.

Размеры по требованиям Store (1280×800 или как актуально в [документации](https://developer.chrome.com/docs/webstore/images)).

## Сборка ZIP

Из корня репозитория:

```bash
chmod +x scripts/package-swiss-extensions-store.sh
./scripts/package-swiss-extensions-store.sh
```

Архив: `dist/SwissExtensions-v<version>-chrome-store.zip` — загрузи его в **Package** в консоли.
