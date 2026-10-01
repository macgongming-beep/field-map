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

## Demo verification

- Commit dac6e37, deployment dpl_8XMG6t6vhAwJsqqCy4Rjdj4AbJKF, alias
  https://chinese-territory-app-demo.vercel.app (Ready).
- Logged-in desktop demo, new entry index-aOKAoTCl.js confirmed after the PWA
  update. Added an absent visit to synthetic building 73 / unit 101, observed
  progress change from 0/8 to 1/8, then invalidated that test visit and verified
  0/8 and no active history. Audit history is preserved by the application.
- Post-save reads used building ID 73 and building-scoped histories. A realtime
  echo also fetched that building; deduplicating that echo is not in this patch.
- Saved existing boundary 28 without moving any points. Network showed the
  card_id/updated_at manifest followed by coordinates filtered to card_id 28,
  not an unfiltered coordinate query. Editing closed successfully.
- These checks establish query scope and local save/undo behavior, not a billed
  egress percentage. Two-device live propagation was not repeated this turn.
- Production main, production DB and billing were not changed.
