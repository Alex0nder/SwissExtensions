/**
 * Применяет сохранённую тему интерфейса (dark | light) к <html> до отрисовки контента.
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
