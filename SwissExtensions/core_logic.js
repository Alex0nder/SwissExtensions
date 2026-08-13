(function initSwissCore(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SwissCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createSwissCore() {
  const DEFAULT_CAPTURE_LIMITS = Object.freeze({
    maxFrames: 48,
    maxHeight: 32767,
    maxPixels: 64 * 1024 * 1024,
  });

  function getCapturePlan({ pageHeight, viewportHeight, viewportWidth }, limits = {}) {
    const pageH = Math.ceil(Number(pageHeight));
    const viewH = Math.floor(Number(viewportHeight));
    const viewW = Math.floor(Number(viewportWidth));
    const applied = { ...DEFAULT_CAPTURE_LIMITS, ...limits };
    if (![pageH, viewH, viewW].every(Number.isFinite) || pageH < 1 || viewH < 1 || viewW < 1) {
      return { ok: false, error: 'Could not determine a valid page size.' };
    }

    const step = Math.max(1, viewH);
    const totalFrames = Math.max(1, Math.ceil(pageH / step));
    const estimatedPixels = totalFrames * viewW * viewH;
    if (pageH > applied.maxHeight) {
      return {
        ok: false,
        error: `Page is too long to capture safely (${pageH}px; limit ${applied.maxHeight}px).`,
      };
    }
    if (totalFrames > applied.maxFrames) {
      return {
        ok: false,
        error: `Page needs too many frames (${totalFrames}; limit ${applied.maxFrames}).`,
      };
    }
    if (estimatedPixels > applied.maxPixels) {
      return {
        ok: false,
        error: 'Page is too large to capture safely. Reduce the window size or capture a shorter page.',
      };
    }
    return { ok: true, pageHeight: pageH, step, totalFrames, estimatedPixels };
  }

  function getRestoreStorageKeys(currentTabId, storedTabId, oldKey) {
    const keys = [`suspended_${currentTabId}`];
    if (Number.isInteger(storedTabId) && storedTabId !== currentTabId) {
      keys.push(`suspended_${storedTabId}`);
    }
    if (typeof oldKey === 'string' && oldKey && !keys.includes(oldKey)) keys.push(oldKey);
    return keys;
  }

  function isSuccessfulRestoreCommit(details) {
    if (!details || details.frameId !== 0 || typeof details.url !== 'string') return false;
    try {
      return ['http:', 'https:', 'file:', 'ftp:'].includes(new URL(details.url).protocol);
    } catch (_) {
      return false;
    }
  }

  function normalizeInactivityMinutes(value, fallback = 5, max = 24 * 60) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 1 && parsed <= max ? parsed : fallback;
  }

  function shouldAllowActiveTabInAlarm(tab, focusedWindowId) {
    // An active tab can remain visible in any Chrome window, even when that
    // window is not focused. Automatic hibernation must never navigate it.
    void tab;
    void focusedWindowId;
    return false;
  }

  function shouldIgnoreTransientUngroup(groupId, transitionUntil, now = Date.now()) {
    return groupId === -1
      && Number.isFinite(transitionUntil)
      && transitionUntil > now;
  }

  return {
    DEFAULT_CAPTURE_LIMITS,
    getCapturePlan,
    getRestoreStorageKeys,
    isSuccessfulRestoreCommit,
    normalizeInactivityMinutes,
    shouldAllowActiveTabInAlarm,
    shouldIgnoreTransientUngroup,
  };
});
