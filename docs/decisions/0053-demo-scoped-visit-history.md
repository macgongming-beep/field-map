# Separate recipient visit histories from full statistics

- Status: reviewed and enabled in production; admin statistics verified unchanged
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

## Deployed demo verification

Code commit: `6d06d81`. Demo deployment: `dpl_Bdmgmdgnyv2jB88GqnEfhpCTknbc`.
Canonical demo served `/assets/index-DK7fbrA4.js`; the PWA update was applied
before testing. The compiled store contains the scoped-history path. No
production deployment or environment variable was changed.

Using the actual demo recipient account, a disposable event (101) assigned
existing card 1. Browser actions, not a direct record insert, saved a missing
visit for building 1 / unit 2 (102):

- Before: unit status unvisited; no valid unit-2 history; three valid global
  histories (IDs 1, 2 and 41).
- Save: history 74 appeared in unit detail as one record. The building changed
  from 1/3 to 2/3 and the assignment map from 2/16 to 3/16.
- Desktop statistics with the same recipient account showed total 4, met 1,
  absent 2, excluded 1, including the original record outside card 1.
- The unit-detail menu invalidated the test record through the normal UI. The
  detail returned to zero records; building/map totals returned to 1/3 and 2/16.
- Desktop statistics returned to total 3 (one of each result). A demo DB read
  independently confirmed unit 2 unvisited, history 74 invalidated and original
  valid histories 1, 2 and 41 unchanged.
- The disposable event and its two generated sessions (143, 144) were removed;
  the invalidated history remains as the normal audit trail. No existing
  assignment, session or valid visit was deleted.

`scripts/smokeScopedHistoryDemo.mjs` provides guarded demo fixture setup, read-only
checks and cleanup, with configuration supplied via `DEMO_ENV_FILE`; explicitly
supplied process variables may override the demo URL/key and test credentials.
It requires explicit credentials and refuses a
non-demo Supabase origin and never prints the authentication token.

Home -> personal settings -> home rendered without the global loading screen.
The assertion of zero additional **store** requests comes from integration
tests, not browser wire capture. Settings may still request their own login
history and home may reload its suggestion. Network transfer bytes were not
captured by this browser tool, so no MB reduction is claimed.

UI evidence (local scratch screenshots): `demo-scoped-history-saved.png`,
`demo-scoped-history-cancelled.png`, `demo-scoped-history-statistics-four.png`,
`demo-scoped-history-statistics-restored.png`. Mobile checks used a 430x900
browser viewport, not a physical phone. Mobile has no `/stats` view; complete
statistics were checked in the desktop layout. Viewport was reset afterward.

## Repeat verification and review handoff (2026-10-29)

The same deployed demo code (`6d06d81`) was tested again, without changing the
application bundle or production. A new disposable event (102) assigned card 1
to the demo recipient. Saving and cancelling were performed through the UI:

| Check | Observed result |
| --- | --- |
| Save absent visit for building 1 / unit 2 (102) | Detail showed history 75; building 2/3, map 3/16 |
| Open desktop statistics as the same recipient | Total 4; met 1, absent 2, excluded 1 |
| Cancel through detail menu and confirm invalidation | Detail returned to zero records; DB unit status unvisited |
| Reopen statistics | Total 3; met 1, absent 1, excluded 1; October visits 0 |
| Independent demo DB check | Original valid IDs 1, 2, 41 unchanged, including unit 240 outside the assigned card |
| Cleanup | Test event and generated sessions removed; history 75 retained invalidated as audit trail |

A new store regression test starts a scoped read while a saved record exists,
cancels that record through `undoLatestVisit`, then releases the stale response.
It requires rejection of that response and verifies that neither the history nor
the visited unit status reappears. This complements the existing save/read race
test. The focused reader/store/settings suite passed 187 tests.
The final full suite passed 1,911 tests across 212 files; lint and build passed.

Review entry points:

- Implementation: `6d06d81`; initial verification: `dc90267`.
- `src/hooks/scopedVisitHistory.ts`: all visitors within loaded units, annual
  window, invalidation filter, complete pagination, strict response validation.
- `src/hooks/useStore.ts` and `src/hooks/useStore.recipient.test.tsx`: scope
  grant/revoke, targeted save/cancel, stale-response rejection, failure retention,
  statistics remount with a complete annual snapshot, privileged-role behavior.
- `src/hooks/useSettingsCalendarScope.ts`: only personal settings retain scope;
  explicit false, calendar-disabled, admin/statistics/editor/deep-link behavior.
- Review the production opt-in gates and rollback before enabling either feature.
  No production rollout is part of this verification.

Fresh local evidence in `scratch/`: `demo-history-review-saved-1029.png`,
`demo-history-review-stats-four-1029.png`, `demo-history-review-cancelled-1029.png`,
`demo-history-review-stats-restored-1029.png`. These are browser viewport checks,
not a physical-phone or two-device realtime test. No wire-byte or monthly-saving
claim is made. Browser viewport was restored and the demo returned to home.

## Rollout

After review of `6d06d81` and `81313c9`, the user separately authorized production
activation. The approved changes were cherry-picked onto production base
`3a2ff1e` as `aba22a5`, `c371cad` and `1fec83e`, then pushed to main. The single
merge conflict retained production's existing `strictGroups` call signature;
unrelated demo-only `strictAssets` behavior was not imported.

Production variables are now `VITE_SCOPED_VISIT_HISTORY_ENABLED=true` and
`VITE_SETTINGS_CALENDAR_RETENTION_ENABLED=true`. No other flag, DB schema or RLS
was changed. Explicit false plus rebuild restores the prior global recipient
history / settings calendar behavior. PWA clients must apply an update.

### Production verification

- Production-base suite: 1,876 tests / 209 files, lint and build passed. This
  excludes unrelated demo-only tests from the 1,911-test demo branch.
- Candidate deployment `dpl_Ao4qNMbmAAQDdkWtZu8ESh8WBsYQ` was built using the
  production project/environment, verified READY, then promoted to
  https://chinese-territory-app.vercel.app.
- Canonical HTML serves `/assets/index-Dd9qNrdl.js`. Both entry and store chunk
  match the inspected candidate byte-for-byte. Store:
  `/assets/TerritoryReportView-ym6ExxRl.js`, SHA-256
  `fdb56376d112e78d5bd7874c0bb00481090afcc8ac87f1ec3313b529ad5726f6`.
- Compiled history gate is enabled and still requires actual `user` role and a
  recipient reader. Unit-ID batching, invalidation/date filters and stale-read
  guard are present; statistics/privileged reads retain the global branch.
- Compiled settings retention is enabled, requires calendar windows, and excludes
  openEvent/openChat deep links. The candidate uses the production Supabase origin.
- Applied the normal PWA update in the existing administrator session and checked
  the DOM script URL is the new entry. Statistics before and after: total 1,314,
  met 346, absent 568, excluded 399; October 222 visits / 46 met; 3,272 units.
  These displayed values were unchanged.
- Local UI evidence:
  `/Users/gm/Documents/New project/field-map-recipient-perf/scratch/production-scoped-history-stats.png`.
- No production visit was saved or cancelled. Actual volunteer-role wire requests
  were not captured; enabled compiled filtering and integration tests are the
  evidence for that path. Save/cancel remains verified on demo only.

No monthly or production-byte saving is claimed. Compare usage after installed
clients apply the update, using matched time windows and active-account counts.
