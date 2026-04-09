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
    return `chrome://favicon2/?size=64&pageUrl=${encodeURIComponent(pageUrl)}`;
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

/**  URL  :  →  Chrome → origin → DDG → Google ( favicon2/ ). */
function faviconCandidateUrls(pageUrl, savedIcon) {
  const out = [];
  const add = (u) => {
    const s = (u || '').trim();
    if (!s || out.includes(s)) return;
    out.push(s);
  };
  add(typeof savedIcon === 'string' ? savedIcon : '');
  add(getLocalFaviconUrl(pageUrl));
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
        showUrlAndRestore(fallbackUrl, '', '');
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
