# Demo mobile home opens event detail directly

- Status: demo validation
- Date: 2026-10-23
- Production: unchanged; mobile entry is gated by VITE_DEMO_MODE

## Problem

Mobile home navigated to `/calendar?openEvent=id`. That route selected a full
calendar snapshot, rendered the calendar, and then opened the detail in an
effect. A home event already exists in the bounded home snapshot.

## Decision

- Demo mobile home navigates to `/?openEvent=id` and renders the existing
  calendar controller in detail-only mode, initialized with that event ID.
- The home snapshot remains bounded. Opening detail does not itself promote
  the calendar to full history. Comments retain their existing reads.
- Keep the query until detail closes. Editing explicitly requests full
  history through CalendarReadGate. App must keep this controller mounted
  while loading, just as it already does for the calendar route.
- Closing or OS back returns home. Assignment editing retains its existing
  return to the event detail. Missing events offer a way home, not a calendar.
- Reuse existing participant, comment, editing and assignment callbacks and
  role gates. No DB, permission, notification or mutation changes.
- Calendar/notification links and desktop home remain unchanged. Production
  activation needs a separate gate review; do not remove demo gating blindly.

## Automated verification

- MobileHome wiring: user, leader and admin home enter the root detail URL;
  stale month/full demand is reset. Production still enters the calendar.
- Detail renders without the month grid; button, OS back and external entry
  return home. Missing event has a back path.
- Applying passes the selected event ID; updated participants render.
- Editing requests full history and survives the gate loading and data update
  without reopening detail over the editor.
- Scope matches home until editing; malformed IDs/chat links remain conservative.
- Mutations: reverting home entry to calendar fails 3 wiring tests; restoring
  unconditional full history for openEvent fails 4 scope tests.

## Measurement limits

No monthly egress or latency claim. This removes an unnecessary calendar-route
transition, not all requests: comments, notifications and explicit mutations
can still read data. Real demo browser verification is recorded below after
deployment. No production deployment or production DB writes in this task.

## Deployed demo verification (2026-10-23)

- Code: `9aeb8e8`; demo deployment `dpl_GQbEZHeaGvyrZdon2giCao17EB3G`.
- Canonical demo alias served `index-CA3z4JN0.js`; the same script was observed
  in the browser after applying the app update. Production was not deployed.
- Final suite: **1,820 tests / 206 files passed**, lint and build passed.
- Chrome mobile emulation (390 x 844), real demo admin and user accounts.
  This is not a physical iOS/Android device test.
- Created disposable demo event 100, `TEST 홈 상세 바로열기 1023`, on today
  2026-10-23, 19:00-21:00. It remains available for review. Test application
  was cancelled; both detail and home show zero applicants. No comment writes.
- Before update, admin home entry visited `/calendar` and read unbounded
  `calendar_events`, `event_card_assignments`, and `event_card_assignment_cards`.
  DevTools showed each as a page/SW pair (not six independent billable reads).
- After update, the same admin entry stayed on `/?openEvent=100`, with no
  calendar grid and **zero requests for all three tables**. Comments still read;
  one unrelated pending-request count also appeared in that observation.
- User entry also had zero calendar/assignment reads and only the comment
  page/SW pair in the filtered REST observation. Do not convert these small
  demo intervals into a monthly billing estimate.
- User application: saved, applicant visible in detail, home badge/count 1;
  reopen preserved it; cancellation changed both screens back to 0.
- Admin edit: explicit full-history loading completed into the editor with
  the original title/time/leader intact; cancelling returned home.
- Assignment editor opened from detail; its back button returned to detail.
  Detail top back and browser back each returned directly home.
- Local evidence: `scratch/demo-home-direct-admin-9aeb8e8.png`,
  `scratch/demo-home-direct-applied-9aeb8e8.png`,
  `scratch/demo-home-direct-detail-9aeb8e8.png`.

Next: independent review and a production opt-in gate before activation.
Desktop home remains a separate unchanged path.
