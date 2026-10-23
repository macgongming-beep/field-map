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

## Measurement limits

This reduces calendar/assignment payloads on home and ordinary calendar reads.
Statistics deliberately remains full. Recipient authorization may require
additional queries. No total daily/monthly reduction or free-plan sufficiency
is claimed. Compare equivalent authenticated flows and transfer bytes after
deployment; do not equate request count with application startup count.
