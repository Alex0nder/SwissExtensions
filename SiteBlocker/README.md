# Site Blocker

Blocks distracting websites and provides **lightweight ad/tracker filtering** via Chrome `declarativeNetRequest` (no backend).

## Features

- **Global on/off** toggle for your site blocklist.
- **Ad filters** via static ruleset with common resource types + **WebSocket**; network rules use **`domainType: thirdParty`** to reduce breakage.
- **Optional cosmetic mode** with a separate toggle: lightweight CSS for common AdSense/iframe containers (not a full AdGuard engine).
- **Subscription support** for up to **two list URLs** (for example EasyList + EasyPrivacy):
  - parses `||domain^` / `||domain/` as block rules,
  - parses `@@||domain^` as allow rules,
  - applies subscription blocking as **thirdParty** only.
- **Auto-refresh** for subscriptions using alarms (6–168 hours).
- **Site blocklist** for full page blocking (`main_frame`) of your own distracting domains.
- **Whitelist, schedule, JSON import/export**, including `filterListUrl2`, `filterListAllowDomains`, auto-refresh settings, and `adsCosmeticLiteEnabled`.

## Installation

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click "Load unpacked" and select the `SiteBlocker` folder.

## Limitations

- Some websites may break when filters are enabled; disable filters in the popup when needed.
- This is intentionally narrower than full adblock engines like uBlock/AdGuard in MV3.
- Subscription parser still ignores lines with `$` modifiers (no full ABP parser yet).
- No scriptlets, no cosmetic filters from remote lists, and no request logger yet.
- With two URLs configured, a failed fetch for either URL currently fails the refresh run.
