# Recent personal service-session reads

- Status: demo deployed; production unchanged, review pending
- Date: 2026-10-26
- Related: 0018 personal-session loading, 0021 session-only post-save refresh

## Decision

Ordinary user, leader and admin stores read the authenticated user's sessions
with `service_date >= local today - 8 calendar days`. There is no status or upper
date filter. All pages are read with stable started_at/id ordering. The extra
day covers the existing rolling seven-day map-card consumer across local/UTC
and daylight-saving boundaries. The cutoff is recomputed for each read.

The actual developer role keeps the complete, all-user, all-date session read
on every route. This deliberately retains developer-home overhead rather than
risk silently truncating `DesktopStats.sessionTimeStats`. Attendance statistics
use calendar participation, not this session list. Visit histories are unchanged.

`VITE_RECENT_SESSIONS_ENABLED` uses `(flag ?? VITE_DEMO_MODE) === 'true'`.
Explicit false disables it even in demo. Missing authenticated name and disabled
flags retain legacy behavior, including the existing personal-recipient flag.
The name comes from auth, not the display role or stale localStorage identity.
When enabled, an authenticated name/role change remounts AppSession to isolate
partial snapshots and pending reads. Ordinary renders do not remount it.

## Consumer audit

- MobileHome/DesktopApp use own sessions for today's state and recent seven-day
  card visibility; the retained window includes both.
- MobileMap/DesktopMap/MobileTerritory/DesktopMyService use own today sessions.
- `getRecordServiceSession` links only today's records; start closes only the
  user's other active sessions today. Both retain their required inputs.
- Past/shared assignments come from calendar assignment data, not old sessions.
- Recipient active-card lookup and chat end-status queries remain unchanged.
- Only actual developers consume all-user historical session durations.

## Failure and mutation contracts

An error on any session page preserves the previous complete snapshot and
surfaces the error; an incomplete result never replaces it. Starting/ending
still refreshes only sessions, without refetching one year of visit histories.
If an explicit end action targets a session outside the retained snapshot,
read that one ID's event/card/time-slot metadata before updating and logging.
A failed/mismatched metadata read prevents the update rather than emitting an
incorrect log. This failure behavior is intentionally different; the successful
write behavior is retained. Cached targets do not add this request.

## Verification

- Full suite: 1,889 tests, 210 files; build and lint passed.
- Role/date/filter tests cover initial, foreground, manual refresh, next-day
  cutoff, future dates, expired sessions, NULL-date exclusion, all pages and
  preserving a complete snapshot after first/second-page failure.
- Developer/disabled cases retain 1,001 historical rows across users and pages.
- Store tests exercise start/end refresh and record linkage without rereading
  histories. Mutation tests check exact ID constraints, metadata preservation,
  failed reads/updates and cached-target behavior.
- Date tests also passed under `TZ=America/New_York`.
- Independent read-only review found no blocking regression. Exact-ID and
  second-page/boundary test gaps were then strengthened. A delayed old read
  across identity remount and the full multiple-active-session reuse matrix are
  not additional browser-level tests in this change.

### Demo DB smoke

`scripts/smokeRecentSessions.mjs` requires explicit demo write confirmation,
local configuration files, the exact demo project origin and a volunteer role.
It never changes pre-existing session rows. On 2026-10-26:

- Full table: 16 rows; demo volunteer's history: 5; current personal window: 0.
- Created test session 142, read active state through the new filters, ended
  that exact test row, and read ended state with unchanged start timestamp.
- Deleted only that ID plus unique memo; full 16-row snapshot matched before.
- This is an authenticated API smoke, not a manual start/end-button test. The
  current app no longer exposes those buttons (see 0021). Helper/store behavior
  is tested separately; no real handset start/end interaction is claimed.

### Deployed UI

Demo deployment `dpl_HtWehjbu4ZppjzAqte1X6BytAXWo`:
https://chinese-territory-app-demo.vercel.app

Applied the normal PWA update. Volunteer home and My Service loaded. October 5
past service and its leader/team member still appeared outside the session window.
Logged in as the actual developer and opened desktop statistics. All six duration
rows matched an independent full DB calculation: 17.1h/5 sessions, 16h/4, 8h/2,
and three 4h/1 rows. Visit totals also displayed. Local screenshots:
`scratch/demo-recent-sessions-past-assignment.png` and
`scratch/demo-recent-sessions-statistics.png`.

The deployed store chunk matches the locally verified demo build byte-for-byte
(SHA-256 `92e07f9d68cd14c8f15f2d7eb3f828851565fc6f54fe3429d7e6473421085471`).
The bundle points to the demo project, with no production Supabase origin.
Chrome native control timed out; UI checks used the in-app browser instead.

## Rollout and limits

No production deployment, database schema change, RLS change or production write.
Production activation requires separate approval and a build with
`VITE_RECENT_SESSIONS_ENABLED=true`. Roll back with explicit false and rebuild;
installed clients must apply the update. Other optimizations remain independent.

This reduces rows per repeated ordinary read, not the number of refresh triggers.
Developers intentionally still read full history. Demo rows and API smoke do not
establish production bytes saved, monthly totals or whether a 5 GB quota fits.
