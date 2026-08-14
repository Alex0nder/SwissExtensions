(() => {
  const ids = ['lens-enabled', 'font-scale', 'clean-page', 'high-contrast', 'reduce-motion'];
  const controls = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
  const siteName = document.getElementById('site-name');
  const fontValue = document.getElementById('font-value');
  const status = document.getElementById('status');
  const reset = document.getElementById('reset');
  let tab = null;
  let siteKey = '';
  let settings = { ...globalThis.SwissLensCore.DEFAULT_SETTINGS };

  function render() {
    controls['lens-enabled'].checked = settings.enabled;
    controls['font-scale'].value = String(settings.fontScale);
    controls['clean-page'].checked = settings.cleanPage;
    controls['high-contrast'].checked = settings.highContrast;
    controls['reduce-motion'].checked = settings.reduceMotion;
    fontValue.value = `${settings.fontScale}%`;
    for (const id of ids.slice(1)) controls[id].disabled = !settings.enabled;
  }

  function readControls() {
    return globalThis.SwissLensCore.sanitizeSettings({
      enabled: controls['lens-enabled'].checked,
      fontScale: controls['font-scale'].value,
      cleanPage: controls['clean-page'].checked,
      highContrast: controls['high-contrast'].checked,
      reduceMotion: controls['reduce-motion'].checked,
    });
  }

  async function save(next) {
    settings = globalThis.SwissLensCore.sanitizeSettings(next);
    render();
    const { swissLensProfiles = {} } = await chrome.storage.local.get('swissLensProfiles');
    await chrome.storage.local.set({
      swissLensProfiles: { ...swissLensProfiles, [siteKey]: settings },
    });
    if (tab?.id) await chrome.tabs.sendMessage(tab.id, { type: 'swissLensApply', settings }).catch(() => {});
    status.textContent = settings.enabled ? 'Applied to this site' : 'Lens is off for this site';
  }

  async function init() {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    siteKey = globalThis.SwissLensCore.siteKeyFromUrl(tab?.url || '');
    if (!siteKey) {
      siteName.textContent = 'Unavailable on this page';
      document.querySelector('.lens-controls').setAttribute('aria-disabled', 'true');
      for (const id of ids) controls[id].disabled = true;
      reset.disabled = true;
      return;
    }
    siteName.textContent = siteKey;
    const { swissLensProfiles = {} } = await chrome.storage.local.get('swissLensProfiles');
    settings = globalThis.SwissLensCore.settingsForSite(swissLensProfiles, siteKey);
    render();
  }

  for (const id of ids) {
    controls[id].addEventListener('input', () => {
      fontValue.value = `${controls['font-scale'].value}%`;
      void save(readControls());
    });
  }
  reset.addEventListener('click', () => void save(globalThis.SwissLensCore.DEFAULT_SETTINGS));
  void init();
})();
