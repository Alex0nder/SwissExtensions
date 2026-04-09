/**
 * Site Blocker popup: site blocking, light filters, EasyList/ABP subscriptions (URL + refresh), import/export.
 */

const toggleEl = document.getElementById('toggle');
const inputEl = document.getElementById('input');
const btnAdd = document.getElementById('btnAdd');
const listEl = document.getElementById('list');
const emptyEl = document.getElementById('empty');
const whitelistInputEl = document.getElementById('whitelistInput');
const btnWhitelistAdd = document.getElementById('btnWhitelistAdd');
const whitelistListEl = document.getElementById('whitelistList');
const whitelistEmptyEl = document.getElementById('whitelistEmpty');
const scheduleToggleEl = document.getElementById('scheduleToggle');
const scheduleFromEl = document.getElementById('scheduleFrom');
const scheduleToEl = document.getElementById('scheduleTo');
const scheduleDaysEl = document.getElementById('scheduleDays');
const btnExport = document.getElementById('btnExport');
const btnImport = document.getElementById('btnImport');
const importFileEl = document.getElementById('importFile');
const adsFilterToggleEl = document.getElementById('adsFilterToggle');
const filterListToggleEl = document.getElementById('filterListToggle');
const filterListUrlEl = document.getElementById('filterListUrl');
const filterListUrl2El = document.getElementById('filterListUrl2');
const filterListMetaEl = document.getElementById('filterListMeta');
const btnRefreshFilterList = document.getElementById('btnRefreshFilterList');
const filterListAutoRefreshToggleEl = document.getElementById('filterListAutoRefreshToggle');
const filterListRefreshHoursEl = document.getElementById('filterListRefreshHours');
const adsCosmeticToggleEl = document.getElementById('adsCosmeticToggle');
const DEFAULT_SCHEDULE = { enabled: false, from: '09:00', to: '18:00', days: [1, 2, 3, 4, 5] };

function normalizeDomain(input) {
  let s = (input || '').trim().toLowerCase();
  if (!s) return '';
  try {
    if (!s.startsWith('http')) s = 'https://' + s;
    return new URL(s).hostname.replace(/^www\./, '') || '';
  } catch {
    return s.replace(/^www\./, '').split('/')[0].split('?')[0];
  }
}

function render(blocked, whitelist, enabled, schedule, scheduleActive, adsFiltersEnabled) {
  toggleEl.classList.toggle('on', enabled);
  toggleEl.setAttribute('aria-pressed', enabled);
  const adsOn = adsFiltersEnabled !== false;
  adsFilterToggleEl.classList.toggle('on', adsOn);
  adsFilterToggleEl.setAttribute('aria-pressed', adsOn);
  listEl.innerHTML = '';
  if (blocked.length === 0) {
    emptyEl.style.display = 'block';
  } else {
    emptyEl.style.display = 'none';
    blocked.forEach((domain) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="domain">${escapeHtml(domain)}</span><button type="button" class="remove" data-domain="${escapeHtml(domain)}">Remove</button>`;
      listEl.appendChild(li);
    });
    listEl.querySelectorAll('.remove').forEach((btn) => {
      btn.addEventListener('click', () => removeDomain(btn.dataset.domain));
    });
  }
  whitelistListEl.innerHTML = '';
  if (!whitelist || whitelist.length === 0) {
    whitelistEmptyEl.style.display = 'block';
  } else {
    whitelistEmptyEl.style.display = 'none';
    whitelist.forEach((domain) => {
      const li = document.createElement('li');
      li.innerHTML = `<span class="domain">${escapeHtml(domain)}</span><button type="button" class="remove-wl" data-domain="${escapeHtml(domain)}">Remove</button>`;
      whitelistListEl.appendChild(li);
    });
    whitelistListEl.querySelectorAll('.remove-wl').forEach((btn) => {
      btn.addEventListener('click', () => removeWhitelistDomain(btn.dataset.domain));
    });
  }
  const safeSchedule = normalizeSchedule(schedule);
  scheduleToggleEl.classList.toggle('on', safeSchedule.enabled);
  scheduleToggleEl.setAttribute('aria-pressed', safeSchedule.enabled);
  scheduleFromEl.value = safeSchedule.from;
  scheduleToEl.value = safeSchedule.to;
  scheduleDaysEl.querySelectorAll('input[data-day]').forEach((cb) => {
    cb.checked = safeSchedule.days.includes(Number(cb.dataset.day));
  });
  const statusEl = document.getElementById('blockerStatus');
  if (statusEl) {
    if (!enabled) statusEl.textContent = 'Blocking disabled manually';
    else if (safeSchedule.enabled) statusEl.textContent = scheduleActive === false ? 'Outside schedule window' : 'Inside schedule window';
    else statusEl.textContent = '';
  }
}

function formatFilterListMeta(data) {
  const on = data.filterListEnabled === true;
  if (!on) return 'Subscription is disabled.';
  const n = data.filterListDomainCount;
  if (data.filterListLastError) return `Error: ${data.filterListLastError}`;
  const autoOn = data.filterListAutoRefreshEnabled !== false;
  const h = Math.max(6, Math.min(168, Number(data.filterListAutoRefreshHours) || 24));
  const autoTxt = autoOn ? `Auto: every ${h}h.` : 'Auto: off.';
  if (n != null && n > 0) {
    const t = data.filterListLastOk ? new Date(data.filterListLastOk).toLocaleString('ru') : '';
    const a = data.filterListAllowCount;
    const allowPart = a != null && a > 0 ? ` · @@ ${a}` : '';
    return `Block: ${n}${allowPart}${t ? ` · ${t}` : ''} · ${autoTxt}`;
  }
  return `Enabled. Click "Refresh list". ${autoTxt}`;
}

async function loadFilterListUi() {
  const data = await chrome.storage.local.get([
    'filterListUrl',
    'filterListUrl2',
    'filterListEnabled',
    'filterListLastOk',
    'filterListLastError',
    'filterListDomainCount',
    'filterListAllowCount',
    'filterListAutoRefreshEnabled',
    'filterListAutoRefreshHours',
  ]);
  filterListUrlEl.value = data.filterListUrl || '';
  if (filterListUrl2El) filterListUrl2El.value = data.filterListUrl2 || '';
  const flOn = data.filterListEnabled === true;
  filterListToggleEl.classList.toggle('on', flOn);
  filterListToggleEl.setAttribute('aria-pressed', flOn);
  if (filterListAutoRefreshToggleEl) {
    const arOn = data.filterListAutoRefreshEnabled !== false;
    filterListAutoRefreshToggleEl.classList.toggle('on', arOn);
    filterListAutoRefreshToggleEl.setAttribute('aria-pressed', arOn);
  }
  if (filterListRefreshHoursEl) {
    const h = Math.max(6, Math.min(168, Number(data.filterListAutoRefreshHours) || 24));
    filterListRefreshHoursEl.value = String(h);
  }
  filterListMetaEl.textContent = formatFilterListMeta(data);
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function addDomain() {
  const raw = inputEl.value;
  const domain = normalizeDomain(raw);
  if (!domain) return;
  inputEl.value = '';
  chrome.storage.local.get(['blocked'], (data) => {
    const blocked = data.blocked || [];
    if (blocked.includes(domain)) return;
    blocked.push(domain);
    chrome.storage.local.get(['whitelist', 'enabled', 'schedule', 'scheduleStateActive', 'adsFiltersEnabled'], (meta) => {
      chrome.storage.local.set({ blocked }, () => render(blocked, meta.whitelist || [], meta.enabled !== false, meta.schedule || DEFAULT_SCHEDULE, meta.scheduleStateActive !== false, meta.adsFiltersEnabled));
    });
  });
}

function removeDomain(domain) {
  chrome.storage.local.get(['blocked'], (data) => {
    const blocked = (data.blocked || []).filter((d) => d !== domain);
    chrome.storage.local.get(['whitelist', 'enabled', 'schedule', 'scheduleStateActive', 'adsFiltersEnabled'], (meta) => {
      chrome.storage.local.set({ blocked }, () => render(blocked, meta.whitelist || [], meta.enabled !== false, meta.schedule || DEFAULT_SCHEDULE, meta.scheduleStateActive !== false, meta.adsFiltersEnabled));
    });
  });
}

function addWhitelistDomain() {
  const domain = normalizeDomain(whitelistInputEl.value);
  if (!domain) return;
  whitelistInputEl.value = '';
  chrome.storage.local.get(['whitelist'], (data) => {
    const whitelist = data.whitelist || [];
    if (whitelist.includes(domain)) return;
    whitelist.push(domain);
    chrome.storage.local.get(['blocked', 'enabled', 'schedule', 'scheduleStateActive', 'adsFiltersEnabled'], (meta) => {
      chrome.storage.local.set({ whitelist }, () => render(meta.blocked || [], whitelist, meta.enabled !== false, meta.schedule || DEFAULT_SCHEDULE, meta.scheduleStateActive !== false, meta.adsFiltersEnabled));
    });
  });
}

function removeWhitelistDomain(domain) {
  chrome.storage.local.get(['whitelist'], (data) => {
    const whitelist = (data.whitelist || []).filter((d) => d !== domain);
    chrome.storage.local.get(['blocked', 'enabled', 'schedule', 'scheduleStateActive', 'adsFiltersEnabled'], (meta) => {
      chrome.storage.local.set({ whitelist }, () => render(meta.blocked || [], whitelist, meta.enabled !== false, meta.schedule || DEFAULT_SCHEDULE, meta.scheduleStateActive !== false, meta.adsFiltersEnabled));
    });
  });
}

function normalizeSchedule(raw) {
  const source = raw && typeof raw === 'object' ? raw : DEFAULT_SCHEDULE;
  const days = Array.isArray(source.days) ? source.days.map((d) => Number(d)).filter((d) => d >= 0 && d <= 6) : DEFAULT_SCHEDULE.days.slice();
  return {
    enabled: source.enabled === true,
    from: typeof source.from === 'string' ? source.from : DEFAULT_SCHEDULE.from,
    to: typeof source.to === 'string' ? source.to : DEFAULT_SCHEDULE.to,
    days: [...new Set(days)],
  };
}

function saveScheduleFromUi() {
  const days = [...scheduleDaysEl.querySelectorAll('input[data-day]:checked')].map((cb) => Number(cb.dataset.day));
  const schedule = normalizeSchedule({
    enabled: scheduleToggleEl.classList.contains('on'),
    from: scheduleFromEl.value || DEFAULT_SCHEDULE.from,
    to: scheduleToEl.value || DEFAULT_SCHEDULE.to,
    days,
  });
  chrome.storage.local.set({ schedule });
}

toggleEl.addEventListener('click', () => {
  const enabled = !toggleEl.classList.contains('on');
  chrome.storage.local.get(['blocked'], (data) => {
    const blocked = data.blocked || [];
    chrome.storage.local.get(['whitelist', 'schedule', 'scheduleStateActive', 'adsFiltersEnabled'], (meta) => {
      chrome.storage.local.set({ enabled }, () => render(blocked, meta.whitelist || [], enabled, meta.schedule || DEFAULT_SCHEDULE, meta.scheduleStateActive !== false, meta.adsFiltersEnabled));
    });
  });
});

adsFilterToggleEl.addEventListener('click', () => {
  const adsFiltersEnabled = !adsFilterToggleEl.classList.contains('on');
  chrome.storage.local.get(['blocked', 'whitelist', 'enabled', 'schedule', 'scheduleStateActive'], (data) => {
    chrome.storage.local.set({ adsFiltersEnabled }, () => render(
      data.blocked || [],
      data.whitelist || [],
      data.enabled !== false,
      data.schedule || DEFAULT_SCHEDULE,
      data.scheduleStateActive !== false,
      adsFiltersEnabled
    ));
  });
});

filterListToggleEl.addEventListener('click', () => {
  const filterListEnabled = !filterListToggleEl.classList.contains('on');
  chrome.storage.local.set({ filterListEnabled }, loadFilterListUi);
});

filterListUrlEl.addEventListener('change', () => {
  chrome.storage.local.set({ filterListUrl: filterListUrlEl.value.trim() });
});
if (filterListUrl2El) {
  filterListUrl2El.addEventListener('change', () => {
    chrome.storage.local.set({ filterListUrl2: filterListUrl2El.value.trim() });
  });
}
if (filterListAutoRefreshToggleEl) {
  filterListAutoRefreshToggleEl.addEventListener('click', () => {
    const filterListAutoRefreshEnabled = !filterListAutoRefreshToggleEl.classList.contains('on');
    chrome.storage.local.set({ filterListAutoRefreshEnabled });
    filterListAutoRefreshToggleEl.classList.toggle('on', filterListAutoRefreshEnabled);
    filterListAutoRefreshToggleEl.setAttribute('aria-pressed', filterListAutoRefreshEnabled);
    loadFilterListUi();
  });
}
if (filterListRefreshHoursEl) {
  filterListRefreshHoursEl.addEventListener('change', () => {
    const h = Math.max(6, Math.min(168, Number(filterListRefreshHoursEl.value) || 24));
    filterListRefreshHoursEl.value = String(h);
    chrome.storage.local.set({ filterListAutoRefreshHours: h });
    loadFilterListUi();
  });
}
if (adsCosmeticToggleEl) {
  adsCosmeticToggleEl.addEventListener('click', () => {
    const adsCosmeticLiteEnabled = !adsCosmeticToggleEl.classList.contains('on');
    chrome.storage.local.set({ adsCosmeticLiteEnabled });
    adsCosmeticToggleEl.classList.toggle('on', adsCosmeticLiteEnabled);
    adsCosmeticToggleEl.setAttribute('aria-pressed', adsCosmeticLiteEnabled);
  });
}

const filterListPresetsEl = document.getElementById('filterListPresets');
if (filterListPresetsEl) {
  filterListPresetsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-preset-url]');
    if (!btn) return;
    const u = (btn.getAttribute('data-preset-url') || '').trim();
    if (!u) return;
    filterListUrlEl.value = u;
    chrome.storage.local.set({ filterListUrl: u });
  });
}

btnRefreshFilterList.addEventListener('click', () => {
  btnRefreshFilterList.disabled = true;
  filterListMetaEl.textContent = 'Loading...';
  chrome.runtime.sendMessage({ type: 'refreshFilterList' }, () => {
    const err = chrome.runtime.lastError;
    btnRefreshFilterList.disabled = false;
    if (err) {
      filterListMetaEl.textContent = 'Error: ' + err.message;
      return;
    }
    loadFilterListUi();
  });
});

scheduleToggleEl.addEventListener('click', () => {
  const enabled = !scheduleToggleEl.classList.contains('on');
  scheduleToggleEl.classList.toggle('on', enabled);
  scheduleToggleEl.setAttribute('aria-pressed', String(enabled));
  saveScheduleFromUi();
});
scheduleFromEl.addEventListener('change', saveScheduleFromUi);
scheduleToEl.addEventListener('change', saveScheduleFromUi);
scheduleDaysEl.querySelectorAll('input[data-day]').forEach((cb) => cb.addEventListener('change', saveScheduleFromUi));

function hostMatchesBlocked(hostname, blockedDomains) {
  if (!hostname) return false;
  const h = hostname.replace(/^www\./, '').toLowerCase();
  for (const d of blockedDomains) {
    if (h === d || h.endsWith('.' + d)) return true;
  }
  return false;
}

document.getElementById('btnOpenBlocked').addEventListener('click', async () => {
  const statusEl = document.getElementById('blockerStatus');
  const btn = document.getElementById('btnOpenBlocked');
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
    // Open tabs in parallel for fast bulk blocking.
    await Promise.all(urls.map((url) => chrome.tabs.create({ url })));
    statusEl.textContent = urls.length > 0 ? `Opened: ${urls.length}` : 'No visits for blocked domains';
  } catch (e) {
    statusEl.textContent = 'Error: ' + (e.message || '');
  }
  btn.disabled = false;
  setTimeout(() => { statusEl.textContent = ''; }, 4000);
});

btnAdd.addEventListener('click', addDomain);
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addDomain();
});
btnWhitelistAdd.addEventListener('click', addWhitelistDomain);
whitelistInputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addWhitelistDomain();
});

btnExport.addEventListener('click', async () => {
  const payload = await chrome.storage.local.get([
    'blocked', 'whitelist', 'enabled', 'schedule', 'adsFiltersEnabled',
    'adsCosmeticLiteEnabled',
    'filterListUrl', 'filterListUrl2', 'filterListEnabled', 'filterListDomains', 'filterListAllowDomains',
    'filterListLastOk', 'filterListAutoRefreshEnabled', 'filterListAutoRefreshHours',
  ]);
  const blob = new Blob([JSON.stringify({
    version: 1,
    exportedAt: new Date().toISOString(),
    blocked: payload.blocked || [],
    whitelist: payload.whitelist || [],
    enabled: payload.enabled !== false,
    schedule: normalizeSchedule(payload.schedule),
    adsFiltersEnabled: payload.adsFiltersEnabled !== false,
    adsCosmeticLiteEnabled: payload.adsCosmeticLiteEnabled === true,
    filterListUrl: payload.filterListUrl || '',
    filterListUrl2: payload.filterListUrl2 || '',
    filterListEnabled: payload.filterListEnabled === true,
    filterListDomains: payload.filterListDomains || [],
    filterListAllowDomains: payload.filterListAllowDomains || [],
    filterListLastOk: payload.filterListLastOk || null,
    filterListAutoRefreshEnabled: payload.filterListAutoRefreshEnabled !== false,
    filterListAutoRefreshHours: Math.max(6, Math.min(168, Number(payload.filterListAutoRefreshHours) || 24)),
  }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `site-blocker-config-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

btnImport.addEventListener('click', () => importFileEl.click());
importFileEl.addEventListener('change', async () => {
  const file = importFileEl.files && importFileEl.files[0];
  if (!file) return;
  const statusEl = document.getElementById('blockerStatus');
  try {
    const text = await file.text();
    const json = JSON.parse(text);
    const blocked = Array.isArray(json.blocked) ? json.blocked.map(normalizeDomain).filter(Boolean) : [];
    const whitelist = Array.isArray(json.whitelist) ? json.whitelist.map(normalizeDomain).filter(Boolean) : [];
    const enabled = json.enabled !== false;
    const schedule = normalizeSchedule(json.schedule);
    const adsFiltersEnabled = json.adsFiltersEnabled !== false;
    const adsCosmeticLiteEnabled = json.adsCosmeticLiteEnabled === true;
    const filterListUrl = typeof json.filterListUrl === 'string' ? json.filterListUrl : '';
    const filterListUrl2 = typeof json.filterListUrl2 === 'string' ? json.filterListUrl2 : '';
    const filterListEnabled = json.filterListEnabled === true;
    const filterListDomains = Array.isArray(json.filterListDomains) ? json.filterListDomains : [];
    const filterListAllowDomains = Array.isArray(json.filterListAllowDomains) ? json.filterListAllowDomains : [];
    const filterListLastOk = json.filterListLastOk != null ? json.filterListLastOk : null;
    const filterListAutoRefreshEnabled = json.filterListAutoRefreshEnabled !== false;
    const filterListAutoRefreshHours = Math.max(6, Math.min(168, Number(json.filterListAutoRefreshHours) || 24));
    await chrome.storage.local.set({
      blocked: [...new Set(blocked)],
      whitelist: [...new Set(whitelist)],
      enabled,
      schedule,
      adsFiltersEnabled,
      adsCosmeticLiteEnabled,
      filterListUrl,
      filterListUrl2,
      filterListEnabled,
      filterListDomains,
      filterListAllowDomains,
      filterListLastOk,
      filterListLastError: '',
      filterListDomainCount: filterListDomains.length,
      filterListAllowCount: filterListAllowDomains.length,
      filterListAutoRefreshEnabled,
      filterListAutoRefreshHours,
    });
    const snap = await chrome.storage.local.get(['blocked', 'whitelist', 'enabled', 'schedule', 'scheduleStateActive', 'adsFiltersEnabled']);
    render(snap.blocked || [], snap.whitelist || [], snap.enabled !== false, snap.schedule || DEFAULT_SCHEDULE, snap.scheduleStateActive !== false, snap.adsFiltersEnabled);
    const cos = await chrome.storage.local.get('adsCosmeticLiteEnabled');
    if (adsCosmeticToggleEl) {
      const cOn = cos.adsCosmeticLiteEnabled === true;
      adsCosmeticToggleEl.classList.toggle('on', cOn);
      adsCosmeticToggleEl.setAttribute('aria-pressed', cOn);
    }
    await loadFilterListUi();
    statusEl.textContent = 'Import completed';
  } catch (e) {
    statusEl.textContent = 'JSON import error';
  } finally {
    importFileEl.value = '';
  }
});

chrome.storage.local.get(
  ['blocked', 'whitelist', 'enabled', 'schedule', 'scheduleStateActive', 'adsFiltersEnabled', 'adsCosmeticLiteEnabled'],
  (data) => {
    const blocked = data.blocked || [];
    const whitelist = data.whitelist || [];
    const enabled = data.enabled !== false;
    render(blocked, whitelist, enabled, data.schedule || DEFAULT_SCHEDULE, data.scheduleStateActive !== false, data.adsFiltersEnabled);
    if (adsCosmeticToggleEl) {
      const cOn = data.adsCosmeticLiteEnabled === true;
      adsCosmeticToggleEl.classList.toggle('on', cOn);
      adsCosmeticToggleEl.setAttribute('aria-pressed', cOn);
    }
    loadFilterListUi();
  },
);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (
    changes.filterListUrl ||
    changes.filterListUrl2 ||
    changes.filterListEnabled ||
    changes.filterListLastError ||
    changes.filterListDomainCount ||
    changes.filterListAllowCount ||
    changes.filterListLastOk ||
    changes.filterListAutoRefreshEnabled ||
    changes.filterListAutoRefreshHours
  ) {
    loadFilterListUi();
  }
});
