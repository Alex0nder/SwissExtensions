/**
 * Site Data Clear — очистка cookies, localStorage, sessionStorage для текущей вкладки.
 * Выбор пользователя через чекбоксы.
 */

document.getElementById('btnClear').addEventListener('click', clearSiteData);

async function clearSiteData() {
  const status = document.getElementById('status');
  status.textContent = '';
  status.className = '';

  const optCookies = document.getElementById('optCookies').checked;
  const optLocalStorage = document.getElementById('optLocalStorage').checked;
  const optSessionStorage = document.getElementById('optSessionStorage').checked;

  if (!optCookies && !optLocalStorage && !optSessionStorage) {
    status.textContent = 'Выберите хотя бы один пункт';
    status.className = 'err';
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) {
    status.textContent = 'Нет активной вкладки';
    status.className = 'err';
    return;
  }

  try {
    const url = new URL(tab.url);
    const origin = url.origin;
    if (url.protocol === 'chrome:' || url.protocol === 'chrome-extension:') {
      status.textContent = 'Недоступно для системных страниц';
      status.className = 'err';
      return;
    }

    const options = { origins: [origin], since: 0 };
    const dataToRemove = {};
    if (optCookies) dataToRemove.cookies = true;
    if (optLocalStorage) dataToRemove.localStorage = true;
    if (Object.keys(dataToRemove).length > 0) {
      await chrome.browsingData.remove(options, dataToRemove);
    }
    if (optSessionStorage) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => { sessionStorage.clear(); },
      });
    }

    status.textContent = 'Готово';
    status.className = 'ok';
    setTimeout(() => chrome.tabs.reload(tab.id), 800);
  } catch (e) {
    status.textContent = 'Ошибка: ' + (e.message || 'неизвестная');
    status.className = 'err';
  }
}
