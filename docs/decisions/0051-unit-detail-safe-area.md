# Keep mobile unit-detail controls below the iPhone safe area

- Date: 2026-10-23
- Status: production integration authorized; deployment verification pending

## Report and diagnosis

The user reported an inaccessible unit-detail header/settings button on an
installed iPhone Pro Max app. No device screenshot was available. The map
header already uses `--safe-top`, but the fixed unit overlay started at top 0
with only 10px header padding. Its header also shared the scrolling container
with long histories. This is a confirmed layout omission; reproducing the
exact user's iOS state is still pending.

## Change

- Reserve the same safe-area padding as the map header, using the existing
  `--safe-top` token (whose source is `env(safe-area-inset-top)`).
- Keep the header and inline number editor out of the shrinking/scrolling
  body. Histories and unit information scroll in a separate min-height:0 body.
- Give the existing settings button a translated accessible name and expanded
  state. Preserve edit/delete permission gates and all write callbacks.
- Keep the bottom unit navigator and its height restoration. No DB, data-read,
  caching, deployment flag or production behavior was changed externally.

## Verification

- Component regression opens settings, opens number editing, cancels, changes
  units and closes detail while preserving the navigator height contract.
- CSS guard checks safe-area padding, non-shrinking header and body scrolling.
  Removing the safe-area padding fails that guard (other 6 component tests pass).
- Local browser harness renders the actual MobileMap with synthetic data and
  25 histories; it uses no production/demo DB credentials and does not save.
- Chromium: 430x932 normal text, 440x956 at 125% app text zoom, and 375x812
  at 125%. A simulated 62px top inset is not an iOS hardware emulation.
- At 430x932, settings starts at y=72; after scrolling the body by 2312.5px,
  it remains at y=72 and hit-testing/clicking still opens the menu. Number
  editing can be opened and cancelled.
- At 440x956 with 125% app zoom, settings starts at y=90. Temporarily removing
  padding moves it to y=12.5, inside the simulated unsafe area; restored.
- Screenshot: `scratch/unit-header-safe-area-430.png` (synthetic layout check).
- Full suite: 1,844 tests / 207 files passed. Real iPhone installed-app safe
  insets, keyboard and Safari scroll behavior must still be checked on device.

## Release boundary

Keep this visual fix separate from the pending home-detail calendar flag review
(`c017528`). Production deployment needs user authorization. Demo testing must
not be described as proof of the user's physical iPhone behavior.

## Production integration (2026-10-23)

- User explicitly authorized production deployment after demo validation.
- Apply only `c08ebcf` on production main `8f59b39`: unit-detail layout and
  regression tests. Do not include pending home-detail changes (`9aeb8e8`,
  `c017528`) or the pending return-detail optimization.
- No environment, database, access control, data-read or write callback changes.
- Production suite: 1,761 tests / 201 files passed; lint and TypeScript/Vite
  build passed. Deployed-asset verification follows after deployment.
