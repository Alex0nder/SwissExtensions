/**
 * Site Blocker: пользовательские домены (dynamic rules) + статические фильтры рекламы/трекеров (DNR rulesets, uBlock‑подобно, без EasyList).
 */

const RULE_ID_START = 1;
const SCHEDULE_ALARM_NAME = 'siteBlockerScheduleTick';
const FILTER_RULESET_IDS = ['sb_filters_ads'];
const DEFAULT_SCHEDULE = {
  enabled: false,
  from: '09:00',
  to: '18:00',
  days: [1, 2, 3, 4, 5],
};

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

/** Вкл/выкл статических фильтров (реклама/трекеры) — не зависит от расписания «фокуса». */
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

/** Пользовательский список сайтов (main_frame) + расписание. */
async function applyUserBlockingRules() {
  const { blocked = [], whitelist = [], enabled = true, schedule = DEFAULT_SCHEDULE } = await chrome.storage.local.get([
    'blocked',
    'whitelist',
    'enabled',
    'schedule',
  ]);
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const toRemove = existing.map((r) => r.id);
  const normalizedSchedule = normalizeSchedule(schedule);
  const scheduleActive = isInSchedule(normalizedSchedule);
  await chrome.storage.local.set({ scheduleStateActive: scheduleActive, schedule: normalizedSchedule });

  if (!enabled || !scheduleActive || blocked.length === 0) {
    if (toRemove.length > 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: toRemove });
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

  if (uniqueDomains.length === 0) {
    if (toRemove.length > 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: toRemove });
    }
    return;
  }

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

async function applyRules() {
  await applyFilterRulesets();
  await applyUserBlockingRules();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.adsFiltersEnabled || changes.blocked || changes.whitelist || changes.enabled || changes.schedule) {
    applyRules();
  }
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
