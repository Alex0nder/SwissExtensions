/**
 * Video Downloader: передаёт ссылку во внешний загрузчик (SaveFrom и запасное зеркало).
 * Валидация URL, история в storage, подставить URL с активной вкладки.
 */

const urlInput = document.getElementById('url');
const btnOpen = document.getElementById('btnOpen');
const btnOpenAlt = document.getElementById('btnOpenAlt');
const btnFromTab = document.getElementById('btnFromTab');
const hintEl = document.getElementById('hint');
const recentListEl = document.getElementById('recentList');

const DOWNLOADER_PRIMARY = 'https://ru.savefrom.net/246rR/?url=';
const DOWNLOADER_FALLBACK = 'https://savefrom.net/?url=';

const RECENT_KEY = 'recentVideoUrls';
const RECENT_MAX = 12;

/** Нормализация и проверка: только http(s), иначе null и сообщение. */
function normalizeAndValidate(raw) {
  let s = String(raw || '').trim();
  if (!s) return { ok: false, message: 'Вставьте ссылку на пост или видео' };
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) {
    s = 'https://' + s;
  }
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return { ok: false, message: 'Нужна ссылка http или https' };
    }
    return { ok: true, url: u.href };
  } catch {
    return { ok: false, message: 'Некорректная ссылка' };
  }
}

function setHint(text, isError) {
  hintEl.textContent = text;
  hintEl.classList.toggle('err', !!isError);
}

async function loadRecent() {
  const { [RECENT_KEY]: list } = await chrome.storage.local.get(RECENT_KEY);
  return Array.isArray(list) ? list : [];
}

async function saveRecent(url) {
  let list = await loadRecent();
  list = list.filter((x) => x !== url);
  list.unshift(url);
  list = list.slice(0, RECENT_MAX);
  await chrome.storage.local.set({ [RECENT_KEY]: list });
}

function renderRecent(urls) {
  recentListEl.innerHTML = '';
  if (!urls.length) {
    recentListEl.classList.add('empty');
    return;
  }
  recentListEl.classList.remove('empty');
  urls.forEach((u) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'recent-item';
    btn.textContent = u.length > 48 ? u.slice(0, 45) + '…' : u;
    btn.title = u;
    btn.addEventListener('click', () => {
      urlInput.value = u;
      updateButton();
      setHint('Откроется загрузчик — сервис сам определит источник.', false);
    });
    recentListEl.appendChild(btn);
  });
}

function buildDownloaderUrl(base, pageUrl) {
  return base + encodeURIComponent(pageUrl);
}

async function openDownloader(base) {
  const parsed = normalizeAndValidate(urlInput.value);
  if (!parsed.ok) {
    setHint(parsed.message, true);
    return;
  }
  const pageUrl = parsed.url;
  setHint('Открываю вкладку…', false);
  try {
    await navigator.clipboard.writeText(pageUrl);
  } catch (_) {}
  await saveRecent(pageUrl);
  const tabsUrl = buildDownloaderUrl(base, pageUrl);
  await chrome.tabs.create({ url: tabsUrl });
  renderRecent(await loadRecent());
  window.close();
}

async function fillFromActiveTab() {
  setHint('', false);
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) {
      setHint('Нет URL у активной вкладки', true);
      return;
    }
    const u = tab.url;
    if (!u.startsWith('http://') && !u.startsWith('https://')) {
      setHint('Активная вкладка не сайт (http/https)', true);
      return;
    }
    urlInput.value = u;
    updateButton();
    setHint('Подставлена ссылка с активной вкладки', false);
  } catch (e) {
    setHint('Не удалось прочитать вкладку', true);
  }
}

function updateButton() {
  const parsed = normalizeAndValidate(urlInput.value);
  const ok = parsed.ok;
  btnOpen.disabled = !ok;
  btnOpenAlt.disabled = !ok;
}

urlInput.addEventListener('input', () => {
  updateButton();
  if (hintEl.classList.contains('err')) setHint('Откроется загрузчик — сервис сам определит источник.', false);
});
urlInput.addEventListener('paste', () => setTimeout(updateButton, 0));
btnOpen.addEventListener('click', () => openDownloader(DOWNLOADER_PRIMARY));
btnOpenAlt.addEventListener('click', () => openDownloader(DOWNLOADER_FALLBACK));
btnFromTab.addEventListener('click', fillFromActiveTab);
urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') openDownloader(DOWNLOADER_PRIMARY);
});

loadRecent().then(renderRecent);
updateButton();
