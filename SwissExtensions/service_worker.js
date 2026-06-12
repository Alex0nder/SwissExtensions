/**
 * Swiss Extensions — Service Worker (MV3).
 * Tab Hibernate + Page Capture + Site Blocker.
 */

const ALARM_CHECK_NAME = 'tabHibernateCheck';
const ALARM_CHECK_PERIOD_MINUTES = 1;
const INACTIVITY_MINUTES = 5;
const CHECK_PERIOD_OPTIONS = [1, 2, 5];
/** Keep backup-by-date keys only for the last N days; remove older ones. */
const BACKUP_RETENTION_DAYS = 30;
/** Site Blocker schedule alarm (Chrome may drop alarms after browser update). */
const SITE_BLOCKER_SCHEDULE_ALARM = 'swissSiteBlockerSchedule';
const SITE_BLOCKER_SCHEDULE_PERIOD_MINUTES = 0.5;
/** Periodically persist URLs of tabs on blocked domains (survives disable/uninstall). */
const BLOCKER_PRESERVE_ALARM = 'swissBlockerPreserveTabs';
const BLOCKER_PRESERVE_PERIOD_MINUTES = 2;
const BLOCKER_TAB_URL_KEY = 'blockerTabUrlByTabId';
/** Serialize Site Blocker applyRules; parallel calls after SW wake broke DNR on recent Chrome. */
let siteBlockerApplyChain = Promise.resolve();

// Last activity per tabId (in memory + synced on messages). After SW sleep, memory is empty — restore from storage at start of onAlarmCheck.
let lastActivityByTab = new Map();
let lastPersistTime = 0;
const PERSIST_THROTTLE_MS = 4000;
/** One-time lightweight SW init per lifecycle — do not reset timers on every wake. */
let swReadyPromise = null;
let placeholderMaintenanceScheduled = false;
let siteBlockerNavEnforceChain = Promise.resolve();
let lastBlockerOpenTabEnforceAt = 0;
/** Last http(s) navigation URL per tab before chrome-error (Site Blocker). */
const lastHttpUrlByTabId = new Map();
const BLOCKER_OPEN_TAB_ENFORCE_MS = 5 * 60 * 1000;

async function getStoredState() {
  const raw = await chrome.storage.local.get(['lastActivityByTab', 'settings', 'suspendedToday', 'suspendedTodayDate']);
  if (raw.lastActivityByTab && typeof raw.lastActivityByTab === 'object') {
    const now = Date.now();
    for (const [k, v] of Object.entries(raw.lastActivityByTab)) {
      const id = Number(k);
      if (Number.isNaN(id)) continue;
      const ts = typeof v === 'number' && !Number.isNaN(v) && v > 0 ? v : now;
      const prev = lastActivityByTab.get(id);
      lastActivityByTab.set(id, prev == null ? ts : Math.max(prev, ts));
    }
  }
  return raw;
}

/** Tabs with no activity record get a grace period; seeded only in onAlarmCheck, not on every SW wake. */
function seedActivityForUnknownTabs(tabs) {
  const now = Date.now();
  let needPersist = false;
  for (const tab of tabs) {
    if (!tab.id || lastActivityByTab.has(tab.id)) continue;
    const u = tab.url || '';
    if (u.startsWith('chrome://') || u.startsWith('chrome-extension://')) continue;
    lastActivityByTab.set(tab.id, now);
    needPersist = true;
  }
  return needPersist;
}

async function persistLastActivity(force = false) {
  const now = Date.now();
  if (!force && now - lastPersistTime < PERSIST_THROTTLE_MS) return;
  lastPersistTime = now;
  try {
    const obj = Object.fromEntries(
      [...lastActivityByTab.entries()].map(([k, v]) => [String(k), v])
    );
    await chrome.storage.local.set({ lastActivityByTab: obj });
  } catch (e) {
    console.warn('[TabHibernate] persistLastActivity failed', e);
  }
}

/** Check by full URL of current extension (for our own redirects). */
function isSuspendedPlaceholderUrl(url) {
  const base = chrome.runtime.getURL('suspended.html');
  return url && url.startsWith(base.split('?')[0]);
}

/** Detect placeholder by path and tabId; works after extension update when tabs still have old chrome-extension://OLD_ID/suspended.html. */
function isPlaceholderTabUrl(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.pathname.endsWith('suspended.html') && u.searchParams.has('tabId');
  } catch (e) {
    return false;
  }
}

/** Map capture errors to user-facing messages (aligned with PdfExtensions). */
function formatSwissCaptureError(e) {
  const m = (e && e.message) || String(e);
  const lower = m.toLowerCase();
  if (lower.includes('no active tab')) return 'No active tab.';
  if (lower.includes('cannot access') || lower.includes('chrome://')) {
    return 'This page cannot be captured (system page or restricted by Chrome).';
  }
  if (lower.includes('chrome-extension://')) return 'Extension pages cannot be captured.';
  if (lower.includes('could not establish connection') || lower.includes('receiving end does not exist')) {
    return 'Could not connect to the page. Reload the tab and try again.';
  }
  if (lower.includes('capturevisible') || lower.includes('cannot capture')) {
    return 'Tab screenshot unavailable (page or window is in an invalid state).';
  }
  return m.length > 160 ? `${m.slice(0, 157)}…` : m;
}

/** True if tab belongs to a Chrome Tab Group (groupId !== -1). */
function isTabInGroup(tab) {
  return tab && tab.groupId != null && tab.groupId !== -1;
}

/** Stable saved group key: window + chrome groupId; batch-save adds batchId. */
function createSavedGroupKey(chromeGroupId, { windowId, saveBatchId } = {}) {
  const gid = chromeGroupId ?? -1;
  const wid = windowId ?? 0;
  if (saveBatchId != null) return `gk_${saveBatchId}_w${wid}_g${gid}`;
  return `gk_${Date.now()}_w${wid}_g${gid}`;
}

const CHROME_GROUP_KEY_REGISTRY = 'chromeGroupKeyRegistry';

/** Stable key for a live Chrome group (avoids merging distinct groups that share a title). */
async function resolveGroupKeyForChromeGroup(groupId, groupInfo, windowId, saveBatchId = null) {
  if (saveBatchId != null) {
    return createSavedGroupKey(groupId, { windowId, saveBatchId });
  }
  const regKey = `${windowId ?? 0}:${groupId}`;
  const { [CHROME_GROUP_KEY_REGISTRY]: registry = {} } = await chrome.storage.local.get(CHROME_GROUP_KEY_REGISTRY);
  if (registry[regKey]) return registry[regKey];
  const groupKey = createSavedGroupKey(groupId, { windowId });
  registry[regKey] = groupKey;
  await chrome.storage.local.set({ [CHROME_GROUP_KEY_REGISTRY]: registry });
  return groupKey;
}

/** Normalize legacy group keys to gk_<id>_w<wid>_g<gid>. */
function normalizeGroupKey(raw) {
  if (!raw || typeof raw !== 'string') return '';
  if (/^gk_\d+_w\d+_g-?\d+$/.test(raw)) return raw;
  let m = /^gk_(\d+)_(-?\d+)$/.exec(raw);
  if (m) return `gk_${m[1]}_w0_g${m[2]}`;
  m = /^gk_(-?\d+)$/.exec(raw);
  if (m) return `gk_0_w0_g${m[1]}`;
  return raw;
}

/** Drop registry entries for Chrome tab groups that no longer exist. */
async function pruneChromeGroupKeyRegistry() {
  try {
    const tabs = await chrome.tabs.query({});
    const live = new Set();
    for (const tab of tabs) {
      if (isTabInGroup(tab)) live.add(`${tab.windowId}:${tab.groupId}`);
    }
    const { [CHROME_GROUP_KEY_REGISTRY]: registry = {} } = await chrome.storage.local.get(CHROME_GROUP_KEY_REGISTRY);
    let changed = false;
    for (const k of Object.keys(registry)) {
      if (!live.has(k)) {
        delete registry[k];
        changed = true;
      }
    }
    if (changed) await chrome.storage.local.set({ [CHROME_GROUP_KEY_REGISTRY]: registry });
  } catch (e) {
    console.warn('[TabHibernate] pruneChromeGroupKeyRegistry failed', e);
  }
}

/** Group metadata fields persisted to storage and used on restore. */
function pickSavedGroupFields(entry) {
  if (!entry?.groupKey) return {};
  return {
    groupKey: entry.groupKey,
    groupTitle: entry.groupTitle || '',
    groupColor: entry.groupColor || 'grey',
    groupCollapsed: entry.groupCollapsed === true,
    tabIndexInGroup: typeof entry.tabIndexInGroup === 'number' ? entry.tabIndexInGroup : 0,
  };
}

function copyGroupMetaToEntry(entry, tabMeta) {
  if (!tabMeta) return entry;
  return { ...entry, ...pickSavedGroupFields(tabMeta) };
}

/** Build tabId → group metadata map; saveBatchId ties one save/close operation. */
async function buildGroupMetaMapForTabs(tabs, saveBatchId = null) {
  const meta = new Map();
  const byGroup = new Map();
  for (const tab of tabs) {
    if (!isTabInGroup(tab)) continue;
    if (!byGroup.has(tab.groupId)) byGroup.set(tab.groupId, []);
    byGroup.get(tab.groupId).push(tab);
  }
  for (const [groupId, groupTabs] of byGroup) {
    groupTabs.sort((a, b) => a.index - b.index);
    let groupInfo = { title: '', color: 'grey', collapsed: false };
    try {
      groupInfo = await chrome.tabGroups.get(groupId);
    } catch (_) {}
    const groupKey = await resolveGroupKeyForChromeGroup(
      groupId,
      groupInfo,
      groupTabs[0]?.windowId,
      saveBatchId,
    );
    groupTabs.forEach((tab, idx) => {
      meta.set(tab.id, {
        groupKey,
        groupTitle: groupInfo.title || '',
        groupColor: groupInfo.color || 'grey',
        groupCollapsed: groupInfo.collapsed === true,
        tabIndexInGroup: idx,
      });
    });
  }
  return meta;
}

/** Open one hibernate placeholder tab; returns the created tab. */
async function openPlaceholderTabForItem(item) {
  const { url, title } = item;
  const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
  const payload = {
    url,
    title: title || '',
    favIconUrl: '',
    tabId: tab.id,
    ...pickSavedGroupFields(item),
  };
  if (payload.groupKey) payload.groupKey = normalizeGroupKey(payload.groupKey);
  await chrome.storage.local.set({ [`suspended_${tab.id}`]: payload });
  const suspendedUrl = buildSuspendedPlaceholderUrl(tab.id, { url, title });
  await chrome.tabs.update(tab.id, { url: suspendedUrl });
  return tab;
}

/** Re-group tabs by saved groupKey. forceRegroup=true only for History/open restore; maintenance must not override user edits. */
async function applySavedTabGroups(pairs, { forceRegroup = false } = {}) {
  const byKey = new Map();
  for (const { tabId, item } of pairs) {
    const key = normalizeGroupKey(item?.groupKey);
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, { meta: item, tabIds: [] });
    byKey.get(key).tabIds.push({ tabId, order: item.tabIndexInGroup ?? 0 });
  }
  for (const { meta, tabIds } of byKey.values()) {
    tabIds.sort((a, b) => a.order - b.order);
    const ids = [...new Set(tabIds.map((t) => t.tabId))];
    if (!ids.length) continue;

    const tabInfos = (await Promise.all(ids.map((id) => chrome.tabs.get(id).catch(() => null)))).filter(Boolean);
    if (!tabInfos.length) continue;

    const update = {};
    if (meta.groupTitle) update.title = meta.groupTitle;
    if (meta.groupColor) update.color = meta.groupColor;
    if (meta.groupCollapsed === true) update.collapsed = true;

    const groupedIds = tabInfos
      .map((t) => t.groupId)
      .filter((g) => g != null && g !== -1);
    const uniqueGroupIds = new Set(groupedIds);

    if (tabInfos.length === 1) {
      if (forceRegroup && uniqueGroupIds.size === 1 && Object.keys(update).length) {
        try {
          await chrome.tabGroups.update([...uniqueGroupIds][0], update);
        } catch (_) {}
      }
      continue;
    }

    if (uniqueGroupIds.size === 1 && tabInfos.every((t) => t.groupId === groupedIds[0])) {
      if (forceRegroup && Object.keys(update).length) {
        try {
          await chrome.tabGroups.update(groupedIds[0], update);
        } catch (_) {}
      }
      continue;
    }

    if (!forceRegroup) {
      const inGroup = tabInfos.filter((t) => isTabInGroup(t));
      const ungrouped = tabInfos.filter((t) => !isTabInGroup(t));
      if (inGroup.length && ungrouped.length) {
        const targetGroupId = inGroup[0].groupId;
        if (inGroup.every((t) => t.groupId === targetGroupId)) {
          for (const t of ungrouped) {
            try {
              await chrome.tabs.group({ tabIds: [t.id], groupId: targetGroupId });
            } catch (_) {}
          }
        }
      }
      continue;
    }

    try {
      const groupId = await chrome.tabs.group({ tabIds: tabInfos.map((t) => t.id) });
      if (Object.keys(update).length) await chrome.tabGroups.update(groupId, update);
    } catch (e) {
      console.warn('[TabHibernate] applySavedTabGroups failed', e);
    }
  }
}

/**
 * Tab cannot be suspended: active (unless allowActive), pinned (when suspendPinnedTabs is off), grouped when skipGroupedInHibernate, audible, system, incognito, or placeholder.
 * allowActive: when true, allows suspending the active tab (e.g. "Suspend current" button).
 * Pass `settings` from callers that already called getSettings() to avoid repeated storage reads.
 * Note: Both Discard and Placeholder unload the page; unsaved forms and SPA state may be lost (Chrome API limitation).
 */
async function isTabEligibleForSuspend(tab, { allowActive = false, settings: settingsPreloaded } = {}) {
  if (!tab || !tab.id) return false;
  const settings = settingsPreloaded || await getSettings();
  if (tab.active && !allowActive) return false;
  if (tab.pinned && !settings.suspendPinnedTabs) return false;
  if (settings.skipGroupedInHibernate && isTabInGroup(tab)) return false;
  if (tab.audible) return false;
  if (tab.incognito) return false;
  const u = (tab.url || '').toLowerCase();
  if (u.startsWith('chrome://') || u.startsWith('chrome-extension://')) return false;
  if (isSuspendedPlaceholderUrl(tab.url) || isPlaceholderTabUrl(tab.url)) return false; // already a placeholder
  return true;
}

/** Get settings from storage (defaults not overwritten by undefined from storage). */
async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  const s = settings || {};
  const parsedTimeout = s.timeoutMinutes != null ? Number(s.timeoutMinutes) || INACTIVITY_MINUTES : INACTIVITY_MINUTES;
  const parsedPeriod = CHECK_PERIOD_OPTIONS.includes(Number(s.checkPeriodMinutes))
    ? Number(s.checkPeriodMinutes)
    : ALARM_CHECK_PERIOD_MINUTES;
  const excludedDomains = parseDomainList(s.excludedDomains);
  const smartPlaceholderDomains = parseDomainList(s.smartPlaceholderDomains);
  const smartDiscardDomains = parseDomainList(s.smartDiscardDomains);
  return {
    enabled: s.enabled !== false,
    timeoutMinutes: parsedTimeout,
    checkPeriodMinutes: parsedPeriod,
    excludedDomains,
    smartRulesEnabled: s.smartRulesEnabled === true,
    smartDefaultMode: s.smartDefaultMode === 'placeholder' ? 'placeholder' : 'discard',
    smartUseHeuristicsFallback: s.smartUseHeuristicsFallback !== false,
    smartPlaceholderDomains,
    smartDiscardDomains,
    /** Default placeholder so new installs get suspended.html, not silent chrome.discard (UI also defaults to Placeholder). */
    mode: ['placeholder', 'smart', 'discard'].includes(s.mode) ? s.mode : 'placeholder',
    /** When true (default), pinned tabs participate in hibernate / Suspend all / Close & save. */
    suspendPinnedTabs: s.suspendPinnedTabs !== false,
    /** When true, tabs in Chrome tab groups are never suspended automatically or via bulk actions. */
    skipGroupedInHibernate: s.skipGroupedInHibernate === true,
  };
}

function normalizeDomain(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
}

function parseDomainList(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const value of list) {
    const domain = normalizeDomain(value);
    if (!domain || seen.has(domain)) continue;
    seen.add(domain);
    out.push(domain);
  }
  return out;
}

function getTabHost(tab) {
  try {
    return new URL(String(tab?.url || '')).hostname.toLowerCase();
  } catch (e) {
    return '';
  }
}

/** Grouping context: one storage read instead of N per tab. */
async function buildDomainGroupingContext(tabs) {
  const blockerData = await chrome.storage.local.get(BLOCKER_TAB_URL_KEY);
  const blockerMap = { ...(blockerData[BLOCKER_TAB_URL_KEY] || {}) };
  const suspendKeys = new Set();
  for (const tab of tabs) {
    if (!tab?.id || !tab.url) continue;
    if (!isPlaceholderTabUrl(tab.url) && !isSuspendedPlaceholderUrl(tab.url)) continue;
    suspendKeys.add(`suspended_${tab.id}`);
    try {
      const tid = new URL(tab.url).searchParams.get('tabId');
      if (tid) suspendKeys.add(`suspended_${tid}`);
    } catch (_) {}
  }
  const suspendedData = suspendKeys.size
    ? await chrome.storage.local.get([...suspendKeys])
    : {};
  return { blockerMap, suspendedData };
}

function getPlaceholderRestoreUrlFromContext(tab, ctx) {
  if (!tab?.url) return null;
  if (!isPlaceholderTabUrl(tab.url) && !isSuspendedPlaceholderUrl(tab.url)) return null;
  try {
    if (tab.id) {
      const item = ctx.suspendedData[`suspended_${tab.id}`];
      if (item?.url) return item.url;
    }
    const u = new URL(tab.url);
    const tid = u.searchParams.get('tabId');
    if (tid) {
      const item = ctx.suspendedData[`suspended_${tid}`];
      if (item?.url) return item.url;
    }
    const fallback = u.searchParams.get('u');
    if (fallback && (fallback.startsWith('http') || fallback.startsWith('file'))) return fallback;
  } catch (_) {}
  return null;
}

function resolveBlockerTabPageUrlFromContext(tab, ctx) {
  if (!tab?.id) return '';
  let url = tab.pendingUrl || tab.url || '';
  if (isPlaceholderTabUrl(url) || isSuspendedPlaceholderUrl(url)) {
    url = getPlaceholderRestoreUrlFromContext(tab, ctx) || url;
  }
  if (hasRestorableUrl(url) && !isChromeBlockedPageUrl(url)) return url;
  const entry = ctx.blockerMap[String(tab.id)];
  if (entry?.url && hasRestorableUrl(entry.url)) return entry.url;
  const lastNav = lastHttpUrlByTabId.get(tab.id);
  if (lastNav && hasRestorableUrl(lastNav) && !isChromeBlockedPageUrl(lastNav)) return lastNav;
  return '';
}

function getTabDomainFromContext(tab, ctx, blockedDomains = []) {
  const url = resolveBlockerTabPageUrlFromContext(tab, ctx);
  if (url && hasRestorableUrl(url)) {
    if (url.startsWith('file://')) return 'local files';
    try {
      return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
    } catch (_) {
      return '';
    }
  }
  return guessBlockedTabDomain(tab, blockedDomains);
}

/** Resolve chrome-error tab URL when missing: single blocked domain or title match. */
function guessBlockedTabDomain(tab, blockedDomains) {
  if (!tab?.id || !blockedDomains?.length) return '';
  if (!isChromeBlockedPageUrl(tab.url || '')) return '';
  const normalized = blockedDomains.map(sbNormDomain).filter(Boolean);
  if (!normalized.length) return '';
  const title = (tab.title || '').toLowerCase();
  const titleMatches = normalized.filter((d) => title.includes(d) || title.includes(`www.${d}`));
  if (titleMatches.length === 1) return titleMatches[0];
  if (normalized.length === 1) return normalized[0];
  return '';
}

async function convertChromeErrorTabsForGrouping(tabs, ctx) {
  const targets = tabs.filter(
    (t) => t?.id && isChromeBlockedPageUrl(t.url || '') && resolveBlockerTabPageUrlFromContext(t, ctx),
  );
  if (!targets.length) return;
  await Promise.all(targets.map(async (tab) => {
    const pageUrl = resolveBlockerTabPageUrlFromContext(tab, ctx);
    if (!pageUrl) return;
    await suspendPlaceholder(tab.id, pageUrl, tab.title, tab.favIconUrl, {
      windowId: tab.windowId,
      skipFavicon: true,
      skipBookmark: true,
    });
  }));
}

const TAB_GROUP_COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];

function pickTabGroupColor(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (Math.imul(31, h) + seed.charCodeAt(i)) >>> 0;
  return TAB_GROUP_COLORS[h % TAB_GROUP_COLORS.length];
}

function isTabEligibleForDomainGrouping(tab) {
  if (!tab?.id || isTabInGroup(tab)) return false;
  const lower = (tab.url || '').toLowerCase();
  const isPlaceholder = isPlaceholderTabUrl(tab.url) || isSuspendedPlaceholderUrl(tab.url);
  const isBlockedPage = isChromeBlockedPageUrl(tab.url);
  if (
    !isPlaceholder
    && !isBlockedPage
    && (
      lower.startsWith('chrome://')
      || lower.startsWith('chrome-extension://')
      || lower.startsWith('edge://')
      || lower.startsWith('about:')
      || lower.startsWith('devtools://')
    )
  ) return false;
  return true;
}

/** Legacy SW grouping: one Chrome group per domain per window (UI uses side panel URL grouping). */
async function runGroupTabsByDomain({ allWindows = false, windowId = null } = {}) {
  const queryOpts = allWindows
    ? {}
    : (typeof windowId === 'number' ? { windowId } : { lastFocusedWindow: true });
  let tabs = await chrome.tabs.query(queryOpts);
  const blockedDomains = await getConfiguredBlockerDomains();
  let ctx = await buildDomainGroupingContext(tabs);

  const needBackfill = tabs.filter(
    (t) => t?.id && isChromeBlockedPageUrl(t.url || '') && !resolveBlockerTabPageUrlFromContext(t, ctx),
  );
  if (needBackfill.length) {
    await Promise.all(needBackfill.map(async (tab) => {
      try {
        const fresh = await chrome.tabs.get(tab.id);
        const pending = fresh.pendingUrl || '';
        if (!pending.startsWith('http') || !hasRestorableUrl(pending) || isChromeBlockedPageUrl(pending)) return;
        ctx.blockerMap[String(tab.id)] = { url: pending, title: fresh.title || pending, at: Date.now() };
        lastHttpUrlByTabId.set(tab.id, pending);
        rememberBlockerTabUrl(tab.id, pending, fresh.title).catch(() => {});
      } catch (_) {}
    }));
  }

  await convertChromeErrorTabsForGrouping(tabs, ctx);
  tabs = await chrome.tabs.query(queryOpts);
  ctx = await buildDomainGroupingContext(tabs);

  const byWindowDomain = new Map();
  for (const tab of tabs) {
    if (!isTabEligibleForDomainGrouping(tab)) continue;
    const domain = getTabDomainFromContext(tab, ctx, blockedDomains);
    if (!domain) continue;
    if (!byWindowDomain.has(tab.windowId)) byWindowDomain.set(tab.windowId, new Map());
    const byDomain = byWindowDomain.get(tab.windowId);
    if (!byDomain.has(domain)) byDomain.set(domain, []);
    byDomain.get(domain).push(tab);
  }

  let groupsCreated = 0;
  let tabsGrouped = 0;

  for (const byDomain of byWindowDomain.values()) {
    for (const [domain, domainTabs] of byDomain) {
      if (domainTabs.length < 2) continue;
      domainTabs.sort((a, b) => a.index - b.index);
      const tabIds = domainTabs.map((t) => t.id).filter(Boolean);
      if (tabIds.length < 2) continue;
      try {
        const groupId = await chrome.tabs.group({ tabIds });
        await chrome.tabGroups.update(groupId, {
          title: domain.slice(0, 256),
          color: pickTabGroupColor(domain),
        });
        groupsCreated++;
        tabsGrouped += tabIds.length;
      } catch (e) {
        const unresolved = domainTabs.filter(
          (t) => t?.id && isChromeBlockedPageUrl(t.url || '') && !resolveBlockerTabPageUrlFromContext(t, ctx),
        );
        if (unresolved.length >= 2 && domain) {
          const fallbackUrl = `https://${domain}/`;
          await Promise.all(unresolved.map((tab) => suspendPlaceholder(tab.id, fallbackUrl, tab.title || domain, '', {
            windowId: tab.windowId,
            skipFavicon: true,
            skipBookmark: true,
          })));
          try {
            const groupId = await chrome.tabs.group({ tabIds });
            await chrome.tabGroups.update(groupId, {
              title: domain.slice(0, 256),
              color: pickTabGroupColor(domain),
            });
            groupsCreated++;
            tabsGrouped += tabIds.length;
            continue;
          } catch (retryErr) {
            console.warn('[TabHibernate] groupTabsByDomain retry failed', domain, retryErr);
          }
        }
        console.warn('[TabHibernate] groupTabsByDomain failed', domain, e);
      }
    }
  }

  return {
    groupsCreated,
    tabsGrouped,
    eligible: tabs.filter((t) => t?.id && !isTabInGroup(t)).length,
  };
}

function matchesDomain(host, domains) {
  if (!host || !Array.isArray(domains) || domains.length === 0) return false;
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}

function isTabExcludedByDomain(tab, excludedDomains) {
  const host = getTabHost(tab);
  return matchesDomain(host, excludedDomains);
}

function getSuspendModeForTab(settings, tab) {
  if (settings.mode !== 'smart') return settings.mode;
  const host = getTabHost(tab);
  if (settings.smartRulesEnabled) {
    if (matchesDomain(host, settings.smartPlaceholderDomains)) return 'placeholder';
    if (matchesDomain(host, settings.smartDiscardDomains)) return 'discard';
    if (!settings.smartUseHeuristicsFallback) return settings.smartDefaultMode;
  }
  const url = String(tab?.url || '');
  const title = String(tab?.title || '').toLowerCase();
  const hasQuery = url.includes('?');
  const webAppHint = /(mail|calendar|docs|drive|notion|figma|slack|telegram|discord|jira|github)/.test(url.toLowerCase())
    || /(dashboard|inbox|workspace|crm|project)/.test(title);
  return hasQuery || webAppHint ? 'placeholder' : settings.smartDefaultMode;
}

/** Increment "suspended today" counter; badge is updated from current placeholder count. */
async function incrementSuspendedToday() {
  const today = new Date().toISOString().slice(0, 10);
  const { suspendedToday = 0, suspendedTodayDate } = await chrome.storage.local.get(['suspendedToday', 'suspendedTodayDate']);
  const count = suspendedTodayDate === today ? suspendedToday + 1 : 1;
  await chrome.storage.local.set({ suspendedToday: count, suspendedTodayDate: today });
  await updateBadge();
}

/** Number of tabs currently showing the placeholder (suspended.html). */
async function getCurrentlySuspendedTabCount() {
  const tabs = await chrome.tabs.query({});
  return tabs.filter((tab) => tab.url && isPlaceholderTabUrl(tab.url)).length;
}

/** "Hibernated" count: placeholder tabs + "Closed and saved" history entries. Used for badge and popup. */
async function getHibernatedCount() {
  const [tabs, raw] = await Promise.all([
    chrome.tabs.query({}),
    chrome.storage.local.get('closedAndSaved'),
  ]);
  const placeholderCount = tabs.filter(
    (tab) => tab.url && (isPlaceholderTabUrl(tab.url) || isSuspendedPlaceholderUrl(tab.url)),
  ).length;
  const closedSaved = Array.isArray(raw.closedAndSaved) ? raw.closedAndSaved : [];
  return placeholderCount + closedSaved.length;
}

/** Badge on icon: hibernated count (placeholders + closed and saved). */
async function updateBadge(count) {
  try {
    const n = typeof count === 'number' ? count : await getHibernatedCount();
    await chrome.action.setBadgeText({ text: n > 0 ? String(n) : '' });
    if (n > 0) {
      await chrome.action.setBadgeBackgroundColor({ color: '#0d9488' });
    }
  } catch (e) {
    console.warn('[TabHibernate] updateBadge failed', e);
  }
}

async function getSuspendedTodayCount() {
  const today = new Date().toISOString().slice(0, 10);
  const { suspendedToday = 0, suspendedTodayDate } = await chrome.storage.local.get(['suspendedToday', 'suspendedTodayDate']);
  return suspendedTodayDate === today ? suspendedToday : 0;
}

/** Remove from storage backup_YYYY-MM-DD keys older than BACKUP_RETENTION_DAYS. */
async function pruneOldBackups() {
  try {
    const all = await chrome.storage.local.get(null);
    const now = new Date();
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - BACKUP_RETENTION_DAYS);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    for (const key of Object.keys(all)) {
      if (!key.startsWith('backup_')) continue;
      const dateStr = key.slice(7);
      if (dateStr.length === 10 && dateStr < cutoffStr) {
        await chrome.storage.local.remove(key);
      }
    }
  } catch (e) {
    console.warn('[TabHibernate] pruneOldBackups failed', e);
  }
}

/** Single point to mark tab as active on user action. */
function markTabActive(tabId) {
  const now = Date.now();
  lastActivityByTab.set(tabId, now);
  persistLastActivity(); // fire-and-forget
}

/** Check if timeout minutes have passed since last activity. Tabs with no record (new or not yet in storage) are not treated as inactive to avoid suspending them too soon on alarm. */
function isTabInactive(tabId, timeoutMinutes) {
  const last = lastActivityByTab.get(tabId);
  if (last == null) return false; // unknown tab — do not suspend
  return (Date.now() - last) >= timeoutMinutes * 60 * 1000;
}

/** Discard mode: unload tab via Chrome API. */
async function suspendDiscard(tabId) {
  try {
    await chrome.tabs.get(tabId);
  } catch (e) {
    return false;
  }
  try {
    await chrome.tabs.discard(tabId);
    await incrementSuspendedToday();
    return true;
  } catch (e) {
    console.warn('[TabHibernate] discard failed', tabId, e);
    return false;
  }
}

/** URL that can be saved and restored (non-empty, not about:blank). */
function hasRestorableUrl(url) {
  const u = (url || '').trim();
  return u.length > 0 && u !== 'about:blank' && !u.startsWith('about:');
}

/** Placeholder mode: save url+title, redirect to suspended.html with ?u= fallback if storage is lost. */
const PLACEHOLDER_URL_PARAM_MAX = 1900;

async function toDataUrlFromImageUrl(url) {
  if (!url || (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('data:'))) return '';
  if (url.startsWith('data:')) return url;
  try {
    const res = await fetch(url, { credentials: 'omit', mode: 'cors' });
    if (!res.ok) return '';
    const blob = await res.blob();
    if (!blob || !blob.type || !blob.type.startsWith('image/')) return '';
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    return typeof dataUrl === 'string' ? dataUrl : '';
  } catch (e) {
    return '';
  }
}

async function suspendPlaceholder(tabId, url, title, favIconUrl, meta = {}) {
  try {
    await chrome.tabs.get(tabId);
  } catch (e) {
    return false;
  }
  const safeUrl = url || '';
  const skipFavicon = meta.skipFavicon === true;
  const skipBookmark = meta.skipBookmark === true;
  const favIconDataUrl = skipFavicon ? '' : await toDataUrlFromImageUrl(favIconUrl || '');
  const restoreKey = `suspended_${tabId}`;
  const payload = {
    url: safeUrl,
    title: title || '',
    favIconUrl: favIconDataUrl || favIconUrl || '',
    tabId,
  };
  if (meta.groupId != null && meta.groupId !== -1) payload.groupId = meta.groupId;
  if (meta.windowId != null) payload.windowId = meta.windowId;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (isTabInGroup(tab)) {
      const gm = await buildGroupMetaMapForTabs([tab]);
      Object.assign(payload, pickSavedGroupFields(gm.get(tabId) || {}));
      if (payload.groupKey) payload.groupKey = normalizeGroupKey(payload.groupKey);
    }
  } catch (_) {}
  await chrome.storage.local.set({ [restoreKey]: payload });
  if (!skipBookmark) {
    try {
      const folderId = await getOrCreateSuspendedRecoveryFolder();
      await chrome.bookmarks.create({
        parentId: folderId,
        title: (title || safeUrl).slice(0, 255),
        url: safeUrl,
      });
    } catch (e) {
      console.warn('[TabHibernate] suspended bookmark backup failed', e);
    }
  }
  const params = new URLSearchParams({ tabId: String(tabId) });
  if (safeUrl && encodeURIComponent(safeUrl).length <= PLACEHOLDER_URL_PARAM_MAX) {
    params.set('u', safeUrl);
  }
  const suspendedUrl = chrome.runtime.getURL('suspended.html') + '?' + params.toString();
  try {
    await chrome.tabs.update(tabId, { url: suspendedUrl });
    if (meta.groupId != null && meta.groupId !== -1) {
      try {
        await chrome.tabs.group({ tabIds: [tabId], groupId: meta.groupId });
      } catch (e) {
        console.warn('[TabHibernate] re-group after suspend failed', tabId, e);
      }
    }
    await incrementSuspendedToday();
    return true;
  } catch (e) {
    console.warn('[TabHibernate] placeholder redirect failed', tabId, e);
    await chrome.storage.local.remove(restoreKey);
    return false;
  }
}

/** Get all tabs eligible for backup (same rules as suspend, minus inactivity check). Includes grouped tabs. */
async function getEligibleTabsForBackup() {
  const tabs = await chrome.tabs.query({});
  const eligible = [];
  for (const tab of tabs) {
    if (!tab.url || !tab.id) continue;
    const u = (tab.url || '').toLowerCase();
    if (u.startsWith('chrome://') || u.startsWith('chrome-extension://')) continue;
    if (tab.incognito) continue;
    eligible.push({ id: tab.id, url: tab.url, title: tab.title || tab.url });
  }
  return eligible;
}

/** Create or get "Tab Hibernate / Suspended Recovery" — backup for suspended tabs (survives extension reinstall). */
async function getOrCreateSuspendedRecoveryFolder() {
  const tree = await chrome.bookmarks.getTree();
  const root = tree[0];
  const findFolder = (nodes, title) => {
    if (!nodes) return null;
    for (const n of nodes) {
      if (n.title === title) return n;
      const inChild = findFolder(n.children || [], title);
      if (inChild) return inChild;
    }
    return null;
  };
  let parent = findFolder(root.children, 'Tab Hibernate');
  if (!parent) {
    const created = await chrome.bookmarks.create({ parentId: root.id, title: 'Tab Hibernate' });
    parent = { id: created.id };
  }
  let folder = findFolder([parent], 'Suspended Recovery');
  if (folder?.id) return folder.id;
  const created = await chrome.bookmarks.create({ parentId: parent.id, title: 'Suspended Recovery' });
  return created.id;
}

/** Remove bookmark by URL from Suspended Recovery folder. */
async function removeSuspendedBookmark(url) {
  if (!url) return;
  try {
    const found = await chrome.bookmarks.search({ url });
    const folderId = await getOrCreateSuspendedRecoveryFolder();
    for (const bm of found) {
      if (bm.parentId === folderId) await chrome.bookmarks.remove(bm.id);
    }
  } catch (e) {
    console.warn('[TabHibernate] removeSuspendedBookmark failed', e);
  }
}

/** Create or get bookmarks folder "Tab Backup / YYYY-MM-DD" (parent "Tab Backup", child is date). */
async function getOrCreateBackupFolder() {
  const dateStr = new Date().toISOString().slice(0, 10);
  const tree = await chrome.bookmarks.getTree();
  const root = tree[0];

  const findFolder = (nodes, title) => {
    if (!nodes) return null;
    for (const n of nodes) {
      if (n.title === title) return n;
      const inChild = findFolder(n.children, title);
      if (inChild) return inChild;
    }
    return null;
  };

  let tabBackupRoot = findFolder(root.children, 'Tab Backup');
  if (!tabBackupRoot) {
    const created = await chrome.bookmarks.create({ parentId: root.id, title: 'Tab Backup' });
    tabBackupRoot = { id: created.id, children: [] };
  }
  const dateFolder = findFolder([tabBackupRoot], dateStr) || (tabBackupRoot.children && tabBackupRoot.children.find((c) => c.title === dateStr));
  if (dateFolder && dateFolder.id) return dateFolder.id;
  const created = await chrome.bookmarks.create({ parentId: tabBackupRoot.id, title: dateStr });
  return created.id;
}

/** Backup: bookmarks + JSON in storage; skip duplicate URLs in one batch. */
async function runBackup(source = 'manual') {
  const tabs = await getEligibleTabsForBackup();
  const seen = new Set();
  const unique = tabs.filter((t) => {
    const key = normalizeUrlKey(t.url);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (unique.length === 0) return { count: 0, folderId: null, folderPath: null };

  const dateStr = new Date().toISOString().slice(0, 10);
  const folderId = await getOrCreateBackupFolder();
  const folderPath = `Tab Backup / ${dateStr}`;
  const batchId = Date.now();
  const groupMeta = await buildGroupMetaMapForTabs(unique, batchId);

  for (const t of unique) {
    try {
      await chrome.bookmarks.create({ parentId: folderId, title: (t.title || t.url).slice(0, 255), url: t.url });
    } catch (e) {
      console.warn('[TabHibernate] bookmark create failed', t.url, e);
    }
  }

  const backupKey = `backup_${dateStr}`;
  const existing = await chrome.storage.local.get(backupKey);
  const list = existing[backupKey] || [];
  const existingUrls = new Set(list.map((x) => normalizeUrlKey(x.url)));
  for (const t of unique) {
    const key = normalizeUrlKey(t.url);
    if (!key || existingUrls.has(key)) continue;
    let entry = { url: t.url, title: t.title || t.url, ts: Date.now() };
    entry = copyGroupMetaToEntry(entry, groupMeta.get(t.id));
    list.push(entry);
    existingUrls.add(key);
  }
  await chrome.storage.local.set({ [backupKey]: list });
  return { count: unique.length, folderId, folderPath };
}

/** Remove closed tab ids from lastActivityByTab to avoid bloating storage. */
async function pruneStaleTabIds() {
  try {
    const tabs = await chrome.tabs.query({});
    const ids = new Set(tabs.map((t) => t.id));
    let changed = false;
    for (const id of lastActivityByTab.keys()) {
      if (!ids.has(id)) {
        lastActivityByTab.delete(id);
        changed = true;
      }
    }
    if (changed) await chrome.storage.local.set({ lastActivityByTab: Object.fromEntries(lastActivityByTab) });
  } catch (e) {
    console.warn('[TabHibernate] pruneStaleTabIds failed', e);
  }
}

const ORPHANED_SUSPENDED_ARCHIVE_MAX = 10000;
const EMERGENCY_SESSION_BACKUPS_MAX = 3;

/** tabIds from placeholder URLs — do not archive even if id no longer matches a live tab. */
function collectPlaceholderReferencedTabIds(tabs) {
  const referenced = new Set();
  for (const tab of tabs) {
    if (!tab?.url) continue;
    if (!isPlaceholderTabUrl(tab.url) && !isSuspendedPlaceholderUrl(tab.url)) continue;
    if (tab.id) referenced.add(tab.id);
    try {
      const u = new URL(tab.url);
      const tid = u.searchParams.get('tabId');
      if (tid) {
        const parsed = Number(tid);
        if (Number.isInteger(parsed)) referenced.add(parsed);
      }
    } catch (_) {}
  }
  return referenced;
}

/** Before deleting orphaned suspended_* keys — archive URL (recover stays populated after extension reload). */
async function archiveOrphanedSuspendedStorage() {
  try {
    const [all, tabs] = await Promise.all([
      chrome.storage.local.get(null),
      chrome.tabs.query({}),
    ]);
    const aliveIds = new Set(tabs.map((t) => t.id));
    const referencedIds = collectPlaceholderReferencedTabIds(tabs);
    const archive = [];
    const keysToRemove = [];
    for (const [key, val] of Object.entries(all)) {
      if (!key.startsWith('suspended_') || key === 'suspendedToday' || key === 'suspendedTodayDate') continue;
      const id = Number(key.slice('suspended_'.length));
      const item = val && typeof val === 'object' ? val : null;
      if (item?.tabId != null && aliveIds.has(item.tabId)) {
        const liveKey = `suspended_${item.tabId}`;
        if (key !== liveKey) {
          if (item.url) {
            try {
              await chrome.storage.local.set({ [liveKey]: { ...item, tabId: item.tabId } });
            } catch (e) {
              console.warn('[TabHibernate] migrate suspended key failed', key, e);
            }
          }
          keysToRemove.push(key);
        }
        continue;
      }
      if (!Number.isInteger(id) || aliveIds.has(id) || referencedIds.has(id)) continue;
      const url = item?.url;
      if (url && (url.startsWith('http') || url.startsWith('file'))) {
        archive.push({
          url,
          title: item.title || '',
          favIconUrl: item.favIconUrl || '',
          archivedAt: Date.now(),
          fromKey: key,
        });
      }
      keysToRemove.push(key);
    }
    if (archive.length) {
      const { orphanedSuspendedArchive = [] } = await chrome.storage.local.get('orphanedSuspendedArchive');
      const seen = new Set(orphanedSuspendedArchive.map((x) => x.url));
      const merged = orphanedSuspendedArchive.slice();
      for (const entry of archive) {
        if (seen.has(entry.url)) continue;
        seen.add(entry.url);
        merged.push(entry);
      }
      await chrome.storage.local.set({
        orphanedSuspendedArchive: merged.slice(-ORPHANED_SUSPENDED_ARCHIVE_MAX),
      });
      try {
        const folderId = await getOrCreateEmergencyRecoveryFolder();
        for (const entry of archive) {
          await chrome.bookmarks.create({
            parentId: folderId,
            title: (entry.title || entry.url).slice(0, 255),
            url: entry.url,
          });
        }
      } catch (e) {
        console.warn('[TabHibernate] emergency bookmark archive failed', e);
      }
    }
    if (keysToRemove.length) await chrome.storage.local.remove(keysToRemove);
  } catch (e) {
    console.warn('[TabHibernate] archiveOrphanedSuspendedStorage failed', e);
  }
}

/** Rebind placeholders before archive (otherwise post-restart alarm deletes live suspended_*). */
async function pruneStaleSuspendedEntries() {
  await rebindPlaceholderStorageKeys();
  await archiveOrphanedSuspendedStorage();
}

async function getOrCreateEmergencyRecoveryFolder() {
  const tree = await chrome.bookmarks.getTree();
  const root = tree[0];
  const findFolder = (nodes, title) => {
    if (!nodes) return null;
    for (const n of nodes) {
      if (n.title === title) return n;
      const inChild = findFolder(n.children || [], title);
      if (inChild) return inChild;
    }
    return null;
  };
  let parent = findFolder(root.children, 'Tab Hibernate');
  if (!parent) {
    const created = await chrome.bookmarks.create({ parentId: root.id, title: 'Tab Hibernate' });
    parent = { id: created.id };
  }
  let folder = findFolder([parent], 'Emergency Recovery');
  if (folder?.id) return folder.id;
  const created = await chrome.bookmarks.create({ parentId: parent.id, title: 'Emergency Recovery' });
  return created.id;
}

/** Snapshot all restorable tabs before extension update. */
async function runEmergencySessionBackup(reason = 'manual') {
  try {
    const tabs = await chrome.tabs.query({});
    const seen = new Set();
    const items = [];
    const batchId = Date.now();
    const groupMeta = await buildGroupMetaMapForTabs(tabs, batchId);
    for (const tab of tabs) {
      if (!tab?.id) continue;
      let url = tab.pendingUrl || tab.url || '';
      if (isPlaceholderTabUrl(url) || isSuspendedPlaceholderUrl(url)) {
        url = (await getPlaceholderRestoreUrl(tab)) || '';
        if (!url) {
          try {
            const u = new URL(tab.url || '');
            url = u.searchParams.get('u') || '';
          } catch (_) {}
        }
      }
      if (!hasRestorableUrl(url) || seen.has(url)) continue;
      seen.add(url);
      let entry = {
        url,
        title: tab.title || url,
        windowId: tab.windowId,
      };
      entry = copyGroupMetaToEntry(entry, groupMeta.get(tab.id));
      items.push(entry);
    }
    if (!items.length) return { count: 0 };

    const snapshot = { savedAt: Date.now(), reason, items };
    const { emergencySessionBackups = [] } = await chrome.storage.local.get('emergencySessionBackups');
    const nextBackups = [...emergencySessionBackups, snapshot].slice(-EMERGENCY_SESSION_BACKUPS_MAX);
    await chrome.storage.local.set({ emergencySessionBackups: nextBackups, lastEmergencyBackupAt: snapshot.savedAt });

    try {
      const folderId = await getOrCreateEmergencyRecoveryFolder();
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const batchFolder = await chrome.bookmarks.create({
        parentId: folderId,
        title: `${stamp} (${reason})`,
      });
      for (const item of items) {
        await chrome.bookmarks.create({
          parentId: batchFolder.id,
          title: (item.title || item.url).slice(0, 255),
          url: item.url,
        });
      }
    } catch (e) {
      console.warn('[TabHibernate] emergency session bookmarks failed', e);
    }

    const dateStr = new Date().toISOString().slice(0, 10);
    await runBackup('emergency');
    return { count: items.length, dateStr };
  } catch (e) {
    console.warn('[TabHibernate] runEmergencySessionBackup failed', e);
    return { count: 0, error: String(e?.message || e) };
  }
}

/** All URLs for Recover: storage, archives, bookmarks (not only suspended_*). */
async function collectRecoverableTabItems() {
  const seen = new Set();
  const items = [];
  const add = (urlOrEntry, title = '') => {
    const entry = typeof urlOrEntry === 'object' && urlOrEntry?.url ? urlOrEntry : { url: urlOrEntry, title };
    const url = entry.url;
    if (!url || !(url.startsWith('http') || url.startsWith('file')) || seen.has(url)) return;
    seen.add(url);
    items.push({ url, title: entry.title || '', ...pickSavedGroupFields(entry) });
  };

  const all = await chrome.storage.local.get(null);
  for (const [key, val] of Object.entries(all)) {
    if (key.startsWith('suspended_') && key !== 'suspendedToday' && key !== 'suspendedTodayDate') {
      const item = val && typeof val === 'object' ? val : null;
      if (item?.url) add(item.url, item.title);
      continue;
    }
    if (key === 'orphanedSuspendedArchive' && Array.isArray(val)) {
      for (const entry of val) add(entry.url, entry.title);
      continue;
    }
    if (key === 'closedAndSaved' && Array.isArray(val)) {
      for (const entry of val) add(entry);
      continue;
    }
    if (key === 'blockedTabsSaved' && Array.isArray(val)) {
      for (const entry of val) add(entry.url, entry.title);
      continue;
    }
    if (key.startsWith('backup_') && Array.isArray(val)) {
      for (const entry of val) add(entry);
      continue;
    }
    if (key === 'emergencySessionBackups' && Array.isArray(val)) {
      for (const snap of val) {
        for (const entry of snap.items || []) add(entry);
      }
    }
  }

  const bookmarkRoots = new Set(['Tab Hibernate', 'Tab Backup', 'Suspended Recovery', 'Emergency Recovery', 'Site Blocker']);
  try {
    const tree = await chrome.bookmarks.getTree();
    const walk = (nodes, insideBackupTree) => {
      if (!nodes) return;
      for (const n of nodes) {
        if (n.url) add(n.url, n.title);
        const enter = insideBackupTree
          || bookmarkRoots.has(n.title)
          || (n.title && /^\d{4}-\d{2}-\d{2}/.test(n.title))
          || (n.title && /^\d{4}-\d{2}-\d{2}T/.test(n.title));
        if (enter) walk(n.children, true);
      }
    };
    walk(tree[0]?.children, false);
  } catch (e) {
    console.warn('[TabHibernate] collectRecoverable bookmark walk failed', e);
  }

  return items;
}

/** Delay between tabs in batch suspend to avoid freezing the browser. */
const SUSPEND_BATCH_DELAY_MS = 80;

/** Manually suspend all eligible tabs (no inactivity timeout check). Batched with delay to avoid browser freeze. */
async function runSuspendAllNow() {
  await getStoredState();
  const settings = await getSettings();
  const tabs = await chrome.tabs.query({});
  const toBackup = [];
  let suspended = 0;
  for (const tab of tabs) {
    if (!(await isTabEligibleForSuspend(tab, { settings }))) continue;
    if (isTabExcludedByDomain(tab, settings.excludedDomains)) continue;
    const mode = getSuspendModeForTab(settings, tab);
    if (mode === 'placeholder' && !hasRestorableUrl(tab.url)) continue;
    if (mode === 'discard') {
      const ok = await suspendDiscard(tab.id);
      if (ok) {
        toBackup.push({ url: tab.url, title: tab.title });
        suspended++;
      }
    } else {
      const ok = await suspendPlaceholder(tab.id, tab.url, tab.title, tab.favIconUrl, {
        groupId: tab.groupId,
        windowId: tab.windowId,
      });
      if (ok) {
        toBackup.push({ url: tab.url, title: tab.title });
        suspended++;
      }
    }
    if (suspended > 0 && suspended % 20 === 0) {
      await new Promise((r) => setTimeout(r, SUSPEND_BATCH_DELAY_MS));
    }
  }
  if (toBackup.length > 0) {
    const seen = new Set();
    const unique = toBackup.filter((t) => {
      const key = normalizeUrlKey(t.url);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const folderId = await getOrCreateBackupFolder();
    for (const t of unique) {
      try {
        await chrome.bookmarks.create({
          parentId: folderId,
          title: (t.title || t.url).slice(0, 255),
          url: t.url,
        });
      } catch (e) {
        console.warn('[TabHibernate] backup bookmark failed', e);
      }
    }
    const backupKey = `backup_${new Date().toISOString().slice(0, 10)}`;
    const existing = await chrome.storage.local.get(backupKey);
    const list = existing[backupKey] || [];
    const existingUrls = new Set(list.map((x) => x.url));
    for (const t of unique) {
      if (!existingUrls.has(t.url)) {
        list.push({ url: t.url, title: t.title || t.url, ts: Date.now() });
        existingUrls.add(t.url);
      }
    }
    await chrome.storage.local.set({ [backupKey]: list });
  }
  return { suspended };
}

/** Placeholder restore URL: storage by tab.id, tabId in URL, or ?u= */
async function getPlaceholderRestoreUrl(tab) {
  if (!tab?.url) return null;
  if (!isPlaceholderTabUrl(tab.url) && !isSuspendedPlaceholderUrl(tab.url)) return null;
  try {
    if (tab.id) {
      const byId = await chrome.storage.local.get(`suspended_${tab.id}`);
      if (byId[`suspended_${tab.id}`]?.url) return byId[`suspended_${tab.id}`].url;
    }
    const u = new URL(tab.url);
    const tid = u.searchParams.get('tabId');
    if (tid) {
      const data = await chrome.storage.local.get(`suspended_${tid}`);
      const item = data[`suspended_${tid}`];
      if (item?.url) return item.url;
    }
    const fallback = u.searchParams.get('u');
    if (fallback && (fallback.startsWith('http') || fallback.startsWith('file'))) return fallback;
  } catch (_) {}
  return null;
}

function buildSuspendedPlaceholderUrl(tabId, item) {
  const params = new URLSearchParams({ tabId: String(tabId) });
  if (item?.url && encodeURIComponent(item.url).length <= PLACEHOLDER_URL_PARAM_MAX) {
    params.set('u', item.url);
  }
  return chrome.runtime.getURL('suspended.html') + '?' + params.toString();
}

async function applyPlaceholderGroupMeta(tab, item) {
  if (!tab?.id || !item) return;
  if (isTabInGroup(tab)) return;
  const groupId = item.groupId;
  if (groupId == null || groupId === -1) return;
  try {
    await chrome.tabGroups.get(groupId);
    await chrome.tabs.group({ tabIds: [tab.id], groupId });
  } catch (_) {
    /* stale groupId after user ungrouped or Chrome recycled the group */
  }
}

/** Write live Chrome group fields into suspended_* so maintenance does not restore stale titles. */
async function syncSuspendedStorageGroupMetaForTab(tab) {
  if (!tab?.id) return;
  if (!isPlaceholderTabUrl(tab.url) && !isSuspendedPlaceholderUrl(tab.url)) return;
  const storageKey = `suspended_${tab.id}`;
  const data = await chrome.storage.local.get(storageKey);
  const item = data[storageKey];
  if (!item?.url) return;

  if (isTabInGroup(tab)) {
    const gm = await buildGroupMetaMapForTabs([tab]);
    const meta = gm.get(tab.id);
    if (meta) {
      await chrome.storage.local.set({
        [storageKey]: { ...item, ...pickSavedGroupFields(meta), groupId: tab.groupId },
      });
    }
    return;
  }

  const cleared = { ...item };
  delete cleared.groupKey;
  delete cleared.groupTitle;
  delete cleared.groupColor;
  delete cleared.groupCollapsed;
  delete cleared.tabIndexInGroup;
  delete cleared.groupId;
  await chrome.storage.local.set({ [storageKey]: cleared });
}

async function syncSuspendedStorageGroupMetaForTabIds(tabIds) {
  for (const tabId of tabIds || []) {
    try {
      const tab = await chrome.tabs.get(tabId);
      await syncSuspendedStorageGroupMetaForTab(tab);
    } catch (_) {}
  }
}

/** Find suspended_* after Chrome session restore changes tab.id. */
async function findSuspendedStorageForPlaceholderTab(tab, urlTabId) {
  if (!tab?.id) return null;
  const directKeys = [`suspended_${tab.id}`];
  if (urlTabId != null && !Number.isNaN(urlTabId) && urlTabId !== tab.id) {
    directKeys.push(`suspended_${urlTabId}`);
  }
  const direct = await chrome.storage.local.get(directKeys);
  for (const key of directKeys) {
    if (direct[key]?.url) {
      return { item: direct[key], oldKey: key !== `suspended_${tab.id}` ? key : null };
    }
  }

  let fallbackUrl = '';
  try {
    fallbackUrl = new URL(tab.url || '').searchParams.get('u') || '';
  } catch (_) {}
  if (fallbackUrl && hasRestorableUrl(fallbackUrl)) {
    return {
      item: { url: fallbackUrl, title: tab.title || '', favIconUrl: '', tabId: tab.id },
      oldKey: urlTabId != null && !Number.isNaN(urlTabId) ? `suspended_${urlTabId}` : null,
    };
  }

  const all = await chrome.storage.local.get(null);
  for (const [key, val] of Object.entries(all)) {
    if (!key.startsWith('suspended_') || key === 'suspendedToday' || key === 'suspendedTodayDate') continue;
    if (!val || typeof val !== 'object' || !val.url) continue;
    if (val.tabId === tab.id || (urlTabId != null && val.tabId === urlTabId)) {
      return { item: val, oldKey: key !== `suspended_${tab.id}` ? key : null };
    }
  }
  return null;
}

/** Rebind one placeholder to current tab.id and restore its Chrome group. */
async function rebindSinglePlaceholderTab(tab) {
  if (!tab?.id || !tab.url) return false;
  if (!isPlaceholderTabUrl(tab.url) && !isSuspendedPlaceholderUrl(tab.url)) return false;

  let urlTabId = null;
  try {
    const raw = new URL(tab.url).searchParams.get('tabId');
    urlTabId = raw ? parseInt(raw, 10) : null;
  } catch (_) {
    return false;
  }

  const found = await findSuspendedStorageForPlaceholderTab(tab, urlTabId);
  if (!found?.item?.url) return false;

  const item = { ...found.item, tabId: tab.id };
  if (item.groupKey) item.groupKey = normalizeGroupKey(item.groupKey);
  const currentKey = `suspended_${tab.id}`;
  const newUrl = buildSuspendedPlaceholderUrl(tab.id, item);
  const existing = await chrome.storage.local.get(currentKey);
  const needsStorage = found.oldKey != null || !existing[currentKey]?.url;
  const needsUrlUpdate = tab.url !== newUrl;

  if (needsStorage) {
    await chrome.storage.local.set({ [currentKey]: item });
  }
  if (found.oldKey && found.oldKey !== currentKey) {
    await chrome.storage.local.remove(found.oldKey);
  }

  if (needsUrlUpdate) {
    await chrome.tabs.update(tab.id, { url: newUrl });
  } else if (needsStorage) {
    chrome.tabs.sendMessage(tab.id, { type: 'placeholderRefresh' }).catch(() => {});
  }

  if (needsStorage || needsUrlUpdate) {
    try {
      const updated = await chrome.tabs.get(tab.id);
      await applyPlaceholderGroupMeta(updated, item);
    } catch (_) {
      await applyPlaceholderGroupMeta(tab, item);
    }
  }
  return true;
}

/** Max rows in closedAndSaved; dedupe by URL key when saving placeholders. */
const CLOSED_SAVED_MAX = 10000;

/** URL dedupe key: host + path + ?query; hash (#) ignored; different path/query = different URL. */
function urlKeyForHistory(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    if (u.protocol === 'file:') return `file:${u.pathname}`;
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    const host = u.hostname.replace(/^www\./i, '').toLowerCase();
    let path = u.pathname;
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    return `${host}${path}${u.search}`;
  } catch (_) {
    return '';
  }
}

function normalizeUrlKey(url) {
  if (!url) return '';
  const key = urlKeyForHistory(url);
  return key || String(url).trim();
}

/** Keep first occurrence of each URL key (lists are newest-first). */
function dedupeEntriesByUrlKey(entries) {
  const seen = new Set();
  const out = [];
  for (const entry of entries) {
    if (!entry?.url) continue;
    const key = normalizeUrlKey(entry.url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

async function pruneDuplicateSavedLists() {
  try {
    const { closedAndSaved = [], blockedTabsSaved = [] } = await chrome.storage.local.get([
      'closedAndSaved',
      'blockedTabsSaved',
    ]);
    const nextClosed = dedupeEntriesByUrlKey(closedAndSaved);
    const nextBlocked = dedupeEntriesByUrlKey(blockedTabsSaved);
    const patch = {};
    if (nextClosed.length !== closedAndSaved.length) patch.closedAndSaved = nextClosed;
    if (nextBlocked.length !== blockedTabsSaved.length) patch.blockedTabsSaved = nextBlocked;
    if (Object.keys(patch).length) await chrome.storage.local.set(patch);
  } catch (e) {
    console.warn('[TabHibernate] pruneDuplicateSavedLists failed', e);
  }
}

function isQuotaExceededError(error) {
  if (!error) return false;
  const message = String(error.message || error).toLowerCase();
  return message.includes('quota') || message.includes('max write operations');
}

async function persistClosedAndSaved(entries) {
  let next = dedupeEntriesByUrlKey(Array.isArray(entries) ? entries : []).slice(0, CLOSED_SAVED_MAX);
  while (next.length > 0) {
    try {
      await chrome.storage.local.set({ closedAndSaved: next });
      return next.length;
    } catch (e) {
      if (!isQuotaExceededError(e)) throw e;
      // Keep newest entries and shrink aggressively to fit storage limits.
      const reducedSize = Math.floor(next.length * 0.8);
      if (reducedSize === next.length) throw e;
      next = next.slice(0, Math.max(1, reducedSize));
    }
  }
  await chrome.storage.local.set({ closedAndSaved: [] });
  return 0;
}
async function runCloseAndSaveAll() {
  const settings = await getSettings();
  const tabs = await chrome.tabs.query({});
  const toSave = [];
  const idsToClose = [];
  const seenUrls = new Set();
  const batchId = Date.now();
  const candidateTabs = [];
  let scanned = 0;
  const setProgress = async (extra = {}) => {
    try {
      await chrome.storage.local.set({
        closeAndSaveProgress: {
          stage: extra.stage || 'scanning',
          scanned,
          totalCandidates: toSave.length,
          totalToClose: idsToClose.length,
          closed: extra.closed || 0,
          saved: extra.saved || 0,
        },
      });
    } catch (_) {}
  };
  await setProgress({ stage: 'scanning' });
  for (const tab of tabs) {
    scanned++;
    let url = '';
    let title = '';
    if (isPlaceholderTabUrl(tab.url)) {
      url = await getPlaceholderRestoreUrl(tab) || '';
      title = (tab.title || url || '').slice(0, 512);
    } else if (await isTabEligibleForSuspend(tab, { settings })) {
      url = tab.url || '';
      title = (tab.title || tab.url || '').slice(0, 512);
    } else {
      continue;
    }
    if (!url) continue;
    candidateTabs.push({ tab, url, title });
    if (scanned % 25 === 0) await setProgress({ stage: 'scanning' });
  }
  const groupMeta = await buildGroupMetaMapForTabs(candidateTabs.map((c) => c.tab), batchId);
  for (const { tab, url, title } of candidateTabs) {
    const urlKey = normalizeUrlKey(url);
    if (seenUrls.has(urlKey)) {
      idsToClose.push(tab.id);
      continue;
    }
    seenUrls.add(urlKey);
    let entry = { url, title, savedAt: Date.now() };
    entry = copyGroupMetaToEntry(entry, groupMeta.get(tab.id));
    toSave.push(entry);
    idsToClose.push(tab.id);
  }
  await setProgress({ stage: 'scanning' });
  if (idsToClose.length === 0) return { closed: 0 };
  const { closedAndSaved = [] } = await chrome.storage.local.get('closedAndSaved');
  const mergedUrls = new Set(toSave.map((x) => normalizeUrlKey(x.url)));
  const uniqueExisting = closedAndSaved.filter((x) => x.url && !mergedUrls.has(normalizeUrlKey(x.url)));
  const merged = [...toSave.reverse(), ...uniqueExisting];
  const savedCount = await persistClosedAndSaved(merged);
  await setProgress({ stage: 'closing', saved: savedCount });
  const CLOSE_BATCH_DELAY_MS = 50;
  let closedCount = 0;
  for (let i = 0; i < idsToClose.length; i++) {
    try { await chrome.tabs.remove(idsToClose[i]); } catch (e) { console.warn('[TabHibernate] tab remove failed', idsToClose[i], e); }
    closedCount++;
    if (closedCount % 20 === 0 || closedCount === idsToClose.length) {
      await setProgress({ stage: 'closing', closed: closedCount, saved: savedCount });
    }
    if ((i + 1) % 30 === 0 && i + 1 < idsToClose.length) {
      await new Promise((r) => setTimeout(r, CLOSE_BATCH_DELAY_MS));
    }
  }
  return { closed: closedCount, saved: savedCount };
}

/** Save tabs of the active Chrome group to History; optionally close them. */
async function runSaveTabGroup({ closeTabs = false } = {}) {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!active?.id || !isTabInGroup(active)) {
    return { saved: 0, closed: 0, error: 'no-group' };
  }
  const tabs = (await chrome.tabs.query({ groupId: active.groupId })).sort((a, b) => a.index - b.index);
  const batchId = Date.now();
  const groupMeta = await buildGroupMetaMapForTabs(tabs, batchId);
  const toSave = [];
  const idsToClose = [];
  const seenUrls = new Set();
  for (const tab of tabs) {
    let url = '';
    let title = '';
    if (isPlaceholderTabUrl(tab.url) || isSuspendedPlaceholderUrl(tab.url)) {
      url = (await getPlaceholderRestoreUrl(tab)) || '';
      title = (tab.title || url || '').slice(0, 512);
    } else if (hasRestorableUrl(tab.url)) {
      url = tab.url;
      title = (tab.title || tab.url || '').slice(0, 512);
    }
    if (!url) continue;
    const urlKey = normalizeUrlKey(url);
    if (seenUrls.has(urlKey)) {
      if (closeTabs) idsToClose.push(tab.id);
      continue;
    }
    seenUrls.add(urlKey);
    let entry = { url, title, savedAt: Date.now() };
    entry = copyGroupMetaToEntry(entry, groupMeta.get(tab.id));
    toSave.push(entry);
    if (closeTabs) idsToClose.push(tab.id);
  }
  if (!toSave.length) return { saved: 0, closed: 0, error: 'empty' };
  const { closedAndSaved = [] } = await chrome.storage.local.get('closedAndSaved');
  const mergedUrls = new Set(toSave.map((x) => normalizeUrlKey(x.url)));
  const uniqueExisting = closedAndSaved.filter((x) => x.url && !mergedUrls.has(normalizeUrlKey(x.url)));
  const savedCount = await persistClosedAndSaved([...toSave.reverse(), ...uniqueExisting]);
  let closedCount = 0;
  if (closeTabs) {
    for (const id of idsToClose) {
      try {
        await chrome.tabs.remove(id);
        closedCount++;
      } catch (e) {
        console.warn('[TabHibernate] close tab group tab failed', id, e);
      }
    }
  }
  await updateBadge();
  return { saved: toSave.length, closed: closedCount, persisted: savedCount };
}

let closeAndSaveJobRunning = false;
async function startCloseAndSaveAllJob() {
  if (closeAndSaveJobRunning) return { started: false, reason: 'already-running' };
  closeAndSaveJobRunning = true;
  await chrome.storage.local.remove('closeAndSaveResult').catch(() => {});
  runCloseAndSaveAll().then(async (res) => {
    await chrome.storage.local.set({ closeAndSaveResult: { ok: true, ...res, finishedAt: Date.now() } });
    await chrome.storage.local.remove('closeAndSaveProgress');
    await updateBadge();
  }).catch(async (e) => {
    console.warn('[TabHibernate] closeAndSaveAll async job failed', e);
    await chrome.storage.local.set({
      closeAndSaveResult: { ok: false, closed: 0, saved: 0, error: String(e?.message || e), finishedAt: Date.now() },
    });
    await chrome.storage.local.remove('closeAndSaveProgress');
  }).finally(() => {
    closeAndSaveJobRunning = false;
  });
  return { started: true };
}

/** Delay between restores (ms) — avoid memory spike. */
const RESTORE_DELAY_MS = 1000;

/** Restore all tabs: one at a time with delay, writes restoreProgress to storage. */
async function runRestoreAllSuspended() {
  const tabs = await chrome.tabs.query({});
  const placeholders = [];
  for (const tab of tabs) {
    if (!tab.url || !tab.id || !isPlaceholderTabUrl(tab.url)) continue;
    const u = new URL(tab.url);
    const tabIdParam = u.searchParams.get('tabId');
    const tid = tabIdParam ? parseInt(tabIdParam, 10) : null;
    if (tid == null) continue;
    placeholders.push({ tab, tid, u });
  }
  const total = placeholders.length;
  let restored = 0;
  const setProgress = (r, t) => {
    chrome.storage.local.set({
      restoreProgress: { restored: r, total: t, remaining: t - r },
    });
  };
  for (const { tab, tid, u } of placeholders) {
    try {
      const key = `suspended_${tid}`;
      const data = await chrome.storage.local.get(key);
      const item = data[key];
      let restoreUrl = item && item.url ? item.url : null;
      if (!restoreUrl) {
        const fallback = u.searchParams.get('u');
        if (fallback && (fallback.startsWith('http://') || fallback.startsWith('https://'))) restoreUrl = fallback;
      }
      if (restoreUrl) {
        await chrome.tabs.update(tab.id, { url: restoreUrl });
        await chrome.storage.local.remove(key);
        await removeSuspendedBookmark(restoreUrl);
        restored++;
        setProgress(restored, total);
        if (restored < total) await new Promise((r) => setTimeout(r, RESTORE_DELAY_MS));
      }
    } catch (e) {
      console.warn('[TabHibernate] restore tab failed', tab.id, e);
    }
  }
  await chrome.storage.local.remove('restoreProgress');
  await updateBadge();
  return { restored };
}

/** Discard background tabs — same rules as TabMemoryCleaner (`tmcSettings`). */
const DISCARD_DELAY_MS = 300;
const TMC_DEFAULT_SETTINGS = {
  skipPinned: false,
  skipAudible: true,
  skipIncognito: true,
  skipGrouped: false,
  excludedDomains: [],
};

function tmcNormalizeDomain(input) {
  let s = String(input || '').trim().toLowerCase();
  if (!s) return '';
  try {
    if (!s.startsWith('http')) s = 'https://' + s;
    return new URL(s).hostname.replace(/^www\./, '') || '';
  } catch {
    return s.replace(/^www\./, '').split('/')[0].split('?')[0];
  }
}

function tmcParseExcludedList(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const d = tmcNormalizeDomain(item);
    if (!d || seen.has(d)) continue;
    seen.add(d);
    out.push(d);
  }
  return out;
}

function tmcHostMatchesDomains(host, domains) {
  if (!host || !domains.length) return false;
  const h = host.replace(/^www\./, '').toLowerCase();
  return domains.some((d) => h === d || h.endsWith('.' + d));
}

async function getTmcDiscardSettings() {
  const { tmcSettings = {} } = await chrome.storage.local.get('tmcSettings');
  return {
    ...TMC_DEFAULT_SETTINGS,
    ...tmcSettings,
    excludedDomains: tmcParseExcludedList(tmcSettings.excludedDomains),
  };
}

async function runDiscardBackgroundTabs() {
  const opts = await getTmcDiscardSettings();
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
      if (tmcHostMatchesDomains(host, opts.excludedDomains)) return false;
    } catch (_) {}
    return true;
  });
  let discarded = 0;
  for (const tab of toDiscard) {
    try {
      await chrome.tabs.discard(tab.id);
      discarded++;
      if (discarded < toDiscard.length) await new Promise((r) => setTimeout(r, DISCARD_DELAY_MS));
    } catch (e) {
      console.warn('[Memory] discard failed', tab.id, e);
    }
  }
  return { discarded, total: toDiscard.length };
}

/**
 *    of storage + bookmarks (survives reinstall).
 * From placeholder- (suspended.html),     —  RAM  CPU  100+ .
 * From     «Restore" .
 */
const RECOVER_DELAY_MS = 60;

async function runRecoverLostSuspended() {
  const items = await collectRecoverableTabItems();
  if (!items.length) {
    return { recovered: 0, sourcesHint: 'Check Chrome bookmarks: Tab Hibernate → Emergency Recovery / Suspended Recovery, or Tab Backup. Open History in the panel for closed-and-saved lists.' };
  }

  const res = await runOpenUrlsAsPlaceholders(items);
  return { recovered: res.opened, totalCandidates: items.length };
}

/** Open URLs as hibernate placeholders; items: [{url, title, groupKey?, ...}]. */
async function runOpenUrlsAsPlaceholders(items) {
  if (!items || !items.length) return { opened: 0 };
  const seenOpen = new Set();
  const valid = items
    .filter((x) => x && x.url && (x.url.startsWith('http') || x.url.startsWith('file')))
    .filter((x) => {
      const key = normalizeUrlKey(x.url);
      if (!key || seenOpen.has(key)) return false;
      seenOpen.add(key);
      return true;
    })
    .sort((a, b) => {
      const ga = normalizeGroupKey(a.groupKey) || `\xff${a.url}`;
      const gb = normalizeGroupKey(b.groupKey) || `\xff${b.url}`;
      if (ga !== gb) return ga.localeCompare(gb);
      return (a.tabIndexInGroup ?? 0) - (b.tabIndexInGroup ?? 0);
    });
  const created = [];
  let opened = 0;
  for (const item of valid) {
    const tab = await openPlaceholderTabForItem(item);
    created.push({ tabId: tab.id, item });
    opened++;
    if (valid.length > 10 && opened % 10 === 0) {
      await new Promise((r) => setTimeout(r, RECOVER_DELAY_MS));
    }
  }
  await applySavedTabGroups(created, { forceRegroup: true });
  await updateBadge();
  return { opened };
}

function shouldSkipHistoryRecoverUrl(url) {
  const lower = (url || '').toLowerCase();
  if (
    lower.startsWith('chrome://')
    || lower.startsWith('chrome-extension://')
    || lower.startsWith('edge://')
    || lower.startsWith('about:')
    || lower.startsWith('devtools://')
  ) return true;
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === 'chromewebstore.google.com' || host === 'chrome.google.com') return true;
  } catch (_) {
    return true;
  }
  return false;
}

async function getOpenTabUrlKeys() {
  const tabs = await chrome.tabs.query({});
  const keys = new Set();
  for (const tab of tabs) {
    let url = tab.pendingUrl || tab.url || '';
    if (isPlaceholderTabUrl(url) || isSuspendedPlaceholderUrl(url)) {
      const restored = await getPlaceholderRestoreUrl(tab);
      if (restored) url = restored;
    }
    const key = urlKeyForHistory(url);
    if (key) keys.add(key);
  }
  return keys;
}

/**
 * Search chrome.history for URLs not already open (typical "lost" tabs after a crash).
 */
async function searchLostTabsFromHistory({
  hoursBack = 24,
  onlyMissing = true,
  maxResults = 1000,
  text = '',
} = {}) {
  const hours = Math.min(Math.max(Number(hoursBack) || 24, 1), 24 * 30);
  const startTime = Date.now() - hours * 60 * 60 * 1000;
  const openKeys = onlyMissing ? await getOpenTabUrlKeys() : new Set();
  const query = {
    text: typeof text === 'string' ? text.trim() : '',
    startTime,
    maxResults: Math.min(Math.max(Number(maxResults) || 1000, 50), 1000),
  };
  const raw = await chrome.history.search(query);
  const seen = new Set();
  const items = [];
  for (const visit of raw) {
    const url = visit.url;
    if (!hasRestorableUrl(url) || shouldSkipHistoryRecoverUrl(url)) continue;
    const key = urlKeyForHistory(url);
    if (!key || seen.has(key)) continue;
    if (onlyMissing && openKeys.has(key)) continue;
    seen.add(key);
    items.push({
      url,
      title: visit.title || url,
      lastVisitTime: visit.lastVisitTime || 0,
      visitCount: visit.visitCount || 1,
    });
  }
  items.sort((a, b) => b.lastVisitTime - a.lastVisitTime);
  return {
    items: items.slice(0, 500),
    scanned: raw.length,
    hoursBack: hours,
    onlyMissing: !!onlyMissing,
  };
}

/** Recover from browser history as suspended.html placeholders. */
async function runRecoverFromBrowserHistory(options) {
  const { items, scanned } = await searchLostTabsFromHistory(options);
  if (!items.length) {
    return {
      recovered: 0,
      candidates: 0,
      scanned,
      message: 'No matching URLs in history for the selected period (or all are already open).',
    };
  }
  const res = await runOpenUrlsAsPlaceholders(items.map(({ url, title }) => ({ url, title })));
  return {
    recovered: res.opened,
    candidates: items.length,
    scanned,
  };
}

/** Main alarm check: suspend inactive tabs and backup if needed. */
async function onAlarmCheck() {
  try {
    await chrome.storage.local.set({ lastAlarmRun: Date.now() });
    await getStoredState();
    await pruneStaleTabIds();
    await pruneStaleSuspendedEntries();
    await pruneChromeGroupKeyRegistry();
    await pruneOldBackups();

    const settings = await getSettings();
    await ensureAlarm(settings.checkPeriodMinutes);
    await ensureSiteBlockerAlarm();
    if (!settings.enabled) return;

    const tabs = await chrome.tabs.query({});
    if (seedActivityForUnknownTabs(tabs)) await persistLastActivity(true);

    const toBackup = [];
    let suspendedThisRun = 0;
    for (const tab of tabs) {
      if (!(await isTabEligibleForSuspend(tab, { settings }))) continue;
      if (isTabExcludedByDomain(tab, settings.excludedDomains)) continue;
      if (!isTabInactive(tab.id, settings.timeoutMinutes)) continue;
      const mode = getSuspendModeForTab(settings, tab);
      if (mode === 'placeholder' && !hasRestorableUrl(tab.url)) continue;

      if (mode === 'discard') {
        const ok = await suspendDiscard(tab.id);
        if (ok) { toBackup.push({ url: tab.url, title: tab.title }); suspendedThisRun++; }
      } else {
        const ok = await suspendPlaceholder(tab.id, tab.url, tab.title, tab.favIconUrl, {
          groupId: tab.groupId,
          windowId: tab.windowId,
        });
        if (ok) { toBackup.push({ url: tab.url, title: tab.title }); suspendedThisRun++; }
      }
      if (suspendedThisRun > 0 && suspendedThisRun % 15 === 0) {
        await new Promise((r) => setTimeout(r, SUSPEND_BATCH_DELAY_MS));
      }
    }

    if (toBackup.length > 0) {
      const seen = new Set();
      const unique = toBackup.filter((t) => {
        if (seen.has(t.url)) return false;
        seen.add(t.url);
        return true;
      });
      const folderId = await getOrCreateBackupFolder();
      for (const t of unique) {
        try {
          await chrome.bookmarks.create({
            parentId: folderId,
            title: (t.title || t.url).slice(0, 255),
            url: t.url,
          });
        } catch (e) {
          console.warn('[TabHibernate] backup bookmark failed', e);
        }
      }
      const backupKey = `backup_${new Date().toISOString().slice(0, 10)}`;
      const existing = await chrome.storage.local.get(backupKey);
      const list = existing[backupKey] || [];
      const existingUrls = new Set(list.map((x) => x.url));
      for (const t of unique) {
        if (!existingUrls.has(t.url)) {
          list.push({ url: t.url, title: t.title || t.url, ts: Date.now() });
          existingUrls.add(t.url);
        }
      }
      await chrome.storage.local.set({ [backupKey]: list });
    }
  } catch (e) {
    console.warn('[TabHibernate] onAlarmCheck failed', e);
  }
}

/** Create/update periodic alarm; call on startup and after each check. */
async function ensureAlarm(periodMinutes = ALARM_CHECK_PERIOD_MINUTES) {
  try {
    const period = CHECK_PERIOD_OPTIONS.includes(Number(periodMinutes)) ? Number(periodMinutes) : ALARM_CHECK_PERIOD_MINUTES;
    await chrome.alarms.create(ALARM_CHECK_NAME, { periodInMinutes: period });
  } catch (e) {
    console.warn('[TabHibernate] alarm create', e);
  }
}

/** After browser restart tab.id changes — rebind storage/URL and regroup by groupKey. */
async function rebindPlaceholderStorageKeys() {
  try {
    const tabs = await chrome.tabs.query({});
    const placeholders = tabs.filter(
      (t) => t.url && (isPlaceholderTabUrl(t.url) || isSuspendedPlaceholderUrl(t.url)),
    );
    const forGrouping = [];
    for (const tab of placeholders) {
      try {
        await rebindSinglePlaceholderTab(tab);
      } catch (e) {
        console.warn('[TabHibernate] rebindSinglePlaceholderTab failed', tab.id, e);
      }
      try {
        const fresh = await chrome.tabs.get(tab.id);
        const key = `suspended_${fresh.id}`;
        const data = await chrome.storage.local.get(key);
        const item = data[key];
        if (item?.url) {
          forGrouping.push({ tabId: fresh.id, item });
          continue;
        }
        let urlTabId = null;
        try {
          urlTabId = parseInt(new URL(fresh.url || '').searchParams.get('tabId') || '', 10);
        } catch (_) {}
        const found = await findSuspendedStorageForPlaceholderTab(
          fresh,
          Number.isNaN(urlTabId) ? null : urlTabId,
        );
        if (found?.item?.url) forGrouping.push({ tabId: fresh.id, item: found.item });
      } catch (e) {
        console.warn('[TabHibernate] collect placeholder group data failed', tab.id, e);
      }
    }
    if (forGrouping.length) await applySavedTabGroups(forGrouping, { forceRegroup: false });
    await pruneChromeGroupKeyRegistry();
  } catch (e) {
    console.warn('[TabHibernate] rebindPlaceholderStorageKeys failed', e);
  }
}

/** After reload: re-point suspended.html tabs to the current extension ID. */
async function migrateOrphanedSuspendedTabs() {
  try {
    const ourId = chrome.runtime.id;
    const ourOrigin = `chrome-extension://${ourId}`;
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (!tab.id || !tab.url) continue;
      try {
        const u = new URL(tab.url);
        if (u.protocol !== 'chrome-extension:') continue;
        if (!u.pathname.endsWith('suspended.html')) continue;
        if (u.origin === ourOrigin) continue;
        const oldTabIdParam = u.searchParams.get('tabId');
        let fallback = u.searchParams.get('u');
        if (!fallback && oldTabIdParam) {
          const stored = await chrome.storage.local.get(`suspended_${oldTabIdParam}`);
          fallback = stored[`suspended_${oldTabIdParam}`]?.url || '';
        }
        if (!fallback || !hasRestorableUrl(fallback)) continue;
        const storedNow = await chrome.storage.local.get(`suspended_${tab.id}`);
        const title = storedNow[`suspended_${tab.id}`]?.title
          || (oldTabIdParam && (await chrome.storage.local.get(`suspended_${oldTabIdParam}`)))[`suspended_${oldTabIdParam}`]?.title
          || '';
        const params = new URLSearchParams({ tabId: String(tab.id) });
        if (encodeURIComponent(fallback).length <= PLACEHOLDER_URL_PARAM_MAX) params.set('u', fallback);
        const newUrl = chrome.runtime.getURL('suspended.html') + '?' + params.toString();
        await chrome.storage.local.set({ [`suspended_${tab.id}`]: { url: fallback, title, favIconUrl: '', tabId: tab.id } });
        await chrome.tabs.update(tab.id, { url: newUrl });
      } catch (e) {
        console.warn('[TabHibernate] migrate tab failed', tab.id, e);
      }
    }
  } catch (e) {
    console.warn('[TabHibernate] migrateOrphanedSuspendedTabs failed', e);
  }
}

async function runPlaceholderMaintenance() {
  try {
    await migrateOrphanedSuspendedTabs();
    await recoverBlockerTabsAfterWake();
    await rebindPlaceholderStorageKeys();
  } catch (e) {
    console.warn('[TabHibernate] migrate/rebind placeholders failed', e);
  }
}

/** Lightweight init on SW wake: alarms + restore activity map. No migrate/rebind or timer reset. */
function ensureServiceWorkerReady() {
  if (!swReadyPromise) {
    swReadyPromise = (async () => {
      const settings = await getSettings();
      await ensureAlarm(settings.checkPeriodMinutes);
      await getStoredState();
      await updateBadge();
      await ensureSiteBlockerAlarm();
      await ensureBlockerPreserveAlarm();
      if (!placeholderMaintenanceScheduled) {
        placeholderMaintenanceScheduled = true;
        setTimeout(() => {
          runPlaceholderMaintenance().catch((e) => {
            console.warn('[TabHibernate] delayed placeholder maintenance failed', e);
          });
        }, 2200);
      }
    })().catch((e) => {
      swReadyPromise = null;
      throw e;
    });
  }
  return swReadyPromise;
}

/** Browser/extension lifecycle only — not on every SW wake. */
async function initOnStartup() {
  await runPlaceholderMaintenance();
  swReadyPromise = null;
  await ensureServiceWorkerReady();
  await pruneDuplicateSavedLists();
}

/** Extension icon click opens the side panel instead of popup. */
async function setSidePanelBehavior() {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (e) {
    console.warn('[TabHibernate] setPanelBehavior failed', e);
  }
}

chrome.runtime.onStartup.addListener(async () => {
  try {
    await setSidePanelBehavior();
    await runPlaceholderMaintenance();
    await new Promise((r) => setTimeout(r, 1500));
    await initOnStartup();
    await siteBlockerApplyRules();
    await siteBlockerApplyAdsRulesets();
  } catch (e) {
    console.error('[SwissExtensions] onStartup failed', e);
  }
});

if (chrome.runtime.onUpdateAvailable) {
  chrome.runtime.onUpdateAvailable.addListener(() => {
    runEmergencySessionBackup('update-available').catch((e) => {
      console.warn('[TabHibernate] pre-update backup failed', e);
    });
  });
}

chrome.runtime.onInstalled.addListener(async (details) => {
  try {
    if (details.reason === 'install') {
      await chrome.storage.local.set({
        settings: {
          enabled: true,
          timeoutMinutes: INACTIVITY_MINUTES,
          checkPeriodMinutes: ALARM_CHECK_PERIOD_MINUTES,
          excludedDomains: [],
          smartRulesEnabled: false,
          smartDefaultMode: 'discard',
          smartUseHeuristicsFallback: true,
          smartPlaceholderDomains: [],
          smartDiscardDomains: [],
          mode: 'placeholder',
          suspendPinnedTabs: true,
          skipGroupedInHibernate: false,
        },
      });
    }
    await setSidePanelBehavior();
    if (details.reason === 'update') {
      await preserveBlockedOpenTabs('extension-update', { convertToPlaceholder: true });
      await runEmergencySessionBackup('extension-update');
      await migrateOrphanedSuspendedTabs();
    }
    await initOnStartup();
    await siteBlockerApplyRules();
    await siteBlockerApplyAdsRulesets();
  } catch (e) {
    console.error('[SwissExtensions] onInstalled failed', e);
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_CHECK_NAME) onAlarmCheck();
  if (alarm.name === SITE_BLOCKER_SCHEDULE_ALARM) runSiteBlockerApplyRules();
  if (alarm.name === BLOCKER_PRESERVE_ALARM) {
    pruneBlockerTabUrlMap()
      .then(() => preserveBlockedOpenTabs('periodic', { convertToPlaceholder: false }))
      .catch((e) => console.warn('[SiteBlocker] periodic preserve failed', e));
  }
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  markTabActive(activeInfo.tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.audible === true) {
    markTabActive(tabId);
  }
  if (changeInfo.url) {
    updateBadge();
    const navUrl = changeInfo.url;
    if (navUrl.startsWith('http://') || navUrl.startsWith('https://')) {
      rememberTabNavigationUrl(tabId, navUrl);
    }
  }
  if (changeInfo.status === 'complete') {
    chrome.tabs.get(tabId).then(async (tab) => {
      if (!tab?.id || !isChromeBlockedPageUrl(tab.url || '')) return;
      const last = lastHttpUrlByTabId.get(tabId);
      if (last && hasRestorableUrl(last)) {
        await rememberBlockerTabUrl(tabId, last, tab.title);
      }
    }).catch(() => {});
  }
  if (changeInfo.url || changeInfo.status === 'complete') {
    chrome.tabs.get(tabId).then(scheduleSiteBlockerNavEnforce).catch(() => {});
  }
  if (changeInfo.groupId !== undefined) {
    chrome.tabs.get(tabId).then(syncSuspendedStorageGroupMetaForTab).catch(() => {});
  }
});

if (chrome.tabGroups?.onUpdated) {
  chrome.tabGroups.onUpdated.addListener((group) => {
    if (!group?.id) return;
    chrome.tabs.query({ groupId: group.id }).then((tabs) => {
      for (const tab of tabs) syncSuspendedStorageGroupMetaForTab(tab).catch(() => {});
    }).catch(() => {});
  });
}

chrome.tabs.onCreated.addListener((tab) => {
  if (tab.id) markTabActive(tab.id);
});

/** Remember navigation URL before DNR block (onUpdated often misses http). */
function rememberTabNavigationUrl(tabId, url, title = '') {
  if (!tabId || !url || (!url.startsWith('http://') && !url.startsWith('https://'))) return;
  lastHttpUrlByTabId.set(tabId, url);
  getActiveBlockerDomains()
    .then((domains) => {
      if (domains.length && sbUrlMatchesBlockedDomains(url, domains)) {
        return rememberBlockerTabUrl(tabId, url, title);
      }
      return undefined;
    })
    .catch(() => {});
}

if (chrome.webNavigation?.onBeforeNavigate) {
  chrome.webNavigation.onBeforeNavigate.addListener((details) => {
    if (details.frameId !== 0) return;
    rememberTabNavigationUrl(details.tabId, details.url || '');
  });
}

chrome.tabs.onRemoved.addListener((tabId) => {
  lastActivityByTab.delete(tabId);
  lastHttpUrlByTabId.delete(tabId);
  persistLastActivity();
  chrome.storage.local.remove(`suspended_${tabId}`);
  chrome.storage.local.get(BLOCKER_TAB_URL_KEY).then((data) => {
    const map = data[BLOCKER_TAB_URL_KEY];
    if (!map || map[String(tabId)] == null) return;
    delete map[String(tabId)];
    chrome.storage.local.set({ [BLOCKER_TAB_URL_KEY]: map });
  }).catch(() => {});
  updateBadge();
});

/** Badge updates when closedAndSaved changes (import/clear on History page). */
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.closedAndSaved) updateBadge();
});

/** Site Blocker: static rulesets + dynamic domain rules (whitelist matches standalone SiteBlocker). */
const SITE_BLOCKER_RULE_ID_START = 10000;
const NETFILTER_RULESET_IDS = ['ruleset_1', 'ruleset_2', 'ruleset_3', 'ruleset_4', 'ruleset_5', 'ruleset_6'];
/** Ads ruleset bundled from standalone Site Blocker extension. */
const SB_ADS_RULESET_IDS = ['sb_siteblocker_ads'];
const SB_DEFAULT_SCHEDULE = {
  enabled: false,
  from: '09:00',
  to: '18:00',
  days: [1, 2, 3, 4, 5],
};

function sbParseHHMM(value) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(value || '').trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isInteger(hh) || !Number.isInteger(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function sbNormalizeSchedule(input) {
  const raw = input && typeof input === 'object' ? input : {};
  const from = typeof raw.from === 'string' ? raw.from : SB_DEFAULT_SCHEDULE.from;
  const to = typeof raw.to === 'string' ? raw.to : SB_DEFAULT_SCHEDULE.to;
  const days = Array.isArray(raw.days)
    ? raw.days.map((d) => Number(d)).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    : SB_DEFAULT_SCHEDULE.days.slice();
  return {
    enabled: raw.enabled === true,
    from: sbParseHHMM(from) != null ? from : SB_DEFAULT_SCHEDULE.from,
    to: sbParseHHMM(to) != null ? to : SB_DEFAULT_SCHEDULE.to,
    days: [...new Set(days)],
  };
}

function sbIsInSchedule(schedule, now = new Date()) {
  if (!schedule.enabled) return true;
  if (!schedule.days.includes(now.getDay())) return false;
  const from = sbParseHHMM(schedule.from);
  const to = sbParseHHMM(schedule.to);
  if (from == null || to == null) return false;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  if (from === to) return true;
  if (from < to) return nowMin >= from && nowMin < to;
  return nowMin >= from || nowMin < to;
}

function sbNormDomain(d) {
  let s = (d || '').trim().toLowerCase();
  if (!s) return '';
  try { if (!s.startsWith('http')) s = 'https://' + s; return new URL(s).hostname.replace(/^www\./, '') || ''; } catch { return s.replace(/^www\./, '').split('/')[0].split('?')[0]; }
}

function sbHostMatchesDomains(hostname, domains) {
  if (!hostname || !Array.isArray(domains) || domains.length === 0) return false;
  const host = hostname.replace(/^www\./, '').toLowerCase();
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function sbUrlMatchesBlockedDomains(url, domains) {
  try {
    const parsed = new URL(url || '');
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    return sbHostMatchesDomains(parsed.hostname, domains);
  } catch (_) {
    return false;
  }
}

const BLOCKED_TABS_SAVED_MAX = 5000;

async function getOrCreateSiteBlockerSavedFolder() {
  const tree = await chrome.bookmarks.getTree();
  const root = tree[0];
  const findFolder = (nodes, title) => {
    if (!nodes) return null;
    for (const n of nodes) {
      if (n.title === title) return n;
      const inChild = findFolder(n.children || [], title);
      if (inChild) return inChild;
    }
    return null;
  };
  let parent = findFolder(root.children, 'Site Blocker');
  if (!parent) {
    const created = await chrome.bookmarks.create({ parentId: root.id, title: 'Site Blocker' });
    parent = { id: created.id };
  }
  let folder = findFolder([parent], 'Saved tabs');
  if (folder?.id) return folder.id;
  const created = await chrome.bookmarks.create({ parentId: parent.id, title: 'Saved tabs' });
  return created.id;
}

/** Local Site Blocker history + user bookmarks (chrome.storage + bookmarks). */
async function appendBlockedTabsSaved(entries, { reason = 'block', writeBookmarks = true } = {}) {
  if (!entries?.length) return { added: 0 };
  const { blockedTabsSaved = [] } = await chrome.storage.local.get('blockedTabsSaved');
  const seen = new Set(blockedTabsSaved.map((x) => normalizeUrlKey(x.url)).filter(Boolean));
  const merged = blockedTabsSaved.slice();
  const newlyAdded = [];
  for (const entry of entries) {
    const key = normalizeUrlKey(entry?.url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push({
      url: entry.url,
      title: entry.title || entry.url,
      domain: entry.domain || '',
      savedAt: Date.now(),
      reason: reason || 'block',
      ...pickSavedGroupFields(entry),
    });
    newlyAdded.push(entry);
  }
  if (!newlyAdded.length) return { added: 0 };
  await chrome.storage.local.set({ blockedTabsSaved: merged.slice(-BLOCKED_TABS_SAVED_MAX) });
  if (writeBookmarks) {
    try {
      const folderId = await getOrCreateSiteBlockerSavedFolder();
      for (const entry of newlyAdded) {
        try {
          await chrome.bookmarks.create({
            parentId: folderId,
            title: (entry.title || entry.url).slice(0, 255),
            url: entry.url,
          });
        } catch (e) {
          console.warn('[SiteBlocker] bookmark save failed', entry.url, e);
        }
      }
    } catch (e) {
      console.warn('[SiteBlocker] saved tabs folder failed', e);
    }
  }
  return { added: newlyAdded.length };
}

async function collectOpenTabsOnBlockedDomains(domains) {
  if (!domains?.length) return [];
  const tabs = await chrome.tabs.query({});
  const matchingTabs = [];
  for (const tab of tabs) {
    let url = tab.pendingUrl || tab.url || '';
    if (isPlaceholderTabUrl(url) || isSuspendedPlaceholderUrl(url)) {
      const restored = await getPlaceholderRestoreUrl(tab);
      if (restored) url = restored;
    }
    if (!hasRestorableUrl(url) || !sbUrlMatchesBlockedDomains(url, domains)) continue;
    matchingTabs.push({ tab, url });
  }
  const batchId = Date.now();
  const groupMeta = await buildGroupMetaMapForTabs(matchingTabs.map((m) => m.tab), batchId);
  const entries = [];
  const seen = new Set();
  for (const { tab, url } of matchingTabs) {
    const key = normalizeUrlKey(url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    let domain = '';
    try {
      domain = sbNormDomain(new URL(url).hostname);
    } catch (_) {}
    let entry = { url, title: tab.title || url, domain };
    entry = copyGroupMetaToEntry(entry, groupMeta.get(tab.id));
    entries.push(entry);
  }
  return entries;
}

async function saveOpenTabsMatchingBlockedDomains(domains, reason) {
  const entries = await collectOpenTabsOnBlockedDomains(domains);
  return appendBlockedTabsSaved(entries, { reason, writeBookmarks: true });
}

async function maybeAutoSaveBlockedTabs(domains, reason) {
  const { blockerAutoSaveTabs = true } = await chrome.storage.local.get('blockerAutoSaveTabs');
  if (blockerAutoSaveTabs === false || !domains?.length) return { added: 0 };
  return saveOpenTabsMatchingBlockedDomains(domains, reason);
}

function isChromeBlockedPageUrl(url) {
  return Boolean(
    url && (url.startsWith('chrome-error://') || url.startsWith('chrome://network-error/'))
  );
}

async function getConfiguredBlockerDomains() {
  const { blocked = [], whitelist = [] } = await chrome.storage.local.get(['blocked', 'whitelist']);
  const whitelistSet = new Set((whitelist || []).map(sbNormDomain).filter(Boolean));
  const seen = new Set();
  return (blocked || []).map(sbNormDomain).filter(Boolean).filter((d) => {
    if (seen.has(d) || whitelistSet.has(d)) return false;
    seen.add(d);
    return true;
  });
}

async function rememberBlockerTabUrl(tabId, url, title = '') {
  if (!tabId || !hasRestorableUrl(url)) return;
  const { [BLOCKER_TAB_URL_KEY]: map = {} } = await chrome.storage.local.get(BLOCKER_TAB_URL_KEY);
  map[String(tabId)] = { url, title: title || url, at: Date.now() };
  await chrome.storage.local.set({ [BLOCKER_TAB_URL_KEY]: map });
}

/** Page URL before chrome-error or after extension disable. */
async function resolveBlockerTabPageUrl(tab) {
  if (!tab?.id) return '';
  let url = tab.pendingUrl || tab.url || '';
  if (isPlaceholderTabUrl(url) || isSuspendedPlaceholderUrl(url)) {
    url = (await getPlaceholderRestoreUrl(tab)) || url;
  }
  if (hasRestorableUrl(url) && !isChromeBlockedPageUrl(url)) return url;
  const remembered = await chrome.storage.local.get(BLOCKER_TAB_URL_KEY);
  const entry = remembered[BLOCKER_TAB_URL_KEY]?.[String(tab.id)];
  if (entry?.url && hasRestorableUrl(entry.url)) return entry.url;
  const lastNav = lastHttpUrlByTabId.get(tab.id);
  if (lastNav && hasRestorableUrl(lastNav) && !isChromeBlockedPageUrl(lastNav)) return lastNav;
  return '';
}

async function tabMatchesBlockerPreserve(tab, domains) {
  if (!tab?.id || !domains?.length) return false;
  const liveUrl = tab.url || '';
  if (isPlaceholderTabUrl(liveUrl) || isSuspendedPlaceholderUrl(liveUrl)) return false;
  if (isChromeBlockedPageUrl(liveUrl)) return true;
  const pageUrl = await resolveBlockerTabPageUrl(tab);
  return pageUrl && sbUrlMatchesBlockedDomains(pageUrl, domains);
}

/**
 * Persist tabs on blocked sites to History/bookmarks;
 * with convertToPlaceholder, move to suspended.html so URL survives disable.
 */
async function preserveBlockedOpenTabs(reason = 'preserve', { convertToPlaceholder = true } = {}) {
  const domains = await getConfiguredBlockerDomains();
  if (!domains.length) return { saved: 0, converted: 0 };

  const tabs = await chrome.tabs.query({});
  const entries = [];
  let converted = 0;

  for (const tab of tabs) {
    if (!tab?.id) continue;
    if (!(await tabMatchesBlockerPreserve(tab, domains))) continue;

    const url = await resolveBlockerTabPageUrl(tab);
    if (!url) continue;

    let domain = '';
    try {
      domain = sbNormDomain(new URL(url).hostname);
    } catch (_) {}

    entries.push({ url, title: tab.title || url, domain });

    if (convertToPlaceholder && !isPlaceholderTabUrl(tab.url) && !isSuspendedPlaceholderUrl(tab.url)) {
      const ok = await suspendPlaceholder(tab.id, url, tab.title, tab.favIconUrl, {
        groupId: tab.groupId,
        windowId: tab.windowId,
      });
      if (ok) converted++;
    }
  }

  const saveRes = entries.length
    ? await appendBlockedTabsSaved(entries, { reason, writeBookmarks: true })
    : { added: 0 };

  return { saved: saveRes.added || 0, converted, candidates: entries.length };
}

/** After disable/re-enable: chrome-error → placeholder with saved URL. */
async function recoverBlockerTabsAfterWake() {
  const domains = await getConfiguredBlockerDomains();
  if (!domains.length) return { converted: 0 };

  const tabs = await chrome.tabs.query({});
  let converted = 0;
  for (const tab of tabs) {
    if (!tab?.id) continue;
    const liveUrl = tab.url || '';
    if (isPlaceholderTabUrl(liveUrl) || isSuspendedPlaceholderUrl(liveUrl)) continue;
    if (!isChromeBlockedPageUrl(liveUrl)) continue;
    const url = await resolveBlockerTabPageUrl(tab);
    if (!url || !sbUrlMatchesBlockedDomains(url, domains)) continue;
    const ok = await suspendPlaceholder(tab.id, url, tab.title, tab.favIconUrl, {
      groupId: tab.groupId,
      windowId: tab.windowId,
    });
    if (ok) converted++;
  }
  return { converted };
}

async function ensureBlockerPreserveAlarm() {
  try {
    const existing = await chrome.alarms.get(BLOCKER_PRESERVE_ALARM);
    if (existing) return;
    await chrome.alarms.create(BLOCKER_PRESERVE_ALARM, { periodInMinutes: BLOCKER_PRESERVE_PERIOD_MINUTES });
  } catch (e) {
    console.warn('[SiteBlocker] ensureBlockerPreserveAlarm failed', e);
  }
}

async function pruneBlockerTabUrlMap() {
  try {
    const tabs = await chrome.tabs.query({});
    const ids = new Set(tabs.map((t) => String(t.id)));
    const { [BLOCKER_TAB_URL_KEY]: map = {} } = await chrome.storage.local.get(BLOCKER_TAB_URL_KEY);
    let changed = false;
    for (const k of Object.keys(map)) {
      if (!ids.has(k)) {
        delete map[k];
        changed = true;
      }
    }
    if (changed) await chrome.storage.local.set({ [BLOCKER_TAB_URL_KEY]: map });
  } catch (e) {
    console.warn('[SiteBlocker] pruneBlockerTabUrlMap failed', e);
  }
}
async function getActiveBlockerDomains() {
  const { blocked = [], whitelist = [], enabled, schedule } = await chrome.storage.local.get([
    'blocked',
    'whitelist',
    'enabled',
    'schedule',
  ]);
  if (enabled === false) return [];
  if (!sbIsInSchedule(sbNormalizeSchedule(schedule))) return [];
  const whitelistSet = new Set((whitelist || []).map(sbNormDomain).filter(Boolean));
  const seen = new Set();
  return (blocked || []).map(sbNormDomain).filter(Boolean).filter((d) => {
    if (seen.has(d) || whitelistSet.has(d)) return false;
    seen.add(d);
    return true;
  });
}

async function siteBlockerReloadBlockedOpenTabs(domains) {
  if (!domains?.length) return;
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab?.id) continue;
    const url = tab.url || '';
    if (isPlaceholderTabUrl(url) || isSuspendedPlaceholderUrl(url)) continue;
    if (isChromeBlockedPageUrl(url)) continue;
    if (!sbUrlMatchesBlockedDomains(url, domains)) continue;
    await rememberBlockerTabUrl(tab.id, url, tab.title);
    try {
      await chrome.tabs.reload(tab.id, { bypassCache: true });
    } catch (e) {
      console.warn('[SiteBlocker] reload blocked tab failed', tab.id, e);
    }
  }
}

function scheduleSiteBlockerNavEnforce(tab) {
  if (!tab?.id) return;
  siteBlockerNavEnforceChain = siteBlockerNavEnforceChain
    .then(() => maybeReloadTabIfBlocked(tab))
    .catch(() => {});
}

/** Reload tabs already open on a blocked domain (e.g. after Back) under DNR. */
async function maybeReloadTabIfBlocked(tab) {
  if (!tab?.id) return;
  const url = tab.url || '';
  if (isPlaceholderTabUrl(url) || isSuspendedPlaceholderUrl(url)) return;
  if (isChromeBlockedPageUrl(url)) return;
  if (!url.startsWith('http://') && !url.startsWith('https://')) return;
  const domains = await getActiveBlockerDomains();
  if (!domains.length || !sbUrlMatchesBlockedDomains(url, domains)) return;
  await rememberBlockerTabUrl(tab.id, url, tab.title);
  try {
    await chrome.tabs.reload(tab.id, { bypassCache: true });
  } catch (e) {
    console.warn('[SiteBlocker] enforce navigation block failed', tab.id, e);
  }
}

/** Recreate schedule alarm if Chrome dropped it (restart / update). */
async function ensureSiteBlockerAlarm() {
  try {
    const existing = await chrome.alarms.get(SITE_BLOCKER_SCHEDULE_ALARM);
    if (existing) return;
    await chrome.alarms.create(SITE_BLOCKER_SCHEDULE_ALARM, { periodInMinutes: SITE_BLOCKER_SCHEDULE_PERIOD_MINUTES });
  } catch (e) {
    console.warn('[SiteBlocker] ensureSiteBlockerAlarm failed', e);
  }
}

function runSiteBlockerApplyRules(options) {
  siteBlockerApplyChain = siteBlockerApplyChain
    .then(() => siteBlockerApplyRulesImpl(options))
    .catch((e) => console.warn('[SiteBlocker] applyRules failed', e));
  return siteBlockerApplyChain;
}

async function siteBlockerApplyAdsRulesets() {
  const { adsFiltersEnabled = true } = await chrome.storage.local.get('adsFiltersEnabled');
  const on = adsFiltersEnabled !== false;
  try {
    if (on) {
      await chrome.declarativeNetRequest.updateEnabledRulesets({
        enableRulesetIds: SB_ADS_RULESET_IDS,
        disableRulesetIds: [],
      });
    } else {
      await chrome.declarativeNetRequest.updateEnabledRulesets({
        enableRulesetIds: [],
        disableRulesetIds: SB_ADS_RULESET_IDS,
      });
    }
  } catch (e) {
    console.warn('[SiteBlocker] ads rulesets failed', e);
  }
}

async function siteBlockerApplyRules(options) {
  return runSiteBlockerApplyRules(options);
}

async function siteBlockerApplyRulesImpl({ enforceOpenTabs = false } = {}) {
  const {
    blocked = [],
    whitelist = [],
    enabled = true,
    schedule = SB_DEFAULT_SCHEDULE,
    scheduleStateActive: previousScheduleStateActive,
  } = await chrome.storage.local.get(['blocked', 'whitelist', 'enabled', 'schedule', 'scheduleStateActive']);
  let existing;
  try {
    existing = await chrome.declarativeNetRequest.getDynamicRules();
  } catch (e) {
    console.warn('[SiteBlocker] getDynamicRules failed', e);
    return;
  }
  const toRemove = existing.map((r) => r.id).filter((id) => id >= SITE_BLOCKER_RULE_ID_START);

  const normalizedSchedule = sbNormalizeSchedule(schedule);
  const scheduleActive = sbIsInSchedule(normalizedSchedule);
  await chrome.storage.local.set({ scheduleStateActive: scheduleActive, schedule: normalizedSchedule });

  const blockingWindowActive = enabled !== false && scheduleActive;

  if (!blockingWindowActive) {
    await preserveBlockedOpenTabs('blocking-off', { convertToPlaceholder: true });
    try {
      await chrome.declarativeNetRequest.updateEnabledRulesets({ disableRulesetIds: NETFILTER_RULESET_IDS });
    } catch (e) {
      console.warn('[SiteBlocker] disable NetFilter rulesets failed', e);
    }
    if (toRemove.length) {
      try {
        await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: toRemove });
      } catch (e) {
        console.warn('[SiteBlocker] remove dynamic rules failed', e);
      }
    }
    await chrome.storage.local.set({ lastBlockerApplyAt: Date.now(), lastBlockerApplyOk: true, blockerRuleCount: 0 });
    return;
  }

  try {
    await chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds: NETFILTER_RULESET_IDS });
  } catch (e) {
    console.warn('[SiteBlocker] enable NetFilter rulesets failed', e);
  }

  if (!blocked.length) {
    if (toRemove.length) {
      try {
        await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: toRemove });
      } catch (e) {
        console.warn('[SiteBlocker] clear dynamic rules failed', e);
      }
    }
    await chrome.storage.local.set({ lastBlockerApplyAt: Date.now(), lastBlockerApplyOk: true, blockerRuleCount: 0 });
    return;
  }

  const whitelistSet = new Set((whitelist || []).map(sbNormDomain).filter(Boolean));
  const seen = new Set();
  const domains = blocked.map(sbNormDomain).filter(Boolean).filter((d) => {
    if (seen.has(d) || whitelistSet.has(d)) return false;
    seen.add(d);
    return true;
  });

  if (!domains.length) {
    if (toRemove.length) {
      try {
        await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: toRemove });
      } catch (e) {
        console.warn('[SiteBlocker] clear dynamic rules (empty domains) failed', e);
      }
    }
    await chrome.storage.local.set({ lastBlockerApplyAt: Date.now(), lastBlockerApplyOk: true, blockerRuleCount: 0 });
    return;
  }

  const rules = domains.flatMap((d, i) => ([
    {
      id: SITE_BLOCKER_RULE_ID_START + i * 2,
      priority: 1,
      action: { type: 'block' },
      condition: {
        urlFilter: `*://${d}/*`,
        resourceTypes: ['main_frame', 'sub_frame'],
      },
    },
    {
      id: SITE_BLOCKER_RULE_ID_START + i * 2 + 1,
      priority: 1,
      action: { type: 'block' },
      condition: {
        urlFilter: `*://*.${d}/*`,
        resourceTypes: ['main_frame', 'sub_frame'],
      },
    },
  ]));

  try {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: toRemove, addRules: rules });
    await chrome.storage.local.set({
      lastBlockerApplyAt: Date.now(),
      lastBlockerApplyOk: true,
      blockerRuleCount: rules.length,
    });
  } catch (e) {
    console.warn('[SiteBlocker] updateDynamicRules failed', e);
    await chrome.storage.local.set({
      lastBlockerApplyAt: Date.now(),
      lastBlockerApplyOk: false,
      lastBlockerApplyError: (e && e.message) || String(e),
    });
    return;
  }

  const shouldSaveBlockedTabs = enforceOpenTabs
    || (previousScheduleStateActive === false && scheduleActive);
  if (shouldSaveBlockedTabs) {
    await maybeAutoSaveBlockedTabs(domains, enforceOpenTabs ? 'block-list-change' : 'schedule-on');
  }

  const shouldReloadOpenTabs = enforceOpenTabs
    || (previousScheduleStateActive === false && blockingWindowActive);
  const shouldPeriodicReload = !shouldReloadOpenTabs
    && blockingWindowActive
    && domains.length > 0
    && (Date.now() - lastBlockerOpenTabEnforceAt >= BLOCKER_OPEN_TAB_ENFORCE_MS);
  if (shouldReloadOpenTabs || shouldPeriodicReload) {
    if (shouldReloadOpenTabs) {
      await maybeAutoSaveBlockedTabs(domains, 'before-reload');
    }
    lastBlockerOpenTabEnforceAt = Date.now();
    await siteBlockerReloadBlockedOpenTabs(domains);
  }
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (changes.adsFiltersEnabled) siteBlockerApplyAdsRulesets();
  if (changes.blocked || changes.whitelist || changes.enabled || changes.schedule) {
    runSiteBlockerApplyRules({ enforceOpenTabs: true });
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const safeSend = (value) => {
    try {
      sendResponse(value);
    } catch (e) {
      console.warn('[TabHibernate] sendResponse failed', e);
    }
  };
  if (msg.type === 'activity') {
    const tabId = sender.tab?.id;
    if (tabId) markTabActive(tabId);
    safeSend({ ok: true });
    return true;
  }
  if (msg.type === 'rebindPlaceholderTab') {
    const tab = sender.tab;
    if (!tab?.id) {
      safeSend({ ok: false });
      return true;
    }
    rebindSinglePlaceholderTab(tab)
      .then((ok) => safeSend({ ok }))
      .catch(() => safeSend({ ok: false }));
    return true;
  }
  if (msg.type === 'resolvePlaceholderData') {
    const tab = sender.tab;
    if (!tab?.id) {
      safeSend(null);
      return true;
    }
    (async () => {
      await rebindSinglePlaceholderTab(tab).catch(() => {});
      let urlTabId = null;
      try {
        urlTabId = parseInt(new URL(tab.url || '').searchParams.get('tabId') || '', 10);
      } catch (_) {}
      const found = await findSuspendedStorageForPlaceholderTab(
        tab,
        Number.isNaN(urlTabId) ? null : urlTabId,
      );
      safeSend(found?.item || null);
    })().catch(() => safeSend(null));
    return true;
  }
  if (msg.type === 'getRestoreData') {
    const tabId = msg.tabId;
    chrome.storage.local.get(`suspended_${tabId}`).then((data) => {
      const key = `suspended_${tabId}`;
      safeSend(data[key] || null);
    }).catch((e) => {
      console.warn('[TabHibernate] getRestoreData failed', e);
      safeSend(null);
    });
    return true;
  }
  if (msg.type === 'backupNow') {
    runBackup('manual').then((res) => safeSend(res)).catch((e) => {
      console.warn('[TabHibernate] backupNow failed', e);
      safeSend({ count: 0, error: String(e.message) });
    });
    return true;
  }
  if (msg.type === 'getStats') {
    chrome.storage.local.get(['suspendedToday', 'suspendedTodayDate']).then((data) => {
      const today = new Date().toISOString().slice(0, 10);
      const count = data.suspendedTodayDate === today ? (data.suspendedToday || 0) : 0;
      safeSend({ suspendedToday: count });
    }).catch((e) => {
      console.warn('[TabHibernate] getStats failed', e);
      safeSend({ suspendedToday: 0 });
    });
    return true;
  }
  if (msg.type === 'getStatus') {
    Promise.all([
      chrome.storage.local.get(['suspendedToday', 'suspendedTodayDate', 'lastAlarmRun']),
      getEligibleTabsForBackup(),
      getHibernatedCount(),
    ]).then(async ([data, eligibleTabs, hibernatedCount]) => {
      const today = new Date().toISOString().slice(0, 10);
      const suspendedToday = data.suspendedTodayDate === today ? (data.suspendedToday || 0) : 0;
      await updateBadge(hibernatedCount);
      safeSend({
        suspendedToday,
        hibernatedCount,
        lastAlarmRun: data.lastAlarmRun || 0,
        eligibleTabCount: eligibleTabs.length,
        closedSavedMax: CLOSED_SAVED_MAX,
      });
    }).catch((e) => {
      console.warn('[TabHibernate] getStatus failed', e);
      safeSend({ suspendedToday: 0, hibernatedCount: 0, lastAlarmRun: 0, eligibleTabCount: 0, closedSavedMax: CLOSED_SAVED_MAX });
    });
    return true;
  }
  if (msg.type === 'getConstants') {
    safeSend({ closedSavedMax: CLOSED_SAVED_MAX });
    return true;
  }
  if (msg.type === 'clearRestoreData') {
    if (msg.tabId) chrome.storage.local.remove(`suspended_${msg.tabId}`);
    safeSend({ ok: true });
    return true;
  }
  if (msg.type === 'settingsUpdated') {
    getSettings()
      .then((s) => ensureAlarm(s.checkPeriodMinutes))
      .then(() => safeSend({ ok: true }))
      .catch(() => safeSend({ ok: false }));
    return true;
  }
  if (msg.type === 'removeSuspendedBookmark') {
    removeSuspendedBookmark(msg.url).then(() => safeSend({ ok: true })).catch(() => safeSend({ ok: false }));
    return true;
  }
  if (msg.type === 'suspendCurrentTab') {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) return safeSend({ ok: false, reason: 'No active tab' });
        const settings = await getSettings();
        if (!(await isTabEligibleForSuspend(tab, { allowActive: true, settings }))) {
          let reason = 'Cannot suspend this tab';
          if (tab.pinned && !settings.suspendPinnedTabs) reason = 'Tab is pinned (enable «Include pinned tabs» in Tab Hibernate)';
          else if (settings.skipGroupedInHibernate && isTabInGroup(tab)) reason = 'Tab is in a group (disable «Skip tabs in tab groups»)';
          else if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('chrome-extension://')) reason = 'System page cannot be suspended';
          return safeSend({ ok: false, reason });
        }
        if (isTabExcludedByDomain(tab, settings.excludedDomains)) {
          return safeSend({ ok: false, reason: 'This domain is excluded in settings' });
        }
        const mode = getSuspendModeForTab(settings, tab);
        if (mode === 'placeholder' && !hasRestorableUrl(tab.url)) {
          return safeSend({ ok: false, reason: 'Cannot suspend: page has no restorable URL' });
        }
        const ok = mode === 'discard'
          ? await suspendDiscard(tab.id)
          : await suspendPlaceholder(tab.id, tab.url, tab.title, tab.favIconUrl, {
            groupId: tab.groupId,
            windowId: tab.windowId,
          });
        safeSend({ ok });
      } catch (e) {
        console.warn('[TabHibernate] suspendCurrentTab failed', e);
        safeSend({ ok: false, reason: String(e.message) });
      }
    })();
    return true;
  }
  if (msg.type === 'suspendAllNow') {
    runSuspendAllNow().then((res) => safeSend(res)).catch((e) => {
      console.warn('[TabHibernate] suspendAllNow failed', e);
      safeSend({ suspended: 0, error: String(e.message) });
    });
    return true;
  }
  if (msg.type === 'openUrlsAsPlaceholders') {
    runOpenUrlsAsPlaceholders(msg.items || []).then((res) => safeSend(res)).catch((e) => {
      console.warn('[TabHibernate] openUrlsAsPlaceholders failed', e);
      safeSend({ opened: 0, error: String(e?.message || e) });
    });
    return true;
  }
  if (msg.type === 'recoverLostSuspended') {
    runRecoverLostSuspended().then((res) => safeSend(res)).catch((e) => {
      console.warn('[TabHibernate] recoverLostSuspended failed', e);
      safeSend({ recovered: 0, error: String(e.message) });
    });
    return true;
  }
  if (msg.type === 'searchLostTabsFromHistory') {
    searchLostTabsFromHistory({
      hoursBack: msg.hoursBack,
      onlyMissing: msg.onlyMissing !== false,
      maxResults: msg.maxResults,
      text: msg.text,
    }).then((res) => safeSend(res)).catch((e) => {
      console.warn('[TabHibernate] searchLostTabsFromHistory failed', e);
      safeSend({ items: [], error: String(e?.message || e) });
    });
    return true;
  }
  if (msg.type === 'recoverFromBrowserHistory') {
    runRecoverFromBrowserHistory({
      hoursBack: msg.hoursBack,
      onlyMissing: msg.onlyMissing !== false,
      maxResults: msg.maxResults,
      text: msg.text,
    }).then((res) => safeSend(res)).catch((e) => {
      console.warn('[TabHibernate] recoverFromBrowserHistory failed', e);
      safeSend({ recovered: 0, error: String(e?.message || e) });
    });
    return true;
  }
  if (msg.type === 'emergencyBackupNow') {
    runEmergencySessionBackup('manual').then((res) => safeSend(res)).catch((e) => {
      console.warn('[TabHibernate] emergencyBackupNow failed', e);
      safeSend({ count: 0, error: String(e?.message || e) });
    });
    return true;
  }
  if (msg.type === 'saveBlockedTabsNow') {
    (async () => {
      const { blocked = [], whitelist = [] } = await chrome.storage.local.get(['blocked', 'whitelist']);
      const wl = new Set((whitelist || []).map(sbNormDomain).filter(Boolean));
      const domains = (blocked || []).map(sbNormDomain).filter(Boolean).filter((d) => !wl.has(d));
      const res = await saveOpenTabsMatchingBlockedDomains(domains, 'manual');
      safeSend(res);
    })().catch((e) => {
      console.warn('[SiteBlocker] saveBlockedTabsNow failed', e);
      safeSend({ added: 0, error: String(e?.message || e) });
    });
    return true;
  }
  if (msg.type === 'restoreAllSuspended') {
    runRestoreAllSuspended().then((res) => safeSend(res)).catch((e) => {
      console.warn('[TabHibernate] restoreAllSuspended failed', e);
      safeSend({ restored: 0, error: String(e.message) });
    });
    return true;
  }
  if (msg.type === 'discardBackgroundTabs') {
    runDiscardBackgroundTabs().then((res) => safeSend(res)).catch((e) => {
      console.warn('[Memory] discard failed', e);
      safeSend({ discarded: 0, error: String(e.message) });
    });
    return true;
  }
  if (msg.type === 'closeAndSaveAll') {
    runCloseAndSaveAll().then(async (res) => {
      await chrome.storage.local.remove('closeAndSaveProgress');
      await updateBadge();
      safeSend(res);
    }).catch((e) => {
      console.warn('[TabHibernate] closeAndSaveAll failed', e);
      chrome.storage.local.remove('closeAndSaveProgress').catch(() => {});
      safeSend({ closed: 0, error: String(e.message) });
    });
    return true;
  }
  if (msg.type === 'closeAndSaveAllAsync') {
    startCloseAndSaveAllJob().then((res) => safeSend(res)).catch((e) => {
      console.warn('[TabHibernate] closeAndSaveAllAsync start failed', e);
      safeSend({ started: false, reason: String(e?.message || e) });
    });
    return true;
  }
  if (msg.type === 'saveTabGroup') {
    runSaveTabGroup({ closeTabs: false }).then((res) => safeSend(res)).catch((e) => {
      console.warn('[TabHibernate] saveTabGroup failed', e);
      safeSend({ saved: 0, error: String(e?.message || e) });
    });
    return true;
  }
  if (msg.type === 'closeTabGroupAndSave') {
    runSaveTabGroup({ closeTabs: true }).then((res) => safeSend(res)).catch((e) => {
      console.warn('[TabHibernate] closeTabGroupAndSave failed', e);
      safeSend({ saved: 0, closed: 0, error: String(e?.message || e) });
    });
    return true;
  }
  if (msg.type === 'prepareTabsForGrouping') {
    (async () => {
      for (const item of msg.items || []) {
        if (!item?.tabId || !item?.url) continue;
        await suspendPlaceholder(item.tabId, item.url, item.title || item.url, '', {
          windowId: item.windowId,
          skipFavicon: true,
          skipBookmark: true,
        });
      }
      safeSend({ ok: true });
    })().catch((e) => {
      console.warn('[TabHibernate] prepareTabsForGrouping failed', e);
      safeSend({ ok: false, error: String(e?.message || e) });
    });
    return true;
  }
  if (msg.type === 'syncPlaceholderGroupMeta') {
    syncSuspendedStorageGroupMetaForTabIds(msg.tabIds || [])
      .then(() => safeSend({ ok: true }))
      .catch((e) => safeSend({ ok: false, error: String(e?.message || e) }));
    return true;
  }
  if (msg.type === 'groupTabsByDomain') {
    runGroupTabsByDomain({
      allWindows: msg.allWindows === true,
      windowId: typeof msg.windowId === 'number' ? msg.windowId : null,
    }).then((res) => safeSend(res)).catch((e) => {
      console.warn('[TabHibernate] groupTabsByDomain failed', e);
      safeSend({ groupsCreated: 0, tabsGrouped: 0, error: String(e?.message || e) });
    });
    return true;
  }
  // Page Capture (Swiss Extensions)
  if (msg.type === 'getTiles') {
    const req = indexedDB.open('PdfCaptureDB', 1);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('capture', 'readwrite');
      const store = tx.objectStore('capture');
      const getReq = store.get('pending');
      getReq.onsuccess = () => {
        const data = getReq.result || {};
        store.delete('pending');
        tx.oncomplete = () => db.close();
        safeSend({ tiles: data.tiles || [], pageInfo: data.pageInfo || null, error: data.error || null });
      };
      getReq.onerror = () => { db.close(); safeSend({ tiles: [], pageInfo: null, error: 'Read error' }); };
    };
    req.onerror = () => safeSend({ tiles: [], pageInfo: null, error: 'IndexedDB unavailable' });
    req.onupgradeneeded = (e) => e.target.result.createObjectStore('capture');
    return true;
  }
  if (msg.type === 'capture') {
    (async () => {
      const SCROLL_DELAY_MS = 1500, FIRST_FRAME_DELAY_MS = 500;
      const cap = {
        getActiveTab: async () => { const [t] = await chrome.tabs.query({ active: true, currentWindow: true }); if (!t?.id) throw new Error('No active tab'); return t; },
        inject: (tid) => chrome.scripting.executeScript({ target: { tabId: tid }, files: ['content.js'] }),
        getPageHeight: (tid) => chrome.tabs.sendMessage(tid, { type: 'getPageHeight' }).then(r => r.height),
        getViewportHeight: (tid) => chrome.tabs.sendMessage(tid, { type: 'getViewportHeight' }).then(r => r.height),
        scrollTo: (tid, y) => chrome.tabs.sendMessage(tid, { type: 'scrollTo', y }),
        hideFloating: (tid) => chrome.tabs.sendMessage(tid, { type: 'hideFloating' }),
        showFloating: (tid) => chrome.tabs.sendMessage(tid, { type: 'showFloating' }).catch(() => {}),
      };
      const saveToIDB = (data) => new Promise((res, rej) => {
        const r = indexedDB.open('PdfCaptureDB', 1);
        r.onerror = () => rej(r.error);
        r.onsuccess = () => {
          const db = r.result;
          const tx = db.transaction('capture', 'readwrite');
          const store = tx.objectStore('capture');
          store.put(data, 'pending');
          tx.oncomplete = () => { db.close(); res(); };
          tx.onerror = () => { db.close(); rej(tx.error); };
        };
        r.onupgradeneeded = (e) => e.target.result.createObjectStore('capture');
      });
      let tabId = null;
      try {
        const tab = await cap.getActiveTab();
        tabId = tab.id;
        if (!tab.url) {
          await saveToIDB({ error: 'No open page.' });
          chrome.tabs.create({ url: chrome.runtime.getURL('result.html'), index: tab.index + 1, windowId: tab.windowId });
          safeSend({ error: 'No open page.' }); return;
        }
        await cap.inject(tabId);
        await new Promise(r => setTimeout(r, 200));
        await cap.hideFloating(tabId);
        await new Promise(r => setTimeout(r, 300));
        await cap.scrollTo(tabId, 0);
        await new Promise(r => setTimeout(r, 400));
        const [pageH, viewH] = await Promise.all([cap.getPageHeight(tabId), cap.getViewportHeight(tabId)]);
        const step = Math.max(1, Math.floor(viewH));
        const totalFrames = Math.ceil(pageH / step) || 1;
        const setProgress = (current) => {
          chrome.storage.local.set({ captureProgress: { total: totalFrames, current } });
        };
        setProgress(0);
        const tiles = [];
        let y = 0, first = true;
        while (y < pageH) {
          await cap.scrollTo(tabId, y);
          await new Promise(r => setTimeout(r, first ? FIRST_FRAME_DELAY_MS + SCROLL_DELAY_MS : SCROLL_DELAY_MS));
          tiles.push(await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }));
          setProgress(tiles.length);
          y += step; first = false;
        }
        await cap.showFloating(tabId);
        await chrome.storage.local.remove('captureProgress');
        await saveToIDB({ tiles, pageInfo: { url: tab.url, title: tab.title || '' } });
        chrome.tabs.create({ url: chrome.runtime.getURL('result.html'), index: tab.index + 1, windowId: tab.windowId });
        safeSend({ ok: true, count: tiles.length });
      } catch (e) {
        await chrome.storage.local.remove('captureProgress');
        if (tabId) try { await cap.showFloating(tabId); } catch (_) {}
        const errText = formatSwissCaptureError(e);
        await saveToIDB({ error: errText });
        let t = null; if (tabId) try { t = await chrome.tabs.get(tabId); } catch (_) {}
        chrome.tabs.create({ url: chrome.runtime.getURL('result.html'), windowId: t?.windowId });
        safeSend({ error: errText });
      }
    })();
    return true;
  }
  return false;
});

chrome.commands?.onCommand.addListener((command) => {
  if (command === 'discard-background-tabs') {
    runDiscardBackgroundTabs().catch((e) => console.warn('[Memory]', e));
    return;
  }
  if (command !== 'suspend-current-tab') return;
  chrome.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
    if (!tab || !tab.id) return;
    const settings = await getSettings();
    if (!(await isTabEligibleForSuspend(tab, { allowActive: true, settings }))) return;
    if (isTabExcludedByDomain(tab, settings.excludedDomains)) return;
    const mode = getSuspendModeForTab(settings, tab);
    if (mode === 'placeholder' && !hasRestorableUrl(tab.url)) return;
    if (mode === 'discard') await suspendDiscard(tab.id);
    else await suspendPlaceholder(tab.id, tab.url, tab.title, tab.favIconUrl, {
      groupId: tab.groupId,
      windowId: tab.windowId,
    });
  }).catch((e) => {
    console.warn('[TabHibernate] command suspend-current-tab failed', e);
  });
});

// SW wake: alarms + restore activity only. Migrate/rebind runs in onStartup/onInstalled.
(async () => {
  try {
    await ensureServiceWorkerReady();
    await runSiteBlockerApplyRules();
    await siteBlockerApplyAdsRulesets();
  } catch (e) {
    console.warn('[SwissExtensions] SW init failed', e);
  }
})();
