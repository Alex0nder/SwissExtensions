# Swiss Extensions

**Публикация в Chrome Web Store:** чтобы ускорить ревью, подавайте отдельные листинги из папок `PdfExtensions`, `TabHibernate`, `TabMemoryCleaner`, `SiteBlocker`, `SiteDataClear` (см. корневой `README.md` в репозитории). Этот каталог — монолит «всё в одном». **Пакет для Store:** из корня репозитория `./scripts/package-swiss-extensions-store.sh` → `dist/SwissExtensions-v*-chrome-store.zip`; чеклист — `PUBLISHING_CHECKLIST.md`; тексты для карточки и permissions — `STORE_LISTING.md`.

Five tools in one extension:

1. **Page Capture** — screenshot by viewport tiles, export to PNG
2. **Tab Hibernate** — suspend inactive tabs, backup to bookmarks, Side Panel
3. **Memory Cleaner** — discard background tabs (RAM)
4. **Site Blocker** — block ads, trackers, miners + custom domain list
5. **Site Data Clear** — clear cookies, localStorage, sessionStorage for current site

## Installation

1. Open `chrome://extensions/`
2. Enable Developer mode
3. Load unpacked → select `SwissExtensions` folder

## Usage

Click extension icon to open **Side Panel** with all tools (Capture, Tabs, Blocker, Clear, Memory where present):
- **Capture** — Scan page, opens result.html for PNG
- **Tabs** — Tab Hibernate settings (timeout, mode, backup, suspend/restore)
- **Blocker** — Toggle and domain blocklist
- **Clear** — Cookies/localStorage/sessionStorage checkboxes and clear button

## Заглушка (suspended.html) не появляется

- Режим **Discard** не открывает заглушку — Chrome просто выгружает вкладку из памяти. Нужен режим **Placeholder** или **Smart** (часть сайтов всё равно уйдёт в Discard по правилам Smart).
- До исправления 1.5.x при **первой установке** в storage не было `settings.mode`, а движок по умолчанию считал режим Discard, хотя в панели отображался Placeholder. Сейчас дефолт — **Placeholder**; если уже сохранён Discard — переключите вручную и сохраните настройки.
- Если включено **Skip tabs in tab groups** — вкладки в группах не гибернируются (в т.ч. без заглушки).

## Tip — Updating without losing tabs

1. **Before update:** Use "Restore all" to unsuspend tabs, then update.
2. **After update (if tabs closed):** Use "Recover lost tabs" — restores from bookmarks.
3. **Fixed ID:** Manifest includes `key` so extension ID stays the same across future updates (Remove + Load unpacked).

## Technical

- Manifest V3, single service worker
- Storage: `settings`, `blocked`, `enabled` — separate keys per tool
- Page Capture: IndexedDB `PdfCaptureDB`, content.js for scroll and hide fixed elements
- Site Blocker: static rulesets (blocker/ruleset_*.json) + dynamic user rules (ID >= 10000)
