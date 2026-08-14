(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SwissLensCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const DEFAULT_SETTINGS = Object.freeze({
    enabled: false,
    fontScale: 115,
    cleanPage: false,
    highContrast: false,
    reduceMotion: false,
  });

  function clamp(value, min, max, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
  }

  function sanitizeSettings(value) {
    const source = value && typeof value === 'object' ? value : {};
    return {
      enabled: source.enabled === true,
      fontScale: clamp(source.fontScale, 100, 180, DEFAULT_SETTINGS.fontScale),
      cleanPage: source.cleanPage === true,
      highContrast: source.highContrast === true,
      reduceMotion: source.reduceMotion === true,
    };
  }

  function siteKeyFromUrl(url) {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.hostname : '';
    } catch (_) {
      return '';
    }
  }

  function settingsForSite(profiles, siteKey) {
    return sanitizeSettings(profiles && siteKey ? profiles[siteKey] : null);
  }

  function buildLensCss(value) {
    const settings = sanitizeSettings(value);
    if (!settings.enabled) return '';
    const scale = (settings.fontScale / 100).toFixed(2);
    const rules = [
      ':root { --swiss-lens-scale: ' + scale + '; }',
      'body { line-height: 1.6 !important; }',
      'p, li, dd, dt, blockquote, figcaption, label, input, textarea, select, button { font-size: calc(1em * var(--swiss-lens-scale)) !important; line-height: 1.6 !important; }',
    ];
    if (settings.cleanPage) {
      rules.push(
        'aside, [role="complementary"], [aria-label*="advert" i], [class*="advert" i], [id*="advert" i], [class*="cookie" i], [id*="cookie" i], [class*="newsletter" i], [class*="recommend" i] { display: none !important; }',
        'article, main, [role="main"] { max-width: 76ch !important; margin-inline: auto !important; }'
      );
    }
    if (settings.highContrast) {
      rules.push(
        'html, body { background: #ffffff !important; color: #171717 !important; }',
        'body :where(p, li, dd, dt, blockquote, figcaption, label, h1, h2, h3, h4, h5, h6) { color: #171717 !important; text-shadow: none !important; }',
        'body a { color: #0057b8 !important; text-decoration: underline !important; text-underline-offset: 0.14em !important; }'
      );
    }
    if (settings.reduceMotion) {
      rules.push(
        'html { scroll-behavior: auto !important; }',
        '*, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; scroll-behavior: auto !important; }'
      );
    }
    return rules.join('\n');
  }

  return { DEFAULT_SETTINGS, sanitizeSettings, siteKeyFromUrl, settingsForSite, buildLensCss };
});
