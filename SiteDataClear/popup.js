/**
 *   origin  : ,    storage.
 */

const STORAGE_KEY = 'sdcOptions';

const DEFAULT_OPTIONS = {
  cookies: true,
  localStorage: true,
  sessionStorage: true,
  cacheStorage: true,
};

const PRESETS = {
  all: { cookies: true, localStorage: true, sessionStorage: true, cacheStorage: true },
  cookies: { cookies: true, localStorage: false, sessionStorage: false, cacheStorage: false },
  storage: { cookies: false, localStorage: true, sessionStorage: true, cacheStorage: true },
  session: { cookies: false, localStorage: false, sessionStorage: true, cacheStorage: false },
};

const els = {
  cookies: document.getElementById('optCookies'),
  localStorage: document.getElementById('optLocalStorage'),
  sessionStorage: document.getElementById('optSessionStorage'),
  cacheStorage: document.getElementById('optCacheStorage'),
  btnClear: document.getElementById('btnClear'),
  status: document.getElementById('status'),
};

function applyOptions(o) {
  const m = { ...DEFAULT_OPTIONS, ...o };
  els.cookies.checked = !!m.cookies;
  els.localStorage.checked = !!m.localStorage;
  els.sessionStorage.checked = !!m.sessionStorage;
  els.cacheStorage.checked = !!m.cacheStorage;
}

function readOptionsFromUi() {
  return {
    cookies: els.cookies.checked,
    localStorage: els.localStorage.checked,
    sessionStorage: els.sessionStorage.checked,
    cacheStorage: els.cacheStorage.checked,
  };
}

function saveOptions() {
  chrome.storage.local.set({ [STORAGE_KEY]: readOptionsFromUi() });
}

async function loadOptions() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  applyOptions(data[STORAGE_KEY] || DEFAULT_OPTIONS);
}

['cookies', 'localStorage', 'sessionStorage', 'cacheStorage'].forEach((key) => {
  els[key].addEventListener('change', saveOptions);
});

document.querySelectorAll('[data-preset]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const id = btn.getAttribute('data-preset');
    const preset = PRESETS[id];
    if (preset) {
      applyOptions(preset);
      saveOptions();
    }
  });
});

document.getElementById('btnClear').addEventListener('click', clearSiteData);

async function clearSiteData() {
  const status = els.status;
  status.textContent = '';
  status.className = '';

  const opt = readOptionsFromUi();
  const anyBrowsing = opt.cookies || opt.localStorage || opt.cacheStorage;
  if (!anyBrowsing && !opt.sessionStorage) {
    status.textContent = 'Select at least one option';
    status.className = 'err';
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) {
    status.textContent = 'No active tab';
    status.className = 'err';
    return;
  }

  try {
    const url = new URL(tab.url);
    const origin = url.origin;
    if (url.protocol === 'chrome:' || url.protocol === 'chrome-extension:' || url.protocol === 'edge:' || url.protocol === 'about:') {
      status.textContent = 'Unavailable on system pages';
      status.className = 'err';
      return;
    }

    const options = { origins: [origin], since: 0 };
    const dataToRemove = {};
    if (opt.cookies) dataToRemove.cookies = true;
    if (opt.localStorage) dataToRemove.localStorage = true;
    if (opt.cacheStorage) dataToRemove.cacheStorage = true;
    if (Object.keys(dataToRemove).length > 0) {
      await chrome.browsingData.remove(options, dataToRemove);
    }
    if (opt.sessionStorage) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => { sessionStorage.clear(); },
      });
    }

    status.textContent = 'Done';
    status.className = 'ok';
    saveOptions();
    setTimeout(() => chrome.tabs.reload(tab.id), 800);
  } catch (e) {
    status.textContent = 'Error: ' + (e.message || 'unknown');
    status.className = 'err';
  }
}

loadOptions();
