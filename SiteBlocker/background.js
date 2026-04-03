/**
 * Site Blocker: пользовательские домены + статические фильтры + опциональная подписка на ABP-список (||host^) в dynamic rules.
 */

const USER_RULE_ID_MIN = 1;
const USER_RULE_ID_MAX = 500;
const SUB_RULE_ID_MIN = 501;
const SUB_RULE_ID_MAX = 5000;
const SCHEDULE_ALARM_NAME = 'siteBlockerScheduleTick';
const FILTER_RULESET_IDS = ['sb_filters_ads'];
const DEFAULT_SCHEDULE = {
  enabled: false,
  from: '09:00',
  to: '18:00',
  days: [1, 2, 3, 4, 5],
};
/** Макс. доменов из подписки (2 DNR-правила на домен → укладываемся в лимит Chrome). */
const SUBSCRIPTION_MAX_DOMAINS = 2200;

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

function domainToUrlFilter(domain) {
  return `*://*.${domain}/*`;
}

function parseHHMM(value) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(value || '').trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isInteger(hh) || !Number.isInteger(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function normalizeSchedule(input) {
  const raw = input && typeof input === 'object' ? input : {};
  const from = typeof raw.from === 'string' ? raw.from : DEFAULT_SCHEDULE.from;
  const to = typeof raw.to === 'string' ? raw.to : DEFAULT_SCHEDULE.to;
  const days = Array.isArray(raw.days)
    ? raw.days.map((d) => Number(d)).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    : DEFAULT_SCHEDULE.days.slice();
  return {
    enabled: raw.enabled === true,
    from: parseHHMM(from) != null ? from : DEFAULT_SCHEDULE.from,
    to: parseHHMM(to) != null ? to : DEFAULT_SCHEDULE.to,
    days: [...new Set(days)],
  };
}

function isInSchedule(schedule, now = new Date()) {
  if (!schedule.enabled) return true;
  if (!schedule.days.includes(now.getDay())) return false;
  const from = parseHHMM(schedule.from);
  const to = parseHHMM(schedule.to);
  if (from == null || to == null) return false;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  if (from === to) return true;
  if (from < to) return nowMin >= from && nowMin < to;
  return nowMin >= from || nowMin < to;
}

/** Из текста EasyList/ABP: только строки ||hostname^ (без $, @@, косметики). */
function parseFilterListDomains(text, maxDomains) {
  const out = [];
  const seen = new Set();
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (out.length >= maxDomains) break;
    const t = line.trim();
    if (!t || t.startsWith('!') || t.startsWith('#')) continue;
    if (t.startsWith('@@')) continue;
    if (t.includes('$')) continue;
    const m = /^\|\|([a-z0-9.-]+)/i.exec(t);
    if (!m) continue;
    const host = m[1].trim().toLowerCase();
    if (!host || host.includes('*')) continue;
    if (seen.has(host)) continue;
    seen.add(host);
    out.push(host);
  }
  return out;
}

const SUB_RES_TYPES = ['script', 'image', 'xmlhttprequest', 'sub_frame', 'ping', 'media', 'other'];

async function applyFilterRulesets() {
  const { adsFiltersEnabled = true } = await chrome.storage.local.get('adsFiltersEnabled');
  const on = adsFiltersEnabled !== false;
  try {
    if (on) {
      await chrome.declarativeNetRequest.updateEnabledRulesets({
        enableRulesetIds: FILTER_RULESET_IDS,
        disableRulesetIds: [],
      });
    } else {
      await chrome.declarativeNetRequest.updateEnabledRulesets({
        enableRulesetIds: [],
        disableRulesetIds: FILTER_RULESET_IDS,
      });
    }
  } catch (e) {
    console.warn('[SiteBlocker] applyFilterRulesets failed', e);
  }
}

/** main_frame: только USER_RULE_ID_MIN..MAX */
async function applyUserBlockingRules() {
  const { blocked = [], whitelist = [], enabled = true, schedule = DEFAULT_SCHEDULE } = await chrome.storage.local.get([
    'blocked',
    'whitelist',
    'enabled',
    'schedule',
  ]);
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const toRemoveUser = existing.filter((r) => r.id >= USER_RULE_ID_MIN && r.id <= USER_RULE_ID_MAX).map((r) => r.id);
  const normalizedSchedule = normalizeSchedule(schedule);
  const scheduleActive = isInSchedule(normalizedSchedule);
  await chrome.storage.local.set({ scheduleStateActive: scheduleActive, schedule: normalizedSchedule });

  if (!enabled || !scheduleActive || blocked.length === 0) {
    if (toRemoveUser.length > 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: toRemoveUser });
    }
    return;
  }

  const domains = blocked.map(normalizeDomain).filter(Boolean);
  const whitelistSet = new Set((whitelist || []).map(normalizeDomain).filter(Boolean));
  const seen = new Set();
  const uniqueDomains = domains.filter((d) => {
    if (seen.has(d) || whitelistSet.has(d)) return false;
    seen.add(d);
    return true;
  });

  const capped = uniqueDomains.slice(0, USER_RULE_ID_MAX - USER_RULE_ID_MIN + 1);
  if (uniqueDomains.length > capped.length) {
    console.warn('[SiteBlocker] список блокировок обрезан до', capped.length, 'доменов (лимит DNR)');
  }

  if (capped.length === 0) {
    if (toRemoveUser.length > 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: toRemoveUser });
    }
    return;
  }

  const rules = capped.map((domain, i) => ({
    id: USER_RULE_ID_MIN + i,
    priority: 1,
    action: { type: 'block' },
    condition: {
      urlFilter: domainToUrlFilter(domain),
      resourceTypes: ['main_frame', 'sub_frame'],
    },
  }));

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: toRemoveUser,
    addRules: rules,
  });
}

/** Подписка: ресурсы как у лёгкого adblock, ID SUB_RULE_ID_MIN..MAX */
async function applySubscriptionDynamicRules() {
  const { filterListEnabled, filterListDomains = [] } = await chrome.storage.local.get([
    'filterListEnabled',
    'filterListDomains',
  ]);
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const toRemoveSub = existing.filter((r) => r.id >= SUB_RULE_ID_MIN && r.id <= SUB_RULE_ID_MAX).map((r) => r.id);

  if (!filterListEnabled || !filterListDomains.length) {
    if (toRemoveSub.length > 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: toRemoveSub });
    }
    return;
  }

  const rules = [];
  let id = SUB_RULE_ID_MIN;
  for (const domain of filterListDomains) {
    if (id > SUB_RULE_ID_MAX - 1) break;
    rules.push({
      id: id++,
      priority: 1,
      action: { type: 'block' },
      condition: { urlFilter: `*://*.${domain}/*`, resourceTypes: SUB_RES_TYPES },
    });
    if (id > SUB_RULE_ID_MAX) break;
    rules.push({
      id: id++,
      priority: 1,
      action: { type: 'block' },
      condition: { urlFilter: `*://${domain}/*`, resourceTypes: SUB_RES_TYPES },
    });
  }

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: toRemoveSub,
    addRules: rules,
  });
}

async function refreshFilterListFromUrl() {
  const { filterListUrl, whitelist = [] } = await chrome.storage.local.get(['filterListUrl', 'whitelist']);
  const url = String(filterListUrl || '').trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    await chrome.storage.local.set({
      filterListLastError: 'Укажите URL списка (https://…)',
      filterListDomains: [],
      filterListLastOk: null,
    });
    await applySubscriptionDynamicRules();
    return { ok: false, error: 'bad_url' };
  }
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const wl = new Set((whitelist || []).map(normalizeDomain).filter(Boolean));
    const raw = parseFilterListDomains(text, SUBSCRIPTION_MAX_DOMAINS + wl.size + 100);
    const domains = raw.filter((d) => !wl.has(d));
    const capped = domains.slice(0, SUBSCRIPTION_MAX_DOMAINS);
    await chrome.storage.local.set({
      filterListDomains: capped,
      filterListLastOk: Date.now(),
      filterListLastError: '',
      filterListDomainCount: capped.length,
    });
    await applySubscriptionDynamicRules();
    return { ok: true, count: capped.length };
  } catch (e) {
    const msg = (e && e.message) || String(e);
    await chrome.storage.local.set({
      filterListLastError: msg,
      filterListDomains: [],
      filterListLastOk: null,
    });
    await applySubscriptionDynamicRules();
    return { ok: false, error: msg };
  }
}

async function applyRules() {
  await applyFilterRulesets();
  await applyUserBlockingRules();
  await applySubscriptionDynamicRules();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (
    changes.adsFiltersEnabled ||
    changes.blocked ||
    changes.whitelist ||
    changes.enabled ||
    changes.schedule ||
    changes.filterListEnabled ||
    changes.filterListDomains
  ) {
    applyRules();
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'refreshFilterList') {
    refreshFilterListFromUrl().then(sendResponse);
    return true;
  }
  if (msg.type === 'getFilterListMeta') {
    chrome.storage.local
      .get(['filterListUrl', 'filterListEnabled', 'filterListLastOk', 'filterListLastError', 'filterListDomainCount'])
      .then(sendResponse);
    return true;
  }
  return false;
});

chrome.alarms.create(SCHEDULE_ALARM_NAME, { periodInMinutes: 1 }).catch(() => {});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SCHEDULE_ALARM_NAME) applyUserBlockingRules();
});

chrome.runtime.onStartup.addListener(applyRules);
chrome.runtime.onInstalled.addListener(async () => {
  await chrome.alarms.create(SCHEDULE_ALARM_NAME, { periodInMinutes: 1 }).catch(() => {});
  await applyRules();
});

applyRules();
