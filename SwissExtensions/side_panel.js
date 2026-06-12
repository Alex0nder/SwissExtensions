/**
 * Swiss Extensions — blocks UI: click block to open, Back to return.
 */

function showView(viewId) {
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  const el = document.getElementById('view-' + viewId);
  if (el) el.classList.add('active');
}

document.querySelectorAll('.block[data-block]').forEach((b) => {
  b.addEventListener('click', () => showView(b.dataset.block));
});
document.querySelectorAll('.back-btn[data-back]').forEach((b) => {
  b.addEventListener('click', () => showView('home'));
});

// Capture —   storage.onChanged
document.getElementById('btnCapture').addEventListener('click', () => {
  const st = document.getElementById('captureStatus');
  const btn = document.getElementById('btnCapture');
  const progEl = document.getElementById('captureProgress');
  const fillEl = document.getElementById('captureProgressFill');
  btn.disabled = true;
  st.textContent = 'Scanning...';
  st.className = '';
  progEl.classList.add('visible');
  fillEl.style.width = '0%';

  const onProgress = (changes, areaName) => {
    if (areaName !== 'local' || !changes.captureProgress?.newValue) return;
    const { total, current } = changes.captureProgress.newValue;
    const pct = total > 0 ? Math.round((current / total) * 100) : 0;
    fillEl.style.width = pct + '%';
    st.textContent = `Frame ${current} of ${total}…`;
  };

  const cleanup = () => {
    chrome.storage.onChanged.removeListener(onProgress);
    chrome.storage.local.remove('captureProgress');
    progEl.classList.remove('visible');
    fillEl.style.width = '0%';
    btn.disabled = false;
  };

  chrome.storage.onChanged.addListener(onProgress);

  chrome.runtime.sendMessage({ type: 'capture' }, (res) => {
    cleanup();
    if (chrome.runtime.lastError) {
      st.textContent = chrome.runtime.lastError.message || 'Error';
      st.className = 'err';
      return;
    }
    if (res?.error) { st.textContent = res.error; st.className = 'err'; }
    else if (res?.ok) st.textContent = 'Screenshots page opened.';
    else st.textContent = 'No frames.';
  });
});

// Tab Hibernate
const el = {
  enabled: document.getElementById('thEnabled'),
  timeout: document.getElementById('thTimeout'),
  mode: document.getElementById('thMode'),
  checkPeriod: document.getElementById('thCheckPeriod'),
  excludedDomains: document.getElementById('thExcludedDomains'),
  smartRulesEnabled: document.getElementById('thSmartRulesEnabled'),
  smartDefaultMode: document.getElementById('thSmartDefaultMode'),
  smartHeuristicsFallback: document.getElementById('thSmartHeuristicsFallback'),
  smartPlaceholderDomains: document.getElementById('thSmartPlaceholderDomains'),
  smartDiscardDomains: document.getElementById('thSmartDiscardDomains'),
  suspendPinned: document.getElementById('thSuspendPinned'),
  skipGroupedHibernate: document.getElementById('thSkipGroupedHibernate'),
  backup: document.getElementById('thBackup'),
  suspendCurrent: document.getElementById('thSuspendCurrent'),
  suspendAll: document.getElementById('thSuspendAll'),
  restoreAll: document.getElementById('thRestoreAll'),
  saveTabGroup: document.getElementById('thSaveTabGroup'),
  groupByDomain: document.getElementById('thGroupByDomain'),
  groupByDomainAllWindows: document.getElementById('thGroupByDomainAllWindows'),
  closeTabGroupSave: document.getElementById('thCloseTabGroupSave'),
  closeSave: document.getElementById('thCloseSave'),
  history: document.getElementById('thHistory'),
  stats: document.getElementById('thStats'),
};

function send(msg, retries = 3) {
  return new Promise((res, rej) => {
    const trySend = (n) => {
      chrome.runtime.sendMessage(msg, (r) => {
        if (chrome.runtime.lastError) {
          if (n < retries) setTimeout(() => trySend(n + 1), 500);
          else rej(new Error(chrome.runtime.lastError.message));
        } else res(r);
      });
    };
    trySend(0);
  });
}

/**
 * Group tabs that share the same page URL in the current window.
 * URL key matches History/save dedupe: host + path + query; hash (#) ignored.
 */
const TH_GROUP_COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];
const TH_BLOCKER_TAB_URL_KEY = 'blockerTabUrlByTabId';

/** Normalize URL to a stable grouping/dedupe key (same rules as service_worker urlKeyForHistory). */
function thUrlKey(url) {
  if (!url) return '';
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

/** Chrome tab group title derived from URL key (truncated). */
function thGroupTitleFromUrlKey(urlKey) {
  if (!urlKey) return '';
  if (urlKey.startsWith('file:')) return 'local files';
  return urlKey.slice(0, 256);
}

/** True for Site Blocker / network error pages (need URL resolution before grouping). */
function thIsChromeErrorUrl(url) {
  return Boolean(url && (url.startsWith('chrome-error://') || url.startsWith('chrome://network-error/')));
}

/** True for Tab Hibernate suspended.html placeholder tabs. */
function thIsSuspendedPlaceholder(url) {
  if (!url) return false;
  try {
    return new URL(url).pathname.endsWith('suspended.html');
  } catch (_) {
    return false;
  }
}

/** Normalize blocked-domain string from settings. */
function thNormBlockedDomain(d) {
  let s = String(d || '').trim().toLowerCase();
  if (!s) return '';
  s = s.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].split('?')[0];
  return s;
}

/** Deterministic tab group color from URL key seed. */
function thPickGroupColor(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (Math.imul(31, h) + seed.charCodeAt(i)) >>> 0;
  return TH_GROUP_COLORS[h % TH_GROUP_COLORS.length];
}

/** Ungrouped tabs we can bucket: placeholders, chrome-error, normal http(s); skip chrome:// etc. */
function thIsEligibleForGrouping(tab) {
  if (!tab?.id || (tab.groupId != null && tab.groupId !== -1)) return false;
  const lower = (tab.url || '').toLowerCase();
  if (thIsSuspendedPlaceholder(tab.url) || thIsChromeErrorUrl(tab.url)) return true;
  if (
    lower.startsWith('chrome://')
    || lower.startsWith('chrome-extension://')
    || lower.startsWith('edge://')
    || lower.startsWith('about:')
    || lower.startsWith('devtools://')
  ) return false;
  return true;
}

/** One storage read: blocker URL map, blocked domains, suspended_* payloads for open tabs. */
async function thBuildGroupingContext(tabs) {
  const stored = await chrome.storage.local.get([TH_BLOCKER_TAB_URL_KEY, 'blocked']);
  const blockerMap = stored[TH_BLOCKER_TAB_URL_KEY] || {};
  const blockedList = [...new Set((stored.blocked || []).map(thNormBlockedDomain).filter(Boolean))];
  const suspendKeys = new Set();
  for (const tab of tabs) {
    if (!tab?.id || !thIsSuspendedPlaceholder(tab.url)) continue;
    suspendKeys.add(`suspended_${tab.id}`);
    try {
      const tid = new URL(tab.url).searchParams.get('tabId');
      if (tid) suspendKeys.add(`suspended_${tid}`);
    } catch (_) {}
  }
  const suspendedData = suspendKeys.size
    ? await chrome.storage.local.get([...suspendKeys])
    : {};
  return { blockerMap, suspendedData, blockedList };
}

/** Real page URL for grouping: live tab URL, suspended payload, or pre-block URL from storage. */
function thResolvePageUrl(tab, ctx) {
  if (!tab?.id) return '';
  let url = tab.pendingUrl || tab.url || '';
  if (thIsSuspendedPlaceholder(url)) {
    try {
      const byId = ctx.suspendedData[`suspended_${tab.id}`];
      if (byId?.url) url = byId.url;
      else {
        const u = new URL(tab.url);
        const tid = u.searchParams.get('tabId');
        const byTid = tid ? ctx.suspendedData[`suspended_${tid}`] : null;
        if (byTid?.url) url = byTid.url;
        else {
          const fallback = u.searchParams.get('u');
          if (fallback && (fallback.startsWith('http') || fallback.startsWith('file'))) url = fallback;
        }
      }
    } catch (_) {}
  }
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  const remembered = ctx.blockerMap[String(tab.id)];
  if (remembered?.url?.startsWith('http')) return remembered.url;
  return '';
}

/** URL key for one tab; chrome-error falls back to single blocked domain or title match. */
function thUrlKeyForTab(tab, ctx) {
  const resolved = thResolvePageUrl(tab, ctx);
  const live = tab.pendingUrl || tab.url || '';
  for (const candidate of [resolved, live]) {
    if (!candidate || thIsChromeErrorUrl(candidate) || thIsSuspendedPlaceholder(candidate)) continue;
    const key = thUrlKey(candidate);
    if (key) return key;
  }
  if (!thIsChromeErrorUrl(tab.url || '')) return '';
  if (ctx.blockedList.length === 1) return thUrlKey(`https://${ctx.blockedList[0]}/`);
  const title = (tab.title || '').toLowerCase();
  const hits = ctx.blockedList.filter((d) => title.includes(d));
  if (hits.length === 1) return thUrlKey(`https://${hits[0]}/`);
  return '';
}

/** Bucket ungrouped tabs by window + URL key, create Chrome groups; retry after SW converts chrome-error tabs. */
async function thGroupTabsByDomain(allWindows) {
  const tabs = await chrome.tabs.query(allWindows ? {} : { currentWindow: true });
  const ctx = await thBuildGroupingContext(tabs);
  const buckets = new Map();

  for (const tab of tabs) {
    if (!thIsEligibleForGrouping(tab)) continue;
    const urlKey = thUrlKeyForTab(tab, ctx);
    if (!urlKey) continue;
    const key = `${tab.windowId}:${urlKey}`;
    if (!buckets.has(key)) buckets.set(key, { urlKey, tabs: [] });
    buckets.get(key).tabs.push(tab);
  }

  let groupsCreated = 0;
  let tabsGrouped = 0;

  for (const { urlKey, tabs: urlTabs } of buckets.values()) {
    if (urlTabs.length < 2) continue;
    urlTabs.sort((a, b) => a.index - b.index);
    const tabIds = urlTabs.map((t) => t.id);
    const title = thGroupTitleFromUrlKey(urlKey);

    const applyGroup = async () => {
      const groupId = await chrome.tabs.group({ tabIds });
      await chrome.tabGroups.update(groupId, {
        title,
        color: thPickGroupColor(urlKey),
      });
      groupsCreated += 1;
      tabsGrouped += tabIds.length;
    };

    try {
      await applyGroup();
    } catch (_) {
      const errTabs = urlTabs.filter((t) => thIsChromeErrorUrl(t.url || ''));
      if (!errTabs.length) continue;
      await send({
        type: 'prepareTabsForGrouping',
        items: errTabs.map((t) => ({
          tabId: t.id,
          url: thResolvePageUrl(t, ctx) || `https://${urlKey.split('/')[0]}/`,
          title: t.title || title,
          windowId: t.windowId,
        })),
      });
      try {
        await applyGroup();
      } catch (e2) {
        console.warn('[TabHibernate] group by url failed', urlKey, e2);
      }
    }
  }

  return { groupsCreated, tabsGrouped, pairs: buckets.size };
}

async function loadThSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  if (settings) {
    el.enabled.checked = settings.enabled !== false;
    el.timeout.value = String(settings.timeoutMinutes ?? 5);
    el.mode.value = ['placeholder', 'smart', 'discard'].includes(settings.mode) ? settings.mode : 'placeholder';
    if (el.checkPeriod) el.checkPeriod.value = ['1', '2', '5'].includes(String(settings.checkPeriodMinutes)) ? String(settings.checkPeriodMinutes) : '1';
    if (el.excludedDomains) el.excludedDomains.value = Array.isArray(settings.excludedDomains) ? settings.excludedDomains.join('\n') : '';
    if (el.smartRulesEnabled) el.smartRulesEnabled.checked = settings.smartRulesEnabled === true;
    if (el.smartDefaultMode) el.smartDefaultMode.value = settings.smartDefaultMode === 'placeholder' ? 'placeholder' : 'discard';
    if (el.smartHeuristicsFallback) el.smartHeuristicsFallback.checked = settings.smartUseHeuristicsFallback !== false;
    if (el.smartPlaceholderDomains) el.smartPlaceholderDomains.value = Array.isArray(settings.smartPlaceholderDomains) ? settings.smartPlaceholderDomains.join('\n') : '';
    if (el.smartDiscardDomains) el.smartDiscardDomains.value = Array.isArray(settings.smartDiscardDomains) ? settings.smartDiscardDomains.join('\n') : '';
    if (el.suspendPinned) el.suspendPinned.checked = settings.suspendPinnedTabs !== false;
    if (el.skipGroupedHibernate) el.skipGroupedHibernate.checked = settings.skipGroupedInHibernate === true;
  }
}

function normalizeDomainsInput(value) {
  return String(value || '')
    .split('\n')
    .map((line) => line.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
    .filter(Boolean)
    .filter((line, idx, arr) => arr.indexOf(line) === idx);
}

function saveThSettings() {
  const excludedDomains = normalizeDomainsInput(el.excludedDomains?.value);
  const smartPlaceholderDomains = normalizeDomainsInput(el.smartPlaceholderDomains?.value);
  let smartDiscardDomains = normalizeDomainsInput(el.smartDiscardDomains?.value);
  smartDiscardDomains = smartDiscardDomains.filter((d) => !smartPlaceholderDomains.includes(d));
  if (el.excludedDomains) el.excludedDomains.value = excludedDomains.join('\n');
  if (el.smartPlaceholderDomains) el.smartPlaceholderDomains.value = smartPlaceholderDomains.join('\n');
  if (el.smartDiscardDomains) el.smartDiscardDomains.value = smartDiscardDomains.join('\n');
  chrome.storage.local.set({
    settings: {
      enabled: el.enabled.checked,
      timeoutMinutes: parseInt(el.timeout.value, 10) || 5,
      checkPeriodMinutes: parseInt(el.checkPeriod?.value, 10) || 1,
      excludedDomains,
      smartRulesEnabled: el.smartRulesEnabled ? el.smartRulesEnabled.checked : false,
      smartDefaultMode: el.smartDefaultMode?.value === 'placeholder' ? 'placeholder' : 'discard',
      smartUseHeuristicsFallback: el.smartHeuristicsFallback ? el.smartHeuristicsFallback.checked : true,
      smartPlaceholderDomains,
      smartDiscardDomains,
      mode: ['placeholder', 'smart', 'discard'].includes(el.mode.value) ? el.mode.value : 'placeholder',
      suspendPinnedTabs: el.suspendPinned ? el.suspendPinned.checked : true,
      skipGroupedInHibernate: el.skipGroupedHibernate ? el.skipGroupedHibernate.checked : false,
    },
  }, () => {
    chrome.runtime.sendMessage({ type: 'settingsUpdated' }, () => {});
  });
}

async function refreshThStats() {
  try {
    const r = await send({ type: 'getStatus' });
    el.stats.textContent = r?.hibernatedCount != null ? r.hibernatedCount : '—';
  } catch { el.stats.textContent = '—'; }
}

el.enabled.addEventListener('change', saveThSettings);
el.timeout.addEventListener('change', saveThSettings);
el.mode.addEventListener('change', saveThSettings);
if (el.checkPeriod) el.checkPeriod.addEventListener('change', saveThSettings);
if (el.excludedDomains) el.excludedDomains.addEventListener('blur', saveThSettings);
if (el.smartRulesEnabled) el.smartRulesEnabled.addEventListener('change', saveThSettings);
if (el.smartDefaultMode) el.smartDefaultMode.addEventListener('change', saveThSettings);
if (el.smartHeuristicsFallback) el.smartHeuristicsFallback.addEventListener('change', saveThSettings);
if (el.smartPlaceholderDomains) el.smartPlaceholderDomains.addEventListener('blur', saveThSettings);
if (el.smartDiscardDomains) el.smartDiscardDomains.addEventListener('blur', saveThSettings);
if (el.suspendPinned) el.suspendPinned.addEventListener('change', saveThSettings);
if (el.skipGroupedHibernate) el.skipGroupedHibernate.addEventListener('change', saveThSettings);

el.backup.addEventListener('click', async () => {
  el.backup.disabled = true;
  try {
    const r = await send({ type: 'backupNow' });
    el.backup.textContent = (r?.count || 0) > 0 ? `Done (${r.count})` : 'Done';
  } catch { el.backup.textContent = 'Error'; }
  setTimeout(() => { el.backup.textContent = 'Backup to bookmarks'; el.backup.disabled = false; refreshThStats(); }, 2000);
});

el.suspendCurrent.addEventListener('click', async () => {
  el.suspendCurrent.disabled = true;
  try {
    const r = await send({ type: 'suspendCurrentTab' });
    el.suspendCurrent.textContent = r?.ok ? 'Done' : (r?.reason || 'Cannot');
  } catch { el.suspendCurrent.textContent = 'Error'; }
  setTimeout(() => { el.suspendCurrent.textContent = 'Suspend current'; el.suspendCurrent.disabled = false; refreshThStats(); }, 1500);
});

el.suspendAll.addEventListener('click', async () => {
  el.suspendAll.disabled = true;
  try {
    const r = await send({ type: 'suspendAllNow' });
    el.suspendAll.textContent = (r?.suspended || 0) > 0 ? `Suspend: ${r.suspended}` : 'Done';
    refreshThStats();
  } catch { el.suspendAll.textContent = 'Error'; }
  setTimeout(() => { el.suspendAll.textContent = 'Suspend all'; el.suspendAll.disabled = false; }, 2000);
});

if (el.saveTabGroup) {
  el.saveTabGroup.addEventListener('click', async () => {
    el.saveTabGroup.disabled = true;
    try {
      const r = await send({ type: 'saveTabGroup' });
      if (r?.error === 'no-group') {
        el.saveTabGroup.textContent = 'Not in a group';
      } else if (r?.error) {
        el.saveTabGroup.textContent = 'Error';
      } else {
        el.saveTabGroup.textContent = (r?.saved || 0) > 0 ? `Saved: ${r.saved}` : 'Nothing to save';
      }
    } catch {
      el.saveTabGroup.textContent = 'Error';
    }
    setTimeout(() => {
      el.saveTabGroup.textContent = 'Save tab group';
      el.saveTabGroup.disabled = false;
    }, 2000);
  });
}

if (el.groupByDomain) {
  el.groupByDomain.addEventListener('click', async () => {
    el.groupByDomain.disabled = true;
    el.groupByDomain.textContent = 'Grouping…';
    const allWindows = el.groupByDomainAllWindows?.checked === true;
    try {
      const r = await thGroupTabsByDomain(allWindows);
      if ((r?.groupsCreated || 0) > 0) {
        el.groupByDomain.textContent = `Groups: ${r.groupsCreated} (${r.tabsGrouped} tabs)`;
      } else {
        el.groupByDomain.textContent = 'No pairs found';
      }
    } catch (e) {
      console.warn('[TabHibernate] groupByDomain UI failed', e);
      el.groupByDomain.textContent = 'Error';
    }
    setTimeout(() => {
      el.groupByDomain.textContent = 'Group same URLs';
      el.groupByDomain.disabled = false;
    }, 2500);
  });
}

if (el.closeTabGroupSave) {
  el.closeTabGroupSave.addEventListener('click', async () => {
    el.closeTabGroupSave.disabled = true;
    try {
      const r = await send({ type: 'closeTabGroupAndSave' });
      if (r?.error === 'no-group') {
        el.closeTabGroupSave.textContent = 'Not in a group';
      } else if (r?.error) {
        el.closeTabGroupSave.textContent = 'Error';
      } else {
        const saved = r?.saved || 0;
        const closed = r?.closed || 0;
        el.closeTabGroupSave.textContent = saved > 0 ? `Closed: ${closed}, saved: ${saved}` : 'Done';
      }
      refreshThStats();
    } catch {
      el.closeTabGroupSave.textContent = 'Error';
    }
    setTimeout(() => {
      el.closeTabGroupSave.textContent = 'Close tab group and save';
      el.closeTabGroupSave.disabled = false;
    }, 2500);
  });
}

el.restoreAll.addEventListener('click', async () => {
  el.restoreAll.disabled = true;
  el.restoreAll.textContent = 'Restoring…';
  const progEl = document.getElementById('thRestoreProgress');
  const doneEl = document.getElementById('thRestoreDone');
  const totalEl = document.getElementById('thRestoreTotal');
  const remainEl = document.getElementById('thRestoreRemain');
  if (progEl) progEl.style.display = 'block';

  const onProgress = (changes, areaName) => {
    if (areaName !== 'local' || !changes.restoreProgress?.newValue) return;
    const { restored, total, remaining } = changes.restoreProgress.newValue;
    if (doneEl) doneEl.textContent = restored;
    if (totalEl) totalEl.textContent = total;
    if (remainEl) remainEl.textContent = remaining;
  };
  chrome.storage.onChanged.addListener(onProgress);
  const cleanup = () => {
    chrome.storage.onChanged.removeListener(onProgress);
    chrome.storage.local.remove('restoreProgress');
    if (progEl) progEl.style.display = 'none';
    el.restoreAll.disabled = false;
  };

  try {
    const r = await send({ type: 'restoreAllSuspended' });
    cleanup();
    el.restoreAll.textContent = (r?.restored || 0) > 0 ? `Restore: ${r.restored}` : 'Done';
    refreshThStats();
  } catch {
    cleanup();
    el.restoreAll.textContent = 'Error';
  }
  setTimeout(() => { el.restoreAll.textContent = 'Restore all'; }, 2000);
});

el.closeSave.addEventListener('click', async () => {
  el.closeSave.disabled = true;
  el.closeSave.textContent = 'Closing…';
  const progEl = document.getElementById('thCloseSaveProgress');
  const doneEl = document.getElementById('thCloseSaveDone');
  const totalEl = document.getElementById('thCloseSaveTotal');
  const remainEl = document.getElementById('thCloseSaveRemain');
  const savedEl = document.getElementById('thCloseSaveSaved');
  if (progEl) progEl.style.display = 'block';
  if (doneEl) doneEl.textContent = '0';
  if (totalEl) totalEl.textContent = '0';
  if (remainEl) remainEl.textContent = '0';
  if (savedEl) savedEl.textContent = '0';

  let finished = false;
  const onProgress = (changes, areaName) => {
    if (areaName !== 'local') return;
    if (changes.closeAndSaveProgress?.newValue) {
      const p = changes.closeAndSaveProgress.newValue;
      const total = p.totalToClose ?? p.totalCandidates ?? 0;
      const closed = p.closed ?? 0;
      const saved = p.saved ?? 0;
      const remaining = Math.max(0, total - closed);
      if (doneEl) doneEl.textContent = String(closed);
      if (totalEl) totalEl.textContent = String(total);
      if (remainEl) remainEl.textContent = String(remaining);
      if (savedEl) savedEl.textContent = String(saved);
      return;
    }
    if (changes.closeAndSaveResult?.newValue) {
      const r = changes.closeAndSaveResult.newValue;
      const closed = r?.closed || 0;
      const saved = typeof r?.saved === 'number' ? r.saved : closed;
      finished = true;
      cleanup(false);
      el.closeSave.textContent = r?.ok === false
        ? `Error: ${r.error || 'failed'}`
        : (closed > 0 ? `Closed: ${closed}, saved: ${saved}` : 'Done');
      refreshThStats();
      setTimeout(() => { el.closeSave.textContent = 'Close all and save'; }, 2500);
    }
  };
  chrome.storage.onChanged.addListener(onProgress);

  const cleanup = (clearState = true) => {
    chrome.storage.onChanged.removeListener(onProgress);
    if (clearState) chrome.storage.local.remove(['closeAndSaveProgress', 'closeAndSaveResult']);
    if (progEl) progEl.style.display = 'none';
    el.closeSave.disabled = false;
  };

  try {
    const start = await send({ type: 'closeAndSaveAllAsync' });
    if (!start?.started) {
      cleanup();
      if (start?.reason === 'already-running') {
        el.closeSave.textContent = 'Already running…';
      } else {
        el.closeSave.textContent = `Error: ${start?.reason || 'start failed'}`;
      }
      setTimeout(() => { el.closeSave.textContent = 'Close all and save'; }, 2500);
      return;
    }
  } catch (e) {
    cleanup();
    el.closeSave.textContent = `Error: ${e?.message || 'unknown'}`;
    setTimeout(() => { el.closeSave.textContent = 'Close all and save'; }, 3000);
    return;
  }

  setTimeout(() => {
    if (!finished) el.closeSave.textContent = 'Running…';
  }, 2000);
});

el.history.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL('history.html') });
});

const recoverBtn = document.getElementById('thRecoverLost');
if (recoverBtn) {
  recoverBtn.addEventListener('click', async () => {
    recoverBtn.disabled = true;
    recoverBtn.textContent = 'Recovering…';
    try {
      const r = await send({ type: 'recoverLostSuspended' });
      const n = r?.recovered ?? 0;
      if (n > 0) {
        recoverBtn.textContent = `Recovered: ${n} placeholder(s)`;
      } else if (r?.sourcesHint) {
        recoverBtn.textContent = 'Nothing in storage — see bookmarks';
        console.info('[TabHibernate]', r.sourcesHint);
      } else {
        recoverBtn.textContent = 'No lost tabs found';
      }
      refreshThStats();
    } catch {
      recoverBtn.textContent = 'Error';
    }
    setTimeout(() => { recoverBtn.textContent = 'Recover lost tabs'; recoverBtn.disabled = false; }, 4000);
  });
}

function historyRecoverOptions() {
  const hoursEl = document.getElementById('thHistoryRecoverHours');
  const onlyEl = document.getElementById('thHistoryOnlyMissing');
  return {
    hoursBack: Number(hoursEl?.value) || 24,
    onlyMissing: onlyEl?.checked !== false,
  };
}

const recoverFromHistoryBtn = document.getElementById('thRecoverFromHistory');
if (recoverFromHistoryBtn) {
  recoverFromHistoryBtn.addEventListener('click', async () => {
    recoverFromHistoryBtn.disabled = true;
    recoverFromHistoryBtn.textContent = 'Scanning history…';
    try {
      const opts = historyRecoverOptions();
      const r = await send({ type: 'recoverFromBrowserHistory', ...opts });
      const n = r?.recovered ?? 0;
      if (n > 0) {
        recoverFromHistoryBtn.textContent = `Opened: ${n} placeholder(s)`;
      } else if (r?.message) {
        recoverFromHistoryBtn.textContent = 'Nothing to restore';
        console.info('[TabHibernate]', r.message);
      } else {
        recoverFromHistoryBtn.textContent = r?.error ? 'Error' : 'No matches';
      }
      refreshThStats();
    } catch {
      recoverFromHistoryBtn.textContent = 'Error';
    }
    setTimeout(() => {
      recoverFromHistoryBtn.textContent = 'Find & restore from history';
      recoverFromHistoryBtn.disabled = false;
    }, 4000);
  });
}

const emergencyBackupBtn = document.getElementById('thEmergencyBackup');
if (emergencyBackupBtn) {
  emergencyBackupBtn.addEventListener('click', async () => {
    emergencyBackupBtn.disabled = true;
    emergencyBackupBtn.textContent = 'Backing up…';
    try {
      const r = await send({ type: 'emergencyBackupNow' });
      const n = r?.count ?? 0;
      emergencyBackupBtn.textContent = n > 0 ? `Saved: ${n} tab(s)` : (r?.error ? 'Error' : 'No tabs to save');
    } catch {
      emergencyBackupBtn.textContent = 'Error';
    }
    setTimeout(() => {
      emergencyBackupBtn.textContent = 'Backup all tabs now';
      emergencyBackupBtn.disabled = false;
    }, 3000);
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.closedAndSaved) refreshThStats();
});

loadThSettings().then(refreshThStats);

// Site Blocker UI (whitelist, schedule, JSON import) — same model as standalone SiteBlocker.
const SB_DEFAULT_SCHEDULE = { enabled: false, from: '09:00', to: '18:00', days: [1, 2, 3, 4, 5] };
/** Temporary status text until next storage refresh. */
let blockerStatusOverride = null;

function normDomain(input) {
  let s = (input || '').trim().toLowerCase();
  if (!s) return '';
  try {
    if (!s.startsWith('http')) s = 'https://' + s;
    return new URL(s).hostname.replace(/^www\./, '') || '';
  } catch {
    return s.replace(/^www\./, '').split('/')[0].split('?')[0];
  }
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function normalizeBlockerSchedule(raw) {
  const source = raw && typeof raw === 'object' ? raw : SB_DEFAULT_SCHEDULE;
  const days = Array.isArray(source.days)
    ? source.days.map((d) => Number(d)).filter((d) => d >= 0 && d <= 6)
    : SB_DEFAULT_SCHEDULE.days.slice();
  return {
    enabled: source.enabled === true,
    from: typeof source.from === 'string' ? source.from : SB_DEFAULT_SCHEDULE.from,
    to: typeof source.to === 'string' ? source.to : SB_DEFAULT_SCHEDULE.to,
    days: [...new Set(days)],
  };
}

function renderBlocker(blocked, whitelist, enabled, schedule, scheduleActive, adsFiltersEnabled, blockerAutoSaveTabs) {
  const list = document.getElementById('blockerList');
  const empty = document.getElementById('blockerEmpty');
  const toggle = document.getElementById('blockerToggle');
  const adsCb = document.getElementById('blockerAdsFilters');
  if (adsCb) adsCb.checked = adsFiltersEnabled !== false;
  const wlList = document.getElementById('blockerWhitelistList');
  const wlEmpty = document.getElementById('blockerWhitelistEmpty');
  const sch = normalizeBlockerSchedule(schedule);
  toggle.checked = enabled;
  const autoSaveEl = document.getElementById('blockerAutoSaveTabs');
  if (autoSaveEl) autoSaveEl.checked = blockerAutoSaveTabs !== false;
  list.innerHTML = '';
  if (!blocked.length) empty.style.display = 'block';
  else {
    empty.style.display = 'none';
    blocked.forEach((d) => {
      const li = document.createElement('li');
      li.innerHTML = `<span>${esc(d)}</span><button type="button" class="rm" data-domain="${esc(d)}">Remove</button>`;
      list.appendChild(li);
    });
    list.querySelectorAll('.rm').forEach((b) => {
      b.addEventListener('click', () => removeBlockerDomain(b.dataset.domain));
    });
  }
  wlList.innerHTML = '';
  if (!whitelist || !whitelist.length) wlEmpty.style.display = 'block';
  else {
    wlEmpty.style.display = 'none';
    whitelist.forEach((d) => {
      const li = document.createElement('li');
      li.innerHTML = `<span>${esc(d)}</span><button type="button" class="rm rm-wl" data-domain="${esc(d)}">Remove</button>`;
      wlList.appendChild(li);
    });
    wlList.querySelectorAll('.rm-wl').forEach((b) => {
      b.addEventListener('click', () => removeWhitelistDomain(b.dataset.domain));
    });
  }
  document.getElementById('blockerScheduleEnabled').checked = sch.enabled;
  document.getElementById('blockerScheduleFrom').value = sch.from;
  document.getElementById('blockerScheduleTo').value = sch.to;
  document.querySelectorAll('#blockerScheduleDays input[data-day]').forEach((cb) => {
    cb.checked = sch.days.includes(Number(cb.dataset.day));
  });
  const statusEl = document.getElementById('blockerStatus');
  if (statusEl) {
    if (!enabled) statusEl.textContent = 'Blocking disabled manually';
    else if (sch.enabled) statusEl.textContent = scheduleActive === false ? 'Outside schedule window' : 'Inside schedule window';
    else statusEl.textContent = '';
  }
}

function refreshBlockerFromStorage() {
  chrome.storage.local.get(['blocked', 'whitelist', 'enabled', 'schedule', 'scheduleStateActive', 'adsFiltersEnabled', 'blockerAutoSaveTabs'], (data) => {
    renderBlocker(
      data.blocked || [],
      data.whitelist || [],
      data.enabled !== false,
      data.schedule || SB_DEFAULT_SCHEDULE,
      data.scheduleStateActive !== false,
      data.adsFiltersEnabled,
      data.blockerAutoSaveTabs
    );
    if (blockerStatusOverride) {
      document.getElementById('blockerStatus').textContent = blockerStatusOverride;
      blockerStatusOverride = null;
    }
  });
}

function addBlockerDomain() {
  const domain = normDomain(document.getElementById('blockerInput').value);
  if (!domain) return;
  document.getElementById('blockerInput').value = '';
  chrome.storage.local.get(['blocked'], (data) => {
    const blocked = data.blocked || [];
    if (blocked.includes(domain)) return;
    blocked.push(domain);
    chrome.storage.local.set({ blocked }, refreshBlockerFromStorage);
  });
}

function removeBlockerDomain(domain) {
  chrome.storage.local.get(['blocked'], (data) => {
    const blocked = (data.blocked || []).filter((d) => d !== domain);
    chrome.storage.local.set({ blocked }, refreshBlockerFromStorage);
  });
}

function addWhitelistDomain() {
  const domain = normDomain(document.getElementById('blockerWhitelistInput').value);
  if (!domain) return;
  document.getElementById('blockerWhitelistInput').value = '';
  chrome.storage.local.get(['whitelist'], (data) => {
    const whitelist = data.whitelist || [];
    if (whitelist.includes(domain)) return;
    whitelist.push(domain);
    chrome.storage.local.set({ whitelist }, refreshBlockerFromStorage);
  });
}

function removeWhitelistDomain(domain) {
  chrome.storage.local.get(['whitelist'], (data) => {
    const whitelist = (data.whitelist || []).filter((d) => d !== domain);
    chrome.storage.local.set({ whitelist }, refreshBlockerFromStorage);
  });
}

function saveBlockerScheduleFromUi() {
  const days = [...document.querySelectorAll('#blockerScheduleDays input[data-day]:checked')].map((cb) => Number(cb.dataset.day));
  const schedule = normalizeBlockerSchedule({
    enabled: document.getElementById('blockerScheduleEnabled').checked,
    from: document.getElementById('blockerScheduleFrom').value || SB_DEFAULT_SCHEDULE.from,
    to: document.getElementById('blockerScheduleTo').value || SB_DEFAULT_SCHEDULE.to,
    days,
  });
  chrome.storage.local.set({ schedule });
}

document.getElementById('blockerToggle').addEventListener('change', () => {
  const enabled = document.getElementById('blockerToggle').checked;
  chrome.storage.local.set({ enabled }, refreshBlockerFromStorage);
});

document.getElementById('blockerAutoSaveTabs')?.addEventListener('change', () => {
  const blockerAutoSaveTabs = document.getElementById('blockerAutoSaveTabs').checked;
  chrome.storage.local.set({ blockerAutoSaveTabs });
});

document.getElementById('blockerSaveTabsNow')?.addEventListener('click', async () => {
  const btn = document.getElementById('blockerSaveTabsNow');
  const statusEl = document.getElementById('blockerStatus');
  if (!btn) return;
  btn.disabled = true;
  btn.textContent = 'Saving…';
  try {
    const r = await send({ type: 'saveBlockedTabsNow' });
    const n = r?.added ?? 0;
    const msg = n > 0 ? `Saved ${n} tab(s)` : 'No open tabs on blocked sites';
    if (statusEl) statusEl.textContent = msg;
    btn.textContent = msg;
  } catch (e) {
    if (statusEl) statusEl.textContent = 'Save failed';
    btn.textContent = 'Error';
  }
  setTimeout(() => {
    btn.textContent = 'Save blocked tabs now';
    btn.disabled = false;
    refreshBlockerFromStorage();
  }, 2500);
});

document.getElementById('blockerAdsFilters').addEventListener('change', () => {
  const adsFiltersEnabled = document.getElementById('blockerAdsFilters').checked;
  chrome.storage.local.set({ adsFiltersEnabled }, refreshBlockerFromStorage);
});

document.getElementById('blockerScheduleEnabled').addEventListener('change', saveBlockerScheduleFromUi);
document.getElementById('blockerScheduleFrom').addEventListener('change', saveBlockerScheduleFromUi);
document.getElementById('blockerScheduleTo').addEventListener('change', saveBlockerScheduleFromUi);
document.querySelectorAll('#blockerScheduleDays input[data-day]').forEach((cb) => {
  cb.addEventListener('change', saveBlockerScheduleFromUi);
});

function hostMatchesBlocked(hostname, blockedDomains) {
  if (!hostname) return false;
  const h = hostname.replace(/^www\./, '').toLowerCase();
  for (const d of blockedDomains) {
    if (h === d || h.endsWith('.' + d)) return true;
  }
  return false;
}

document.getElementById('blockerOpenFromHistory').addEventListener('click', async () => {
  const statusEl = document.getElementById('blockerStatus');
  const btn = document.getElementById('blockerOpenFromHistory');
  btn.disabled = true;
  statusEl.textContent = 'Loading...';
  try {
    const { blocked = [] } = await chrome.storage.local.get('blocked');
    if (!blocked.length) {
      statusEl.textContent = 'No blocked domains';
      return;
    }
    const since = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const items = await chrome.history.search({ text: '', maxResults: 1000, startTime: since });
    const seen = new Set();
    const urls = [];
    for (const item of items) {
      if (!item.url || !item.url.startsWith('http')) continue;
      try {
        const host = new URL(item.url).hostname.replace(/^www\./, '').toLowerCase();
        if (!hostMatchesBlocked(host, blocked)) continue;
        if (seen.has(item.url)) continue;
        seen.add(item.url);
        urls.push(item.url);
      } catch (_) {}
    }
    //    —      
    await Promise.all(urls.map((url) => chrome.tabs.create({ url })));
    statusEl.textContent = urls.length > 0 ? `Opened: ${urls.length}` : 'No visits for blocked domains';
  } catch (e) {
    statusEl.textContent = 'Error: ' + (e.message || '');
  }
  btn.disabled = false;
  setTimeout(() => { refreshBlockerFromStorage(); }, 4000);
});

document.getElementById('blockerAdd').addEventListener('click', addBlockerDomain);
document.getElementById('blockerInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') addBlockerDomain(); });
document.getElementById('blockerWhitelistAdd').addEventListener('click', addWhitelistDomain);
document.getElementById('blockerWhitelistInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') addWhitelistDomain(); });

document.getElementById('blockerExport').addEventListener('click', async () => {
  const payload = await chrome.storage.local.get(['blocked', 'whitelist', 'enabled', 'schedule', 'adsFiltersEnabled']);
  const blob = new Blob([JSON.stringify({
    version: 1,
    exportedAt: new Date().toISOString(),
    blocked: payload.blocked || [],
    whitelist: payload.whitelist || [],
    enabled: payload.enabled !== false,
    schedule: normalizeBlockerSchedule(payload.schedule),
    adsFiltersEnabled: payload.adsFiltersEnabled !== false,
  }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `swiss-site-blocker-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('blockerImport').addEventListener('click', () => document.getElementById('blockerImportFile').click());
document.getElementById('blockerImportFile').addEventListener('change', async () => {
  const input = document.getElementById('blockerImportFile');
  const file = input.files && input.files[0];
  const statusEl = document.getElementById('blockerStatus');
  if (!file) return;
  try {
    const text = await file.text();
    const json = JSON.parse(text);
    const blocked = Array.isArray(json.blocked) ? json.blocked.map(normDomain).filter(Boolean) : [];
    const whitelist = Array.isArray(json.whitelist) ? json.whitelist.map(normDomain).filter(Boolean) : [];
    const enabled = json.enabled !== false;
    const schedule = normalizeBlockerSchedule(json.schedule);
    const adsFiltersEnabled = json.adsFiltersEnabled !== false;
    blockerStatusOverride = 'Import completed';
    await chrome.storage.local.set({
      blocked: [...new Set(blocked)],
      whitelist: [...new Set(whitelist)],
      enabled,
      schedule,
      adsFiltersEnabled,
    });
  } catch {
    blockerStatusOverride = null;
    statusEl.textContent = 'Error  JSON';
  } finally {
    input.value = '';
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.blocked || changes.whitelist || changes.enabled || changes.schedule || changes.scheduleStateActive || changes.adsFiltersEnabled) {
    refreshBlockerFromStorage();
  }
});

refreshBlockerFromStorage();

// Memory Cleaner (tmcSettings — Tab Memory Cleaner; defaults discard pinned + grouped unless user opts out)
const TMC_UI_DEFAULTS = {
  skipPinned: false,
  skipAudible: true,
  skipIncognito: true,
  skipGrouped: false,
  excludedDomains: [],
};

function memoryNormalizeDomainsText(value) {
  return String(value || '')
    .split('\n')
    .map((line) => line.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
    .filter(Boolean)
    .filter((d, i, arr) => arr.indexOf(d) === i);
}

function readMemorySettingsFromUi() {
  return {
    skipPinned: document.getElementById('memorySkipPinned').checked,
    skipAudible: document.getElementById('memorySkipAudible').checked,
    skipIncognito: document.getElementById('memorySkipIncognito').checked,
    skipGrouped: document.getElementById('memorySkipGrouped').checked,
    excludedDomains: memoryNormalizeDomainsText(document.getElementById('memoryExcludedDomains').value),
  };
}

function saveMemorySettings() {
  const raw = readMemorySettingsFromUi();
  document.getElementById('memoryExcludedDomains').value = raw.excludedDomains.join('\n');
  chrome.storage.local.set({ tmcSettings: raw });
}

async function loadMemorySettings() {
  const { tmcSettings = {} } = await chrome.storage.local.get('tmcSettings');
  const s = { ...TMC_UI_DEFAULTS, ...tmcSettings };
  document.getElementById('memorySkipPinned').checked = !!s.skipPinned;
  document.getElementById('memorySkipAudible').checked = s.skipAudible !== false;
  document.getElementById('memorySkipIncognito').checked = s.skipIncognito !== false;
  document.getElementById('memorySkipGrouped').checked = !!s.skipGrouped;
  const list = Array.isArray(s.excludedDomains) ? s.excludedDomains : [];
  document.getElementById('memoryExcludedDomains').value = list.join('\n');
}

['memorySkipPinned', 'memorySkipAudible', 'memorySkipIncognito', 'memorySkipGrouped'].forEach((id) => {
  document.getElementById(id).addEventListener('change', saveMemorySettings);
});
document.getElementById('memoryExcludedDomains').addEventListener('blur', saveMemorySettings);

document.getElementById('btnDiscard').addEventListener('click', async () => {
  const btn = document.getElementById('btnDiscard');
  const st = document.getElementById('memoryStatus');
  saveMemorySettings();
  btn.disabled = true;
  st.textContent = 'Discarding...';
  try {
    const r = await send({ type: 'discardBackgroundTabs' });
    const n = r?.discarded ?? 0;
    st.textContent = n > 0 ? `Discarded tabs: ${n}` : 'Done (no matching tabs)';
  } catch {
    st.textContent = 'Error';
  }
  btn.disabled = false;
  setTimeout(() => { st.textContent = ''; }, 3000);
});

loadMemorySettings();

// Site Data Clear —   standalone (sdcOptions, , cacheStorage).
const SDC_STORAGE_KEY = 'sdcOptions';
const SDC_DEFAULT = {
  cookies: true,
  localStorage: true,
  sessionStorage: true,
  cacheStorage: true,
};
const SDC_PRESETS = {
  all: { cookies: true, localStorage: true, sessionStorage: true, cacheStorage: true },
  cookies: { cookies: true, localStorage: false, sessionStorage: false, cacheStorage: false },
  storage: { cookies: false, localStorage: true, sessionStorage: true, cacheStorage: true },
  session: { cookies: false, localStorage: false, sessionStorage: true, cacheStorage: false },
};

const sdcEls = {
  cookies: document.getElementById('optCookies'),
  localStorage: document.getElementById('optLocalStorage'),
  sessionStorage: document.getElementById('optSessionStorage'),
  cacheStorage: document.getElementById('optCacheStorage'),
};

function sdcApplyOptions(o) {
  const m = { ...SDC_DEFAULT, ...o };
  sdcEls.cookies.checked = !!m.cookies;
  sdcEls.localStorage.checked = !!m.localStorage;
  sdcEls.sessionStorage.checked = !!m.sessionStorage;
  sdcEls.cacheStorage.checked = !!m.cacheStorage;
}

function sdcReadOptionsFromUi() {
  return {
    cookies: sdcEls.cookies.checked,
    localStorage: sdcEls.localStorage.checked,
    sessionStorage: sdcEls.sessionStorage.checked,
    cacheStorage: sdcEls.cacheStorage.checked,
  };
}

function sdcSaveOptions() {
  chrome.storage.local.set({ [SDC_STORAGE_KEY]: sdcReadOptionsFromUi() });
}

async function sdcLoadOptions() {
  const data = await chrome.storage.local.get(SDC_STORAGE_KEY);
  sdcApplyOptions(data[SDC_STORAGE_KEY] || SDC_DEFAULT);
}

['optCookies', 'optLocalStorage', 'optSessionStorage', 'optCacheStorage'].forEach((id) => {
  document.getElementById(id).addEventListener('change', sdcSaveOptions);
});

document.querySelectorAll('[data-sdc-preset]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const id = btn.getAttribute('data-sdc-preset');
    const preset = SDC_PRESETS[id];
    if (preset) {
      sdcApplyOptions(preset);
      sdcSaveOptions();
    }
  });
});

document.getElementById('btnClearSite').addEventListener('click', async () => {
  const st = document.getElementById('clearStatus');
  st.textContent = '';
  st.className = '';

  const opt = sdcReadOptionsFromUi();
  const anyBrowsing = opt.cookies || opt.localStorage || opt.cacheStorage;
  if (!anyBrowsing && !opt.sessionStorage) {
    st.textContent = 'Select at least one option';
    st.className = 'err';
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) {
    st.textContent = 'No active tab';
    st.className = 'err';
    return;
  }

  try {
    const url = new URL(tab.url);
    const origin = url.origin;
    if (url.protocol === 'chrome:' || url.protocol === 'chrome-extension:' || url.protocol === 'edge:' || url.protocol === 'about:') {
      st.textContent = 'Unavailable on system pages';
      st.className = 'err';
      return;
    }

    const options = { origins: [origin], since: 0 };
    const dataToRemove = {};
    if (opt.cookies) dataToRemove.cookies = true;
    if (opt.localStorage) dataToRemove.localStorage = true;
    if (opt.cacheStorage) dataToRemove.cacheStorage = true;
    if (Object.keys(dataToRemove).length > 0) {
      await chrome.browsingData.remove(options, dataToRemove);
    }
    if (opt.sessionStorage) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => { sessionStorage.clear(); },
      });
    }

    st.textContent = 'Done';
    st.className = 'ok';
    sdcSaveOptions();
    setTimeout(() => chrome.tabs.reload(tab.id), 800);
  } catch (e) {
    st.textContent = 'Error: ' + (e.message || 'unknown');
    st.className = 'err';
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[SDC_STORAGE_KEY]) {
    sdcApplyOptions(changes[SDC_STORAGE_KEY].newValue || SDC_DEFAULT);
  }
});

/** uiTheme in chrome.storage.local — shared by side panel, History, and suspended pages. */
const UI_THEME_KEY = 'uiTheme';

function applyUiThemePanel(mode) {
  document.documentElement.dataset.theme = mode === 'light' ? 'light' : 'dark';
}

function initUiThemeSwitcher() {
  const darkBtn = document.getElementById('themeDark');
  const lightBtn = document.getElementById('themeLight');
  if (!darkBtn || !lightBtn) return;

  const sync = () => {
    const t = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    darkBtn.classList.toggle('active', t === 'dark');
    lightBtn.classList.toggle('active', t === 'light');
  };

  darkBtn.addEventListener('click', () => {
    applyUiThemePanel('dark');
    chrome.storage.local.set({ [UI_THEME_KEY]: 'dark' }, sync);
  });
  lightBtn.addEventListener('click', () => {
    applyUiThemePanel('light');
    chrome.storage.local.set({ [UI_THEME_KEY]: 'light' }, sync);
  });

  chrome.storage.local.get([UI_THEME_KEY], (r) => {
    if (!chrome.runtime.lastError) applyUiThemePanel(r[UI_THEME_KEY]);
    sync();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[UI_THEME_KEY]) return;
    applyUiThemePanel(changes[UI_THEME_KEY].newValue);
    sync();
  });
}

initUiThemeSwitcher();
sdcLoadOptions();
