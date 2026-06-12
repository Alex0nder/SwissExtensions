/**
 * Apply stored UI theme (dark | light) on <html> before content paints.
 */
(function applyStoredUiTheme() {
  const apply = (mode) => {
    document.documentElement.dataset.theme = mode === 'light' ? 'light' : 'dark';
  };
  apply('dark');
  try {
    chrome.storage.local.get(['uiTheme'], (r) => {
      if (chrome.runtime.lastError) return;
      apply(r.uiTheme);
    });
  } catch (_) {}
})();
