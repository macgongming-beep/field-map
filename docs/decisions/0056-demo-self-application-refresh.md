# 0056: Demo self-application participant refresh

Status: demo only; production rollout requires review and an explicit gate decision.
Date: 2026-10-30

## Scope

Ordinary self service application and cancellation refresh participants instead
of the calendar/recipient territory bundle. The callback is wired only when
VITE_DEMO_MODE is true. No database, notification, authorization or write-path
changes. Production retains the existing callback fallback.

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
cart switching exclusion. Roll back the demo deployment to restore old reads.
