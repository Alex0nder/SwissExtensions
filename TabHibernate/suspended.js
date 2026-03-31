/**
 * Placeholder page: shows URL and Restore button.
 * Restore on button click or click on background/card (except link clicks — open in new tab).
 */

const params = new URLSearchParams(window.location.search);
const tabIdParam = params.get('tabId');
const tabId = tabIdParam ? parseInt(tabIdParam, 10) : null;
const fallbackUrl = params.get('u') || '';

const urlEl = document.getElementById('url');
const btn = document.getElementById('reload');
const pageFaviconEl = document.getElementById('pageFavicon');
const pageTitleEl = document.getElementById('pageTitle');

/** Current URL to restore (if any); used by both button and background click. */
let currentRestoreUrl = null;

/** Domain from URL for favicon request (http(s) only). */
function getDomainForFavicon(url) {
  try {
    const u = new URL(url);
    return u.hostname || '';
  } catch (e) {
    return '';
  }
}

/** Favicon URL by domain (external service; icon hidden on load error). */
const FAVICON_BASE = 'https://www.google.com/s2/favicons?sz=32&domain=';

function setDocumentFavicon(href) {
  if (!href) return;
  try {
    const iconLink = document.querySelector('link[rel="icon"]') || document.createElement('link');
    iconLink.setAttribute('rel', 'icon');
    iconLink.setAttribute('href', href);
    if (!iconLink.parentNode) document.head.appendChild(iconLink);
  } catch (e) {
    console.warn('[TabHibernate] failed to set document favicon', e);
  }
}

function showError(msg) {
  urlEl.textContent = msg;
  if (btn) btn.disabled = true;
}

function isRestorableUrl(url) {
  return typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('file://'));
}

/** Show page title and favicon, then URL and Restore button. */
function showUrlAndRestore(url, title, favIconUrl) {
  if (!url || !isRestorableUrl(url)) {
    showError('Restore data unavailable');
    return;
  }
  currentRestoreUrl = url;
  const displayTitle = (title && String(title).trim()) || url || '—';
  if (pageTitleEl) pageTitleEl.textContent = displayTitle;

  if (pageFaviconEl) {
    const savedIcon = typeof favIconUrl === 'string' ? favIconUrl.trim() : '';
    const domain = getDomainForFavicon(url);
    if (savedIcon) {
      pageFaviconEl.hidden = true;
      pageFaviconEl.onerror = () => { pageFaviconEl.hidden = true; };
      pageFaviconEl.onload = () => { pageFaviconEl.hidden = false; };
      pageFaviconEl.src = savedIcon;
      setDocumentFavicon(savedIcon);
    } else if (domain && (url.startsWith('http://') || url.startsWith('https://'))) {
      pageFaviconEl.hidden = true;
      pageFaviconEl.onerror = () => { pageFaviconEl.hidden = true; };
      pageFaviconEl.onload = () => { pageFaviconEl.hidden = false; };
      pageFaviconEl.src = FAVICON_BASE + encodeURIComponent(domain);
      setDocumentFavicon(FAVICON_BASE + encodeURIComponent(domain));
    } else {
      pageFaviconEl.hidden = true;
    }
  }

  urlEl.innerHTML = '';
  const link = document.createElement('a');
  link.href = url;
  link.textContent = url;
  link.title = url;
  link.target = '_blank';
  link.rel = 'noopener';
  urlEl.appendChild(link);
  if (btn) btn.onclick = () => restore(url);
}

// Restore: load URL in this tab. getCurrent() needed after browser restart (tabId in URL may be stale).
function restore(url) {
  if (!url || !isRestorableUrl(url)) return;
  if (btn) btn.disabled = true;
  const key = `suspended_${tabId}`;
  chrome.storage.local.remove(key);
  chrome.runtime.sendMessage({ type: 'removeSuspendedBookmark', url }).catch(() => {});
  chrome.tabs.getCurrent((tab) => {
    const targetId = tab ? tab.id : tabId;
    chrome.tabs.update(targetId, { url }).then(() => {}).catch((e) => {
      console.warn('[TabHibernate] restore failed', e);
      if (btn) btn.disabled = false;
    });
  });
}

// Click on background or card — restore tab (button and link handle themselves).
document.body.addEventListener('click', (e) => {
  if (!currentRestoreUrl) return;
  if (e.target.closest('a') || e.target.closest('button')) return;
  e.preventDefault();
  restore(currentRestoreUrl);
});

if (!tabId) {
  showError('Unknown tab');
} else {
  const key = `suspended_${tabId}`;
  chrome.storage.local.get(key, (data) => {
    if (chrome.runtime.lastError) {
      if (isRestorableUrl(fallbackUrl)) {
        showUrlAndRestore(fallbackUrl, '');
      } else {
        showError('Could not load restore data');
      }
      return;
    }
    const item = data[key];
    if (item && item.url && isRestorableUrl(item.url)) {
      showUrlAndRestore(item.url, item.title, item.favIconUrl || '');
    } else if (isRestorableUrl(fallbackUrl)) {
      showUrlAndRestore(fallbackUrl, '', '');
    } else {
      showError('Restore data unavailable');
    }
  });
}
