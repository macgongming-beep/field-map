# Demo: reuse complete calendar screens without a loading remount

- Status: demo validation; production unchanged; external review pending
- Date: 2026-10-30
- Related: 0054 navigation cache; 0055 participant invalidation

## Findings

An exact/covering calendar cache hit was applied only in a passive effect. The
preceding render returned `calendarScopeReady=false` and App replaced its content
with AppLoading. This unmounted shared UI even though no calendar request was
needed. The rendered demo reproduced a loading mount on each home/service return,
plus settings/notification reads.

Complete `full` calendar snapshots were not stored in the navigation cache. The
administrator service/zone path deliberately still consumes full calendar data;
returning from home therefore fetched calendar events and both assignment tables
again. Do not solve that by truncating administrator data.

## Decision

Demo-only, behind `VITE_CALENDAR_CACHED_SCREEN_ENABLED` (unset defaults on only
when demo AND calendar navigation reuse are on; explicit false disables):

- Return a matching fresh cached event list and readiness together during render.
  The existing navigation effect still publishes the snapshot to store state.
  Never show the previous scope's events while claiming the new scope is ready.
- The display selection requires an enabled store, unchanged role/recipient
  identity, no pending invalidating refresh, and an eligible complete cache hit.
- Cache successfully completed full calendar snapshots as well as window/service
  snapshots. Preserve all old/future events, applicants and other teams. Full
  reads with failed assignment pages never enter the cache.
- Keep the existing six-entry limit, two-minute TTL, clock-reversal rejection
  and no TTL extension on reuse. Keep cache generation checks so an invalidated
  in-flight read cannot refill the cache.
- Keep every existing invalidation: writes, participant changes, assignment and
  restaurant changes, recovery/reconnect, foreground, manual refresh and identity
  changes. Cold/expired/invalidated destinations still load and expose retries.
- The cache remains display-only. Restoring it does not supply recipient
  authorization scope or mark a partial snapshot as suitable for mutation merging.
- No DB changes, no persistent device cache, no broader user/leader card access,
  no production flag activation.

## Scope Boundaries / Remaining Requests

- Volunteer home/calendar/service and assigned maps keep their existing recipient
  store. Leaders retain full cards/buildings and personal calendar ranges.
- A volunteer directly visiting the full zone/map workflow still switches store
  modes deliberately. Reusing a partial recipient snapshot there could omit cards;
  that broader ownership change is not part of this patch.
- First visits and cache expiry still request complete applicable data. Navigation
  misses in recipient mode still refresh the permitted territory snapshot.
- Home suggestions, admin attention counts, notification polling and chat TTLs
  can still request data. This patch does not suppress their freshness mechanisms.

## Regression Verification

Full suite: 2,061 tests / 221 files; lint and TypeScript/Vite build passed.

Store+render tests cover all four roles: after warmup, repeated home/service
navigation causes no loading/unmount and no calendar calls, and EVERY render has
the destination's events. Cancellation invalidates a hidden full snapshot;
mutation/realtime/foreground/manual invalidation restores changed participants
and team assignments. Full snapshots expire without renewal; a late invalidated
full response cannot repopulate the cache. Production true remains disabled, and
demo explicit false retains the old behavior.

Mutation checks, restored before final tests:
- Removing immediate cache readiness: four role/render tests fail.
- Removing full-snapshot cache insertion: three tests fail (including expiry).

## Browser Measurement

`scripts/measureCalendarScreensDemo.mjs` launches an isolated headless Chromium
mobile viewport against the canonical demo URL. It never uses the user's browser
session. Credentials are read from a private env file, not command arguments.
It blocks non-demo Supabase traffic and non-read mutations (except login/session
verification), and suppresses automatic stale-session closure. No visit, applicant
or assignment is modified by this measurement.

It measures home -> calendar -> service -> zone (leader/admin) -> home, three
times, recording all application DB HTTP requests and AppLoading DOM mounts.
Navigation uses SPA history/popstate, not full document reloads. First-traversal
reads are distinct from repeat-cache reads. Background polling is included in
totals and can vary; specific full-calendar queries and loading mounts are the
stable regression indicators. This is actual rendered Chromium, not a physical
iPhone/PWA. Cancellation/reassignment safety is tested automatically, not by
changing real demo assignments in this browser measurement.

## Deployed Browser Results

Code `a701ddb` was deployed only to the demo project. Deployment
`dpl_F2noWtCr1v4FVuit2YWkMGnMT9SX` is READY and aliased to the canonical demo URL.
The served entry changed from `index-M5TXCaZm.js` to `index-G9vSxsEj.js`.

Three round trips per role, including first-visit reads:

| Role | All DB HTTP requests before -> after | AppLoading mounts before -> after |
| --- | --- | --- |
| Volunteer | 54 -> 44 | 6 -> 1 |
| Leader | 29 -> 14 | 6 -> 1 |
| Administrator | 44 -> 25 | 6 -> 1 |

The remaining loading mount is the first service visit. On the second trip:

| Destination | Volunteer before -> after | Leader before -> after | Admin before -> after |
| --- | --- | --- | --- |
| Calendar | 0 -> 0 | 0 -> 0 | 1 -> 1 |
| Service | 2 -> 0 | 2 -> 0 | 7 -> 3 |
| Zone | Not tested: different store mode | 0 -> 0 | 0 -> 0 |
| Home | 3 -> 1 | 3 -> 1 | 4 -> 2 |

Every repeated destination has zero AppLoading mounts after the patch. The
administrator's repeated service visit eliminates all three calendar/assignment
reads; other requests remain for admin attention and notification refresh.
Volunteer/leader service visits eliminate settings/notification reads caused by
the unnecessary remount. Home still reads its suggestion.

These are observed request counts, not billed bytes or monthly savings. The
before run includes a five-request chat TTL refresh on the third leader/admin
trip that the after run does not; do not attribute that difference to this patch.
Initial volunteer calendar/service reads (18/23 requests) remain unchanged and
are a separate potential follow-up. All three browser runs reported no page
errors or unexpected writes. End-of-run screenshots render the home normally.
Physical iPhone/PWA behavior remains untested.

Local measurement logs: `/tmp/calendar-screens-before.log` and
`/tmp/calendar-screens-after.log`. Production checkout remains at `5d42a73`;
no production deployment or configuration change was performed.

## Rollback

Set `VITE_CALENDAR_CACHED_SCREEN_ENABLED=false` on the demo project and redeploy;
clients apply the PWA update. Existing calendar navigation reuse can stay enabled.
An explicit true cannot enable this trial in production. A separate review and
production gate are required before release.
