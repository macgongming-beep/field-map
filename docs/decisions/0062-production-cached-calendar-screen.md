# Production: cached calendar screens only

- Date: 2026-10-31
- Status: deployment authorized; verification recorded below after deployment
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
