/**
 * Popup: load/save settings, backup button, suspend-all, stats.
 * Handles lastError and retries when the service worker is waking up.
 */

const el = {
  enabled: document.getElementById('enabled'),
  timeout: document.getElementById('timeout'),
  mode: document.getElementById('mode'),
  checkPeriod: document.getElementById('checkPeriod'),
  excludedDomains: document.getElementById('excludedDomains'),
  smartRulesEnabled: document.getElementById('smartRulesEnabled'),
  smartDefaultMode: document.getElementById('smartDefaultMode'),
  smartHeuristicsFallback: document.getElementById('smartHeuristicsFallback'),
  smartPlaceholderDomains: document.getElementById('smartPlaceholderDomains'),
  smartDiscardDomains: document.getElementById('smartDiscardDomains'),
  backup: document.getElementById('backup'),
  suspendCurrent: document.getElementById('suspendCurrent'),
  suspendAll: document.getElementById('suspendAll'),
  restoreAll: document.getElementById('restoreAll'),
  closeAndSave: document.getElementById('closeAndSave'),
  openHistory: document.getElementById('openHistory'),
  stats: document.getElementById('stats'),
  statsNumber: document.getElementById('statsNumber'),
  statusLine: document.getElementById('statusLine'),
};

async function loadSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  if (settings) {
    el.enabled.checked = settings.enabled !== false;
    el.timeout.value = String(settings.timeoutMinutes ?? 5);
    el.mode.value = ['placeholder', 'smart', 'discard'].includes(settings.mode) ? settings.mode : 'discard';
    el.checkPeriod.value = ['1', '2', '5'].includes(String(settings.checkPeriodMinutes)) ? String(settings.checkPeriodMinutes) : '1';
    const domains = Array.isArray(settings.excludedDomains) ? settings.excludedDomains : [];
    el.excludedDomains.value = domains.join('\n');
    if (el.smartRulesEnabled) el.smartRulesEnabled.checked = settings.smartRulesEnabled === true;
    if (el.smartDefaultMode) el.smartDefaultMode.value = settings.smartDefaultMode === 'placeholder' ? 'placeholder' : 'discard';
    if (el.smartHeuristicsFallback) el.smartHeuristicsFallback.checked = settings.smartUseHeuristicsFallback !== false;
    if (el.smartPlaceholderDomains) {
      const list = Array.isArray(settings.smartPlaceholderDomains) ? settings.smartPlaceholderDomains : [];
      el.smartPlaceholderDomains.value = list.join('\n');
    }
    if (el.smartDiscardDomains) {
      const list = Array.isArray(settings.smartDiscardDomains) ? settings.smartDiscardDomains : [];
      el.smartDiscardDomains.value = list.join('\n');
    }
  }
}

function normalizeDomainsInput(value) {
  return String(value || '')
    .split('\n')
    .map((line) => line.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
    .filter(Boolean)
    .filter((line, idx, arr) => arr.indexOf(line) === idx);
}

function saveSettings() {
  const excludedDomains = normalizeDomainsInput(el.excludedDomains?.value);
  const smartPlaceholderDomains = normalizeDomainsInput(el.smartPlaceholderDomains?.value);
  let smartDiscardDomains = normalizeDomainsInput(el.smartDiscardDomains?.value);
  // If domain is listed in both groups, placeholder wins.
  smartDiscardDomains = smartDiscardDomains.filter((d) => !smartPlaceholderDomains.includes(d));
  if (el.excludedDomains) el.excludedDomains.value = excludedDomains.join('\n');
  if (el.smartPlaceholderDomains) el.smartPlaceholderDomains.value = smartPlaceholderDomains.join('\n');
  if (el.smartDiscardDomains) el.smartDiscardDomains.value = smartDiscardDomains.join('\n');
  const settings = {
    enabled: el.enabled.checked,
    timeoutMinutes: parseInt(el.timeout.value, 10) || 5,
    checkPeriodMinutes: parseInt(el.checkPeriod.value, 10) || 1,
    excludedDomains,
    smartRulesEnabled: el.smartRulesEnabled ? el.smartRulesEnabled.checked : false,
    smartDefaultMode: el.smartDefaultMode?.value === 'placeholder' ? 'placeholder' : 'discard',
    smartUseHeuristicsFallback: el.smartHeuristicsFallback ? el.smartHeuristicsFallback.checked : true,
    smartPlaceholderDomains,
    smartDiscardDomains,
    mode: ['placeholder', 'smart', 'discard'].includes(el.mode.value) ? el.mode.value : 'discard',
  };
  chrome.storage.local.set({ settings }, () => {
    chrome.runtime.sendMessage({ type: 'settingsUpdated' }, () => {});
  });
}

function sendMessageWithRetry(msg, retries = 3) {
  return new Promise((resolve, reject) => {
    const trySend = (attempt) => {
      chrome.runtime.sendMessage(msg, (res) => {
        if (chrome.runtime.lastError) {
          if (attempt < retries) {
            setTimeout(() => trySend(attempt + 1), 500);
          } else {
            reject(new Error(chrome.runtime.lastError.message));
          }
          return;
        }
        resolve(res);
      });
    };
    trySend(0);
  });
}

function formatLastCheck(ts) {
  if (!ts) return 'never';
  const min = Math.floor((Date.now() - ts) / 60000);
  if (min < 1) return 'just now';
  if (min === 1) return '1 min ago';
  return `${min} min ago`;
}

async function refreshStats() {
  try {
    const res = await sendMessageWithRetry({ type: 'getStatus' });
    if (res && el.statsNumber) {
      const n = typeof res.hibernatedCount === 'number' ? res.hibernatedCount : null;
      el.statsNumber.textContent = n !== null ? String(n) : '—';
    }
    if (res && el.statusLine) {
      const lastRun = res.lastAlarmRun || 0;
      const eligible = typeof res.eligibleTabCount === 'number' ? res.eligibleTabCount : 0;
      el.statusLine.textContent = `Last check: ${formatLastCheck(lastRun)} • Eligible tabs: ${eligible}`;
      if (lastRun && Date.now() - lastRun > 10 * 60 * 1000) {
        el.statusLine.textContent += ' (reload extension if needed)';
      }
    }
  } catch (e) {
    if (el.statsNumber) el.statsNumber.textContent = '—';
    if (el.statusLine) el.statusLine.textContent = 'No connection to extension. Open popup again.';
  }
}

/** Refresh counter when closedAndSaved changes (history clear, import, etc.). */
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.closedAndSaved) refreshStats();
});

el.enabled.addEventListener('change', saveSettings);
el.timeout.addEventListener('change', saveSettings);
el.mode.addEventListener('change', saveSettings);
if (el.checkPeriod) el.checkPeriod.addEventListener('change', saveSettings);
if (el.excludedDomains) el.excludedDomains.addEventListener('blur', saveSettings);
if (el.smartRulesEnabled) el.smartRulesEnabled.addEventListener('change', saveSettings);
if (el.smartDefaultMode) el.smartDefaultMode.addEventListener('change', saveSettings);
if (el.smartHeuristicsFallback) el.smartHeuristicsFallback.addEventListener('change', saveSettings);
if (el.smartPlaceholderDomains) el.smartPlaceholderDomains.addEventListener('blur', saveSettings);
if (el.smartDiscardDomains) el.smartDiscardDomains.addEventListener('blur', saveSettings);

el.backup.addEventListener('click', async () => {
  el.backup.disabled = true;
  el.backup.textContent = 'Saving…';
  try {
    const res = await sendMessageWithRetry({ type: 'backupNow' });
    const count = res && typeof res.count === 'number' ? res.count : 0;
    const path = res && res.folderPath ? res.folderPath : null;
    el.backup.textContent = count > 0 ? `Done (${count})` : 'Done';
    if (res && res.error) el.stats.textContent = res.error;
    else if (path && count > 0) el.stats.textContent = `Saved to bookmarks: ${path}`;
  } catch (e) {
    el.backup.textContent = 'Error';
    el.stats.textContent = 'Could not reach extension. Open popup again.';
  }
  setTimeout(() => {
    el.backup.textContent = 'Backup tabs to bookmarks';
    el.backup.disabled = false;
    refreshStats();
  }, 2500);
});

if (el.suspendCurrent) {
  el.suspendCurrent.addEventListener('click', async () => {
    el.suspendCurrent.disabled = true;
    el.suspendCurrent.textContent = 'Suspending…';
    try {
      const res = await sendMessageWithRetry({ type: 'suspendCurrentTab' });
      if (res && res.ok) {
        el.suspendCurrent.textContent = 'Done';
        refreshStats();
      } else {
        el.suspendCurrent.textContent = res?.reason || 'Cannot suspend';
      }
    } catch (e) {
      el.suspendCurrent.textContent = 'Error';
    }
    setTimeout(() => {
      el.suspendCurrent.textContent = 'Suspend current tab';
      el.suspendCurrent.disabled = false;
    }, 1500);
  });
}

if (el.suspendAll) {
  el.suspendAll.addEventListener('click', async () => {
    el.suspendAll.disabled = true;
    el.suspendAll.textContent = 'Suspending…';
    try {
      const res = await sendMessageWithRetry({ type: 'suspendAllNow' });
      const n = res && typeof res.suspended === 'number' ? res.suspended : 0;
      el.suspendAll.textContent = n > 0 ? `Suspended: ${n}` : 'Done';
      refreshStats();
    } catch (e) {
      el.suspendAll.textContent = 'Error';
    }
    setTimeout(() => {
      el.suspendAll.textContent = 'Suspend all tabs';
      el.suspendAll.disabled = false;
    }, 2000);
  });
}

if (el.restoreAll) {
  const restoreProgressEl = document.getElementById('restoreProgress');
  const restoreDoneEl = document.getElementById('restoreDone');
  const restoreTotalEl = document.getElementById('restoreTotal');
  const restoreRemainEl = document.getElementById('restoreRemain');

  el.restoreAll.addEventListener('click', async () => {
    el.restoreAll.disabled = true;
    el.restoreAll.textContent = 'Restoring…';
    if (restoreProgressEl) restoreProgressEl.style.display = 'block';

    const onProgress = (changes, areaName) => {
      if (areaName !== 'local' || !changes.restoreProgress?.newValue) return;
      const { restored, total, remaining } = changes.restoreProgress.newValue;
      if (restoreDoneEl) restoreDoneEl.textContent = restored;
      if (restoreTotalEl) restoreTotalEl.textContent = total;
      if (restoreRemainEl) restoreRemainEl.textContent = remaining;
    };
    chrome.storage.onChanged.addListener(onProgress);

    const cleanup = () => {
      chrome.storage.onChanged.removeListener(onProgress);
      chrome.storage.local.remove('restoreProgress');
      if (restoreProgressEl) restoreProgressEl.style.display = 'none';
      el.restoreAll.disabled = false;
    };

    try {
      const res = await sendMessageWithRetry({ type: 'restoreAllSuspended' });
      cleanup();
      const n = res && typeof res.restored === 'number' ? res.restored : 0;
      el.restoreAll.textContent = n > 0 ? `Restored: ${n}` : 'Done';
      refreshStats();
    } catch (e) {
      cleanup();
      el.restoreAll.textContent = 'Error';
    }
    setTimeout(() => {
      el.restoreAll.textContent = 'Restore all tabs';
    }, 2000);
  });
}

if (el.closeAndSave) {
  el.closeAndSave.addEventListener('click', async () => {
    el.closeAndSave.disabled = true;
    el.closeAndSave.textContent = 'Closing…';
    try {
      const res = await sendMessageWithRetry({ type: 'closeAndSaveAll' });
      const n = res && typeof res.closed === 'number' ? res.closed : 0;
      el.closeAndSave.textContent = n > 0 ? `Closed: ${n}` : 'Done';
      refreshStats();
    } catch (e) {
      el.closeAndSave.textContent = 'Error';
    }
    setTimeout(() => {
      el.closeAndSave.textContent = 'Close all and save';
      el.closeAndSave.disabled = false;
    }, 2000);
  });
}

if (el.openHistory) {
  el.openHistory.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('history.html') });
  });
}

const recoverBtn = document.getElementById('recoverLost');
if (recoverBtn) {
  recoverBtn.addEventListener('click', async () => {
    recoverBtn.disabled = true;
    recoverBtn.textContent = 'Recovering…';
    try {
      const res = await sendMessageWithRetry({ type: 'recoverLostSuspended' });
      const n = res?.recovered ?? 0;
      recoverBtn.textContent = n > 0 ? `Recovered: ${n}` : 'No lost tabs';
      refreshStats();
    } catch {
      recoverBtn.textContent = 'Error';
    }
    setTimeout(() => {
      recoverBtn.textContent = 'Recover lost tabs';
      recoverBtn.disabled = false;
    }, 2000);
  });
}

loadSettings().then(refreshStats);
