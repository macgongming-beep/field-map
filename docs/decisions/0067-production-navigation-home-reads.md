# Production navigation recovery and home reuse

- Date: 2026-10-31
- Status: approved; deployment in progress
- Reviewed source: 9f3def1, ba8b767, 0de172e; decision 0066
- Production baseline: 421f291

## Scope

Integrate the reviewed navigation recovery, retired notices read skip, home
suggestion body reuse and home meeting metadata reuse. Preserve main's existing
production gates and exclude unrelated demo informal-group behavior. No database,
RLS or persisted-cache changes. Existing uncommitted 0063/0064 notes are retained.

## Activation

First enable VITE_LEGACY_NOTICES_SKIP_ENABLED,
VITE_HOME_SUGGESTION_REUSE_ENABLED and VITE_HOME_MEETING_META_REUSE_ENABLED.
Then enable VITE_CALENDAR_NAVIGATION_RECOVERY_ENABLED in a second deployment.

Read production Vercel settings before activation: scoped history recovery,
scoped visit histories, recipient store, territory realtime, calendar window,
navigation reuse, home suggestion body and service meeting notes are all true.
DEMO is unset. Navigation recovery remains dependent on the existing history
coverage, pending-update and thirty-minute safety checks. Changed/revoked
assignment scope falls back to the existing complete scoped refresh.

## Verification

Production integration: 2,135 tests / 219 files passed; lint and production-mode
build with all four new flags true passed. The count differs from demo because
unrelated demo-only work is not integrated. Reviewed mutation and real demo DB
measurements remain recorded in 0065/0066; they are not production measurements.

Browser connection timed out before deployment. Verify the canonical served
JavaScript as well as deployment status and environment values. Do not claim a
logged-in production navigation or save/cancel check unless actually performed.

## Rollback

Set the affected new flag false, rebuild/redeploy and apply the client PWA update.
Navigation false leaves foreground recovery intact. The home switches do not
hide home content or disable meeting notes. No DB rollback is needed.
