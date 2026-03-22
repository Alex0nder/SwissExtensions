/**
 * Video Downloader: одна ссылка — один сервис (SaveFrom).
 * Сервис сам определяет тип (LinkedIn, Instagram, Twitter и др.), расширение только передаёт URL.
 */

const urlInput = document.getElementById('url');
const btnOpen = document.getElementById('btnOpen');
const hintEl = document.getElementById('hint');

// Единый загрузчик: принимает любую ссылку и сам определяет источник
const DOWNLOADER_BASE = 'https://ru.savefrom.net/246rR/';

async function openDownloader() {
  const raw = urlInput.value.trim();
  if (!raw) return;

  const encoded = encodeURIComponent(raw);
  const urlWithParam = DOWNLOADER_BASE + (DOWNLOADER_BASE.includes('?') ? '&' : '?') + 'url=' + encoded;
  try {
    await navigator.clipboard.writeText(raw);
  } catch (_) {}
  chrome.tabs.create({ url: urlWithParam });
  window.close();
}

function updateButton() {
  btnOpen.disabled = !urlInput.value.trim();
}
urlInput.addEventListener('input', updateButton);
urlInput.addEventListener('paste', () => setTimeout(updateButton, 0));
btnOpen.addEventListener('click', openDownloader);
urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') openDownloader(); });
updateButton();
