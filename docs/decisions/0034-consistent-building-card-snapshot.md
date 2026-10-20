# Consistent building and card snapshots

- Date: 2026-10-20
- Status: verified and independently reviewed; no production deployment
- Scope: correctness only; no DB, permission, query or optimization gate changes

## Problem

The production branch of `applyBuildingsChange` updated `buildingsRef` inside a
React state updater, then queued card-stat calculation reading that mutable ref.
When React defers the building updater, the card updater can see the preceding
building snapshot. Correctness must not depend on eager updater execution.

## Change

Use the existing demo approach in every environment: compute the next building
snapshot synchronously, publish it to the ref and building state, and close over
that exact snapshot for card statistics. Consecutive changes must compose from
the latest ref, not the last rendered state. Recipient cards outside the loaded
scope retain their server summaries.

The separate calendar-edit and building-move query optimizations remain
demo-only. This fix does not enable them in production or claim egress savings.

## Release boundary

Keep this as a separate commit and review before production deployment.
`origin/main` was checked at `0f77e9f`; the restaurant deletion fix `874ae3a`
is already an ancestor, so it is not another pending fix to release.

## Verification

- Production mode, another hook's state update queued in the same `act` before
  one or two building deletion signals: both regressions failed on the old path.
  Building data changed, but card totals retained the preceding snapshot.
- Fixed version: 1,586 tests / 190 files passed; lint and build passed.
- Mutation: calculating card statistics from the rendered `buildings` snapshot
  instead of `next` made both new tests fail. Restored immediately afterward.
- Consecutive deletions retain both changes and preserve an unrelated building;
  the synchronous signal handlers issue no network reads.
- Independent read-only review found no remaining blockers. All direct building
  state writers synchronize the ref without an intervening await, and recipient
  unloaded-card summary protection remains unchanged.
- No deployment was performed for this follow-up. Demo already uses this
  calculation path under the previous commit; production activation still
  requires a separate release decision. No new live-device claim is made.
