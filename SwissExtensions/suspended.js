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

/** MV3 favicon API — chrome://favicon2 is blocked from extension pages. */
function getExtensionFaviconUrl(pageUrl, size = 64) {
  try {
    const u = new URL(pageUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    const url = new URL(chrome.runtime.getURL('/_favicon/'));
    url.searchParams.set('pageUrl', pageUrl);
    url.searchParams.set('size', String(size));
    return url.toString();
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

/** Favicon candidates: saved icon → extension favicon API → origin → DDG → Google. */
function faviconCandidateUrls(pageUrl, savedIcon) {
  const out = [];
  const add = (u) => {
    const s = (u || '').trim();
    if (!s || out.includes(s)) return;
    if (s.startsWith('chrome://')) return;
    out.push(s);
  };
  add(typeof savedIcon === 'string' ? savedIcon : '');
  add(getExtensionFaviconUrl(pageUrl));
  try {
    const u = new URL(pageUrl);
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      add(`${u.origin}/favicon.ico`);
      add(`https://icons.duckduckgo.com/ip3/${encodeURIComponent(u.hostname)}.ico`);
      add(getFallbackFaviconUrl(pageUrl));
    }
  } catch (e) {
    /* ignore */
  }
  return out;
}

function fillRoundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, rr);
  } else {
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }
  ctx.fill();
}

/**
 * Favicon :  PNG (SVG  chrome://     ).
 *   canvas —   ,    URL.
 */
function rasterizeBlockedTabIcon(src, done) {
  const img = new Image();
  img.decoding = 'async';
  img.onload = () => {
    try {
      const W = 64;
      const H = 64;
      const pad = 8;
      const side = 48;
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#0f1115';
      fillRoundRect(ctx, 0, 0, W, H, 12);

      ctx.save();
      ctx.filter = 'grayscale(1) saturate(0) brightness(0.88) contrast(0.95)';
      ctx.drawImage(img, pad, pad, side, side);
      ctx.restore();

      const bx = 49;
      const by = 49;
      ctx.beginPath();
      ctx.arc(bx, by, 11, 0, Math.PI * 2);
      ctx.fillStyle = '#3d414a';
      ctx.fill();
      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(-Math.PI / 4);
      ctx.fillStyle = '#f2f3f5';
      fillRoundRect(ctx, -6.5, -1.5, 13, 3, 1.5);
      ctx.restore();

      done(c.toDataURL('image/png'));
    } catch (e) {
      done('');
    }
  };
  img.onerror = () => done('');
  img.src = src;
}

function loadFirstWorkingFaviconUrl(candidates, done) {
  let i = 0;
  const next = () => {
    if (i >= candidates.length) {
      done('');
      return;
    }
    const url = candidates[i++];
    const probe = new Image();
    probe.decoding = 'async';
    probe.onload = () => done(url);
    probe.onerror = next;
    probe.src = url;
  };
  next();
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
    const candidates = faviconCandidateUrls(url, savedIcon);
    pageFaviconEl.hidden = true;
    loadFirstWorkingFaviconUrl(candidates, (resolved) => {
      if (!resolved) {
        pageFaviconEl.hidden = true;
        return;
      }
      pageFaviconEl.onerror = () => { pageFaviconEl.hidden = true; };
      pageFaviconEl.onload = () => {
        pageFaviconEl.style.filter = 'grayscale(1) saturate(0) brightness(0.85) contrast(0.95)';
        pageFaviconEl.style.opacity = '0.95';
        pageFaviconEl.hidden = false;
      };
      pageFaviconEl.src = resolved;
      rasterizeBlockedTabIcon(resolved, (png) => {
        setDocumentFavicon(png || resolved);
      });
    });
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
  chrome.runtime.sendMessage({ type: 'removeSuspendedBookmark', url }).catch(() => {});
  chrome.tabs.getCurrent((tab) => {
    const targetId = tab?.id ?? tabId;
    const keys = [`suspended_${targetId}`];
    if (tabId && tabId !== targetId) keys.push(`suspended_${tabId}`);
    chrome.storage.local.remove(keys);
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

let rebindAttempt = 0;
const REBIND_RETRY_MS = [0, 400, 1200, 2800];

function requestPlaceholderRebind() {
  if (rebindAttempt >= REBIND_RETRY_MS.length) return;
  const delay = REBIND_RETRY_MS[rebindAttempt];
  rebindAttempt += 1;
  setTimeout(() => {
    chrome.runtime.sendMessage({ type: 'rebindPlaceholderTab' }, () => {
      loadRestoreDataFromServiceWorker();
    });
  }, delay);
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'placeholderRefresh') loadRestoreData();
});

function applyRestoreItem(item) {
  if (item?.url && isRestorableUrl(item.url)) {
    showUrlAndRestore(item.url, item.title, item.favIconUrl || '');
    return true;
  }
  return false;
}

/** Service worker scans all suspended_* keys (tab.id changes after session restore). */
function loadRestoreDataFromServiceWorker() {
  chrome.runtime.sendMessage({ type: 'resolvePlaceholderData' }, (item) => {
    if (applyRestoreItem(item)) return;
    loadRestoreDataLocal();
  });
}

/** Local fallback: current tab.id and tabId from suspended.html URL. */
function loadRestoreDataLocal() {
  chrome.tabs.getCurrent((tab) => {
    const actualTabId = tab?.id ?? null;
    const keys = [];
    if (actualTabId) keys.push(`suspended_${actualTabId}`);
    if (tabId && tabId !== actualTabId) keys.push(`suspended_${tabId}`);
    if (!keys.length) {
      if (isRestorableUrl(fallbackUrl)) showUrlAndRestore(fallbackUrl, '', '');
      else {
        showError('Unknown tab');
        requestPlaceholderRebind();
      }
      return;
    }
    chrome.storage.local.get(keys, (data) => {
      if (chrome.runtime.lastError) {
        if (isRestorableUrl(fallbackUrl)) showUrlAndRestore(fallbackUrl, '', '');
        else {
          showError('Could not load restore data');
          requestPlaceholderRebind();
        }
        return;
      }
      let item = null;
      for (const k of keys) {
        if (data[k]?.url && isRestorableUrl(data[k].url)) {
          item = data[k];
          break;
        }
      }
      if (applyRestoreItem(item)) return;
      if (isRestorableUrl(fallbackUrl)) {
        showUrlAndRestore(fallbackUrl, '', '');
      } else {
        showError('Restore data unavailable');
        requestPlaceholderRebind();
      }
    });
  });
}

function loadRestoreData() {
  loadRestoreDataFromServiceWorker();
}

loadRestoreData();

window.addEventListener('pageshow', (event) => {
  if (event.persisted) loadRestoreData();
});
