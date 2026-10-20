# Consistent building and card snapshots

- Date: 2026-10-20
- Release base: production `0f77e9f`
- Review source: `92a1c11` (independent and external review approved)
- Scope: card-stat correctness only, no DB or query changes

`applyBuildingsChange` must compute the next building snapshot synchronously,
publish it to both the ref and state, and calculate card statistics from that
same captured snapshot. Updating the ref inside a deferred React updater can
leave card totals on the previous snapshot.

All other building state writers also update the ref synchronously. Consecutive
changes compose through the ref. Unloaded recipient-card summaries remain
protected by the existing scope guard.

This release ports only the reviewed calculation change and two production-mode
regressions onto main. It does not merge the demo branch: targeted calendar edits,
targeted building-card moves, and their demo read-version guards are excluded.
There are no environment variable, permission, notification or database changes.

Both new tests fail on the unmodified release base. They queue another React
state update before one or two deletion signals, verify the building and card
snapshots agree, and ensure unrelated buildings and successive changes survive.
They issue no network reads.

Release checks: 1,507 tests / 187 files passed; lint and build passed.
The count is lower than the demo branch because this release excludes its other
changes. Independent release-diff review found no blockers or optimization leaks.
