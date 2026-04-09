/**
 * Content script:  , ,  /    .
 * From    overflow- ( document) —     scrollTop.
 */
const HIDE_CLASS = 'page-capture-hide-fixed';

/**  : window vs   (  capture). */
let scrollRootCache = null;

function invalidateScrollRoot() {
  scrollRootCache = null;
}

/** .    . */
function windowMaxScroll() {
  const h = Math.max(
    document.documentElement.scrollHeight,
    document.body ? document.body.scrollHeight : 0
  );
  return Math.max(0, h - window.innerHeight);
}

/** From «"   (overflow-y: auto|scroll|overlay). */
function findLargestScrollableElement() {
  let best = null;
  let bestDelta = 0;
  const nodes = document.querySelectorAll('body *');
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i];
    const oy = window.getComputedStyle(el).overflowY;
    if (oy !== 'auto' && oy !== 'scroll' && oy !== 'overlay') continue;
    const delta = el.scrollHeight - el.clientHeight;
    if (delta > bestDelta) {
      bestDelta = delta;
      best = el;
    }
  }
  return best;
}

/**     ,     overflow —  . */
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

function injectHideStyle() {
  if (document.getElementById('page-capture-hide-style')) return;
  const style = document.createElement('style');
  style.id = 'page-capture-hide-style';
  style.textContent = `.${HIDE_CLASS} { visibility: hidden !important; pointer-events: none !important; }`;
  (document.head || document.documentElement).appendChild(style);
}

function hideFloating() {
  invalidateScrollRoot();
  injectHideStyle();
  const hidden = [];
  const all = document.querySelectorAll('body *');
  all.forEach((el) => {
    const pos = window.getComputedStyle(el).position;
    if (pos === 'fixed' || pos === 'sticky') {
      el.classList.add(HIDE_CLASS);
      hidden.push(el);
    }
  });
  window.__pageCaptureHidden = hidden;
  return hidden.length;
}

function showFloating() {
  invalidateScrollRoot();
  (window.__pageCaptureHidden || []).forEach((el) => el.classList.remove(HIDE_CLASS));
  window.__pageCaptureHidden = [];
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
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
