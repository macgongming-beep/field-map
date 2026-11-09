# Production visit signal deduplication

- Date: 2026-11-09
- Status: production enabled and served bundle verified
- Approved source: `92fdd61`; external review and explicit deployment approval
- Production baseline: `fb9e38b`
- Related: 0071 fanout measurements, 0072 exact signal receipts

## Scope

Apply only the approved receipt reader, existing-queue wrapper, realtime wiring,
tests and verification scripts. Preserve main's existing production gates and
exclude unrelated demo informal-asset/group optimizations. The dirty legacy
main checkout is not modified. No production data writes, migrations or RLS
changes are required.

The implementation is identical to the approved demo code. Production adds
save/cancel store tests with DEMO=false, plus this activation record. The env
example keeps main's existing ordering and documents the independent switch.

## Prerequisites checked

Actual values read from the `chinese-territory-app` Vercel Production settings:

- VITE_RECIPIENT_STORE_ENABLED=true
- VITE_SCOPED_VISIT_HISTORY_ENABLED=true
- VITE_SCOPED_HISTORY_RECOVERY_ENABLED=true
- VITE_VISIT_REALTIME_QUEUE_ENABLED=true
- VITE_TERRITORY_REALTIME_ENABLED=true
- VITE_DEMO_MODE unset
- VITE_VISIT_SIGNAL_DEDUP_ENABLED initially unset

Only the final new setting was added as true. A before/after comparison of all
VITE settings confirmed this was the only change. Existing settings remain
unchanged. The previous production deployment URL is
https://chinese-territory-475m0a3by-gms-projects-3b3e1c8b.vercel.app.

## Verification boundary

Verify the served production JavaScript, not only the environment setting:
the compiled default dedup gate must be true, the existing queue dependency
must remain enabled, and realtime must call the signal-aware callback. The
role/scoped-history gate continues excluding admin, leader and developer.
No logged-in production write test is claimed unless separately recorded.

Production commit `cc1b2ce` deployed successfully on 2026-11-09:

- Deployment: `dpl_GgoPNMhgmKYiJ58Gw1QjsSpUhDRa` (Ready, Production)
- URL: https://chinese-territory-iyy52b5sf-gms-projects-3b3e1c8b.vercel.app
- Canonical alias: https://chinese-territory-app.vercel.app
- The canonical service worker references `TerritoryReportView-DDugu7SJ.js`.
  TypeScript AST inspection of that served chunk confirmed the dedup helper's
  compiled default is `true`, while its existing queue dependency remains on.
- Served `useTerritoryRealtime-Dn7sEbkD.js` includes the signal-aware callback;
  `mapUtils-BXruzWXu.js` includes signal-proof validation.
- This verifies the delivered code/configuration, not an authenticated production
  save/cancel network trace. No production application records were changed.

Production integration: 2,210 tests / 223 files passed, including save/cancel
with DEMO=false. Lint and build passed. This count excludes unrelated demo-only
features, so it differs from the demo suite count of 2,231.

The measured save/cancel and delayed-response tests remain demo evidence from
0072. Do not infer a daily/monthly saving from the small scripted request set.

## Rollback

Set only VITE_VISIT_SIGNAL_DEDUP_ENABLED=false, rebuild/redeploy and apply the
client PWA update. History recovery, the existing queue, 30-minute safety read,
manual refresh and all unrelated flags remain enabled. No DB rollback needed.
