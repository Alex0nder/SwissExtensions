/**
 * Discard фоновых вкладок для освобождения памяти. Настройки в chrome.storage (tmcSettings).
 */
const DISCARD_DELAY_MS = 300;

const DEFAULT_SETTINGS = {
  skipPinned: true,
  skipAudible: true,
  skipIncognito: true,
  skipGrouped: true,
  excludedDomains: [],
};

function normalizeDomain(input) {
  let s = String(input || '').trim().toLowerCase();
  if (!s) return '';
  try {
    if (!s.startsWith('http')) s = 'https://' + s;
    return new URL(s).hostname.replace(/^www\./, '') || '';
  } catch {
    return s.replace(/^www\./, '').split('/')[0].split('?')[0];
  }
}

function parseExcludedList(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const d = normalizeDomain(item);
    if (!d || seen.has(d)) continue;
    seen.add(d);
    out.push(d);
  }
  return out;
}

function hostMatchesDomains(host, domains) {
  if (!host || !domains.length) return false;
  const h = host.replace(/^www\./, '').toLowerCase();
  return domains.some((d) => h === d || h.endsWith('.' + d));
}

function isTabInGroup(tab) {
  return tab && tab.groupId != null && tab.groupId !== -1;
}

async function getSettings() {
  const { tmcSettings = {} } = await chrome.storage.local.get('tmcSettings');
  return {
    ...DEFAULT_SETTINGS,
    ...tmcSettings,
    excludedDomains: parseExcludedList(tmcSettings.excludedDomains),
  };
}

async function runDiscard() {
  const opts = await getSettings();
  const tabs = await chrome.tabs.query({});
  const toDiscard = tabs.filter((tab) => {
    if (!tab.id) return false;
    const u = (tab.url || '').toLowerCase();
    if (u.startsWith('chrome://') || u.startsWith('chrome-extension://')) return false;
    if (tab.active) return false;
    if (opts.skipPinned && tab.pinned) return false;
    if (opts.skipAudible && tab.audible) return false;
    if (opts.skipIncognito && tab.incognito) return false;
    if (opts.skipGrouped && isTabInGroup(tab)) return false;
    try {
      const host = new URL(tab.url || 'about:blank').hostname;
      if (hostMatchesDomains(host, opts.excludedDomains)) return false;
    } catch (_) {}
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

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'discardBackgroundTabs') {
    runDiscard().then(sendResponse);
    return true;
  }
});

chrome.commands?.onCommand.addListener((command) => {
  if (command === 'discard-background-tabs') {
    runDiscard().catch((e) => console.warn('[TabMemoryCleaner]', e));
  }
});
