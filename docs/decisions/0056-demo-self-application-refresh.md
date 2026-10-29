# 0056: Demo self-application participant refresh

Status: production opt-in activated after review and explicit user approval.
Date: 2026-10-30

## Scope

Ordinary self service application and cancellation refresh participants instead
of the calendar/recipient territory bundle. The shared gate is
`(VITE_CALENDAR_APPLICATION_REFRESH_ENABLED ?? VITE_DEMO_MODE) === 'true'`.
Explicit false disables it even in demo; absent configuration preserves demo
defaults and leaves production off. It is independent of
VITE_CALENDAR_NAVIGATION_REUSE_ENABLED. No database, notification, authorization
or write-path changes. Production retains the existing callback fallback until
explicitly enabled and redeployed.

## Safety contracts

- Team cancellation still uses remove_team_event_participant_tx and the existing
  calendar + visits recovery. No assignment/team/history narrowing there.
- A local snapshot may predate assignment. After a non-team cancellation, read
  server id, assignment_shared_at, assignment_team_informal and assignment_team_scopes.
  Only a confirmed matching ID, null sharing timestamp, null informal map and
  empty scopes object may use participant-only refresh. Unknown/malformed state
  or a failed read triggers calendar + visits recovery.
- cleanup_team_participant_removal advances assignment_shared_at even after
  removing the last team. This detects cleanup caused by a stale local snapshot.
  Previously shared events conservatively retain broad recovery too.
- The cart-enabled service RPC returns applied/cancelled for ordinary actions.
  Switching kinds, unknown responses, cart application, admin participant edits,
  and team removals retain existing refresh behavior.
- A narrow failure falls back to existing reads. A failed fallback propagates;
  success is not announced before refresh finishes. Missing loaded event falls back.
- The participant reader invalidates navigation caches and retains the existing
  late-response and lifecycle guards. No optimistic participant list is invented.

## Verification

- Full suite: 1,978 tests / 217 files passed; lint and build passed.
- Mutation tests cover legacy and RPC apply/cancel, kind switches, team removal,
  missing callback, failed writes and both fallback outcomes.
- Server-probe tests reject shared/cleaned-up, wrong-ID, missing and failed data.
- useStore wiring tests verify demo narrow refresh and unchanged production path.
- scripts/measureParticipantRealtimeDemo.mjs --confirm-demo --self-application
  uses two independent authenticated demo clients with real DB/WebSocket and
  application hooks under JSDOM. One invokes useStore.applyToEvent; the other
  receives participant realtime. Both final lists are asserted for join/cancel,
  with cart feature off and on. Driver followup reads: join 1 participant read;
  cancel 1 assignment-state probe + 1 participant read. Observer: 1 participant
  read each. No territory reads occurred in those measured refresh paths.
- Driver hook intentionally has no self realtime subscription: these counts
  isolate post-write recovery, not whole-app traffic. A real App can also receive
  its own realtime signal and refresh participants again. Chat/notification
  hooks, physical phones and billed bytes are not part of this measurement.
- Successful real run used event 114. Test events and participants are deleted in finally; inspect-fixtures checks
  for leftovers independently. Team cancellation safety is covered by automated
  mutation tests, not destructive production tests.

## Deployment

Demo deployment only. No production writes or flag changes are authorized here.
Before production, review cancellation metadata assumptions, callback gate and
cart switching exclusion. For production activation set
VITE_CALENDAR_APPLICATION_REFRESH_ENABLED=true and rebuild/redeploy. To roll
back set it to false and rebuild/redeploy; clients must apply the PWA update.
This flag does not disable the separate realtime/navigation optimizations.

## Review followup: 2026-10-30

- Added useStore integration cancellation cases, using the real server-guard
  helper over a mocked query transport rather than mocking away the helper.
  Verify the participant write precedes the exact assignment metadata query and
  no narrow participant read starts before that query.
- Confirmed unassigned response uses only the participant patch. Shared timestamp
  or server failure must skip that patch and read calendar, both assignment tables,
  visit_histories and service_sessions. The resulting list removes the applicant.
  These cases run with production mode and the new flag on, navigation reuse off.
- Store-level flag matrix covers demo default, production default, production
  opt-in, explicit demo false and explicit production false.
- Mutation verification: removing the assertUnassignedCalendarEvent invocation
  makes all three cancellation integration cases fail. Ignoring explicit false
  makes the demo-off integration case fail. Restored code passes focused tests.
- Final full verification: 1,984 tests / 217 files passed, lint and build passed.

## Production activation: 2026-10-30

- User authorized rollout and reserved real team cancellation for their own test.
- Cherry-picked 779ab27 and 374e90d as 4052715 and 745e42e on production main.
  No unrelated demo functionality was imported.
- Added VITE_CALENDAR_APPLICATION_REFRESH_ENABLED=true to Production only.
  Existing flags were left unchanged.
- Production-base verification: 1,949 tests / 214 files, lint and build pass.
- Inspected candidate, then promoted dpl_7QMoHUWZMZXc4FFgrWVpxH6dHazd.
  Canonical index-C9RfdUwV.js loads TerritoryReportView-C-Qf8Lbm.js, identical
  to the inspected candidate. Compiled application gate defaults to true,
  cancellation awaits assignment-state validation, and broad removal recovery
  remains wired. This verifies deployed activation, not an actual production write.
- No production application/cancellation or DB test writes were performed.
  User must apply the PWA update before their team-cancellation smoke check.
- Rollback: set the application flag false and redeploy, or restore preceding
  deployment dpl_EJBCw5vDKJCJNCaLtaweniLeNfDS. Clients need the app update.
