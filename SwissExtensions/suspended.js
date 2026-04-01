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

/** Local browser favicon URL (no external requests from extension page). */
function getLocalFaviconUrl(pageUrl) {
  try {
    const u = new URL(pageUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return `chrome://favicon2/?size=32&pageUrl=${encodeURIComponent(pageUrl)}`;
  } catch (e) {
    return '';
  }
}

function getFallbackFaviconUrl(pageUrl) {
  try {
    const u = new URL(pageUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(u.hostname)}`;
  } catch (e) {
    return '';
  }
}

function escapeSvgAttr(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function makeBlockedFaviconDataUrl(sourceHref) {
  if (!sourceHref) return '';
  try {
    const safeHref = escapeSvgAttr(sourceHref);
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">` +
      `<defs><filter id="g"><feColorMatrix type="saturate" values="0"/></filter></defs>` +
      `<rect width="64" height="64" rx="12" fill="#0f1115"/>` +
      `<image href="${safeHref}" x="8" y="8" width="48" height="48" filter="url(#g)" opacity="0.9"/>` +
      `<circle cx="49" cy="49" r="11" fill="#3d414a"/>` +
      `<rect x="42.5" y="47.5" width="13" height="3" rx="1.5" fill="#f2f3f5" transform="rotate(-45 49 49)"/>` +
      `</svg>`;
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  } catch (e) {
    return '';
  }
}

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
    const faviconUrl = savedIcon || getLocalFaviconUrl(url) || getFallbackFaviconUrl(url);
    if (faviconUrl) {
      pageFaviconEl.hidden = true;
      pageFaviconEl.onerror = () => { pageFaviconEl.hidden = true; };
      pageFaviconEl.onload = () => {
        pageFaviconEl.style.filter = 'grayscale(1) saturate(0) brightness(0.85) contrast(0.95)';
        pageFaviconEl.style.opacity = '0.95';
        pageFaviconEl.hidden = false;
      };
      pageFaviconEl.src = faviconUrl;
      const blockedIcon = makeBlockedFaviconDataUrl(faviconUrl);
      setDocumentFavicon(blockedIcon || faviconUrl);
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
