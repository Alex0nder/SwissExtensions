/**
 * Site Blocker: custom domains + static filters + ABP subscription (|| / @@), thirdParty, auto-refresh.
 */

const USER_RULE_ID_MIN = 1;
const USER_RULE_ID_MAX = 500;
const SUB_RULE_ID_MIN = 501;
const SUB_RULE_ID_MAX = 5000;
const SCHEDULE_ALARM_NAME = 'siteBlockerScheduleTick';
const FILTER_LIST_ALARM_NAME = 'siteBlockerFilterListRefresh';
const FILTER_RULESET_IDS = ['sb_filters_ads'];
const DEFAULT_SCHEDULE = {
  enabled: false,
  from: '09:00',
  to: '18:00',
  days: [1, 2, 3, 4, 5],
};
/** 2 rules per domain (block) + 2 per domain (allow). Reserve for Chrome dynamic rules limit (~5000). */
const SUBSCRIPTION_MAX_BLOCKS = 1850;
const SUBSCRIPTION_MAX_ALLOWS = 280;

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

function normalizeFilterHost(raw) {
  const host = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/^\.+/, '');
  if (!host || host.includes('*') || host.startsWith('-') || host.endsWith('-')) return '';
  return host;
}

/**
 * Two passes: first @@|| (allow), then || (block), skipping lines with $ (same as before).
 */
function parseFilterListAbp(text, maxBlocks, maxAllows) {
  const lines = text.split(/\r?\n/);
  const allowSet = new Set();
  const allows = [];
  for (const line of lines) {
    if (allows.length >= maxAllows) break;
    const t = line.trim();
    if (!t || t.startsWith('!') || t.startsWith('#') || t.includes('$')) continue;
    const allowM = /^@@\|\|([a-z0-9._-]+)(?:\^|\/|$)/i.exec(t);
    if (!allowM) continue;
    const host = normalizeFilterHost(allowM[1]);
    if (!host || allowSet.has(host)) continue;
    allowSet.add(host);
    allows.push(host);
  }
  const blockSeen = new Set();
  const blocks = [];
  for (const line of lines) {
    if (blocks.length >= maxBlocks) break;
    const t = line.trim();
    if (!t || t.startsWith('!') || t.startsWith('#') || t.startsWith('@@') || t.includes('$')) continue;
    const m = /^\|\|([a-z0-9._-]+)(?:\^|\/|$)/i.exec(t);
    if (!m) continue;
    const host = normalizeFilterHost(m[1]);
    if (!host || allowSet.has(host) || blockSeen.has(host)) continue;
    blockSeen.add(host);
    blocks.push(host);
  }
  return { blocks, allows };
}

const SUB_RES_TYPES = ['script', 'image', 'xmlhttprequest', 'sub_frame', 'ping', 'media', 'other', 'websocket'];
const BLOCK_PRIORITY = 1;
const ALLOW_PRIORITY = 10;

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
    console.warn('[SiteBlocker] block list truncated to', capped.length, 'domains (DNR limit)');
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

function pushPairBlock(rules, idRef, domain) {
  if (idRef.v > SUB_RULE_ID_MAX - 1) return false;
  rules.push({
    id: idRef.v++,
    priority: BLOCK_PRIORITY,
    action: { type: 'block' },
    condition: {
      urlFilter: `*://*.${domain}/*`,
      resourceTypes: SUB_RES_TYPES,
      domainType: 'thirdParty',
    },
  });
  if (idRef.v > SUB_RULE_ID_MAX) return true;
  rules.push({
    id: idRef.v++,
    priority: BLOCK_PRIORITY,
    action: { type: 'block' },
    condition: {
      urlFilter: `*://${domain}/*`,
      resourceTypes: SUB_RES_TYPES,
      domainType: 'thirdParty',
    },
  });
  return idRef.v > SUB_RULE_ID_MAX;
}

function pushPairAllow(rules, idRef, domain) {
  if (idRef.v > SUB_RULE_ID_MAX - 1) return;
  rules.push({
    id: idRef.v++,
    priority: ALLOW_PRIORITY,
    action: { type: 'allow' },
    condition: {
      urlFilter: `*://*.${domain}/*`,
      resourceTypes: SUB_RES_TYPES,
    },
  });
  if (idRef.v > SUB_RULE_ID_MAX) return;
  rules.push({
    id: idRef.v++,
    priority: ALLOW_PRIORITY,
    action: { type: 'allow' },
    condition: {
      urlFilter: `*://${domain}/*`,
      resourceTypes: SUB_RES_TYPES,
    },
  });
}

/** Subscription: block thirdParty + allow (@@) with higher priority. */
async function applySubscriptionDynamicRules() {
  const { filterListEnabled, filterListDomains = [], filterListAllowDomains = [] } = await chrome.storage.local.get([
    'filterListEnabled',
    'filterListDomains',
    'filterListAllowDomains',
  ]);
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const toRemoveSub = existing.filter((r) => r.id >= SUB_RULE_ID_MIN && r.id <= SUB_RULE_ID_MAX).map((r) => r.id);

  if (!filterListEnabled || (!filterListDomains.length && !filterListAllowDomains.length)) {
    if (toRemoveSub.length > 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: toRemoveSub });
    }
    return;
  }

  const rules = [];
  const idRef = { v: SUB_RULE_ID_MIN };

  for (const domain of filterListDomains) {
    if (pushPairBlock(rules, idRef, domain)) break;
  }
  for (const domain of filterListAllowDomains) {
    pushPairAllow(rules, idRef, domain);
    if (idRef.v > SUB_RULE_ID_MAX) break;
  }

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: toRemoveSub,
    addRules: rules,
  });
}

function validListUrl(s) {
  const u = String(s || '').trim();
  return u.length > 0 && /^https?:\/\//i.test(u);
}

async function refreshFilterListFromUrl() {
  const { filterListUrl, filterListUrl2 = '', whitelist = [] } = await chrome.storage.local.get([
    'filterListUrl',
    'filterListUrl2',
    'whitelist',
  ]);
  const urls = [filterListUrl, filterListUrl2].map((u) => String(u || '').trim()).filter(validListUrl);
  if (urls.length === 0) {
    await chrome.storage.local.set({
      filterListLastError: 'Specify at least one list URL (https://...)',
      filterListDomains: [],
      filterListAllowDomains: [],
      filterListLastOk: null,
      filterListDomainCount: 0,
      filterListAllowCount: 0,
    });
    await applySubscriptionDynamicRules();
    return { ok: false, error: 'bad_url' };
  }
  try {
    const texts = await Promise.all(
      urls.map(async (url) => {
        const res = await fetch(url, { cache: 'no-cache' });
        if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
        return res.text();
      }),
    );
    const combined = texts.join('\n');
    const wl = new Set((whitelist || []).map(normalizeDomain).filter(Boolean));
    const parsed = parseFilterListAbp(combined, SUBSCRIPTION_MAX_BLOCKS + wl.size + 50, SUBSCRIPTION_MAX_ALLOWS);
    const blocks = parsed.blocks.filter((d) => !wl.has(d)).slice(0, SUBSCRIPTION_MAX_BLOCKS);
    const allows = parsed.allows.slice(0, SUBSCRIPTION_MAX_ALLOWS);

    await chrome.storage.local.set({
      filterListDomains: blocks,
      filterListAllowDomains: allows,
      filterListLastOk: Date.now(),
      filterListLastError: '',
      filterListDomainCount: blocks.length,
      filterListAllowCount: allows.length,
    });
    await applySubscriptionDynamicRules();
    await rescheduleFilterListAlarm();
    return { ok: true, count: blocks.length, allows: allows.length };
  } catch (e) {
    const msg = (e && e.message) || String(e);
    await chrome.storage.local.set({
      filterListLastError: msg,
      filterListDomains: [],
      filterListAllowDomains: [],
      filterListLastOk: null,
      filterListDomainCount: 0,
      filterListAllowCount: 0,
    });
    await applySubscriptionDynamicRules();
    return { ok: false, error: msg };
  }
}

async function rescheduleFilterListAlarm() {
  try {
    await chrome.alarms.clear(FILTER_LIST_ALARM_NAME);
  } catch (e) {
    /* ignore */
  }
  const {
    filterListEnabled,
    filterListAutoRefreshEnabled = true,
    filterListAutoRefreshHours = 24,
    filterListUrl,
    filterListUrl2,
  } = await chrome.storage.local.get([
    'filterListEnabled',
    'filterListAutoRefreshEnabled',
    'filterListAutoRefreshHours',
    'filterListUrl',
    'filterListUrl2',
  ]);
  if (!filterListEnabled || filterListAutoRefreshEnabled === false) return;
  const hasUrl = [filterListUrl, filterListUrl2].some((u) => validListUrl(u));
  if (!hasUrl) return;
  const hours = Math.max(6, Math.min(168, Number(filterListAutoRefreshHours) || 24));
  const period = Math.min(hours * 60, 24 * 7 * 60);
  await chrome.alarms.create(FILTER_LIST_ALARM_NAME, { periodInMinutes: period });
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
    changes.filterListDomains ||
    changes.filterListAllowDomains
  ) {
    applyRules();
  }
  if (
    changes.filterListEnabled ||
    changes.filterListUrl ||
    changes.filterListUrl2 ||
    changes.filterListAutoRefreshEnabled ||
    changes.filterListAutoRefreshHours
  ) {
    rescheduleFilterListAlarm();
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'refreshFilterList') {
    refreshFilterListFromUrl().then(sendResponse);
    return true;
  }
  if (msg.type === 'getFilterListMeta') {
    chrome.storage.local
      .get([
        'filterListUrl',
        'filterListUrl2',
        'filterListEnabled',
        'filterListLastOk',
        'filterListLastError',
        'filterListDomainCount',
        'filterListAllowCount',
        'filterListAutoRefreshEnabled',
        'filterListAutoRefreshHours',
      ])
      .then(sendResponse);
    return true;
  }
  return false;
});

chrome.alarms.create(SCHEDULE_ALARM_NAME, { periodInMinutes: 1 }).catch(() => {});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SCHEDULE_ALARM_NAME) applyUserBlockingRules();
  if (alarm.name === FILTER_LIST_ALARM_NAME) {
    chrome.storage.local.get('filterListEnabled', (d) => {
      if (d.filterListEnabled === true) refreshFilterListFromUrl();
    });
  }
});

chrome.runtime.onStartup.addListener(() => {
  applyRules();
  rescheduleFilterListAlarm();
});
chrome.runtime.onInstalled.addListener(async () => {
  await chrome.alarms.create(SCHEDULE_ALARM_NAME, { periodInMinutes: 1 }).catch(() => {});
  await applyRules();
  await rescheduleFilterListAlarm();
});

applyRules();
rescheduleFilterListAlarm();
