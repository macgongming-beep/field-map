# Pending restaurant requests only

- Date: 2026-10-19
- Status: demo verified; independent review passed for production activation

RestaurantServiceSheet displays the current volunteer's pending requests;
RestaurantsTab displays pending requests for review. Neither uses approved or
rejected rows. The shared restaurantRequests slice now filters status=pending
on the server only when VITE_DEMO_MODE=true. No rows are deleted, and no SQL,
permission, notification or write contracts change. Production retains its
existing unfiltered query.

All initial and post-save reads share the same filter. Submission and memo saves
still refresh the authoritative request list. Approval/rejection keep their
existing refresh paths, and reviewed requests disappear after the read. Read
failures preserve the previous snapshot and surface an error. This is not yet
lazy loading; pending requests still load with the initial store.

Tests cover server-side filters and reviewed-row removal in demo, unchanged
production queries, user/admin/developer roles, and the existing save/failure
suite. Live demo verification is required before claiming UI completion.

## Verification

Full suite: 1,385 tests / 182 files, lint and build passed. Inverting the demo
gate makes all six new query/role cases fail; restored code passes. Demo source
a934970 deployed READY as dpl_5aap4rSs4TMNms4N8YafN83iZaTC and assigned to
chinese-territory-app-demo.vercel.app. Production remains a868af8 (session-only
refresh), READY as dpl_AcsQCfFqp9Do6NxbknsUsob4LvtS with the production alias.

Applied the new-version prompt after deployment. In the demo volunteer UI,
submitted synthetic DEMO-1019-대기필터검증 with an explicitly fake address.
It appeared immediately in the pending list once the catalog search was cleared.
Saved a test-only memo through the request service flow; the active local session
cleared. Demo admin approval list displayed the exact memo and retained it after
reload. Rejected only this synthetic request; the pending section disappeared
immediately and the existing restaurant count remained four. No real restaurant
or production data was created or changed. Desktop Chrome mobile layout, not a
physical phone. Restored zoom and the admin view preference after verification.

Screenshots: scratch/demo-pending-request-memo-a934970.png and
scratch/demo-pending-request-reviewed-a934970.png. UI checks establish saved
state/rendering; server query narrowing is covered by tests, not a live network
byte measurement. No monthly savings estimate is claimed.

## Production activation

User approved activation after review. Removed only the demo gate: the shared
request slice now queries status=pending in production as well. Independent
read-only review confirmed both UI consumers require pending rows, approval
reads the request directly inside its RPC transaction, and backup/restore paths
are independent. No blockers found; reviewer did not independently rerun tests.

Expanded query tests across demo true/false, all four roles, and both approved
and rejected transitions. Full suite: 1,395 tests / 182 files; lint and build
passed. Removing the server status filter fails all 16 targeted tests; restoring
it passes. Existing save and read-failure tests remain green.

Pre-existing follow-ups, not changed by this activation: review controls need
finally handling for refresh failures; memo write failures need an explicit
success result before discarding UI drafts; request reads are not paginated.
No DB/schema, notification, authentication or write changes are included.
