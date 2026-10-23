# 0037 - Demo calendar reads by visible date scope

## Status

Demo only. No production flags, database migrations, or permission changes.

## Decision

On home, load events since 14 local calendar days ago and all future events.
On the calendar, widen this lower bound to the first day of the selected month
when necessary. Include every participant and both assignment tables for the
returned event IDs. Page every query and reject assignments from foreign events.

Statistics and all other routes retain full calendar history. Calendar editors,
repeat/delete controls, import/export, and event/chat deep links also require a
full snapshot. Historical statistics (including multi-month reports) must never
render against the home window. Calendar contents are gated until the requested
month is ready; errors expose retry instead of an empty applicant list.

This intentionally retains all future events and later months when opening an
old month. It is not a month-only cache. Manual refresh re-reads the complete
current date scope, not a delta; full consumers still request full history.

Visible dates are not authorization. A partial calendar is never passed to the
recipient reader as a complete assignment snapshot. It independently resolves
the user's assignments, preserving access to older assigned cards.

## Consistency and failure handling

- Latest scope/version wins independently of the single-event edit flag.
- Failed assignment reads cannot mark a full snapshot complete.
- Calendar scope transitions have a 45-second deadline, including recipient
  queue work. Timeout exposes retry. Underlying transport is not aborted, but
  timed-out results cannot commit state through the abandoned await.
- Initial superseded reads retry within one shared 45-second deadline; real
  failures still surface. Several rapid route changes must not lock startup.
- Production ignores requested scopes and retains its existing query behavior.

## Verification

Unit/integration tests cover route gates, historical applicants/guests, attendance
counts, pagination beyond 1,000 rows, assignment batches, foreign responses,
full/partial races, disabled targeted-edit flags, failed assignments, stalled
month transitions with retry, and repeated initial supersession.

Independent review identified stale full-read overwrite, incomplete assignment
readiness, initial cancellation, and unbounded transitions. These were repaired
before demo release. Final review and live demo verification are recorded below.

### 2026-10-23 demo release

- Implementation: `c8cb803`; independent reviewer approved after running 300
  tests across 9 files. Full suite: 1,677 tests / 196 files, lint and build pass.
  The final two local-size instrumentation lines were followed by 29 passing
  scope/gate tests and the successful deployment build. This JSON estimate is
  not network transfer or billing.
- Demo deployment: `dpl_9yCz2ugZT2EuJ9tjgmhDQKCbH8H1`, canonical demo alias,
  browser entry `/assets/index-CeqecX93.js` after applying the PWA update.
- Chrome, demo administrator: home -> calendar -> September 13 retained the
  same three named applicants and three cart participants as before deployment.
  August historical participants are covered by synthetic regression tests;
  no production historical records were modified or used as demo fixtures.
- Home -> statistics -> attendance -> October + September: October Monday
  10:00 remained 1, Tuesday 13:00 remained 0; September Monday 10:00 remained 4
  and Sunday 10:00 remained 6. Exclusion dates stayed September 29 - October 4.
- Full-period export dialog opened; September 13 editing opened with original
  values and was cancelled without saving. Desktop `openChat=19` moved to the
  old event and opened its chat, retaining applicants. Desktop does not consume
  `openEvent` (existing behavior); that route is implemented by mobile.
- No console errors observed in the smoke test. Real-phone UI, actual exported
  file contents, authenticated transfer-byte comparison, and production rollout
  remain outside this verification.
- Screenshots: `scratch/demo-calendar-scope-applicants-c8cb803.png` and
  `scratch/demo-calendar-scope-stats-c8cb803.png` (local verification artifacts).
- `origin/main` remained `8a4ffdcd29616fafd7363f002eefefe7e2d9b5a1`.

## Measurement limits

This reduces calendar/assignment payloads on home and ordinary calendar reads.
Statistics deliberately remains full. Recipient authorization may require
additional queries. No total daily/monthly reduction or free-plan sufficiency
is claimed. Compare equivalent authenticated flows and transfer bytes after
deployment; do not equate request count with application startup count.
