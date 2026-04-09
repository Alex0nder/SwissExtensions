/**
 * Popup:    -.    result.html  .
 */
const status = document.getElementById('status');
const btnScan = document.getElementById('btnScan');
const captureProgressEl = document.getElementById('captureProgress');
const captureProgressFillEl = document.getElementById('captureProgressFill');

function setStatus(text, isError) {
  status.textContent = text;
  status.className = isError ? 'err' : '';
}

function showProgress(visible) {
  if (captureProgressEl) captureProgressEl.style.display = visible ? 'block' : 'none';
  if (captureProgressFillEl && !visible) captureProgressFillEl.style.width = '0%';
}

btnScan.addEventListener('click', async () => {
  btnScan.disabled = true;
  setStatus('Scanning...');
  showProgress(true);

  const onProgress = (changes, areaName) => {
    if (areaName !== 'local' || !changes.captureProgress?.newValue) return;
    const { total, current } = changes.captureProgress.newValue;
    const pct = total > 0 ? Math.round((current / total) * 100) : 0;
    if (captureProgressFillEl) captureProgressFillEl.style.width = pct + '%';
    setStatus(`Frame ${current} of ${total}…`);
  };

  chrome.storage.onChanged.addListener(onProgress);

  const cleanup = () => {
    chrome.storage.onChanged.removeListener(onProgress);
    chrome.storage.local.remove('captureProgress');
    showProgress(false);
    btnScan.disabled = false;
  };

  try {
    const res = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'capture' }, (r) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(r);
      });
    });
    cleanup();
    if (res?.error) {
      setStatus(res.error, true);
      return;
    }
    if (res?.ok && res?.count > 0) {
      setStatus('Screenshots page opened.');
    } else {
      setStatus('No frames.', true);
    }
  } catch (e) {
    cleanup();
    setStatus(e?.message || 'Error', true);
  }
});
