# Swiss Extensions — тексты для Chrome Web Store

Версия пакета: **1.5.9** · [Developer Dashboard](https://chrome.google.com/webstore/devconsole)

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

## What’s new (Release notes) — версия 1.5.9

**EN (полный):**
```
Tab Hibernate: fixed auto-suspend timer resetting on every service worker wake (tabs stayed active indefinitely).

Tab Hibernate: fixed empty placeholder tabs in groups after browser restart — storage keys now rebind to current tab IDs.

History: fixed "Open all/selected" clearing saved tabs before tabs were actually opened.
```

**EN (короткий, если лимит символов):**
```
Hibernate timer fix; placeholder tabs survive browser restart; safer History open/restore.
```

**RU:**
```
Tab Hibernate: исправлен таймер авто-усыпления (сбрасывался при каждом пробуждении SW). Placeholder-вкладки в группах сохраняются после перезапуска браузера. History: безопасное открытие сохранённых вкладок.
```

---

## Single purpose

**EN:**
```
Productivity suite: page capture, tab lifecycle (hibernate, backup, recovery), memory discard, site blocking with local tab archives, and per-site data clearing — unified side panel and on-device storage only.
```

---

## Permission justifications

- **tabs** — Tab URLs for capture, hibernate, suspend/restore, memory discard, recovery flows, and opening result/history pages.
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

Архив: `dist/SwissExtensions-v1.5.9-chrome-store.zip`
