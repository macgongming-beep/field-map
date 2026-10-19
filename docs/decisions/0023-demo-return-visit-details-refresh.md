# Return visit detail-only refresh

- Date: 2026-10-19
- Status: production activation approved on 2026-10-19

Reachable callers include DesktopMyService log submission and
MobileRegularVisitDetail/MobileTerritory log and nickname submission. Unlike the
unused manual session controls in 0021, these are live UI paths.

Add an optional refreshDetails dependency to regular visit mutations, defaulting
to the existing full callback. Both environments inject a returnVisitDetails slice for adding
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
clearing it. The saved write is not repeated. Production now uses the same
detail-only refresh verified in the demo.

Verification: 1,330 tests / 182 files passed, build passed. Integration tests
verify current nickname/log state, unchanged building/history snapshots, no
recipient territory refresh, failed read preservation and production's original
refresh. Replacing refreshDetails with fetchAll fails both new demo tests.
These are mocked store tests, not evidence of monthly egress savings. Return
visit tables themselves are still fully read. Live save verification is separate.

## Live demo UI verification (2026-10-19)

Verified cf4585a on the deployed demo as the existing demo volunteer, using
Chrome zoom to exercise the mobile layout (not a physical phone). Through the
app UI, created one unlinked synthetic target, ID 20, initially named
DEMO-UI-20261019-RETURN-VERIFY, with no real address, building or unit.
Saved an absent result and a clearly labelled test memo through the quick-log
sheet. The saved log and latest-visit label appeared without a manual refresh.
Changed the nickname through the detail menu to "데모 저장확인 완료 1019";
the heading immediately changed and the existing log remained. Reloading the
detail URL retained both the nickname and the single absent/memo entry.

Finally ended this synthetic target through the normal UI, choosing no longer
a return-visit target and no place issue. The active list returned to zero.
This is soft termination: the demo's test history is retained, not hard deleted.
Browser zoom was restored. Production was not modified. Screenshots are local
scratch/return-visit-live-log-saved.png and return-visit-live-persisted.png.
No live network-byte measurement was taken; request exclusions remain covered
by the mocked store regression tests, not inferred from visible success alone.

## Production activation (2026-10-19)

After the live demo check, the user explicitly authorized production release.
Removed only the return-visit refresh demo gate. The manual service-session
refresh gate remains demo-only. No database or environment changes are needed.
Regression coverage now checks both demo settings, user/developer roles, and
nickname/log operations: fresh details, unchanged building/history snapshots,
and no recipient scope refresh. Failed reads preserve snapshots in production
as well. Full suite: 1,336 tests / 182 files; lint and build passed.
No production test records are created. Monthly savings remain unmeasured.
