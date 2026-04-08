/**
 * Content script: page height, scroll, hide fixed/sticky elements during capture.
 */
const HIDE_CLASS = 'page-capture-hide-fixed';

function injectHideStyle() {
  if (document.getElementById('page-capture-hide-style')) return;
  const style = document.createElement('style');
  style.id = 'page-capture-hide-style';
  style.textContent = `.${HIDE_CLASS} { visibility: hidden !important; pointer-events: none !important; }`;
  (document.head || document.documentElement).appendChild(style);
}

function hideFloating() {
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
  (window.__pageCaptureHidden || []).forEach((el) => el.classList.remove(HIDE_CLASS));
  window.__pageCaptureHidden = [];
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'getPageHeight') {
    const height = Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight,
      document.body.offsetHeight,
      document.documentElement.offsetHeight
    );
    sendResponse({ height });
    return true;
  }
  if (msg.type === 'getViewportHeight') {
    sendResponse({ height: window.innerHeight });
    return true;
  }
  if (msg.type === 'scrollTo') {
    const y = Math.max(0, Math.round(msg.y || 0));
    window.scrollTo(0, y);
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
