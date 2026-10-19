# Return visit detail-only refresh

- Date: 2026-10-19
- Status: demo only

Reachable callers include DesktopMyService log submission and
MobileRegularVisitDetail/MobileTerritory log and nickname submission. Unlike the
unused manual session controls in 0021, these are live UI paths.

Add an optional refreshDetails dependency to regular visit mutations, defaulting
to the existing full callback. Demo injects a returnVisitDetails slice for adding
a log (including a partially failed summary update) and changing a nickname only.
It reuses the authoritative return_visits and return_visit_logs reads/transforms.
No optimistic editing, DB migration, permissions or notification changes.

A distinct slice is necessary: the recipient store expands returnVisits into a
territory scope refresh, including buildings, summaries and boundaries. Detail
changes do not alter membership and must not invoke that expansion. Existing
initial/foreground/manual reads and membership-changing mutations remain intact.
Log editing/invalidation, address changes, registration, ending and reassignment
also retain their previous refresh contracts in this narrow change.

If either details read fails, throw before replacing either snapshot instead of
clearing it. The saved write is not repeated. Production retains the original
combined buildings/returnVisits refresh; the new failure preservation is shared.

Verification: 1,330 tests / 182 files passed, build passed. Integration tests
verify current nickname/log state, unchanged building/history snapshots, no
recipient territory refresh, failed read preservation and production's original
refresh. Replacing refreshDetails with fetchAll fails both new demo tests.
These are mocked store tests, not evidence of monthly egress savings. Return
visit tables themselves are still fully read. Live save verification is separate.
