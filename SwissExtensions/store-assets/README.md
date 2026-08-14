# Chrome Web Store assets

Ready-to-upload files are in `final/`.

## Upload mapping

- Store icon: `store-icon-128.png` — 128 × 128
- Screenshots, in recommended order:
  1. `screenshot-01-overview-1280x800.png`
  2. `screenshot-02-command-1280x800.png`
  3. `screenshot-03-hibernate-1280x800.png`
  4. `screenshot-04-memory-1280x800.png`
  5. `screenshot-05-blocker-1280x800.png`
- Small promotional image: `promo-small-440x280.png`
- Marquee promotional image: `promo-marquee-1400x560.png`

All screenshots and promotional images are opaque PNG files with the exact Chrome Web Store dimensions.

## Art direction

The set uses the real extension UI, Swiss editorial typography, the existing red cross brand mark, and a quiet alpine background. The background was generated with the built-in ImageGen workflow, then combined with deterministic browser screenshots so product text and controls remain accurate.

## Source files

- `compositor.html` — reusable layout for every store image
- `source/` — real UI captures and the generated alpine background

ImageGen prompt summary: minimalist Swiss alpine landscape, pale winter daylight, generous negative space, editorial realism, no text, UI, logos, people, or watermark.
