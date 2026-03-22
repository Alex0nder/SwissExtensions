/**
 * Страница скриншотов: показывает кадры, кнопки «Скачать PNG» и «Скачать PDF».
 * Поддерживает: 1) выбор папки через showDirectoryPicker; 2) подпапку в «Загрузки».
 */
(function () {
  const subEl = document.getElementById('sub');
  const framesEl = document.getElementById('frames');
  const emptyEl = document.getElementById('empty');
  const actionsEl = document.getElementById('actions');
  const btnPng = document.getElementById('btnPng');
  const btnPdf = document.getElementById('btnPdf');
  const exportFolderInput = document.getElementById('exportFolder');
  const btnSaveFolder = document.getElementById('btnSaveFolder');
  const btnPickFolder = document.getElementById('btnPickFolder');
  const folderStatusEl = document.getElementById('folderStatus');
  const downloadStatusEl = document.getElementById('downloadStatus');
  const downloadProgressEl = document.getElementById('downloadProgress');
  const downloadProgressFillEl = document.getElementById('downloadProgressFill');

  let tiles = [];
  let pageInfo = null;
  let exportFolder = '';
  let pngFormat = 'tiles';
  let pickedDirHandle = null;

  const MULTI_TLD_PREFIXES = new Set([
    'co', 'com', 'org', 'net', 'ac', 'gov', 'edu', 'sch', 'ne', 'or', 'go', 'gv', 'lg', 'mil', 'nom', 'gob',
  ]);

  /** Short site label: no www, no TLD (jetsense.io → jetsense). */
  function getShortSiteName(url) {
    if (!url || typeof url !== 'string') return 'capture';
    try {
      const u = new URL(url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'capture';
      let host = u.hostname.toLowerCase().replace(/^www\./, '');
      const parts = host.split('.').filter(Boolean);
      if (parts.length === 0) return 'capture';
      if (parts.length === 1) return sanitizeShortName(parts[0]);
      if (parts.length === 2) return sanitizeShortName(parts[0]);
      const last = parts[parts.length - 1];
      const sld = parts[parts.length - 2];
      if (last.length === 2 && MULTI_TLD_PREFIXES.has(sld) && parts.length >= 3) {
        return sanitizeShortName(parts[parts.length - 3]);
      }
      return sanitizeShortName(parts[parts.length - 2]);
    } catch (_) {
      return 'capture';
    }
  }

  function sanitizeShortName(s) {
    if (!s) return 'capture';
    const t = s
      .replace(/[^\w\u0400-\u04FF\-]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 80);
    return t || 'capture';
  }

  /** Безопасное имя папки: только буквы, цифры, дефис, подчёркивание. Без .. и слешей. */
  function sanitizeFolderName(raw) {
    if (!raw || typeof raw !== 'string') return '';
    return raw
      .replace(/\.\./g, '')
      .replace(/[/\\]/g, '')
      .replace(/[^\w\u0400-\u04FF\-]/g, '_')
      .trim()
      .slice(0, 100);
  }

  function getFullFilename(baseName, ext) {
    const filename = `${baseName}.${ext}`;
    return exportFolder ? `${exportFolder}/${filename}` : filename;
  }

  function getExportDestText() {
    if (pickedDirHandle) return `in «${pickedDirHandle.name}»`;
    return `in Downloads${exportFolder ? `/${exportFolder}` : ''}`;
  }

  async function pickFolder() {
    if (!('showDirectoryPicker' in self)) {
      folderStatusEl.textContent = 'Folder picker not supported.';
      folderStatusEl.style.color = '#c00';
      return;
    }
    try {
      pickedDirHandle = await window.showDirectoryPicker({ mode: 'readwrite', startIn: 'downloads' });
      folderStatusEl.textContent = `Selected: ${pickedDirHandle.name}`;
      folderStatusEl.style.color = '#34a853';
      if (tiles.length > 0) subEl.textContent = `Captured: ${tiles.length} frames. PNG and PDF — ${getExportDestText()}.`;
    } catch (e) {
      if (e.name === 'AbortError') return;
      folderStatusEl.textContent = 'Error: ' + (e.message || String(e));
      folderStatusEl.style.color = '#c00';
    }
  }

  async function writeBlobToDir(dirHandle, filename, blob) {
    const fh = await dirHandle.getFileHandle(filename, { create: true });
    const w = await fh.createWritable();
    await w.write(blob);
    await w.close();
  }

  function dataUrlToBlob(dataUrl) {
    return fetch(dataUrl).then((r) => r.blob());
  }

  async function stitchTilesToBlob(dataUrls, onProgress) {
    const loadImage = (dataUrl) =>
      new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({ img, w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = () => reject(new Error('Frame load error'));
        img.src = dataUrl;
      });
    const specs = await Promise.all(dataUrls.map(loadImage));
    const width = Math.max(...specs.map((s) => s.w));
    const totalHeight = specs.reduce((sum, s) => sum + s.h, 0);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = totalHeight;
    const ctx = canvas.getContext('2d');
    let y = 0;
    for (let i = 0; i < specs.length; i++) {
      const { img, w, h } = specs[i];
      ctx.drawImage(img, 0, y, w, h);
      y += h;
      if (onProgress) onProgress(i + 1, specs.length);
    }
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG create error'))), 'image/png');
    });
  }

  /** Показать статус скачивания: text — сообщение, state — 'loading' | 'done' | '' */
  function setDownloadStatus(text, state = '') {
    if (downloadStatusEl) {
      downloadStatusEl.textContent = text;
      downloadStatusEl.className = 'download-status' + (state ? ' ' + state : '');
    }
  }

  /** Показать прогресс-бар: current/total, или скрыть при total=0 */
  function setDownloadProgress(current, total) {
    if (!downloadProgressEl || !downloadProgressFillEl) return;
    if (!total) {
      downloadProgressEl.classList.remove('visible');
      downloadProgressFillEl.style.width = '0%';
      return;
    }
    downloadProgressEl.classList.add('visible');
    const pct = Math.min(100, Math.round((current / total) * 100));
    downloadProgressFillEl.style.width = pct + '%';
  }

  function setButtonsEnabled(enabled) {
    if (btnPng) btnPng.disabled = !enabled;
    if (btnPdf) btnPdf.disabled = !enabled;
  }

  function loadExportFolder() {
    chrome.storage.local.get(['exportFolder', 'pngFormat'], (data) => {
      exportFolder = sanitizeFolderName(data.exportFolder || '');
      exportFolderInput.value = exportFolder;
      pngFormat = data.pngFormat === 'whole' ? 'whole' : 'tiles';
      const tilesEl = document.getElementById('formatTiles');
      const wholeEl = document.getElementById('formatWhole');
      if (tilesEl) tilesEl.checked = pngFormat === 'tiles';
      if (wholeEl) wholeEl.checked = pngFormat === 'whole';
      if (tiles.length > 0) subEl.textContent = `Captured: ${tiles.length} frames. PNG and PDF — ${getExportDestText()}.`;
    });
  }

  function savePngFormat() {
    const wholeEl = document.getElementById('formatWhole');
    pngFormat = wholeEl?.checked ? 'whole' : 'tiles';
    chrome.storage.local.set({ pngFormat });
  }

  function saveExportFolder() {
    const raw = exportFolderInput.value;
    exportFolder = sanitizeFolderName(raw);
    exportFolderInput.value = exportFolder;
    chrome.storage.local.set({ exportFolder });
    if (tiles.length > 0) subEl.textContent = `Captured: ${tiles.length} frames. PNG and PDF — ${getExportDestText()}.`;
  }

  /** Имя файла: домен + путь страницы (из URL) + дата + время — понятно, с какой страницы скан */
  function getFileBase(pageInfo) {
    let host = 'page-capture';
    let pathPart = '';
    if (pageInfo?.url) {
      try {
        const u = new URL(pageInfo.url);
        host = u.hostname.replace(/^www\./, '').replace(/[\\/:*?"<>|\s]/g, '_').slice(0, 60);
        const path = (u.pathname || '/').replace(/\/$/, '') || '/';
        if (path !== '/') {
          pathPart = '_' + path.slice(1).replace(/[/\\:*?"<>|\s]/g, '_').slice(0, 80);
        }
      } catch (_) {}
    }
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const time = now.toTimeString().slice(0, 8).replace(/:/g, '-');
    return `${host}${pathPart}_${date}_${time}`;
  }

  function render(tilesList, info) {
    tiles = tilesList || [];
    pageInfo = info || null;
    if (tiles.length === 0) {
      subEl.textContent = 'No frames.';
      emptyEl.style.display = 'block';
      emptyEl.textContent = 'No frames.';
      emptyEl.style.color = '';
      framesEl.innerHTML = '';
      return;
    }
    subEl.textContent = `Captured: ${tiles.length} frames. PNG and PDF — ${getExportDestText()}.`;
    emptyEl.style.display = 'none';
    framesEl.innerHTML = '';
    tiles.forEach((dataUrl, i) => {
      const div = document.createElement('div');
      div.className = 'frame';
      const img = document.createElement('img');
      img.src = dataUrl;
      img.alt = `Frame ${i + 1}`;
      const span = document.createElement('span');
      span.textContent = `Frame ${i + 1}`;
      div.appendChild(img);
      div.appendChild(span);
      framesEl.appendChild(div);
    });
    actionsEl.style.display = 'flex';
  }

  async function savePngToDisk(base, isWhole, isAuto) {
    if (!isAuto) setButtonsEnabled(false);
    setDownloadStatus(isWhole ? 'Stitching frames…' : 'Saving PNG…', 'loading');
    setDownloadProgress(0, tiles.length);
    try {
      if (isWhole) {
        const blob = await stitchTilesToBlob(tiles, (cur, tot) => {
          setDownloadStatus(`Stitching ${cur} of ${tot}…`, 'loading');
          setDownloadProgress(cur, tot);
        });
        const filename = `${base}.png`;
        if (pickedDirHandle) {
          await writeBlobToDir(pickedDirHandle, filename, blob);
          setDownloadStatus(isAuto ? `Auto-saved: ${base}.png` : 'One file saved.', 'done');
        } else {
          const url = URL.createObjectURL(blob);
          chrome.downloads.download({ url, filename: getFullFilename(base, 'png'), saveAs: false });
          setTimeout(() => URL.revokeObjectURL(url), 2000);
          setDownloadStatus(isAuto ? `Downloading ${base}.png` : 'Download started.', 'done');
        }
        setDownloadProgress(tiles.length, tiles.length);
      } else {
        if (pickedDirHandle) {
          for (let i = 0; i < tiles.length; i++) {
            setDownloadStatus(`Saved ${i + 1} of ${tiles.length}…`, 'loading');
            setDownloadProgress(i + 1, tiles.length);
            const blob = await dataUrlToBlob(tiles[i]);
            await writeBlobToDir(pickedDirHandle, `${base}_${i + 1}.png`, blob);
          }
          setDownloadStatus(
            isAuto ? `Auto-saved ${tiles.length} files (${base}_*.png)` : `Saved ${tiles.length} files.`,
            'done'
          );
          setDownloadProgress(tiles.length, tiles.length);
        } else {
          tiles.forEach((dataUrl, i) => {
            chrome.downloads.download({
              url: dataUrl,
              filename: getFullFilename(`${base}_${i + 1}`, 'png'),
              saveAs: false,
            });
          });
          setDownloadProgress(tiles.length, tiles.length);
          setDownloadStatus(
            isAuto ? `Downloading ${tiles.length} files (${base}_*.png)` : `Download of ${tiles.length} files.`,
            'done'
          );
        }
      }
    } catch (e) {
      setDownloadProgress(0, 0);
      setDownloadStatus('', '');
      if (isAuto) {
        console.error('Auto-save PNG:', e);
      } else {
        alert('Save error: ' + (e.message || String(e)));
      }
    } finally {
      if (!isAuto) setButtonsEnabled(true);
      if (downloadStatusEl && downloadStatusEl.className.includes('done')) {
        setTimeout(() => {
          if (!isAuto) {
            setDownloadStatus('');
            setDownloadProgress(0, 0);
          } else {
            setDownloadProgress(0, 0);
          }
        }, 4000);
      }
    }
  }

  async function downloadPng() {
    savePngFormat();
    await savePngToDisk(getFileBase(pageInfo), pngFormat === 'whole', false);
  }

  async function autoSaveScreenshotAfterScan() {
    const base = getShortSiteName(pageInfo?.url || '');
    await savePngToDisk(base, true, true);
  }

  /** PDF — одна длинная страница: все кадры склеены вертикально */
  function downloadPdf() {
    if (!window.jspdf?.jsPDF) {
      alert('PDF library loading. Wait and try again.');
      return;
    }
    setButtonsEnabled(false);
    setDownloadStatus('Building PDF…', 'loading');
    setDownloadProgress(0, 1);
    const { jsPDF } = window.jspdf;
    const loadImage = (dataUrl) =>
      new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({ dataUrl, w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = () => reject(new Error('Image load error'));
        img.src = dataUrl;
      });

    Promise.all(tiles.map(loadImage))
      .then(async (specs) => {
        setDownloadStatus('Assembling pages…', 'loading');
        setDownloadProgress(1, 2);
        const width = Math.max(...specs.map((s) => s.w));
        const totalHeight = specs.reduce((sum, s) => sum + s.h, 0);
        const doc = new jsPDF({
          unit: 'px',
          format: [width, totalHeight],
          hotfixes: ['px_scaling'],
        });
        let y = 0;
        specs.forEach(({ dataUrl, w, h }) => {
          doc.addImage(dataUrl, 'PNG', 0, y, w, h, undefined, 'FAST');
          y += h;
        });
        const blob = doc.output('blob');
        const filename = getFileBase(pageInfo) + '.pdf';
        if (pickedDirHandle) {
          setDownloadStatus('Saving PDF…', 'loading');
          setDownloadProgress(2, 3);
          await writeBlobToDir(pickedDirHandle, filename, blob);
        } else {
          const url = URL.createObjectURL(blob);
          chrome.downloads.download({
            url,
            filename: getFullFilename(getFileBase(pageInfo), 'pdf'),
            saveAs: false,
          });
          setTimeout(() => URL.revokeObjectURL(url), 2000);
        }
        setDownloadProgress(3, 3);
        setDownloadStatus('PDF saved.', 'done');
        setTimeout(() => { setDownloadStatus(''); setDownloadProgress(0, 0); }, 3000);
      })
      .catch((e) => {
        setDownloadProgress(0, 0);
        setDownloadStatus('', '');
        setButtonsEnabled(true);
        alert('Error: ' + (e?.message || String(e)));
      })
      .finally(() => setButtonsEnabled(true));
  }

  btnPng.addEventListener('click', () => downloadPng());
  btnPdf.addEventListener('click', () => downloadPdf());
  btnSaveFolder.addEventListener('click', () => saveExportFolder());
  btnPickFolder.addEventListener('click', () => pickFolder());
  document.getElementById('formatTiles')?.addEventListener('change', savePngFormat);
  document.getElementById('formatWhole')?.addEventListener('change', savePngFormat);

  loadExportFolder();

  function handleTilesResponse(res) {
    if (chrome.runtime.lastError) {
      subEl.textContent = 'Error: ' + chrome.runtime.lastError.message;
      return;
    }
    if (res?.error) {
      subEl.textContent = '';
      emptyEl.style.display = 'block';
      emptyEl.textContent = 'Error: ' + res.error;
      emptyEl.style.color = '#c00';
      return;
    }
    const tilesList = res?.tiles || [];
    const pageInfoData = res?.pageInfo || null;
    if (tilesList.length === 0 && !res?.error) {
      subEl.textContent = 'Waiting for data…';
      setTimeout(() => {
        chrome.runtime.sendMessage({ type: 'getTiles' }, handleTilesResponse);
      }, 500);
      return;
    }
    render(tilesList, pageInfoData);
    setTimeout(() => {
      autoSaveScreenshotAfterScan();
    }, 200);
  }

  chrome.runtime.sendMessage({ type: 'getTiles' }, handleTilesResponse);
})();
