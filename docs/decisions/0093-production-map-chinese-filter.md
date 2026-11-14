# Production Chinese-marked unit map filter

- Date: 2026-11-14
- Reviewed implementation: 5db2c06 (decision 0092)
- Language/layout follow-up: demo 21a725c, production f8ccae4
- Production feature port: 01a0971
- Status: enabled, deployed, actual browser verification complete

## Scope

The user approved production after English and Chinese small-screen checks.
Both languages were tested through demo Settings, at 320x740 and 125% text.
English wrapping exposed a fixed-offset overlap with the legend. The follow-up
observes actual header layout height, moves legend and map tools below it, and
constrains tooltip width. Details and screenshots are recorded in 0092.
Demo settings were restored to Korean/normal text; viewport overrides removed.

No SQL migration, data rewrite, new network query, subscription, role change,
or DesktopMap feature is included. Only explicitly marked units are filtered;
unmarked does not mean non-Chinese-speaking. Original data remains the write
source. The default filter state is off on entry.

## Verification and rollout

- Full production suite: 2,379 tests / 237 files passed; lint and production-flag
  TypeScript/Vite build passed. Full demo suite: 2,459 / 243 files passed.
- The new measured-height regression test fails if header height is replaced
  with a constant. English and Chinese tooltip/empty/reset rendering is tested.
- Vercel project chinese-territory-app (not the separate demo project): added
  VITE_MAP_CHINESE_FILTER_ENABLED=true to production only; confirmed by a new
  environment pull. VITE_DEMO_MODE remains unset. No other flag was changed.
- Main f8ccae4 built successfully and deployed as
  dpl_78m3LP4By7PgN7oRrm2MJRkdo79U, Ready. Build logs identify main/f8ccae4.
  Canonical alias: https://chinese-territory-app.vercel.app.
- Existing production administrator's Chrome session applied the normal PWA
  update; DOM script changed from index-xJoPW0It.js to index-ioLUG6Sm.js,
  matching the deployment build output.
- At 430x932, navigated Zone -> Map. Filter off: 3,663 units (2,697 house /
  966 shop). Filter on: 1,100 units (562 / 538); summary 256/1,100 (23%).
  The actual header icon, counts, legend and map aggregates rendered together.
  Header bottom 91px, legend top 103px. Turned off again: 3,663 restored.
  These are current observed counts, not a claim of unchanged data since an
  earlier review; other people can continue using the production app.
- Screenshot: scratch/production-chinese-filter-enabled.png (local only).
- Production checks were read-only view toggles; no visit, cancellation,
  application or assignment writes were performed. Returned to the original
  calendar and reset the viewport. Not a physical iPhone/PWA hardware test.

## Rollback

Set VITE_MAP_CHINESE_FILTER_ENABLED=false and redeploy. Users apply the normal
app update; the switch is compiled at build time and is not an instant remote
toggle. Original data needs no restoration. Keep unrelated performance and
Sentry settings unchanged.
