# Swiss Extensions — тексты для Chrome Web Store

Версия пакета: **1.5.48** · [Developer Dashboard](https://chrome.google.com/webstore/devconsole)

Privacy Policy: `https://github.com/Alex0nder/SwissExtensions/blob/main/PRIVACY_POLICY.md`

---

## Short description (≤132 символов)

**EN (131 символ):**
```
Capture, tab hibernate, RAM cleaner, site blocker with tab backup, history recovery — all local in one side panel.
```

**RU:**
```
Скрин, сон вкладок, RAM, блокировка сайтов с сохранением вкладок и восстановлением из истории — локально, одна панель.
```

---

## Full description (Detailed description)

**EN — вставить в карточку Store:**

Your browser shouldn’t feel like a second job. Swiss Extensions packs five practical tools into one minimal side panel — so you move faster, use less RAM, and stay on task.

What’s inside

1. **Page Capture** — Long pages, clean exports: tiled PNG capture (full scroll stitched in the browser).

2. **Tab Hibernate** — Suspend inactive tabs as lightweight placeholders or discard; restore when you’re back. Backup to bookmarks and local history. **Recover lost tabs** after crashes or extension updates.

3. **Memory Cleaner** — Discard background tabs to free memory without closing your active tab.

4. **Site Blocker** — Block distracting domains with built-in filter lists plus your own blocklist, whitelist, and focus schedule. **Auto-save open tabs** on blocked sites to plugin History and Chrome bookmarks so you can restore them later.

5. **Site Data Clear** — Clear cookies, localStorage, and sessionStorage for the current site — only when you confirm.

**Tab recovery (local, on your device)**

- **Backup all tabs now** before updating the extension.
- **Recover lost tabs** from extension storage and backup bookmarks.
- **Recover from Chrome history** — find visited URLs that are not open and restore as placeholders.
- **History page** — closed tabs, site-blocker saves, dated backups; export/import JSON.
- **Site Blocker → Saved tabs** — auto-saved when blocking turns on or you add a domain.

No accounts. No cloud upload of your browsing data. Keyboard shortcuts: suspend current tab (Alt+Shift+H), discard background tabs (Alt+Shift+K).

No bloat. No noise. Built for people who live in many tabs and want performance and focus through the day.

---

**RU (опционально, отдельная локаль):**

Браузер не должен ощущаться второй работой. Swiss Extensions — пять инструментов в одной боковой панели: быстрее, меньше RAM, больше фокуса.

**Внутри:** захват длинных страниц (PNG); гибернация вкладок с восстановлением; очистка RAM; блокировка сайтов по списку и расписанию; очистка данных текущего сайта по кнопке.

**Восстановление вкладок (только на устройстве):** резервная копия перед обновлением; восстановление из storage и закладок; поиск потерянных URL в истории Chrome; отдельный раздел History; автосохранение вкладок на заблокированных сайтах.

Без аккаунта. Данные не отправляются на сервер. Горячие клавиши: Alt+Shift+H (усыпить вкладку), Alt+Shift+K (сбросить фоновые).

---

---

## What's new (Release notes) — version 1.5.48

**EN (full):**
```
Tab Hibernate: fix tab groups being renamed or split by background maintenance — your Chrome group titles and membership stay as you set them.

Tab Hibernate: sync placeholder group metadata when you rename or move tabs; Group same URLs updates storage after grouping.
```

**EN (short, if character limit):**
```
Fix tab group rename/split overridden by background sync; placeholder group metadata stays in sync with Chrome.
```

**RU:**
```
Tab Hibernate: исправлено — фоновое обслуживание больше не сбрасывает переименование групп и не сливает разделённые вручную.

Tab Hibernate: синхронизация метаданных группы при rename/move; после Group same URLs storage обновляется.
```

---

## What's new (Release notes) — version 1.5.25 (archive)

**EN (full):**
```
Tab Hibernate: Group same URLs — Chrome tab groups for matching pages in the current window (hash ignored; different paths stay separate). Works on hibernate placeholders and Site Blocker error pages.

Tab Hibernate: dedupe by URL when saving — Close all and save, Save tab group, History import/load keep one entry per page URL.

Site Blocker: remember page URL before block (webNavigation); blocked tabs convert to hibernate placeholders when blocking is off or the extension is disabled.
```

**EN (short, if character limit):**
```
Group same URLs; save/History URL dedupe; Site Blocker URL memory and placeholder fallback.
```

**RU:**
```
Tab Hibernate: «Group same URLs» — группы вкладок с одинаковым URL (# игнорируется; разные path/query — отдельно). Работает на placeholder и заблокированных вкладках.

Tab Hibernate: дедуп по URL при сохранении — Close all and save, Save tab group, History.

Site Blocker: запоминание URL до блокировки; при выключении блокировки/расширения вкладки остаются placeholder с URL.
```

## What’s new (Release notes) — version 1.5.14 (archive)

**EN (полный):**
```
Tab Hibernate: save and restore whole tab groups (title, color, order) — Close all and save, History, Save tab group.

Tab Hibernate: after browser restart or force quit, suspended placeholders rebind faster; alarm no longer deletes live restore data before rebind.

Site Blocker: stronger domain blocking rules; periodic reload of open tabs on blocked sites.
```

**EN (короткий, если лимит символов):**
```
Tab groups save/restore; crash-restart placeholder fix; Site Blocker blocking improvements.
```

**RU:**
```
Tab Hibernate: сохранение и восстановление групп вкладок (название, цвет, порядок) — Close all and save, History, Save tab group.

После перезапуска/force quit placeholder быстрее перепривязывается; alarm больше не удаляет живые suspended_* до rebind.

Site Blocker: усиленные правила блокировки; периодическая перезагрузка открытых вкладок на заблокированных доменах.
```

---

## What’s new (Release notes) — version 1.5.11 (archive)

**EN (полный):**
```
Tab Hibernate: fixed inactivity timer resetting on every service worker wake — background tabs now auto-suspend again.

Tab Hibernate: pinned tabs no longer stay “always active” after notification sounds (audible:false no longer resets the timer).

Tab Hibernate: suspended placeholders stay in their tab group; clearer “Auto-suspend pinned tabs” setting.
```

**EN (короткий, если лимит символов):**
```
Auto-hibernate timer fix; pinned-tab activity reset fix; placeholders keep tab groups.
```

**RU:**
```
Tab Hibernate: таймер неактивности больше не сбрасывается при каждом пробуждении SW — фоновые вкладки снова усыпляются.

Закреплённые вкладки: audible:false не обнуляет таймер после уведомлений. Placeholder остаётся в группе; понятнее настройка auto-suspend для pinned.
```

---

## Single purpose

**EN:**
```
Productivity suite: page capture, tab lifecycle (hibernate, backup, recovery), memory discard, site blocking with local tab archives, and per-site data clearing — unified side panel and on-device storage only.
```

---

## Privacy tab — обоснование разрешения webNavigation

Вставить на вкладке **«Меры по обеспечению конфиденциальности»** → поле обоснования для **webNavigation**:

**EN (для Store):**
```
The webNavigation permission is used only to read the target http(s) URL of the main frame in onBeforeNavigate before Site Blocker declarativeNetRequest rules replace the page with a chrome-error page. Chrome tabs.onUpdated often no longer exposes the original URL after a block, so without this hook the extension cannot recover which page the user was opening.

That remembered URL is stored locally (chrome.storage.local and in-memory maps on the device) to: auto-save tabs on blocked domains to History and bookmarks; convert blocked tabs to Tab Hibernate placeholders when blocking is disabled or the extension is turned off; resolve URLs for “Group same URLs” and tab recovery. No navigation history is uploaded, sold, or used for advertising or profiling.
```

**RU (если форма на русском):**
```
Разрешение webNavigation нужно только чтобы в onBeforeNavigate (основной фрейм) прочитать целевой http(s) URL до того, как Site Blocker через declarativeNetRequest заменит страницу на chrome-error. После блокировки tabs.onUpdated часто уже не содержит исходный адрес — без этого хука расширение не может восстановить, какую страницу открывал пользователь.

Запомненный URL хранится локально (chrome.storage.local и оперативные структуры на устройстве) для: автосохранения вкладок на заблокированных доменах в History и закладки; перевода заблокированных вкладок в placeholder Tab Hibernate при выключении блокировки или расширения; определения URL для «Group same URLs» и восстановления вкладок. История навигации не отправляется на сервер, не продаётся и не используется для рекламы или профилирования.
```

**Короткий EN (если лимит символов):**
```
Capture the http(s) URL in onBeforeNavigate before Site Blocker DNR replaces the tab with chrome-error, so blocked tabs can be saved/restored locally. Stored on-device only; never sent off-device.
```

---

## Privacy tab — обоснование разрешения tabGroups

Вставить на вкладке **«Меры по обеспечению конфиденциальности»** → поле обоснования для **tabGroups**:

**EN (для Store):**
```
The tabGroups permission is used only for Tab Hibernate features that the user triggers: saving a tab group to local History (title, color, tab order), keeping suspended placeholder tabs in their group, and restoring saved tabs back into a group when opened from History. Group metadata is read from Chrome Tab Groups API and stored locally in chrome.storage.local on the device. It is not transmitted to any server, not sold, and not used for advertising or profiling.
```

**RU (если форма на русском):**
```
Разрешение tabGroups нужно только для Tab Hibernate по действию пользователя: сохранить группу вкладок в локальную History (название, цвет, порядок), оставить suspended-заглушки в группе и восстановить сохранённые вкладки в группу при открытии из History. Метаданные группы читаются через Chrome Tab Groups API и хранятся локально в chrome.storage.local. Данные не отправляются на сервер, не продаются и не используются для рекламы или профилирования.
```

**Короткий EN (если лимит символов):**
```
Read/update tab group title, color, and membership when the user saves or restores tab groups in Tab Hibernate. Stored locally only; never sent off-device.
```

---

## Permission justifications

- **tabs** — Tab URLs for capture, hibernate, suspend/restore, memory discard, recovery flows, and opening result/history pages.
- **tabGroups** — Save and restore tab group metadata (title, color, collapsed) when hibernating or closing tabs.
- **activeTab** — Active tab when the user starts capture or site-data clear.
- **host_permissions (`<all_urls>`)** — Capture and helpers on visited pages; hibernate and blocking on URLs the user loads or lists.
- **scripting** — Inject capture scroll helper when the user starts Page Capture.
- **downloads** — Save PNG exports to Downloads or a chosen folder.
- **storage** — Settings, blocklists, tab recovery archives (`closedAndSaved`, `blockedTabsSaved`, backups) — all local.
- **bookmarks** — Optional backups: Tab Hibernate, Site Blocker saved tabs, emergency recovery folders (user-triggered or auto-save on block).
- **alarms** — Tab inactivity checks and Site Blocker schedule.
- **history** — Recover lost tabs from Chrome browsing history; optional helper to pick blocked domains from past visits.
- **browsingData** — Clear data for the current site only after user confirmation.
- **sidePanel** — Main UI.
- **declarativeNetRequest** — Built-in filter rulesets and user block rules; no remote rule downloads.
- **webNavigation** — Read main-frame http(s) URL in onBeforeNavigate before Site Blocker DNR blocks the navigation, so the original page URL can be saved locally for tab recovery, History, placeholders, and “Group same URLs”.

---

## Data safety

- Обработка данных **только на устройстве** (chrome.storage.local, IndexedDB для capture, локальные закладки).
- **Не продаётся** и **не передаётся** на серверы разработчика.
- History permission: чтение истории **только** для функций восстановления по действию пользователя.

---

## Скриншоты (рекомендации)

1. Главная боковая панель (5 инструментов).
2. Tab Hibernate — recovery / History.
3. Site Blocker — список + auto-save.
4. History — Site blocker saved tabs + Chrome history recover.
5. Page Capture — результат.

---

## Сборка

```bash
./scripts/package-swiss-extensions-store.sh
```

Архив Store: `dist/SwissExtensions-v1.5.48-chrome-store.zip`
Сайт (Load unpacked): `downloads/SwissExtensions-v1.5.48.zip`
