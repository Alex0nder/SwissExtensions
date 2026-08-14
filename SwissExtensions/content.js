(() => {
/**
 * Content script: page height, scroll, hide fixed/sticky chrome during capture.
 * Docs SPAs (Docusaurus/Mintlify/GitBook) wrap UI in a fixed shell — never hide
 * that shell or the scroll root, or captureVisibleTab returns blank/white frames.
 */
if (globalThis.__swissPageCaptureInjected) return;
globalThis.__swissPageCaptureInjected = true;

const HIDE_CLASS = 'page-capture-hide-fixed';
const CAPTURE_ACTIVE_CLASS = 'page-capture-active';
const CAPTURE_FAILSAFE_MS = 2 * 60 * 1000;
const LENS_STYLE_ID = 'swiss-lens-overrides';

let scrollRootCache = null;
let restoreFailsafeTimer = null;

function invalidateScrollRoot() {
  scrollRootCache = null;
}

function windowMaxScroll() {
  const h = Math.max(
    document.documentElement.scrollHeight,
    document.body ? document.body.scrollHeight : 0
  );
  return Math.max(0, h - window.innerHeight);
}

/** Prefer the main reading pane over tiny overflow boxes (code blocks, widgets). */
function findLargestScrollableElement() {
  let best = null;
  let bestScore = 0;
  const vw = window.innerWidth || document.documentElement.clientWidth || 1;
  const vh = window.innerHeight || document.documentElement.clientHeight || 1;
  const nodes = document.querySelectorAll('body *');
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i];
    const oy = window.getComputedStyle(el).overflowY;
    if (oy !== 'auto' && oy !== 'scroll' && oy !== 'overlay') continue;
    const delta = el.scrollHeight - el.clientHeight;
    if (delta < 5) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 80 || rect.height < 80) continue;
    const visibleW = Math.min(Math.max(rect.width, 0), vw);
    const visibleH = Math.min(Math.max(rect.height, 0), vh);
    const areaFactor = (visibleW * visibleH) / (vw * vh);
    if (areaFactor < 0.15) continue;
    const score = delta * (0.5 + areaFactor);
    if (score > bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}

function resolveScrollRoot() {
  const winMax = windowMaxScroll();
  const inner = findLargestScrollableElement();
  const innerMax = inner ? inner.scrollHeight - inner.clientHeight : 0;
  if (winMax > 50 && winMax >= innerMax - 20) {
    return { kind: 'window' };
  }
  if (inner && innerMax > 5) {
    return { kind: 'element', el: inner };
  }
  return { kind: 'window' };
}

function getScrollRoot() {
  if (!scrollRootCache) {
    scrollRootCache = resolveScrollRoot();
  }
  return scrollRootCache;
}

function isFullViewportShell(el) {
  const rect = el.getBoundingClientRect();
  const vw = window.innerWidth || document.documentElement.clientWidth || 1;
  const vh = window.innerHeight || document.documentElement.clientHeight || 1;
  return rect.width >= vw * 0.9 && rect.height >= vh * 0.85;
}

/**
 * Hide cookie bars / sticky TOC / fixed headers, but keep app shells and the
 * scroll container — otherwise docs pages capture as pure white.
 */
function shouldHideFloatingEl(el, scrollEl) {
  if (!el || el === document.body || el === document.documentElement) return false;
  if (scrollEl) {
    if (el === scrollEl) return false;
    if (el.contains(scrollEl)) return false;
  }
  const style = window.getComputedStyle(el);
  const pos = style.position;
  if (pos !== 'fixed' && pos !== 'sticky') return false;
  if (pos === 'fixed' && isFullViewportShell(el)) return false;
  if (pos === 'sticky') {
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth || document.documentElement.clientWidth || 1;
    const vh = window.innerHeight || document.documentElement.clientHeight || 1;
    // Wide sticky reading pane — keep; narrow sticky TOC/sidebar — hide.
    if (rect.height >= vh * 0.5 && rect.width >= vw * 0.4) return false;
  }
  return true;
}

function injectHideStyle() {
  if (document.getElementById('page-capture-hide-style')) return;
  const style = document.createElement('style');
  style.id = 'page-capture-hide-style';
  style.textContent = [
    `.${HIDE_CLASS} { visibility: hidden !important; pointer-events: none !important; }`,
    `html.${CAPTURE_ACTIVE_CLASS}, html.${CAPTURE_ACTIVE_CLASS} * { scroll-behavior: auto !important; }`,
  ].join('\n');
  (document.head || document.documentElement).appendChild(style);
}

function hideFloating() {
  invalidateScrollRoot();
  const root = getScrollRoot();
  const scrollEl = root.kind === 'element' ? root.el : null;
  injectHideStyle();
  document.documentElement.classList.add(CAPTURE_ACTIVE_CLASS);
  const hidden = [];
  const all = document.querySelectorAll('body *');
  all.forEach((el) => {
    if (!shouldHideFloatingEl(el, scrollEl)) return;
    el.classList.add(HIDE_CLASS);
    hidden.push(el);
  });
  window.__pageCaptureHidden = hidden;
  if (restoreFailsafeTimer) clearTimeout(restoreFailsafeTimer);
  restoreFailsafeTimer = setTimeout(() => showFloating(), CAPTURE_FAILSAFE_MS);
  return hidden.length;
}

function showFloating() {
  if (restoreFailsafeTimer) {
    clearTimeout(restoreFailsafeTimer);
    restoreFailsafeTimer = null;
  }
  invalidateScrollRoot();
  (window.__pageCaptureHidden || []).forEach((el) => el.classList.remove(HIDE_CLASS));
  window.__pageCaptureHidden = [];
  document.documentElement.classList.remove(CAPTURE_ACTIVE_CLASS);
}

function applySwissLens(settings) {
  if (!globalThis.SwissLensCore) return false;
  let style = document.getElementById(LENS_STYLE_ID);
  if (!style) {
    style = document.createElement('style');
    style.id = LENS_STYLE_ID;
    (document.head || document.documentElement).appendChild(style);
  }
  const safe = globalThis.SwissLensCore.sanitizeSettings(settings);
  style.textContent = globalThis.SwissLensCore.buildLensCss(safe);
  document.documentElement.toggleAttribute('data-swiss-lens', safe.enabled);
  return true;
}

async function loadSwissLensProfile() {
  if (!globalThis.SwissLensCore) return;
  const siteKey = globalThis.SwissLensCore.siteKeyFromUrl(location.href);
  if (!siteKey) return applySwissLens({ enabled: false });
  const { swissLensProfiles = {} } = await chrome.storage.local.get('swissLensProfiles');
  applySwissLens(globalThis.SwissLensCore.settingsForSite(swissLensProfiles, siteKey));
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'swissLensApply') {
    sendResponse({ ok: applySwissLens(msg.settings) });
    return true;
  }
  if (msg.type === 'getPageHeight') {
    const root = getScrollRoot();
    const height =
      root.kind === 'element' && root.el
        ? root.el.scrollHeight
        : Math.max(
            document.body.scrollHeight,
            document.documentElement.scrollHeight,
            document.body.offsetHeight,
            document.documentElement.offsetHeight
          );
    sendResponse({ height });
    return true;
  }
  if (msg.type === 'getViewportHeight') {
    const root = getScrollRoot();
    const height =
      root.kind === 'element' && root.el ? root.el.clientHeight : window.innerHeight;
    sendResponse({ height });
    return true;
  }
  if (msg.type === 'getScrollPosition') {
    const root = getScrollRoot();
    const y = root.kind === 'element' && root.el ? root.el.scrollTop : window.scrollY;
    sendResponse({ y: Math.max(0, Math.round(y || 0)) });
    return true;
  }
  if (msg.type === 'scrollTo') {
    const y = Math.max(0, Math.round(msg.y || 0));
    const root = getScrollRoot();
    if (root.kind === 'element' && root.el) {
      const el = root.el;
      const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
      el.scrollTop = Math.min(y, maxTop);
    } else {
      window.scrollTo(0, y);
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => sendResponse({ ok: true }));
    });
    return true;
  }
  if (msg.type === 'hideFloating') {
    const n = hideFloating();
    sendResponse({ ok: true, hidden: n });
    return true;
  }
  if (msg.type === 'showFloating') {
    showFloating();
    sendResponse({ ok: true });
    return true;
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.swissLensProfiles) void loadSwissLensProfile();
});

void loadSwissLensProfile();
})();
