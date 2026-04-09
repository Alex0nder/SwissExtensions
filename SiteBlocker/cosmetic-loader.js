/**
 * Injects cosmetic-lite.css when both "Filters" and "Cosmetic" are enabled.
 */
let cosmeticLinkEl = null;

function mountCosmetic() {
  chrome.storage.local.get(['adsFiltersEnabled', 'adsCosmeticLiteEnabled'], (r) => {
    if (chrome.runtime.lastError) return;
    const on = r.adsFiltersEnabled !== false && r.adsCosmeticLiteEnabled === true;
    const root = document.documentElement;
    if (!root) return;
    if (on) {
      if (cosmeticLinkEl) return;
      cosmeticLinkEl = document.createElement('link');
      cosmeticLinkEl.rel = 'stylesheet';
      cosmeticLinkEl.href = chrome.runtime.getURL('cosmetic-lite.css');
      root.appendChild(cosmeticLinkEl);
    } else if (cosmeticLinkEl) {
      cosmeticLinkEl.remove();
      cosmeticLinkEl = null;
    }
  });
}

mountCosmetic();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.adsFiltersEnabled || changes.adsCosmeticLiteEnabled) mountCosmetic();
});
