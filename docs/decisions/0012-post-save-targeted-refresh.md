# Post-save targeted refresh

- Status: demo validation
- Date: 2026-10-01

Visit mutations previously refreshed the global one-year visit history and all
service sessions after each write. They now require a unit-scoped callback. The
store locates its building and reuses the version-guarded realtime reconciliation
for that building, its units and histories. It does not re-read service sessions;
visit mutations do not write that table. Session start/end retain their refresh.
Unknown units or failed targeted reads fall back to buildings/cards/visits so a
successful write does not leave only an optimistic status behind.

Boundary mutations use the existing version manifest reader, fetching coordinates
only for changed rows (including concurrent edits), and removing deleted rows.
These post-write reads never join a request started before the write. Initial and
manual reads remain full. The existing >200-change and error fallbacks remain.
This supersedes the post-mutation full-coordinate rule in decision 0011.

No schema, grants, subscription, retention, or production data changes. This is
not a claim that these paths explain all observed billed egress, nor a forecast
that the free quota is sufficient. The affected building is the refresh unit,
not a single visit row; realtime may independently reconcile the same building.

Validation: 1,104 tests / 153 files, lint and build passed. Reverting both store
paths to full reads caused exactly the ten new store tests to fail; the existing
eleven store tests still passed. Reverted mutations were restored. Existing
query/cache tests cover pagination, invalidation, errors and response ordering.
