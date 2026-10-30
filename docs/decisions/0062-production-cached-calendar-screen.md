# Production: cached calendar screens only

- Date: 2026-10-31
- Status: deployed; served production bundle verified
- Reviewed source: a701ddb, 5a6e115, 55cb779; baseline origin/main 5d42a73

## Scope

Port only the approved cached-screen selector, full-calendar snapshot insertion,
production opt-in helper and associated tests. Keep main's production role/window
gates and existing production tests. Do not merge the demo branch wholesale.
History recovery and the visit/realtime queue implementations are NOT included.
No DB writes, migration or permissions changes.

## Verified Environment

Production prerequisites read from Vercel: scoped visit histories, recipient
store, territory realtime, calendar window and calendar navigation reuse all true.
DEMO is unset. Explicit deployment flags:

| Flag | Value |
| --- | --- |
| VITE_CALENDAR_CACHED_SCREEN_ENABLED | true |
| VITE_SCOPED_HISTORY_RECOVERY_ENABLED | false |
| VITE_VISIT_REALTIME_QUEUE_ENABLED | false |

Only the first flag has an implementation in this production port. The other
two are deliberately false as well as absent from the application code.

## Safety / Tests

Keep two-minute TTL without renewal, complete assignment responses, pending-read
guards, role/account matching and epoch invalidation. Cached navigation publishes
matching events and readiness together. First/expired/invalidated reads still load.
Cancellation, reassignment, foreground and manual refresh keep their invalidation.

Clean installation: 2,010 tests / 217 files passed; lint passed. This production
branch has fewer tests than the demo branch because unrelated demo work is absent.
Tests cover all four roles, production true/default-off/demo false, cached screen
render frames, both failed assignment tables, pending participant refresh, cache
expiry and stale responses. Main's production role/scope tests are retained.

## Rollback

Set only VITE_CALENDAR_CACHED_SCREEN_ENABLED=false, rebuild/redeploy, then clients
apply the PWA update. Calendar navigation reuse can remain true. Keep the other
two new flags false. Old app instances retain their existing bundle until update.

## Deployment Verification

- Production code commit: 6fe2894 (pushed to main).
- Deployment: dpl_8a7yovVesfXDg2BfyxBnwcdRy3gS, READY and aliased to
  https://chinese-territory-app.vercel.app.
- Followed the canonical page's JavaScript module graph to the served store:
  `/assets/TerritoryReportView-C8MuIqty.js` (HTTP 200).
- The compiled cached-screen helper returns the enabled navigation-reuse helper
  AND true; navigation reuse defaults to the compiled string `true`.
- Served store selects cached calendar events and marks that same snapshot ready.
  Visit/realtime queue implementation is absent, consistent with the limited port.
- Store SHA-256:
  `8106ee744ddcf1a8f2bc95a973c8c7d5806cbf0166506134b84c2f5ec511fe3d`.
- Production environment was re-read after changes: cache screen true, history
  recovery false, visit/realtime queue false; all five prerequisites true.
- Logged-in production UI navigation was not rechecked: browser connection timed
  out. User previously confirmed immediate demo navigation. No production records
  were created or modified for this deployment check.
- This verification-only documentation update is local, after deployment; it does
  not trigger another production build.
