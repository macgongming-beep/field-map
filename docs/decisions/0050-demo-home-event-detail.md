# Demo mobile home opens event detail directly

- Status: approved; production integration in validation
- Date: 2026-10-23
- Production: selective integration of approved `c017528`; release verification below

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

## Shared production flag follow-up (2026-10-23)

- Replace demo-only home entry/detail, App loading/context and store gates with
  `calendarWindowEnabled()`, matching the helper already on production main.
  `(VITE_CALENDAR_WINDOW_ENABLED ?? VITE_DEMO_MODE) === 'true'`: production
  opt-in works, explicit false disables even demo, unset retains demo fallback.
- Home detail still uses the existing home snapshot. Editing still promotes
  to full history; the detail controller stays mounted during that load.
  Other full consumers remain blocked until complete history is ready.
- Keep decision 0049's pending return-detail optimization demo-only. Adopting
  the shared production calendar flag must not silently activate that feature.
- Production main already contains recipient card and leader calendar scope
  integration at `8f59b39`; do not reapply those as pending work.
- Read-only Vercel inspection found production alias Ready at
  `dpl_5oq5NQcgn1Uhf8nfaZYuGL2CSQaN` (created 2026-10-23 21:27 KST).
  This inspection alone is not a deployed bundle flag assertion. No production
  deployment, environment update or DB write was performed for this follow-up.
- Added actual App wiring tests for provider/scope, production home editor
  survival during history loading, and full-consumer loading gates. Mobile
  navigation covers user/leader/admin with enabled and explicitly disabled
  flags; store tests verify scoped versus full requests under the same matrix.
- Mutation checks: reverting the shared helper to demo-only fails 15 tests;
  reverting only App's loading gate to demo-only fails 2 tests. Both restored.
- Final automated verification: **1,843 tests / 207 files passed**; lint and
  TypeScript/Vite production build passed. Focused flag/wiring suite: 83 passed.
- Production integration will immediately follow the already-enabled calendar
  flag. Rollback by setting that flag false requires rebuild, redeploy and PWA
  update, and disables other calendar-window optimizations too, not just home
  detail. This is not an instant or home-only rollback switch.
- This follow-up changes gating only. The browser verification above is for
  `9aeb8e8`; it must not be presented as a new production browser verification.

## Selective production integration (2026-10-23)

- User approved production activation after independent approval of `c017528`.
- Integrated only home direct event detail and its shared calendar gate into
  production `a8ebcb0`. Existing calendar/recipient gates and the iPhone unit
  header fix remain intact. No DB or permission changes.
- Decision 0049 return-detail optimization is not included, even as dormant
  source. An integration test keeps return-detail routes on the existing full
  calendar scope for all roles.
- Focused integration suite: 109 tests passed across six files.
- Mutation checks on this production integration: restoring demo-only home
  detail fails three role tests; restoring demo-only App loading fails two
  gate tests. Restored both mutations before final validation.
- Existing `VITE_CALENDAR_WINDOW_ENABLED=true` activates the feature upon
  rebuild and client PWA update. The rollback limits above still apply.
- Final production-branch validation: 1,792 tests / 203 files passed;
  lint and TypeScript/Vite build passed. The count differs from the demo suite
  because unapproved demo-only changes are deliberately not integrated.
