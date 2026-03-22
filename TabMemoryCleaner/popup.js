/**
 * Popup: discard background tabs, optional skip pinned.
 */
const btn = document.getElementById('btnDiscard');
const status = document.getElementById('status');
const skipPinned = document.getElementById('skipPinned');

btn.addEventListener('click', async () => {
  btn.disabled = true;
  status.textContent = 'Discarding…';
  try {
    const res = await chrome.runtime.sendMessage({
      type: 'discardBackgroundTabs',
      skipPinned: skipPinned.checked,
    });
    const n = res?.discarded ?? 0;
    status.textContent = n > 0 ? `${n} tabs discarded` : 'Done (no tabs to discard)';
  } catch (e) {
    status.textContent = 'Error: ' + (e.message || 'unknown');
  }
  btn.disabled = false;
  setTimeout(() => { status.textContent = ''; }, 3000);
});
