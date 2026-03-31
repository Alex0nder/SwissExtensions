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
/** Alarm: пересчёт правил пользовательского списка Site Blocker по расписанию. */
const SITE_BLOCKER_SCHEDULE_ALARM = 'swissSiteBlockerSchedule';

// Last activity per tabId (in memory + synced on messages). After SW sleep, memory is empty — restore from storage at start of onAlarmCheck.
let lastActivityByTab = new Map();
let lastPersistTime = 0;
const PERSIST_THROTTLE_MS = 4000;

async function getStoredState() {
  const raw = await chrome.storage.local.get(['lastActivityByTab', 'settings', 'suspendedToday', 'suspendedTodayDate']);
  if (raw.lastActivityByTab && typeof raw.lastActivityByTab === 'object') {
    const now = Date.now();
    lastActivityByTab = new Map(
      Object.entries(raw.lastActivityByTab)
        .map(([k, v]) => {
          const id = Number(k);
          const ts = typeof v === 'number' && !Number.isNaN(v) && v > 0 ? v : now;
          return [id, ts];
        })
        .filter(([id]) => !Number.isNaN(id))
    );
  }
  return raw;
}

async function persistLastActivity() {
  const now = Date.now();
  if (now - lastPersistTime < PERSIST_THROTTLE_MS) return;
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

/** Понятные сообщения об ошибках захвата страницы (как в PdfExtensions). */
function formatSwissCaptureError(e) {
  const m = (e && e.message) || String(e);
  const lower = m.toLowerCase();
  if (lower.includes('no active tab')) return 'Нет активной вкладки.';
  if (lower.includes('cannot access') || lower.includes('chrome://')) {
    return 'Эту страницу нельзя сканировать (системная или с ограничениями Chrome).';
  }
  if (lower.includes('chrome-extension://')) return 'Страницы расширений сканировать нельзя.';
  if (lower.includes('could not establish connection') || lower.includes('receiving end does not exist')) {
    return 'Не удалось подключиться к странице. Обновите вкладку и попробуйте снова.';
  }
  if (lower.includes('capturevisible') || lower.includes('cannot capture')) {
    return 'Снимок вкладки недоступен (страница или окно в неподходящем состоянии).';
  }
  return m.length > 160 ? `${m.slice(0, 157)}…` : m;
}

/** Tab в группе (Chrome Tab Groups): groupId !== -1. */
function isTabInGroup(tab) {
  return tab && tab.groupId != null && tab.groupId !== -1;
}

/**
 * Tab cannot be suspended: active, pinned, audible, system, incognito, in tab group, or already a placeholder.
 * allowActive: when true, allows suspending the active tab (e.g. "Suspend current" button).
 * Note: Both Discard and Placeholder unload the page; unsaved forms and SPA state may be lost (Chrome API limitation).
 */
async function isTabEligibleForSuspend(tab, { allowActive = false } = {}) {
  if (!tab || !tab.id) return false;
  if (tab.active && !allowActive) return false;
  if (tab.pinned) return false;
  if (tab.audible) return false;
  if (tab.incognito) return false;
  if (isTabInGroup(tab)) return false;
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
    mode: ['placeholder', 'smart', 'discard'].includes(s.mode) ? s.mode : 'discard',
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
  const placeholderCount = tabs.filter((tab) => tab.url && isPlaceholderTabUrl(tab.url)).length;
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

/** Placeholder mode: save url+title, redirect to suspended.html. Add fallback param u (URL) in query so stub can restore if storage is lost. */
/** Макс длина закодированного URL в query (u param). Слишком длинные — без fallback при потере storage. */
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

async function suspendPlaceholder(tabId, url, title, favIconUrl) {
  try {
    await chrome.tabs.get(tabId);
  } catch (e) {
    return false;
  }
  const safeUrl = url || '';
  const favIconDataUrl = await toDataUrlFromImageUrl(favIconUrl || '');
  const restoreKey = `suspended_${tabId}`;
  await chrome.storage.local.set({
    [restoreKey]: { url: safeUrl, title: title || '', favIconUrl: favIconDataUrl || favIconUrl || '', tabId },
  });
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
  const params = new URLSearchParams({ tabId: String(tabId) });
  if (safeUrl && encodeURIComponent(safeUrl).length <= PLACEHOLDER_URL_PARAM_MAX) {
    params.set('u', safeUrl);
  }
  const suspendedUrl = chrome.runtime.getURL('suspended.html') + '?' + params.toString();
  try {
    await chrome.tabs.update(tabId, { url: suspendedUrl });
    await incrementSuspendedToday();
    return true;
  } catch (e) {
    console.warn('[TabHibernate] placeholder redirect failed', tabId, e);
    await chrome.storage.local.remove(restoreKey);
    return false;
  }
}

/** Get all tabs eligible for backup (same rules as suspend, minus inactivity check). Skip grouped tabs. */
async function getEligibleTabsForBackup() {
  const tabs = await chrome.tabs.query({});
  const eligible = [];
  for (const tab of tabs) {
    if (!tab.url || !tab.id) continue;
    if (isTabInGroup(tab)) continue;
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
    if (seen.has(t.url)) return false;
    seen.add(t.url);
    return true;
  });
  if (unique.length === 0) return { count: 0, folderId: null, folderPath: null };

  const dateStr = new Date().toISOString().slice(0, 10);
  const folderId = await getOrCreateBackupFolder();
  const folderPath = `Tab Backup / ${dateStr}`;

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
  const existingUrls = new Set(list.map((x) => x.url));
  for (const t of unique) {
    if (!existingUrls.has(t.url)) {
      list.push({ url: t.url, title: t.title || t.url, ts: Date.now() });
      existingUrls.add(t.url);
    }
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

async function pruneStaleSuspendedEntries() {
  try {
    const [all, tabs] = await Promise.all([
      chrome.storage.local.get(null),
      chrome.tabs.query({}),
    ]);
    const aliveIds = new Set(tabs.map((t) => t.id));
    const keysToRemove = [];
    for (const key of Object.keys(all)) {
      if (!key.startsWith('suspended_')) continue;
      const id = Number(key.slice('suspended_'.length));
      if (!Number.isInteger(id) || !aliveIds.has(id)) keysToRemove.push(key);
    }
    if (keysToRemove.length > 0) await chrome.storage.local.remove(keysToRemove);
  } catch (e) {
    console.warn('[TabHibernate] pruneStaleSuspendedEntries failed', e);
  }
}

/** Задержка между операциями при массовом suspend — снижает риск зависания браузера. */
const SUSPEND_BATCH_DELAY_MS = 80;

/** Manually suspend all eligible tabs (no inactivity timeout check). Batched with delay to avoid browser freeze. */
async function runSuspendAllNow() {
  await getStoredState();
  const settings = await getSettings();
  const tabs = await chrome.tabs.query({});
  const toBackup = [];
  let suspended = 0;
  for (const tab of tabs) {
    if (!(await isTabEligibleForSuspend(tab))) continue;
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
      const ok = await suspendPlaceholder(tab.id, tab.url, tab.title, tab.favIconUrl);
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
  return { suspended };
}

/** Получить URL из placeholder-вкладки: storage или ?u= в URL. */
async function getPlaceholderRestoreUrl(tab) {
  if (!tab?.url || !isPlaceholderTabUrl(tab.url)) return null;
  try {
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

/** Закрыть все подходящие вкладки (включая placeholder) и сохранить URL в closedAndSaved. Без дубликатов по URL. */
const CLOSED_SAVED_MAX = 2000;
async function runCloseAndSaveAll() {
  const tabs = await chrome.tabs.query({});
  const toSave = [];
  const idsToClose = [];
  const seenUrls = new Set();
  for (const tab of tabs) {
    let url = '';
    let title = '';
    if (isPlaceholderTabUrl(tab.url)) {
      url = await getPlaceholderRestoreUrl(tab) || '';
      title = (tab.title || url || '').slice(0, 512);
    } else if (await isTabEligibleForSuspend(tab)) {
      url = tab.url || '';
      title = (tab.title || tab.url || '').slice(0, 512);
    } else {
      continue;
    }
    if (!url) continue;
    if (seenUrls.has(url)) {
      idsToClose.push(tab.id);
      continue;
    }
    seenUrls.add(url);
    toSave.push({ url, title, savedAt: Date.now() });
    idsToClose.push(tab.id);
  }
  if (idsToClose.length === 0) return { closed: 0 };
  const { closedAndSaved = [] } = await chrome.storage.local.get('closedAndSaved');
  const mergedUrls = new Set(toSave.map((x) => x.url));
  const uniqueExisting = closedAndSaved.filter((x) => x.url && !mergedUrls.has(x.url));
  const merged = [...toSave.reverse(), ...uniqueExisting].slice(0, CLOSED_SAVED_MAX);
  await chrome.storage.local.set({ closedAndSaved: merged });
  const CLOSE_BATCH_DELAY_MS = 50;
  for (let i = 0; i < idsToClose.length; i++) {
    try { await chrome.tabs.remove(idsToClose[i]); } catch (e) { console.warn('[TabHibernate] tab remove failed', idsToClose[i], e); }
    if ((i + 1) % 30 === 0 && i + 1 < idsToClose.length) {
      await new Promise((r) => setTimeout(r, CLOSE_BATCH_DELAY_MS));
    }
  }
  return { closed: idsToClose.length };
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

/** Discard background tabs — настройки как в TabMemoryCleaner (`tmcSettings`). */
const DISCARD_DELAY_MS = 300;
const TMC_DEFAULT_SETTINGS = {
  skipPinned: true,
  skipAudible: true,
  skipIncognito: true,
  skipGrouped: true,
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
 * Восстановить утерянные вкладки из storage + bookmarks (survives reinstall).
 * Создаёт placeholder-вкладки (suspended.html), а не загружает страницы — экономия RAM и CPU при 100+ вкладках.
 * Страница загрузится только при клике «Restore» пользователем.
 */
const RECOVER_DELAY_MS = 60;

async function runRecoverLostSuspended() {
  const seen = new Set();
  const items = []; // { url, title }
  const keysToRemove = [];

  const all = await chrome.storage.local.get(null);
  for (const [key, val] of Object.entries(all)) {
    if (!key.startsWith('suspended_') || key === 'suspendedToday' || key === 'suspendedTodayDate') continue;
    const item = val && typeof val === 'object' ? val : null;
    const url = item && item.url && (item.url.startsWith('http') || item.url.startsWith('file'));
    if (url && !seen.has(item.url)) {
      seen.add(item.url);
      items.push({ url: item.url, title: item.title || '' });
      keysToRemove.push(key);
    }
  }

  try {
    const folderId = await getOrCreateSuspendedRecoveryFolder();
    const children = await chrome.bookmarks.getChildren(folderId);
    for (const bm of children) {
      if (bm.url && !seen.has(bm.url)) {
        seen.add(bm.url);
        items.push({ url: bm.url, title: bm.title || '' });
      }
    }
  } catch (_) {}

  for (const { url, title } of items) {
    const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
    const params = new URLSearchParams({ tabId: String(tab.id) });
    if (url && encodeURIComponent(url).length <= PLACEHOLDER_URL_PARAM_MAX) params.set('u', url);
    const suspendedUrl = chrome.runtime.getURL('suspended.html') + '?' + params.toString();
    await chrome.storage.local.set({ [`suspended_${tab.id}`]: { url, title, favIconUrl: '', tabId: tab.id } });
    await chrome.tabs.update(tab.id, { url: suspendedUrl });
    if (items.length > 10) await new Promise((r) => setTimeout(r, RECOVER_DELAY_MS));
  }

  await chrome.storage.local.remove(keysToRemove);
  await updateBadge();
  return { recovered: items.length };
}

/** Открыть URL как placeholder-вкладки (заблокированные). items: [{url, title}]. */
async function runOpenUrlsAsPlaceholders(items) {
  if (!items || !items.length) return { opened: 0 };
  const valid = items.filter((x) => x && x.url && (x.url.startsWith('http') || x.url.startsWith('file')));
  for (const { url, title } of valid) {
    const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
    const params = new URLSearchParams({ tabId: String(tab.id) });
    if (url && encodeURIComponent(url).length <= PLACEHOLDER_URL_PARAM_MAX) params.set('u', url);
    const suspendedUrl = chrome.runtime.getURL('suspended.html') + '?' + params.toString();
    await chrome.storage.local.set({ [`suspended_${tab.id}`]: { url, title: title || '', favIconUrl: '', tabId: tab.id } });
    await chrome.tabs.update(tab.id, { url: suspendedUrl });
    if (valid.length > 10) await new Promise((r) => setTimeout(r, RECOVER_DELAY_MS));
  }
  await updateBadge();
  return { opened: valid.length };
}

/** Main alarm check: suspend inactive tabs and backup if needed. */
async function onAlarmCheck() {
  try {
    await chrome.storage.local.set({ lastAlarmRun: Date.now() });
    await getStoredState();
    await pruneStaleTabIds();
    await pruneStaleSuspendedEntries();
    await pruneOldBackups();

    const settings = await getSettings();
    await ensureAlarm(settings.checkPeriodMinutes);
    if (!settings.enabled) return;

    const tabs = await chrome.tabs.query({});
    const now = Date.now();
    let needPersist = false;
    for (const tab of tabs) {
      if (tab.id && !lastActivityByTab.has(tab.id)) {
        lastActivityByTab.set(tab.id, now);
        needPersist = true;
      }
    }
    if (needPersist) await persistLastActivity();

    const toBackup = [];
    let suspendedThisRun = 0;
    for (const tab of tabs) {
      if (!(await isTabEligibleForSuspend(tab))) continue;
      if (isTabExcludedByDomain(tab, settings.excludedDomains)) continue;
      if (!isTabInactive(tab.id, settings.timeoutMinutes)) continue;
      const mode = getSuspendModeForTab(settings, tab);
      if (mode === 'placeholder' && !hasRestorableUrl(tab.url)) continue;

      if (mode === 'discard') {
        const ok = await suspendDiscard(tab.id);
        if (ok) { toBackup.push({ url: tab.url, title: tab.title }); suspendedThisRun++; }
      } else {
        const ok = await suspendPlaceholder(tab.id, tab.url, tab.title, tab.favIconUrl);
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

/** После обновления/переустановки: вкладки с suspended от старого extension ID — мигрировать на наш. */
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
        const tabId = u.searchParams.get('tabId');
        const fallback = u.searchParams.get('u');
        if (!tabId || !fallback) continue;
        if (u.origin === ourOrigin) continue;
        const newUrl = chrome.runtime.getURL('suspended.html') + '?tabId=' + tab.id + '&u=' + encodeURIComponent(fallback);
        await chrome.storage.local.set({ [`suspended_${tab.id}`]: { url: fallback, title: '', favIconUrl: '', tabId: tab.id } });
        await chrome.tabs.update(tab.id, { url: newUrl });
      } catch (e) {
        console.warn('[TabHibernate] migrate tab failed', tab.id, e);
      }
    }
  } catch (e) {
    console.warn('[TabHibernate] migrateOrphanedSuspendedTabs failed', e);
  }
}

async function initOnStartup() {
  try {
    await migrateOrphanedSuspendedTabs();
  } catch (e) {
    console.warn('[TabHibernate] migrateOrphanedSuspendedTabs failed', e);
  }
  try {
    const settings = await getSettings();
    await ensureAlarm(settings.checkPeriodMinutes);
    await getStoredState();
    await pruneStaleSuspendedEntries();
    const tabs = await chrome.tabs.query({});
    const now = Date.now();
    for (const tab of tabs) {
      if (tab.id && tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
        lastActivityByTab.set(tab.id, now);
      }
    }
    await persistLastActivity();
    await updateBadge();
    await chrome.alarms.create(SITE_BLOCKER_SCHEDULE_ALARM, { periodInMinutes: 1 }).catch(() => {});
  } catch (e) {
    console.warn('[TabHibernate] initOnStartup failed', e);
  }
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
    await new Promise((r) => setTimeout(r, 1500));
    await initOnStartup();
    await siteBlockerApplyRules();
  } catch (e) {
    console.error('[SwissExtensions] onStartup failed', e);
  }
});
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
        },
      });
    }
    await setSidePanelBehavior();
    await initOnStartup();
    await siteBlockerApplyRules();
    if (details.reason === 'update') {
      setTimeout(() => migrateOrphanedSuspendedTabs().catch((e) => console.warn('[TabHibernate] delayed migrate failed', e)), 800);
    }
  } catch (e) {
    console.error('[SwissExtensions] onInstalled failed', e);
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_CHECK_NAME) onAlarmCheck();
  if (alarm.name === SITE_BLOCKER_SCHEDULE_ALARM) siteBlockerApplyRules();
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  markTabActive(activeInfo.tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.audible !== undefined || changeInfo.pinned !== undefined) {
    lastActivityByTab.set(tabId, Date.now());
    persistLastActivity();
  }
});

chrome.tabs.onCreated.addListener((tab) => {
  if (tab.id) markTabActive(tab.id);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  lastActivityByTab.delete(tabId);
  persistLastActivity();
  chrome.storage.local.remove(`suspended_${tabId}`);
  updateBadge();
});

/** Badge updates when closedAndSaved changes (import/clear on History page). */
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.closedAndSaved) updateBadge();
});

/** Site Blocker: static rulesets + пользовательский список (расписание и whitelist — как в standalone SiteBlocker). */
const SITE_BLOCKER_RULE_ID_START = 10000;
const NETFILTER_RULESET_IDS = ['ruleset_1', 'ruleset_2', 'ruleset_3', 'ruleset_4', 'ruleset_5', 'ruleset_6'];
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

async function siteBlockerApplyRules() {
  const {
    blocked = [],
    whitelist = [],
    enabled = true,
    schedule = SB_DEFAULT_SCHEDULE,
  } = await chrome.storage.local.get(['blocked', 'whitelist', 'enabled', 'schedule']);
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const toRemove = existing.map((r) => r.id).filter((id) => id >= SITE_BLOCKER_RULE_ID_START);

  const normalizedSchedule = sbNormalizeSchedule(schedule);
  const scheduleActive = sbIsInSchedule(normalizedSchedule);
  await chrome.storage.local.set({ scheduleStateActive: scheduleActive, schedule: normalizedSchedule });

  if (!enabled) {
    try {
      await chrome.declarativeNetRequest.updateEnabledRulesets({ disableRulesetIds: NETFILTER_RULESET_IDS });
    } catch (e) {
      console.warn('[SiteBlocker] disable NetFilter rulesets failed', e);
    }
    if (toRemove.length) await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: toRemove });
    return;
  }

  try {
    await chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds: NETFILTER_RULESET_IDS });
  } catch (e) {
    console.warn('[SiteBlocker] enable NetFilter rulesets failed', e);
  }

  if (!blocked.length || !scheduleActive) {
    if (toRemove.length) await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: toRemove });
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
    if (toRemove.length) await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: toRemove });
    return;
  }

  const rules = domains.map((d, i) => ({
    id: SITE_BLOCKER_RULE_ID_START + i,
    priority: 1,
    action: { type: 'block' },
    condition: { urlFilter: `*://*.${d}/*`, resourceTypes: ['main_frame', 'sub_frame'] },
  }));
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: toRemove, addRules: rules });
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && (changes.blocked || changes.whitelist || changes.enabled || changes.schedule)) {
    siteBlockerApplyRules();
  }
});

/** On tab URL change (e.g. single-tab restore) refresh badge. */
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) updateBadge();
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
    getSettings().then((s) => ensureAlarm(s.checkPeriodMinutes)).then(() => safeSend({ ok: true })).catch(() => safeSend({ ok: false }));
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
        if (!(await isTabEligibleForSuspend(tab, { allowActive: true }))) {
          const reason = tab.pinned ? 'Tab is pinned' : tab.url?.startsWith('chrome://') || tab.url?.startsWith('chrome-extension://')
            ? 'System page cannot be suspended' : 'Cannot suspend this tab';
          return safeSend({ ok: false, reason });
        }
        const settings = await getSettings();
        if (isTabExcludedByDomain(tab, settings.excludedDomains)) {
          return safeSend({ ok: false, reason: 'This domain is excluded in settings' });
        }
        const mode = getSuspendModeForTab(settings, tab);
        if (mode === 'placeholder' && !hasRestorableUrl(tab.url)) {
          return safeSend({ ok: false, reason: 'Cannot suspend: page has no restorable URL' });
        }
        const ok = mode === 'discard'
          ? await suspendDiscard(tab.id)
          : await suspendPlaceholder(tab.id, tab.url, tab.title, tab.favIconUrl);
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
      await updateBadge();
      safeSend(res);
    }).catch((e) => {
      console.warn('[TabHibernate] closeAndSaveAll failed', e);
      safeSend({ closed: 0, error: String(e.message) });
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
          await saveToIDB({ error: 'Нет открытой страницы.' });
          chrome.tabs.create({ url: chrome.runtime.getURL('result.html'), index: tab.index + 1, windowId: tab.windowId });
          safeSend({ error: 'Нет открытой страницы.' }); return;
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
    if (!(await isTabEligibleForSuspend(tab, { allowActive: true }))) return;
    const settings = await getSettings();
    if (isTabExcludedByDomain(tab, settings.excludedDomains)) return;
    const mode = getSuspendModeForTab(settings, tab);
    if (mode === 'placeholder' && !hasRestorableUrl(tab.url)) return;
    if (mode === 'discard') await suspendDiscard(tab.id);
    else await suspendPlaceholder(tab.id, tab.url, tab.title, tab.favIconUrl);
  }).catch((e) => {
    console.warn('[TabHibernate] command suspend-current-tab failed', e);
  });
});

// Init on first SW run (after sleep)
initOnStartup();
