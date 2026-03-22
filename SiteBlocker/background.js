/**
 * Site Blocker: применяет правила блокировки из storage к declarativeNetRequest.
 */

const RULE_ID_START = 1;

/** Нормализует домен: убирает протокол, www, путь */
function normalizeDomain(input) {
  let s = (input || '').trim().toLowerCase();
  if (!s) return '';
  try {
    if (!s.startsWith('http')) s = 'https://' + s;
    const host = new URL(s).hostname.replace(/^www\./, '');
    return host || '';
  } catch {
    return s.replace(/^www\./, '').split('/')[0].split('?')[0];
  }
}

/** Создаёт urlFilter для домена (все поддомены + основной) */
function domainToUrlFilter(domain) {
  return `*://*.${domain}/*`;
}

/** Загрузить правила из storage и применить */
async function applyRules() {
  const { blocked = [], enabled = true } = await chrome.storage.local.get(['blocked', 'enabled']);
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const toRemove = existing.map((r) => r.id);

  if (!enabled || blocked.length === 0) {
    if (toRemove.length > 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: toRemove });
    }
    return;
  }

  const domains = blocked.map(normalizeDomain).filter(Boolean);
  const seen = new Set();
  const uniqueDomains = domains.filter((d) => {
    if (seen.has(d)) return false;
    seen.add(d);
    return true;
  });

  const rules = uniqueDomains.map((domain, i) => ({
    id: RULE_ID_START + i,
    priority: 1,
    action: { type: 'block' },
    condition: {
      urlFilter: domainToUrlFilter(domain),
      resourceTypes: ['main_frame', 'sub_frame'],
    },
  }));

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: toRemove,
    addRules: rules,
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.blocked || changes.enabled)) {
    applyRules();
  }
});

chrome.runtime.onStartup.addListener(applyRules);
chrome.runtime.onInstalled.addListener(applyRules);
