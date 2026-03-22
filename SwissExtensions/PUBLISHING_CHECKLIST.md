# Swiss Extensions — публикация в Chrome Web Store

Коротко: расширение уже приведено к релизному состоянию по `manifest.json` (иконки, очистка `key`, корректные `host_permissions`). Ниже шаги, чтобы пройти публикацию с первого раза.

## 1) Что уже исправлено в проекте

- Удален `key` из `manifest.json` (для Web Store не нужен и часто мешает review).
- Добавлены `icons` (`16/32/48/128`) и `action.default_icon`.
- Нормализованы `host_permissions` до `["<all_urls>"]` без дублей.
- Добавлен `web_accessible_resources` для `content.js`, который инжектится через `chrome.scripting.executeScript`.

## 2) Подготовить пакет

1. Открой `chrome://extensions` и проверь, что расширение запускается без ошибок.
2. Запакуй только содержимое папки `SwissExtensions` в ZIP (не родительскую папку `Extensions`).
3. Убедись, что в архив попали:
   - `manifest.json`
   - `service_worker.js`
   - `side_panel.html`, `side_panel.js`
   - `content.js`, `content_script.js`
   - `result.html`, `result.js`, `history.html`, `history.js`, `suspended.html`, `suspended.js`
   - папки `icons`, `blocker`, `lib`

## 3) Данные для карточки в Store (подготовить заранее)

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
- `Page Capture` создает PNG/PDF.
- `Tab Hibernate` делает backup/restore.
- `Site Blocker` включает/выключает правила.
- `Site Data Clear` очищает данные текущего сайта.

