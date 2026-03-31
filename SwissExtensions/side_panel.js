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

// Capture — прогресс через storage.onChanged
document.getElementById('btnCapture').addEventListener('click', () => {
  const st = document.getElementById('captureStatus');
  const btn = document.getElementById('btnCapture');
  const progEl = document.getElementById('captureProgress');
  const fillEl = document.getElementById('captureProgressFill');
  btn.disabled = true;
  st.textContent = 'Scanning…';
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
    else if (res?.ok) st.textContent = 'Screenshot page opened.';
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
  backup: document.getElementById('thBackup'),
  suspendCurrent: document.getElementById('thSuspendCurrent'),
  suspendAll: document.getElementById('thSuspendAll'),
  restoreAll: document.getElementById('thRestoreAll'),
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

async function loadThSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  if (settings) {
    el.enabled.checked = settings.enabled !== false;
    el.timeout.value = String(settings.timeoutMinutes ?? 5);
    el.mode.value = ['placeholder', 'smart', 'discard'].includes(settings.mode) ? settings.mode : 'discard';
    if (el.checkPeriod) el.checkPeriod.value = ['1', '2', '5'].includes(String(settings.checkPeriodMinutes)) ? String(settings.checkPeriodMinutes) : '1';
    if (el.excludedDomains) el.excludedDomains.value = Array.isArray(settings.excludedDomains) ? settings.excludedDomains.join('\n') : '';
    if (el.smartRulesEnabled) el.smartRulesEnabled.checked = settings.smartRulesEnabled === true;
    if (el.smartDefaultMode) el.smartDefaultMode.value = settings.smartDefaultMode === 'placeholder' ? 'placeholder' : 'discard';
    if (el.smartHeuristicsFallback) el.smartHeuristicsFallback.checked = settings.smartUseHeuristicsFallback !== false;
    if (el.smartPlaceholderDomains) el.smartPlaceholderDomains.value = Array.isArray(settings.smartPlaceholderDomains) ? settings.smartPlaceholderDomains.join('\n') : '';
    if (el.smartDiscardDomains) el.smartDiscardDomains.value = Array.isArray(settings.smartDiscardDomains) ? settings.smartDiscardDomains.join('\n') : '';
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
      mode: ['placeholder', 'smart', 'discard'].includes(el.mode.value) ? el.mode.value : 'discard',
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
  try {
    const r = await send({ type: 'closeAndSaveAll' });
    el.closeSave.textContent = (r?.closed || 0) > 0 ? `Closed: ${r.closed}` : 'Done';
    refreshThStats();
  } catch { el.closeSave.textContent = 'Error'; }
  setTimeout(() => { el.closeSave.textContent = 'Close all and save'; el.closeSave.disabled = false; }, 2000);
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
      recoverBtn.textContent = n > 0 ? `Recovered: ${n} (placeholders)` : 'No lost tabs';
      refreshThStats();
    } catch {
      recoverBtn.textContent = 'Error';
    }
    setTimeout(() => { recoverBtn.textContent = 'Recover lost tabs'; recoverBtn.disabled = false; }, 2000);
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.closedAndSaved) refreshThStats();
});

loadThSettings().then(refreshThStats);

// Site Blocker
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

function renderBlocker(blocked, enabled) {
  const list = document.getElementById('blockerList');
  const empty = document.getElementById('blockerEmpty');
  const toggle = document.getElementById('blockerToggle');
  toggle.checked = enabled;
  list.innerHTML = '';
  if (!blocked.length) {
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  blocked.forEach((d) => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${esc(d)}</span><button class="rm" data-domain="${esc(d)}">Remove</button>`;
    list.appendChild(li);
  });
  list.querySelectorAll('.rm').forEach((b) => {
    b.addEventListener('click', () => removeDomain(b.dataset.domain));
  });
}

function addDomain() {
  const domain = normDomain(document.getElementById('blockerInput').value);
  if (!domain) return;
  document.getElementById('blockerInput').value = '';
  chrome.storage.local.get(['blocked'], (data) => {
    const blocked = data.blocked || [];
    if (blocked.includes(domain)) return;
    blocked.push(domain);
    chrome.storage.local.set({ blocked }, () => renderBlocker(blocked, document.getElementById('blockerToggle').checked));
  });
}

function removeDomain(domain) {
  chrome.storage.local.get(['blocked'], (data) => {
    const blocked = (data.blocked || []).filter((d) => d !== domain);
    chrome.storage.local.set({ blocked }, () => renderBlocker(blocked, document.getElementById('blockerToggle').checked));
  });
}

document.getElementById('blockerToggle').addEventListener('change', () => {
  const enabled = document.getElementById('blockerToggle').checked;
  chrome.storage.local.get(['blocked'], (data) => {
    chrome.storage.local.set({ enabled }, () => renderBlocker(data.blocked || [], enabled));
  });
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
  statusEl.textContent = 'Loading…';
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
    // Параллельное открытие вкладок — быстрая массовая блокировка вместо по одной
    await Promise.all(urls.map((url) => chrome.tabs.create({ url })));
    statusEl.textContent = urls.length > 0 ? `Opened: ${urls.length}` : 'No visits to blocked sites';
  } catch (e) {
    statusEl.textContent = 'Error: ' + (e.message || '');
  }
  btn.disabled = false;
  setTimeout(() => { statusEl.textContent = ''; }, 4000);
});

document.getElementById('blockerAdd').addEventListener('click', addDomain);
document.getElementById('blockerInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') addDomain(); });

chrome.storage.local.get(['blocked', 'enabled'], (data) => {
  const blocked = data.blocked || [];
  const enabled = data.enabled !== false;
  renderBlocker(blocked, enabled);
});

// Memory Cleaner
document.getElementById('btnDiscard').addEventListener('click', async () => {
  const btn = document.getElementById('btnDiscard');
  const st = document.getElementById('memoryStatus');
  btn.disabled = true;
  st.textContent = 'Discarding…';
  try {
    const r = await send({
      type: 'discardBackgroundTabs',
      skipPinned: document.getElementById('memorySkipPinned').checked,
    });
    const n = r?.discarded ?? 0;
    st.textContent = n > 0 ? `${n} tabs discarded` : 'Done (no tabs to discard)';
  } catch {
    st.textContent = 'Error';
  }
  btn.disabled = false;
  setTimeout(() => { st.textContent = ''; }, 3000);
});

// Site Data Clear
document.getElementById('btnClear').addEventListener('click', async () => {
  const st = document.getElementById('clearStatus');
  const optC = document.getElementById('clearCookies').checked;
  const optL = document.getElementById('clearLocal').checked;
  const optS = document.getElementById('clearSession').checked;
  if (!optC && !optL && !optS) {
    st.textContent = 'Select at least one option';
    st.className = 'err';
    return;
  }
  st.textContent = '';
  st.className = '';
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) {
    st.textContent = 'No active tab';
    st.className = 'err';
    return;
  }
  try {
    const url = new URL(tab.url);
    const origin = url.origin;
    if (url.protocol === 'chrome:' || url.protocol === 'chrome-extension:') {
      st.textContent = 'Not available for system pages';
      st.className = 'err';
      return;
    }
    const opts = { origins: [origin], since: 0 };
    const data = {};
    if (optC) data.cookies = true;
    if (optL) data.localStorage = true;
    if (Object.keys(data).length) await chrome.browsingData.remove(opts, data);
    if (optS) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => { sessionStorage.clear(); },
      });
    }
    st.textContent = 'Done';
    st.className = 'ok';
    setTimeout(() => chrome.tabs.reload(tab.id), 800);
  } catch (e) {
    st.textContent = 'Error: ' + (e.message || 'unknown');
    st.className = 'err';
  }
});
