const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_SETTINGS, sanitizeSettings, siteKeyFromUrl, settingsForSite, buildLensCss } = require('../lens-core.js');

test('extracts only web hostnames', () => {
  assert.equal(siteKeyFromUrl('https://www.example.com/article?id=1'), 'www.example.com');
  assert.equal(siteKeyFromUrl('chrome://extensions'), '');
});

test('sanitizes and bounds site settings', () => {
  assert.deepEqual(sanitizeSettings({ enabled: true, fontScale: 999, cleanPage: 1 }), {
    ...DEFAULT_SETTINGS,
    enabled: true,
    fontScale: 180,
  });
});

test('returns independent defaults for unknown sites', () => {
  assert.deepEqual(settingsForSite({}, 'example.com'), DEFAULT_SETTINGS);
});

test('disabled lens injects no page styles', () => {
  assert.equal(buildLensCss({ enabled: false }), '');
});

test('enabled features produce scoped accessibility rules', () => {
  const css = buildLensCss({ enabled: true, fontScale: 130, cleanPage: true, highContrast: true, reduceMotion: true });
  assert.match(css, /--swiss-lens-scale: 1\.30/);
  assert.match(css, /role="complementary"/);
  assert.match(css, /#0057b8/);
  assert.match(css, /animation-duration: 0\.01ms/);
});
