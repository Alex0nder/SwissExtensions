# Swiss Extensions — публикация в Chrome Web Store

Коротко: расширение уже приведено к релизному состоянию по `manifest.json` (иконки, очистка `key`, корректные `host_permissions`). Ниже шаги, чтобы пройти публикацию с первого раза.

## 1) Что уже исправлено в проекте

- Удален `key` из `manifest.json` (для Web Store не нужен и часто мешает review).
- Добавлены `icons` (`16/32/48/128`) и `action.default_icon`.
- Нормализованы `host_permissions` до `["<all_urls>"]` без дублей.
- Интерфейс собирается из `frontend/apps/swiss-ui` в `SwissExtensions/ui-dist`.
- Для карточки Store: `minimum_chrome_version` **114** (Side Panel), `homepage_url` на репозиторий GitHub.

## 2) Подготовить пакет

1. Открой `chrome://extensions` и проверь, что расширение запускается без ошибок.
2. Собери ZIP: `./scripts/package-swiss-extensions-store.sh` → `dist/SwissExtensions-v*-chrome-store.zip` (без `.md`, `scripts/`, `_metadata/`, `.gitignore`).
3. Либо вручную: запакуй **только содержимое** папки `SwissExtensions` (не родительскую `Extensions`), чтобы `manifest.json` лежал в **корне** ZIP.
4. Обязательные файлы в пакете:
   - `manifest.json`, `service_worker.js`, `core_logic.js`
   - `content.js`
   - `ui-dist/side_panel.html`, `ui-dist/history.html`, `ui-dist/result.html`, `ui-dist/suspended.html`
   - `ui-dist/assets/`
   - `icons/`, `blocker/*.json`

## 3) Данные для карточки в Store (подготовить заранее)

Готовые черновики текстов и permission blurbs: **`STORE_LISTING.md`** в этой папке.

- **Short description** (до 132 символов)
- **Full description**
- **Скриншоты** интерфейса (минимум 1, рекомендую 3-5)
- **Promo images** (по желанию)
- **Категория**: Productivity
- **Контакты поддержки** (email/сайт)

## 4) Privacy и Compliance (критично)

У расширения есть чувствительные возможности: `history`, `browsingData`, `tabs`, `bookmarks`, работа на `<all_urls>`.

Перед отправкой обязательно:

1. Добавь публичную Privacy Policy URL.
2. В Data usage в консоли укажи:
   - данные, к которым есть доступ (history/tabs/site data),
   - что данные обрабатываются локально (если так),
   - не продаются третьим лицам.
3. В justification для permission укажи по пунктам:
   - `history`: выбор доменов из истории для блокировщика,
   - `browsingData`: очистка cookies/storage для текущего сайта,
   - `<all_urls>`/`tabs`/`activeTab`: захват страницы, hibernate и блокировка доменов.

## 5) Рекомендованный текст "Permission justification"

- **tabs + activeTab + host permissions**: нужны для Page Capture, Tab Hibernate и применения блокировки на посещаемых сайтах.
- **history**: нужен только для функции "Open blocked from history" в Site Blocker.
- **browsingData**: нужен только для функции Site Data Clear (очистка данных текущего сайта по действию пользователя).
- **bookmarks**: нужны для backup/restore вкладок в Tab Hibernate.
- **declarativeNetRequest**: нужен для встроенного блокировщика доменов и трекеров.

## 6) Финальная проверка перед Submit

- Нет ошибок в `Errors` на странице расширения.
- Все кнопки side panel работают.
- `Page Capture` создаёт PNG (целый скролл или плитки).
- `Tab Hibernate` делает backup/restore.
- `Site Blocker` включает/выключает правила.
- `Site Data Clear` очищает данные текущего сайта.
