/**
 * Content script: sends user activity (mousemove, keydown) to the service worker
 * so the tab is not treated as inactive.
 * Not injected into chrome:// or chrome-extension:// (excluded in manifest).
 */

const REPORT_THROTTLE_MS = 2000;
let lastReport = 0;

function reportActivity() {
  const now = Date.now();
  if (now - lastReport < REPORT_THROTTLE_MS) return;
  lastReport = now;
  chrome.runtime.sendMessage({ type: 'activity' }).catch(() => {});
}

document.addEventListener('mousemove', reportActivity, { passive: true });
document.addEventListener('keydown', reportActivity, { passive: true });
document.addEventListener('scroll', reportActivity, { passive: true });
