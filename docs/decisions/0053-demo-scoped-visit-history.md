# Separate recipient visit histories from full statistics

- Status: demo implementation verified automatically; deployed UI verification pending
- Date: 2026-10-26
- Related: 0015 recipient loading, 0049 return-detail retention, 0052 recent sessions

## Decision

`VITE_SCOPED_VISIT_HISTORY_ENABLED` follows `(flag ?? VITE_DEMO_MODE) === 'true'`.
Only actual users in the existing recipient store read histories for loaded unit
IDs. This is NOT a visitor-name filter: other visitors' records in those units
remain available. The 365-day created_at window, invalidation filter, projection,
and all-page completeness are preserved. Queries batch 100 unit IDs and reject
foreign/duplicate rows. Empty scopes issue no history request.

Statistics routes already leave recipient mode and remount AppSession. They
continue reading the complete annual history, including records outside the
personal building snapshot. Leader/admin/developer stores and CSV paths retain
their existing complete history. No statistics are calculated from a personal
subset. This step deliberately does not optimize privileged stores.

Scope-changing calendar/resource/card reads also refresh the history snapshot,
without fetching sessions solely for that purpose. Revoked units are pruned.
Save/cancel still use targeted authoritative building/history refreshes. A newer
targeted result invalidates a pending older scoped history read; it cannot put a
cancelled record back. Failed reads preserve the last snapshot, with no silent
unfiltered fallback. The mutation recovery path still refreshes its authoritative
building/card/visit slices.

This first step rereads the scoped annual histories on foreground recovery.
It does not claim to eliminate all unchanged-history requests or implement a
second history watermark. Existing building recovery remains unchanged.

## Personal settings calendar

`VITE_SETTINGS_CALENDAR_RETENTION_ENABLED` uses the same opt-in convention and
requires calendar windows to be enabled. Exact personal-settings routes retain
the previous calendar scope; direct entry uses the bounded home window. Home,
month and personal-service scope round trips do not promote to `full` merely
because settings opened. Admin settings, statistics, editors and openEvent/
openChat deep links retain their previous full-read behavior. Settings do not
freeze the data: normal foreground/realtime/manual refresh is unchanged.

## Verification

- 1,910 tests / 212 files; lint and build passed.
- Scoped reader: every page/batch, all visitors, annual projection, empty scope,
  invalid IDs, foreign/duplicate rows and partial-page failure.
- Store: initial/foreground/manual filters; user statistics remount with unrelated
  history retained; leader/admin/developer complete reads; scope grant/revoke;
  save/cancel and delayed stale read rejection; failed-read preservation.
- Personal-settings round trips assert no new store requests. Direct entry,
  explicit false, calendar disabled, old month, personal service and deep links
  are covered. Shared/history/attendance tests remain unchanged and pass.
- No DB schema, RLS, write permission or production configuration change.

## Rollout

Demo only for this task. Production remains unchanged. Separate review and
authorization are required before production opt-in. Explicit false plus rebuild
restores the prior global recipient history / settings calendar behavior. PWA
clients must apply an update. No monthly or production-byte saving is claimed.
