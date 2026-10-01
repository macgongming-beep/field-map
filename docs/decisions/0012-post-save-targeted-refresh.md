# Post-save targeted refresh

- Status: production released
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

## Follow-up propagation verification

- Two independent Chrome windows, both signed into the same demo administrator
  account, observed building 73. Window A marked unit 101 absent and window B
  received it without refresh; B marked unit 102 absent and A received it.
  Both reversals propagated, restoring zero active visits.
- Added synthetic units `동기화검증1001` and `동기화검증1002` and recorded visits
  immediately after creation. The other window received both units and records.
  The first network interval included a foreground refresh, so it was not used
  to attribute full reads to the save. In the isolated second interval, the
  service_sessions network filter showed 0 of 39 requests; scoped building 73
  and history reads were observed, with no full-refresh fallback observed.
- Test visits were invalidated through the UI. The two synthetic units remain
  in the demo with no active visits; audit history was not permanently deleted.
- This verifies propagation between two active browser clients, not physical
  phones or permissions between distinct participant accounts. It does not
  measure billed egress. Production was not changed during these checks.

## Production rollout (2026-10-01 23:26 KST)

- User approved release after the demo follow-up. Production main fast-forwarded
  from adaf5a6 to 2587ed4; no intervening main commits or DB changes.
- Pre-release production backup succeeded: 40 tables / 22,772 rows and private
  merge audit SQL; the absent app_sessions table was skipped, zero failures.
  Backup metadata is in backups/2026-10-01/_meta.json (not committed).
- Focused store regression tests were rerun: 21 passed. The earlier full-suite,
  lint/build and independent mutation checks remain the release evidence.
- Deployment dpl_83h7YrrBofgfHcACwTc5xRq5hu9x reached Ready. At
  2026-10-01T14:26:32Z the production alias returned HTTP 200 with entry
  index-x0qL149u.js and store chunk TerritoryReportView-DEuf2SiY.js. The served
  chunk contains the targeted visit recovery and boundary mutation paths.
- No production test visits, schema changes, grant changes or billing changes.
- Compare the first complete post-release KST day (October 2) with October 1,
  using identical billing categories and matching log start/end timestamps.
  Note active usage and old-client adoption; do not attribute changes to this
  release solely from aggregate totals. The backup itself also transfers data.
  Post-release billed egress and fallback frequency have not yet been measured.
