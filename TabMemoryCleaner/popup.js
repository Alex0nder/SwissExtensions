/**
 * Popup: настройки в storage, discard через service worker.
 */
const btn = document.getElementById('btnDiscard');
const statusEl = document.getElementById('status');
const els = {
  skipPinned: document.getElementById('skipPinned'),
  skipAudible: document.getElementById('skipAudible'),
  skipIncognito: document.getElementById('skipIncognito'),
  skipGrouped: document.getElementById('skipGrouped'),
  excludedDomains: document.getElementById('excludedDomains'),
};

function normalizeDomainsText(value) {
  return String(value || '')
    .split('\n')
    .map((line) => line.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
    .filter(Boolean)
    .filter((d, i, arr) => arr.indexOf(d) === i);
}

function readSettingsFromUi() {
  return {
    skipPinned: els.skipPinned.checked,
    skipAudible: els.skipAudible.checked,
    skipIncognito: els.skipIncognito.checked,
    skipGrouped: els.skipGrouped.checked,
    excludedDomains: normalizeDomainsText(els.excludedDomains.value),
  };
}

function applySettingsToUi(s) {
  if (!s) return;
  if (typeof s.skipPinned === 'boolean') els.skipPinned.checked = s.skipPinned;
  if (typeof s.skipAudible === 'boolean') els.skipAudible.checked = s.skipAudible;
  if (typeof s.skipIncognito === 'boolean') els.skipIncognito.checked = s.skipIncognito;
  if (typeof s.skipGrouped === 'boolean') els.skipGrouped.checked = s.skipGrouped;
  const list = Array.isArray(s.excludedDomains) ? s.excludedDomains : [];
  els.excludedDomains.value = list.join('\n');
}

function saveSettings() {
  const raw = readSettingsFromUi();
  els.excludedDomains.value = raw.excludedDomains.join('\n');
  chrome.storage.local.set({ tmcSettings: raw });
}

async function loadSettings() {
  const { tmcSettings } = await chrome.storage.local.get('tmcSettings');
  applySettingsToUi(tmcSettings);
}

['skipPinned', 'skipAudible', 'skipIncognito', 'skipGrouped'].forEach((id) => {
  els[id].addEventListener('change', saveSettings);
});
els.excludedDomains.addEventListener('blur', saveSettings);

btn.addEventListener('click', async () => {
  saveSettings();
  btn.disabled = true;
  statusEl.textContent = 'Discarding…';
  try {
    const res = await chrome.runtime.sendMessage({ type: 'discardBackgroundTabs' });
    const n = res?.discarded ?? 0;
    statusEl.textContent = n > 0 ? `${n} tabs discarded` : 'Done (nothing to discard)';
  } catch (e) {
    statusEl.textContent = 'Error: ' + (e.message || 'unknown');
  }
  btn.disabled = false;
  setTimeout(() => { statusEl.textContent = ''; }, 3500);
});

loadSettings();
