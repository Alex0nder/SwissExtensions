# Extensions (Swiss family)

В репозитории два варианта:

- **`SwissExtensions/`** — один пакет (Side Panel): захват страницы, Tab Hibernate, Memory Cleaner, Site Blocker, Site Data Clear. Больше прав в `manifest.json` → ревью в Chrome Web Store обычно дольше и с большим числом вопросов.
- **Отдельные папки ниже** — те же идеи с **минимальными** правами под задачу. Их удобнее подавать в Store по одному: меньше поверхность для проверки, проще обосновать каждое разрешение.

## Отдельные расширения (рекомендуется для публикации)

| Папка | Название для Store | Суть |
|--------|-------------------|------|
| `PdfExtensions/` | Page Capture (tiles / PNG) | Скан страницы, плитки, экспорт PNG; `activeTab` + узкие `host_permissions` где возможно |
| `TabHibernate/` | Tab Hibernate | Сон вкладок, закладки-бэкап, side panel |
| `TabMemoryCleaner/` | Tab Memory Cleaner | Discard фоновых вкладок, горячая клавиша |
| `SiteBlocker/` | Site Blocker | DNR, списки блокировки, отдельный `background.js` |
| `SiteDataClear/` | Site Data Clear | Очистка данных сайта по кнопке |

Загрузка в режиме разработчика: для каждого пункта — **Load unpacked** и выбор **соответствующей папки** (не корень репозитория).

## Монолит (опционально)

`SwissExtensions/` — для тех, кто хочет одну иконку и одну панель. Можно оставить как «suite» или не публиковать в Store, если цель — быстрее пройти модерацию через сплиты.

Дубликат для истории/сравнения: `SwissExtensions-repo/` (по необходимости не смешивать с активной разработкой).

## Установка (developer mode)

1. `chrome://extensions/` → **Режим разработчика**.
2. **Загрузить распакованное** → указать папку нужного расширения (например `PdfExtensions` или `SwissExtensions`).

## Privacy / лицензия

- Политика (для Store): https://github.com/Alex0nder/SwissExtensions/blob/main/PRIVACY_POLICY.md  
- Лицензия: MIT (см. файлы в подпроектах при наличии).
