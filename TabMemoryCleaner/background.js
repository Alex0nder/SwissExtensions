/**
 * Discard background tabs to free memory. Skip active, pinned, system pages.
 */
const DISCARD_DELAY_MS = 300;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'discardBackgroundTabs') {
    runDiscard(msg.skipPinned !== false).then(sendResponse);
    return true;
  }
});

async function runDiscard(skipPinned) {
  const tabs = await chrome.tabs.query({});
  const toDiscard = tabs.filter((tab) => {
    if (!tab.id) return false;
    const u = (tab.url || '').toLowerCase();
    if (u.startsWith('chrome://') || u.startsWith('chrome-extension://')) return false;
    if (tab.active) return false;
    if (skipPinned && tab.pinned) return false;
    return true;
  });

  let discarded = 0;
  for (const tab of toDiscard) {
    try {
      await chrome.tabs.discard(tab.id);
      discarded++;
      if (discarded < toDiscard.length) {
        await new Promise((r) => setTimeout(r, DISCARD_DELAY_MS));
      }
    } catch (e) {
      console.warn('[TabMemoryCleaner] discard failed', tab.id, e);
    }
  }
  return { discarded, total: toDiscard.length };
}
