const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  DEFAULT_CAPTURE_LIMITS,
  getCapturePlan,
  getRestoreStorageKeys,
  isSuccessfulRestoreCommit,
  normalizeInactivityMinutes,
  shouldAllowActiveTabInAlarm,
  shouldIgnoreTransientUngroup,
} = require('../core_logic.js');

test('capture plan accepts a bounded page', () => {
  assert.deepEqual(getCapturePlan({ pageHeight: 5000, viewportHeight: 1000, viewportWidth: 1200 }), {
    ok: true,
    pageHeight: 5000,
    step: 1000,
    totalFrames: 5,
    estimatedPixels: 6_000_000,
  });
});

test('capture plan rejects invalid and oversized pages', () => {
  assert.equal(getCapturePlan({ pageHeight: 0, viewportHeight: 900, viewportWidth: 1200 }).ok, false);
  assert.equal(
    getCapturePlan({
      pageHeight: DEFAULT_CAPTURE_LIMITS.maxHeight + 1,
      viewportHeight: 900,
      viewportWidth: 1200,
    }).ok,
    false,
  );
  assert.equal(
    getCapturePlan(
      { pageHeight: 10_000, viewportHeight: 1000, viewportWidth: 2000 },
      { maxPixels: 1_000_000 },
    ).ok,
    false,
  );
});

test('restore keys are unique and include rebound storage', () => {
  assert.deepEqual(getRestoreStorageKeys(10, 4, 'suspended_3'), [
    'suspended_10',
    'suspended_4',
    'suspended_3',
  ]);
  assert.deepEqual(getRestoreStorageKeys(10, 10, 'suspended_10'), ['suspended_10']);
});

test('only a top-level web navigation finalizes a restore', () => {
  assert.equal(isSuccessfulRestoreCommit({ frameId: 0, url: 'https://example.com/' }), true);
  assert.equal(isSuccessfulRestoreCommit({ frameId: 1, url: 'https://example.com/' }), false);
  assert.equal(isSuccessfulRestoreCommit({ frameId: 0, url: 'chrome-error://chromewebdata/' }), false);
});

test('inactivity timeout rejects corrupted values', () => {
  assert.equal(normalizeInactivityMinutes(60), 60);
  assert.equal(normalizeInactivityMinutes('10'), 10);
  assert.equal(normalizeInactivityMinutes(0), 5);
  assert.equal(normalizeInactivityMinutes(-1), 5);
  assert.equal(normalizeInactivityMinutes(1441), 5);
  assert.equal(normalizeInactivityMinutes('broken'), 5);
});

test('an active tab in any visible window never auto-suspends', () => {
  assert.equal(shouldAllowActiveTabInAlarm({ active: true, windowId: 2 }, 1), false);
  assert.equal(shouldAllowActiveTabInAlarm({ active: true, windowId: 1 }, 1), false);
  assert.equal(shouldAllowActiveTabInAlarm({ active: false, windowId: 2 }, 1), false);
  assert.equal(shouldAllowActiveTabInAlarm({ active: true, windowId: 1 }, null), false);
});

test('temporary ungroup during placeholder navigation does not erase group data', () => {
  assert.equal(shouldIgnoreTransientUngroup(-1, 10_000, 9_000), true);
  assert.equal(shouldIgnoreTransientUngroup(-1, 10_000, 10_001), false);
  assert.equal(shouldIgnoreTransientUngroup(7, 10_000, 9_000), false);
});

test('service worker never loads the entire extension storage into memory', () => {
  const worker = fs.readFileSync(path.join(__dirname, '..', 'service_worker.js'), 'utf8');
  assert.equal(worker.includes('chrome.storage.local.get(null)'), false);
});

test('placeholder rebind finishes before a background tab is discarded', () => {
  const worker = fs.readFileSync(path.join(__dirname, '..', 'service_worker.js'), 'utf8');
  assert.match(
    worker,
    /await rebindSinglePlaceholderTab\(tab\)[\s\S]{0,160}await discardInactivePlaceholder\(tab\)/,
  );
});

test('placeholder favicon is set before a background renderer is discarded', () => {
  const worker = fs.readFileSync(path.join(__dirname, '..', 'service_worker.js'), 'utf8');
  const bootstrap = fs.readFileSync(
    path.join(__dirname, '..', '..', 'frontend', 'apps', 'swiss-ui', 'public', 'suspended-favicon-bootstrap.js'),
    'utf8',
  );
  const html = fs.readFileSync(
    path.join(__dirname, '..', '..', 'frontend', 'apps', 'swiss-ui', 'suspended.html'),
    'utf8',
  );
  assert.match(worker, /params\.set\('o', original\.origin \+ '\/'\)/);
  assert.match(worker, /await waitForPlaceholderFavicon\(tab\.id\)/);
  assert.match(worker, /changeInfo\.favIconUrl/);
  assert.match(html, /suspended-favicon-bootstrap\.js/);
  assert.match(html, /suspended-fallback\.svg/);
  assert.match(bootstrap, /chrome\.runtime\.getURL\("\/_favicon\/"\)/);
  assert.match(bootstrap, /canvas\.toDataURL\("image\/png"\)/);
});

test('blocked main-frame errors are converted before Chrome keeps the extension icon', () => {
  const worker = fs.readFileSync(path.join(__dirname, '..', 'service_worker.js'), 'utf8');
  const handler = worker.split('if (chrome.webNavigation?.onErrorOccurred)')[1]
    ?.split('function mutateBlockerTabUrlMap')[0] || '';
  assert.match(handler, /ERR_BLOCKED_BY_CLIENT/);
  assert.match(handler, /convertBlockedTabToPlaceholder\(tab, pageUrl\)/);
  assert.match(worker, /const blockerPlaceholderConversions = new Set\(\)/);
});

test('restore progress contract uses the UI field name', () => {
  const worker = fs.readFileSync(path.join(__dirname, '..', 'service_worker.js'), 'utf8');
  assert.match(worker, /restoreProgress:\s*\{\s*done:/);
  assert.doesNotMatch(worker, /restoreProgress:\s*\{\s*restored:/);
});

test('large suspended sessions keep more than the old 1000-entry recovery index', () => {
  const worker = fs.readFileSync(path.join(__dirname, '..', 'service_worker.js'), 'utf8');
  const match = worker.match(/const SUSPENDED_URL_INDEX_MAX = (\d+);/);
  assert.ok(match);
  assert.ok(Number(match[1]) >= 5000);
});

test('service worker wake does not rebuild Site Blocker rules', () => {
  const worker = fs.readFileSync(path.join(__dirname, '..', 'service_worker.js'), 'utf8');
  const wakeInit = worker.split('// SW wake: alarms + restore activity only.')[1] || '';
  assert.equal(wakeInit.includes('runSiteBlockerApplyRules()'), false);
  assert.equal(wakeInit.includes('siteBlockerApplyAdsRulesets()'), false);
});

test('placeholder repair compares extension hosts and runs once per runtime', () => {
  const worker = fs.readFileSync(path.join(__dirname, '..', 'service_worker.js'), 'utf8');
  assert.match(worker, /current\.host !== expected\.host/);
  assert.match(worker, /await ensureRuntimePlaceholderRepair\(\)/);
  assert.match(worker, /chrome\.storage\.session\.get\(RUNTIME_PLACEHOLDER_REPAIR_KEY\)/);
});

test('activating a current placeholder does not reload and flash the page', () => {
  const worker = fs.readFileSync(path.join(__dirname, '..', 'service_worker.js'), 'utf8');
  const activatedHandler = worker.split('chrome.tabs.onActivated.addListener')[1]?.split('chrome.windows.onFocusChanged')[0] || '';
  assert.doesNotMatch(activatedHandler, /chrome\.tabs\.reload\(tabId\)/);
  assert.match(activatedHandler, /rebindSinglePlaceholderTab\(tab\)/);
});

test('active placeholders in unfocused windows are never discarded', () => {
  const worker = fs.readFileSync(path.join(__dirname, '..', 'service_worker.js'), 'utf8');
  const discard = worker.split('async function discardInactivePlaceholder')[1]
    ?.split('async function openPlaceholderTabForItem')[0] || '';
  assert.match(discard, /if \(tab\.active\) return false/);
  assert.doesNotMatch(discard, /window\?\.focused/);
});

test('rebind does not navigate a current placeholder just to rewrite restored tab ids', () => {
  const worker = fs.readFileSync(path.join(__dirname, '..', 'service_worker.js'), 'utf8');
  const rebind = worker.split('async function rebindSinglePlaceholderTab')[1]
    ?.split('/** Max rows in closedAndSaved')[0] || '';
  const urlDecision = rebind.split('let needsUrlUpdate = true;')[1]
    ?.split('if (needsStorage)')[0] || '';
  assert.match(urlDecision, /current\.host !== expected\.host/);
  assert.doesNotMatch(urlDecision, /currentTabId !== tab\.id/);
  assert.doesNotMatch(urlDecision, /currentFallback !== expectedFallback/);
});

test('removed placeholder tabs are archived without deleting their recovery index', () => {
  const worker = fs.readFileSync(path.join(__dirname, '..', 'service_worker.js'), 'utf8');
  const cleanup = worker.split('async function flushRemovedTabCleanup()')[1]?.split('function scheduleRemovedTabCleanup')[0] || '';
  assert.match(cleanup, /orphanedSuspendedArchive/);
  assert.match(cleanup, /persistBoundedList/);
  assert.doesNotMatch(cleanup, /delete idx\[/);
  assert.doesNotMatch(cleanup, /removeSuspendedUrlIndex/);
});

test('lost-tab recovery skips URLs that are already open', () => {
  const worker = fs.readFileSync(path.join(__dirname, '..', 'service_worker.js'), 'utf8');
  const recovery = worker.split('async function runOpenUrlsAsPlaceholders')[1]?.split('function shouldSkipHistoryRecoverUrl')[0] || '';
  assert.match(recovery, /await getOpenTabUrlKeys\(\)/);
  assert.match(recovery, /alreadyOpenKeys\.has\(openKey\)/);
});

test('daily session snapshots retain 30 recovery points with group and order metadata', () => {
  const worker = fs.readFileSync(path.join(__dirname, '..', 'service_worker.js'), 'utf8');
  assert.match(worker, /const BACKUP_RETENTION_DAYS = 30;/);
  const capture = worker.split('async function captureDailySessionSnapshot')[1]
    ?.split('/** tabIds from placeholder URLs')[0] || '';
  assert.match(capture, /buildGroupMetaMapForTabs\(tabs, batchId\)/);
  assert.match(capture, /windowOrder:/);
  assert.match(capture, /tabIndex:/);
  assert.match(capture, /copyGroupMetaToEntry/);
  assert.match(capture, /pruneDailySessionSnapshots\(\)/);
});

test('daily restore regroups existing tabs and opens only missing URLs', () => {
  const worker = fs.readFileSync(path.join(__dirname, '..', 'service_worker.js'), 'utf8');
  const restore = worker.split('async function runRestoreDailySessionSnapshot')[1]
    ?.split('function shouldSkipHistoryRecoverUrl')[0] || '';
  assert.match(restore, /openByUrl\.has\(key\)/);
  assert.match(restore, /existingGroupPairs\.push/);
  assert.match(restore, /applySavedTabGroups\(existingGroupPairs, \{ forceRegroup: true \}\)/);
  assert.match(restore, /runOpenUrlsAsPlaceholders\(missing, \{ existingGroupPairs \}\)/);
});
