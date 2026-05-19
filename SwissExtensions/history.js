/**
 * History page: list closedAndSaved + backup_* from storage, export to JSON file, import from file, open selected as tabs.
 * closedSavedMax limit is requested from the service worker (single source: service_worker.js).
 */

async function loadAll() {
  const raw = await chrome.storage.local.get(null);
  const closedAndSaved = Array.isArray(raw.closedAndSaved) ? raw.closedAndSaved : [];
  const blockedTabsSaved = Array.isArray(raw.blockedTabsSaved) ? raw.blockedTabsSaved : [];
  const backups = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key.startsWith('backup_') && Array.isArray(value)) backups[key.slice(7)] = value;
  }
  return { closedAndSaved, blockedTabsSaved, backups };
}

/** Render saved URL list (closed or site-blocker). */
function renderSavedUrlList(listEl, items, { emptyText, checkboxClass, selectAllRowId, selectAllCbId }) {
  const selectAllRow = document.getElementById(selectAllRowId);
  const selectAllCb = document.getElementById(selectAllCbId);
  listEl.innerHTML = '';
  if (!items.length) {
    listEl.innerHTML = `<li class="empty">${emptyText}</li>`;
    if (selectAllRow) selectAllRow.style.display = 'none';
    return;
  }
  if (selectAllRow) selectAllRow.style.display = 'flex';
  for (const item of items) {
    const li = document.createElement('li');
    li.dataset.url = item.url || '';
    const date = item.savedAt ? new Date(item.savedAt).toLocaleString() : '—';
    const sub = item.domain ? ` · ${item.domain}` : '';
    li.innerHTML = `
      <span class="checkbox-wrap">
        <input type="checkbox" class="${checkboxClass}" data-url="${escapeAttr(item.url)}">
        <span class="checkbox-box" aria-hidden="true"></span>
      </span>
      <div class="item-content">
        <div class="item-title" title="${escapeAttr(item.title || item.url)}">${escapeHtml(item.title || item.url || '—')}</div>
        <div class="item-url" title="${escapeAttr(item.url)}">${escapeHtml(item.url || '')}</div>
      </div>
      <span class="item-meta">${escapeHtml(date)}${escapeHtml(sub)}</span>
    `;
    listEl.appendChild(li);
  }
  bindSelectAll(listEl, selectAllCb, checkboxClass);
}

function renderClosed(listEl, items) {
  renderSavedUrlList(listEl, items, {
    emptyText: 'No closed-and-saved tabs.',
    checkboxClass: 'cb-closed',
    selectAllRowId: 'selectAllRow',
    selectAllCbId: 'selectAllClosed',
  });
}

function renderBlockedSaved(listEl, items) {
  renderSavedUrlList(listEl, items, {
    emptyText: 'No saved blocked-site tabs yet.',
    checkboxClass: 'cb-blocked-saved',
    selectAllRowId: 'blockedSelectAllRow',
    selectAllCbId: 'selectAllBlocked',
  });
}

/** Wire "Select all" checkbox to row checkboxes; sync state when rows change */
function bindSelectAll(listEl, selectAllCb, checkboxClass = 'cb-closed') {
  if (!selectAllCb) return;
  const checkboxes = () => listEl.querySelectorAll(`.${checkboxClass}`);
  const updateSelectAllState = () => {
    const cbs = checkboxes();
    const n = cbs.length;
    const checked = Array.from(cbs).filter((cb) => cb.checked).length;
    selectAllCb.checked = n > 0 && checked === n;
    selectAllCb.indeterminate = checked > 0 && checked < n;
  };
  selectAllCb.checked = false;
  selectAllCb.indeterminate = false;
  selectAllCb.removeEventListener('change', window.__selectAllHandler);
  window.__selectAllHandler = () => {
    const checked = selectAllCb.checked;
    checkboxes().forEach((cb) => { cb.checked = checked; });
  };
  selectAllCb.addEventListener('change', window.__selectAllHandler);
  listEl.addEventListener('change', (e) => {
    if (e.target.classList.contains(checkboxClass)) updateSelectAllState();
  });
}

function renderBackups(listEl, backups) {
  listEl.innerHTML = '';
  const dates = Object.keys(backups).sort().reverse();
  if (!dates.length) {
    listEl.innerHTML = '<li class="empty">No backup dates.</li>';
    return;
  }
  for (const date of dates) {
    const items = backups[date];
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="checkbox-wrap">
        <input type="checkbox" class="cb-backup" data-date="${escapeAttr(date)}">
        <span class="checkbox-box" aria-hidden="true"></span>
      </span>
      <div class="item-content">
        <div class="item-title">${escapeHtml(date)}</div>
        <div class="item-url">${items.length} tab(s)</div>
      </div>
      <span class="item-meta"></span>
    `;
    listEl.appendChild(li);
  }
}

function escapeHtml(s) {
  if (s == null) return '';
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}
function escapeAttr(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** From  URL  ,  . */
function getCheckedClosedUrls() {
  const urls = new Set();
  document.querySelectorAll('.cb-closed:checked').forEach((cb) => {
    const u = cb.dataset?.url;
    if (u) urls.add(u);
  });
  return urls;
}

async function refresh() {
  const checkedUrls = getCheckedClosedUrls();
  const data = await loadAll();
  window.__backupsCache = data;
  renderClosed(document.getElementById('closedList'), data.closedAndSaved);
  renderBlockedSaved(document.getElementById('blockedSavedList'), data.blockedTabsSaved);
  renderBackups(document.getElementById('backupList'), data.backups);
  document.querySelectorAll('.cb-closed').forEach((cb) => {
    if (checkedUrls.has(cb.dataset?.url)) cb.checked = true;
  });
  const selectAllCb = document.getElementById('selectAllClosed');
  if (selectAllCb) {
    const cbs = document.querySelectorAll('.cb-closed');
    const n = cbs.length;
    const checked = cbs.length && Array.from(cbs).every((c) => c.checked);
    selectAllCb.checked = checked;
    selectAllCb.indeterminate = Array.from(cbs).some((c) => c.checked) && !checked;
  }
}

function getSelectedUrls() {
  const urls = [];
  document.querySelectorAll('.cb-closed:checked').forEach((cb) => {
    const u = cb.dataset.url;
    if (u) urls.push(u);
  });
  document.querySelectorAll('.cb-backup:checked').forEach((cb) => {
    const date = cb.dataset.date;
    if (!date) return;
    const backupData = window.__backupsCache?.backups?.[date];
    if (Array.isArray(backupData)) backupData.forEach((item) => item.url && urls.push(item.url));
  });
  return [...new Set(urls)];
}

/**   {url, title} — of Closed and saved  Backups. */
function getSelectedItems() {
  const seen = new Set();
  const items = [];
  document.querySelectorAll('.cb-closed:checked').forEach((cb) => {
    const url = cb.dataset.url;
    if (!url || seen.has(url)) return;
    seen.add(url);
    const cached = (window.__backupsCache?.closedAndSaved ?? []).find((x) => x.url === url);
    items.push({ url, title: cached?.title ?? url });
  });
  document.querySelectorAll('.cb-blocked-saved:checked').forEach((cb) => {
    const url = cb.dataset.url;
    if (!url || seen.has(url)) return;
    seen.add(url);
    const cached = (window.__backupsCache?.blockedTabsSaved ?? []).find((x) => x.url === url);
    items.push({ url, title: cached?.title ?? url });
  });
  document.querySelectorAll('.cb-backup:checked').forEach((cb) => {
    const date = cb.dataset.date;
    if (!date) return;
    const backupData = window.__backupsCache?.backups?.[date];
    if (!Array.isArray(backupData)) return;
    backupData.forEach((item) => {
      if (item?.url && !seen.has(item.url)) {
        seen.add(item.url);
        items.push({ url: item.url, title: item.title ?? item.url });
      }
    });
  });
  return items;
}

/**     placeholder (). Remove of closedAndSaved. */
async function openSelected() {
  const items = getSelectedItems();
  if (!items.length) return alert('Select at least one item.');
  const urlSet = new Set(items.map((x) => x.url));
  const closed = window.__backupsCache?.closedAndSaved ?? [];
  const remaining = closed.filter((x) => !x.url || !urlSet.has(x.url));
  if (remaining.length !== closed.length) {
    await chrome.storage.local.set({ closedAndSaved: remaining });
    if (window.__backupsCache) window.__backupsCache.closedAndSaved = remaining;
  }
  const blocked = window.__backupsCache?.blockedTabsSaved ?? [];
  const remainingBlocked = blocked.filter((x) => !x.url || !urlSet.has(x.url));
  if (remainingBlocked.length !== blocked.length) {
    await chrome.storage.local.set({ blockedTabsSaved: remainingBlocked });
    if (window.__backupsCache) window.__backupsCache.blockedTabsSaved = remainingBlocked;
  }
  try {
    await chrome.runtime.sendMessage({ type: 'openUrlsAsPlaceholders', items });
  } catch (e) {
    console.warn(e);
    alert('Error: ' + (e?.message || e));
  }
  await refresh();
}

/**   of Closed and saved  placeholder (). From  . */
async function openAll() {
  const items = window.__backupsCache?.closedAndSaved;
  if (!Array.isArray(items) || !items.length) return alert('No closed-and-saved tabs.');
  const toOpen = items.map((x) => ({ url: x.url, title: x.title ?? x.url })).filter((x) => x.url);
  if (!toOpen.length) return alert('No URLs to open.');
  await chrome.storage.local.set({ closedAndSaved: [] });
  if (window.__backupsCache) window.__backupsCache.closedAndSaved = [];
  await refresh();
  try {
    await chrome.runtime.sendMessage({ type: 'openUrlsAsPlaceholders', items: toOpen });
  } catch (e) {
    console.warn(e);
    alert('Error: ' + (e?.message || e));
  }
}

/** Remove   ( ).  Closed and saved —  URL; of Backups —  . */
async function removeSelected() {
  const urlSet = new Set();
  const backupDatesToRemove = new Set();
  document.querySelectorAll('.cb-closed:checked').forEach((cb) => {
    const u = cb.dataset.url;
    if (u) urlSet.add(u);
  });
  document.querySelectorAll('.cb-backup:checked').forEach((cb) => {
    const date = cb.dataset.date;
    if (date) backupDatesToRemove.add(date);
  });
  if (!urlSet.size && !backupDatesToRemove.size) return alert('Select at least one item.');
  const closed = (window.__backupsCache?.closedAndSaved ?? []).filter((x) => !x.url || !urlSet.has(x.url));
  const backups = { ...(window.__backupsCache?.backups ?? {}) };
  for (const date of backupDatesToRemove) delete backups[date];
  await chrome.storage.local.set({ closedAndSaved: closed });
  for (const date of backupDatesToRemove) await chrome.storage.local.remove(`backup_${date}`);
  window.__backupsCache = { closedAndSaved: closed, backups };
  await refresh();
}

function exportData() {
  const data = {
    closedAndSaved: window.__backupsCache?.closedAndSaved ?? [],
    blockedTabsSaved: window.__backupsCache?.blockedTabsSaved ?? [],
    backups: window.__backupsCache?.backups ?? {},
    exportedAt: new Date().toISOString(),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const filename = `tab-hibernate-backup-${new Date().toISOString().slice(0, 10)}.json`;
  chrome.downloads.download({ url, filename, saveAs: true }, () => {
    URL.revokeObjectURL(url);
  });
}

async function importData(file) {
  const text = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('Read failed'));
    r.readAsText(file, 'UTF-8');
  });
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    alert('Invalid JSON file.');
    return;
  }
  const existing = await loadAll();
  const maxClosed = window.__closedSavedMax ?? 2000;
  const closedAndSaved = [...(Array.isArray(data.closedAndSaved) ? data.closedAndSaved : []), ...existing.closedAndSaved].slice(0, maxClosed);
  const blockedTabsSaved = [...(Array.isArray(data.blockedTabsSaved) ? data.blockedTabsSaved : []), ...existing.blockedTabsSaved].slice(0, maxClosed);
  const backups = { ...existing.backups };
  if (data.backups && typeof data.backups === 'object') {
    for (const [date, list] of Object.entries(data.backups)) {
      if (!Array.isArray(list)) continue;
      const key = `backup_${date}`;
      const current = backups[date] || [];
      const seen = new Set(current.map((x) => x.url));
      for (const item of list) {
        if (item && item.url && !seen.has(item.url)) {
          current.push({ url: item.url, title: item.title || item.url, ts: item.ts || Date.now() });
          seen.add(item.url);
        }
      }
      backups[date] = current;
    }
  }
  const toSet = { closedAndSaved, blockedTabsSaved };
  for (const [date, list] of Object.entries(backups)) toSet[`backup_${date}`] = list;
  await chrome.storage.local.set(toSet);
  window.__backupsCache = { closedAndSaved, blockedTabsSaved, backups };
  await refresh();
  alert('Import done.');
}

/** Синхронизация переключателя темы с uiTheme (как в side panel). */
const HISTORY_UI_THEME_KEY = 'uiTheme';

function initHistoryThemeSwitcher() {
  const darkBtn = document.getElementById('historyThemeDark');
  const lightBtn = document.getElementById('historyThemeLight');
  if (!darkBtn || !lightBtn) return;

  const apply = (mode) => {
    document.documentElement.dataset.theme = mode === 'light' ? 'light' : 'dark';
  };

  const sync = () => {
    const t = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    darkBtn.classList.toggle('active', t === 'dark');
    lightBtn.classList.toggle('active', t === 'light');
  };

  darkBtn.addEventListener('click', () => {
    apply('dark');
    chrome.storage.local.set({ [HISTORY_UI_THEME_KEY]: 'dark' }, sync);
  });
  lightBtn.addEventListener('click', () => {
    apply('light');
    chrome.storage.local.set({ [HISTORY_UI_THEME_KEY]: 'light' }, sync);
  });

  chrome.storage.local.get([HISTORY_UI_THEME_KEY], (r) => {
    if (!chrome.runtime.lastError) apply(r[HISTORY_UI_THEME_KEY]);
    sync();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[HISTORY_UI_THEME_KEY]) return;
    apply(changes[HISTORY_UI_THEME_KEY].newValue);
    sync();
  });
}

let __histRecoverItems = [];

function formatHistRecoverTime(ts) {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString();
  } catch (_) {
    return '—';
  }
}

function renderHistRecoverList(items) {
  const listEl = document.getElementById('histRecoverList');
  const selectRow = document.getElementById('histRecoverSelectAllRow');
  const countEl = document.getElementById('histRecoverCount');
  const openSel = document.getElementById('histRecoverOpenSelected');
  const openAll = document.getElementById('histRecoverOpenAll');
  if (!listEl) return;
  listEl.innerHTML = '';
  if (!items.length) {
    listEl.innerHTML = '<li class="empty">Scan history to see recoverable URLs.</li>';
    if (selectRow) selectRow.style.display = 'none';
    if (countEl) countEl.textContent = '';
    if (openSel) openSel.disabled = true;
    if (openAll) openAll.disabled = true;
    return;
  }
  if (selectRow) selectRow.style.display = 'flex';
  if (countEl) countEl.textContent = `${items.length} URL(s)`;
  if (openSel) openSel.disabled = false;
  if (openAll) openAll.disabled = false;
  for (const item of items) {
    const li = document.createElement('li');
    li.dataset.url = item.url || '';
    const when = formatHistRecoverTime(item.lastVisitTime);
    li.innerHTML = `
      <span class="checkbox-wrap">
        <input type="checkbox" class="cb-hist-recover" data-url="${escapeAttr(item.url)}">
        <span class="checkbox-box" aria-hidden="true"></span>
      </span>
      <div class="item-content">
        <div class="item-title" title="${escapeAttr(item.title || item.url)}">${escapeHtml(item.title || item.url || '—')}</div>
        <div class="item-url" title="${escapeAttr(item.url)}">${escapeHtml(item.url || '')}</div>
      </div>
      <span class="item-meta">${escapeHtml(when)}</span>
    `;
    listEl.appendChild(li);
  }
  const selectAllCb = document.getElementById('histRecoverSelectAll');
  if (selectAllCb) {
    selectAllCb.checked = false;
    selectAllCb.indeterminate = false;
    selectAllCb.onchange = () => {
      const checked = selectAllCb.checked;
      listEl.querySelectorAll('.cb-hist-recover').forEach((cb) => { cb.checked = checked; });
    };
  }
}

function getSelectedHistRecoverItems() {
  const seen = new Set();
  const items = [];
  document.querySelectorAll('.cb-hist-recover:checked').forEach((cb) => {
    const url = cb.dataset.url;
    if (!url || seen.has(url)) return;
    seen.add(url);
    const found = __histRecoverItems.find((x) => x.url === url);
    items.push({ url, title: found?.title ?? url });
  });
  return items;
}

async function scanHistRecover() {
  const btn = document.getElementById('histRecoverScan');
  const hours = Number(document.getElementById('histRecoverHours')?.value) || 24;
  const onlyMissing = document.getElementById('histRecoverOnlyMissing')?.checked !== false;
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Scanning…';
  }
  try {
    const res = await chrome.runtime.sendMessage({
      type: 'searchLostTabsFromHistory',
      hoursBack: hours,
      onlyMissing,
    });
    if (res?.error) {
      alert('Scan failed: ' + res.error);
      __histRecoverItems = [];
    } else {
      __histRecoverItems = Array.isArray(res?.items) ? res.items : [];
    }
    renderHistRecoverList(__histRecoverItems);
  } catch (e) {
    alert('Scan failed: ' + (e?.message || e));
    __histRecoverItems = [];
    renderHistRecoverList([]);
  }
  if (btn) {
    btn.disabled = false;
    btn.textContent = 'Scan history';
  }
}

async function openHistRecoverItems(items) {
  if (!items.length) return alert('Select at least one URL.');
  try {
    await chrome.runtime.sendMessage({ type: 'openUrlsAsPlaceholders', items });
  } catch (e) {
    alert('Open failed: ' + (e?.message || e));
  }
}

function initHistRecoverUi() {
  document.getElementById('histRecoverScan')?.addEventListener('click', scanHistRecover);
  document.getElementById('histRecoverOpenSelected')?.addEventListener('click', async () => {
    await openHistRecoverItems(getSelectedHistRecoverItems());
  });
  document.getElementById('histRecoverOpenAll')?.addEventListener('click', async () => {
    if (!__histRecoverItems.length) return alert('Scan history first.');
    await openHistRecoverItems(__histRecoverItems.map(({ url, title }) => ({ url, title: title || url })));
  });
  renderHistRecoverList([]);
}

async function init() {
  initHistoryThemeSwitcher();
  initHistRecoverUi();
  try {
    const res = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'getConstants' }, resolve);
    });
    if (res && typeof res.closedSavedMax === 'number') {
      window.__closedSavedMax = res.closedSavedMax;
    } else {
      window.__closedSavedMax = 2000;
    }
  } catch (e) {
    window.__closedSavedMax = 2000;
  }
  document.getElementById('exportBtn').addEventListener('click', () => exportData());
  document.getElementById('importBtn').addEventListener('click', () => document.getElementById('importFile').click());
  document.getElementById('importFile').addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    if (f) importData(f);
    e.target.value = '';
  });
  document.getElementById('openSelected').addEventListener('click', openSelected);
  document.getElementById('openAllBtn').addEventListener('click', openAll);
  document.getElementById('removeSelectedBtn').addEventListener('click', removeSelected);
  refresh();
  setInterval(refresh, 3000);
}

init();
