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
