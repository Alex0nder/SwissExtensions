# Page Capture — 1440 × 1024 tiles

A Chrome extension that captures a long page as fixed-size 1440 × 1024 tiles and exports them as separate PNG files or a multipage PDF.

## Install

1. Open `chrome://extensions/`.
2. Enable **Developer mode**.
3. Select **Load unpacked** and choose the `PdfExtensions` folder.

## Use

1. Open an `http://` or `https://` page.
2. Select the extension icon.
3. Choose **Download PNG tiles** to save numbered PNG files.
4. Choose **Download PDF** to create one document with a page for each tile.

## How capture works

1. The browser window is temporarily resized to 1440 × 1024.
2. The extension scrolls the page in 1024-pixel steps and calls `captureVisibleTab()` at each position.
3. High-density displays may produce 2880 × 2048 source images; exports preserve the intended 1440 × 1024 page proportions.
4. The original browser-window size and maximized state are restored after capture.

## Output

- **PNG:** one numbered file per 1440 × 1024 tile.
- **PDF:** one landscape page per tile in a single document.

## Limitations

- Capture is limited to supported web pages; Chrome internal pages cannot be captured.
- The browser window changes size temporarily during capture.
- Very long or dynamically loaded pages may require additional time to render while scrolling.
