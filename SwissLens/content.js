(() => {
  if (globalThis.__swissLensInstalled) return;
  globalThis.__swissLensInstalled = true;

  const STYLE_ID = 'swiss-lens-overrides';
  const siteKey = globalThis.SwissLensCore.siteKeyFromUrl(location.href);

  function apply(settings) {
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(style);
    }
    style.textContent = globalThis.SwissLensCore.buildLensCss(settings);
    document.documentElement.toggleAttribute('data-swiss-lens', Boolean(settings?.enabled));
  }

  async function load() {
    if (!siteKey) return apply({ enabled: false });
    const { swissLensProfiles = {} } = await chrome.storage.local.get('swissLensProfiles');
    apply(globalThis.SwissLensCore.settingsForSite(swissLensProfiles, siteKey));
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'swissLensApply') return;
    apply(message.settings);
    sendResponse({ ok: true });
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.swissLensProfiles) void load();
  });

  void load();
})();
