/**
 * Site Blocker popup: переключатель вкл/выкл, список доменов, добавление/удаление.
 */

const toggleEl = document.getElementById('toggle');
const inputEl = document.getElementById('input');
const btnAdd = document.getElementById('btnAdd');
const listEl = document.getElementById('list');
const emptyEl = document.getElementById('empty');

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

function render(blocked, enabled) {
  toggleEl.classList.toggle('on', enabled);
  toggleEl.setAttribute('aria-pressed', enabled);
  listEl.innerHTML = '';
  if (blocked.length === 0) {
    emptyEl.style.display = 'block';
    return;
  }
  emptyEl.style.display = 'none';
  blocked.forEach((domain) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="domain">${escapeHtml(domain)}</span><button type="button" class="remove" data-domain="${escapeHtml(domain)}">Удалить</button>`;
    listEl.appendChild(li);
  });
  listEl.querySelectorAll('.remove').forEach((btn) => {
    btn.addEventListener('click', () => removeDomain(btn.dataset.domain));
  });
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
    chrome.storage.local.set({ blocked }, () => render(blocked, toggleEl.classList.contains('on')));
  });
}

function removeDomain(domain) {
  chrome.storage.local.get(['blocked'], (data) => {
    const blocked = (data.blocked || []).filter((d) => d !== domain);
    chrome.storage.local.set({ blocked }, () => render(blocked, toggleEl.classList.contains('on')));
  });
}

toggleEl.addEventListener('click', () => {
  const enabled = !toggleEl.classList.contains('on');
  chrome.storage.local.get(['blocked'], (data) => {
    const blocked = data.blocked || [];
    chrome.storage.local.set({ enabled }, () => render(blocked, enabled));
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

document.getElementById('btnOpenBlocked').addEventListener('click', async () => {
  const statusEl = document.getElementById('blockerStatus');
  const btn = document.getElementById('btnOpenBlocked');
  btn.disabled = true;
  statusEl.textContent = 'Загрузка…';
  try {
    const { blocked = [] } = await chrome.storage.local.get('blocked');
    if (!blocked.length) {
      statusEl.textContent = 'Нет заблокированных доменов';
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
    statusEl.textContent = urls.length > 0 ? `Открыто: ${urls.length}` : 'Нет посещений заблокированных сайтов';
  } catch (e) {
    statusEl.textContent = 'Ошибка: ' + (e.message || '');
  }
  btn.disabled = false;
  setTimeout(() => { statusEl.textContent = ''; }, 4000);
});

btnAdd.addEventListener('click', addDomain);
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addDomain();
});

chrome.storage.local.get(['blocked', 'enabled'], (data) => {
  const blocked = data.blocked || [];
  const enabled = data.enabled !== false;
  render(blocked, enabled);
});
