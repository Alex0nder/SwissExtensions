/**
 * Service worker: скролл + captureVisibleTab по тайлам (без ресайза окна — без chrome.windows).
 * Размер кадра = текущий viewport окна браузера.
 */

/** Задержка между кадрами: Chrome ограничивает captureVisibleTab (лимит вызовов в секунду) */
const SCROLL_DELAY_MS = 1500;
/** Доп. пауза перед первым кадром, чтобы верх страницы успел отрисоваться */
const FIRST_FRAME_DELAY_MS = 500;

/** Только активная вкладка — не трогаем окно (избегаем "No window with id") */
async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('Нет активной вкладки');
  return tab;
}

function injectContentScript(tabId) {
  return chrome.scripting.executeScript({
    target: { tabId },
    files: ['content.js'],
  });
}

function getPageHeight(tabId) {
  return chrome.tabs.sendMessage(tabId, { type: 'getPageHeight' }).then((r) => r.height);
}

function getViewportHeight(tabId) {
  return chrome.tabs.sendMessage(tabId, { type: 'getViewportHeight' }).then((r) => r.height);
}

function scrollTo(tabId, y) {
  return chrome.tabs.sendMessage(tabId, { type: 'scrollTo', y });
}

function hideFloating(tabId) {
  return chrome.tabs.sendMessage(tabId, { type: 'hideFloating' });
}

function showFloating(tabId) {
  return chrome.tabs.sendMessage(tabId, { type: 'showFloating' }).catch(() => {});
}

/** Шаг скролла = высота viewport, чтобы кадры стыковались без обрезков и пропусков. */
async function captureTiles(tabId, windowId, pageHeight, viewportHeight, onProgress) {
  const step = Math.max(1, Math.floor(viewportHeight));
  const tiles = [];
  let y = 0;
  let isFirst = true;
  while (y < pageHeight) {
    await scrollTo(tabId, y);
    await new Promise((r) =>
      setTimeout(r, isFirst ? FIRST_FRAME_DELAY_MS + SCROLL_DELAY_MS : SCROLL_DELAY_MS)
    );
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
      format: 'png',
    });
    tiles.push(dataUrl);
    if (onProgress) onProgress(tiles.length);
    y += step;
    isFirst = false;
  }
  return tiles;
}

const DB_NAME = 'PdfCaptureDB';
const DB_STORE = 'capture';
const DB_KEY = 'pending';

/** Сохранить данные в IndexedDB (переживают завершение service worker) */
function saveToIndexedDB(data) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put(data, DB_KEY);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
    req.onupgradeneeded = (e) => {
      e.target.result.createObjectStore(DB_STORE);
    };
  });
}

/** Открыть страницу результата рядом с текущей вкладкой (справа) */
function openResultPage(tab) {
  chrome.tabs.create({
    url: chrome.runtime.getURL('result.html'),
    index: tab ? tab.index + 1 : undefined,
    windowId: tab?.windowId,
  });
}

/** Понятные сообщения для типичных ошибок захвата. */
function formatCaptureError(e) {
  const msg = (e && e.message) || String(e);
  const lower = msg.toLowerCase();
  if (lower.includes('no active tab') || msg.includes('Нет активной')) return 'Нет активной вкладки.';
  if (lower.includes('cannot access') || lower.includes('chrome://')) {
    return 'Эту страницу нельзя сканировать (системная или с ограничениями Chrome).';
  }
  if (lower.includes('chrome-extension://')) return 'Страницы расширений сканировать нельзя.';
  if (lower.includes('could not establish connection') || lower.includes('receiving end does not exist')) {
    return 'Не удалось подключиться к странице. Обновите вкладку и попробуйте снова.';
  }
  if (lower.includes('capturevisible') || lower.includes('cannot capture')) {
    return 'Снимок экрана вкладки недоступен (страница или окно в неподходящем состоянии).';
  }
  return msg.length > 160 ? `${msg.slice(0, 157)}…` : msg;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'getTiles') {
    const req = indexedDB.open(DB_NAME, 1);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(DB_STORE, 'readwrite');
      const store = tx.objectStore(DB_STORE);
      const getReq = store.get(DB_KEY);
      getReq.onsuccess = () => {
        const data = getReq.result || {};
        store.delete(DB_KEY);
        tx.oncomplete = () => db.close();
        sendResponse({
          tiles: data.tiles || [],
          pageInfo: data.pageInfo || null,
          error: data.error || null,
        });
      };
      getReq.onerror = () => {
        db.close();
        sendResponse({ tiles: [], pageInfo: null, error: 'Ошибка чтения данных' });
      };
    };
    req.onerror = () => sendResponse({ tiles: [], pageInfo: null, error: 'IndexedDB недоступна' });
    req.onupgradeneeded = (e) => e.target.result.createObjectStore(DB_STORE);
    return true;
  }

  if (msg.type !== 'capture') return false;

  (async () => {
    let tabId = null;
    try {
      const tab = await getActiveTab();
      tabId = tab.id;

      if (!tab.url) {
        await saveToIndexedDB({ error: 'Нет открытой страницы.' });
        openResultPage(tab);
        sendResponse({ error: 'Нет открытой страницы.' });
        return;
      }

      await injectContentScript(tabId);
      await new Promise((r) => setTimeout(r, 200));

      await hideFloating(tabId);
      await new Promise((r) => setTimeout(r, 300));

      await scrollTo(tabId, 0);
      await new Promise((r) => setTimeout(r, 400));

      const [pageHeight, viewportHeight] = await Promise.all([
        getPageHeight(tabId),
        getViewportHeight(tabId),
      ]);
      const step = Math.max(1, Math.floor(viewportHeight));
      const totalFrames = Math.ceil(pageHeight / step) || 1;
      const setProgress = (current) => {
        chrome.storage.local.set({ captureProgress: { total: totalFrames, current } });
      };
      setProgress(0);

      const tiles = await captureTiles(tabId, tab.windowId, pageHeight, viewportHeight, setProgress);
      await chrome.storage.local.remove('captureProgress');

      await showFloating(tabId);

      await saveToIndexedDB({
        tiles,
        pageInfo: { url: tab.url, title: tab.title || '' },
      });
      // Небольшая задержка — гарантирует commit IndexedDB до загрузки result.html
      await new Promise((r) => setTimeout(r, 150));
      openResultPage(tab);
      sendResponse({ ok: true, count: tiles.length });
    } catch (e) {
      await chrome.storage.local.remove('captureProgress');
      if (tabId) try { await showFloating(tabId); } catch (_) {}
      const userMsg = formatCaptureError(e);
      await saveToIndexedDB({ error: userMsg });
      let tabForOpen = null;
      if (tabId) {
        try { tabForOpen = await chrome.tabs.get(tabId); } catch (_) {}
      }
      openResultPage(tabForOpen);
      sendResponse({ error: userMsg });
    }
  })();

  return true;
});
