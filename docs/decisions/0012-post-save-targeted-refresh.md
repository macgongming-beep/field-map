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

## Historical usage check (2026-10-01, after rollout)

Read-only Supabase Usage UI inspection, using Current billing cycle and Last 30
days, explicitly filtered to production qdxemvdorasoryfysuoq. Dates below are
dashboard daily labels; the UI did not establish the daily bucket timezone, so
these must not be treated as exact KST request-log windows. October 1 is partial
and the UI states that refresh can lag by an hour. Numbers use the UI's MB/GB
labels, not uncompressed database JSON or request-count estimates.

| Dashboard date | Production PostgREST MB | Production Realtime MB | Approximate total MB |
| --- | ---: | ---: | ---: |
| September 5 | 418.167 | 5.699 | 427 |
| September 18 | 446.051 | 4.702 | 451 |
| September 19 | 737.268 | 8.282 | 746 |
| September 28 | 28.894 | 0.175 | 29 |
| September 29 | 38.383 | 0.320 | 39 |
| September 30 | 596.892 | 7.240 | 604 |
| October 1 (partial) | 459.209 | 7.108 | 466 |

The small Functions/Pooler contributions are included in approximate totals.
The displayed current-cycle totals were organization 4.003 GB, production
3.961 GB and demo 0.042 GB (about 1% of organization egress). Cached egress was
zero. Daily production tooltips for September 1 through October 1 were checked:
500+ MB days already existed before the September 30 realtime rollout, and low
days also exist; a fixed 500 MB/day forecast is not supported by this history.

Vercel production deployment history places report-related releases between
September 18 22:40 KST and September 19 00:35 KST, and navigation commit 7be10a1
at September 19 11:35 KST. This is temporal context, NOT evidence that reports
caused the spike. A September 18 11:28 deployment is marked gitDirty and a
September 17 deployment lacks a commit SHA, limiting exact reconstruction.
The September 19 source already refreshed all data on foreground return after
the two-minute cooldown and passed global refetchVisits to visit mutations.
These behaviors predate the new realtime feature. Their byte contributions and
the role of active users, repeated loads, testing and backups remain unmeasured.

Do not reinterpret this as normal/necessary traffic, proof of a specific
regression, or a post-release savings measurement. The remaining investigation
needs matching request/billing windows and per-action authenticated measurement.

### October 2 read-only request audit of October 1

Unified Logs filter: API Gateway, GET, fixed window
2026-09-30T14:54:58.142Z through 2026-10-01T14:54:58.142Z
(September 30 23:54 through October 1 23:54 KST). This is not asserted to
match the billing chart's daily bucket. No production data or settings changed.

The UI showed about 40.4k GET requests, 18.6k OPTIONS and 8.7k POST in
this window. GET pathname facets included visit_histories 3324, buildings
3234, calendar_events 2844, service_sessions 2702, and card_boundaries 997.
These are requests, not users, refreshes, rows or transferred bytes.

Exported all 997 boundary requests and all 3324 history requests (four
descending time-window exports, 1000/1000/1000/324 rows). History IDs were
unique across all four exports, and their sum matched the UI count.
Raw exports stay in local Downloads, not Git; URLs may contain private data.

| Query shape | Requests |
| --- | ---: |
| Boundaries: full coordinates, paginated | 446 |
| Boundaries: full coordinates, no pagination | 79 |
| Boundaries: manifest without coordinates | 472 |
| Histories: global, offset 0 | 1441 |
| Histories: global, offset 1000 | 1444 |
| Histories: filtered by units.building_id | 371 |
| Histories: filtered by unit_id | 68 |

Full coordinates remain in 525 requests; manifest recovery is demonstrably
running, so it is incorrect to say the earlier delta work did nothing.
Do not label all 446 paginated full reads as cold starts: explicit refresh
and pre-release boundary mutations also use this query.

Global history requests total 2885. Of these, 2877 precede the October 1
14:26:32Z production Ready time; only eight follow it. This is deployment
timing, not proof of which bundle each client ran. At 18:00-18:59 KST there
were 303 global first pages, 302 second pages, 19 building-filtered and two
unit-filtered history requests. Query counts do not identify the caller:
triggeredBy is not transmitted to the server.

Current source still calls fetchAll(true) on foreground/focus after a two-minute
cooldown; ALL_SLICES includes visits, and that slice reads one year of global
histories plus all service_sessions. This is not a two-minute periodic timer.
Session mutations and participant removal also retain broad history reads.
These remaining paths need separate targeted recovery work, with deletion,
invalidation and statistics tests. Initial loading remains broad as well.

Exported logs and the inspected Overview detail contain no response-byte
field. Therefore this audit establishes query frequency/shape and timing,
not a complete attribution of the approximately 466 MB billing-chart total.
Neither raw JSON sizes nor compressed sample sizes multiplied by these counts
are an exact billing reconciliation. The new post-save release cannot be
judged from traffic that almost entirely preceded it.

### October 2 demo history-signal verification

Scope: validate reuse of existing signals, not remove global foreground reads
or deploy another optimization. Production was not accessed or changed.

Ran `scripts/checkDemoHistorySignals.mjs` against the explicitly guarded demo
project. Its SQL transaction rolled back fixtures and signals (sequence values
can advance). Eight assertions passed: history insert, memo edit, invalidation,
restoration, hard deletion, unit move signalling both buildings, unit deletion
signalling the surviving parent, and building disappearance from the ID index.
The first five use a 30-day-old history with NULL updated_at and explicitly
verify that it remains NULL. Resetting only synthetic signals between actions
prevents transaction coalescing from hiding a missing trigger invocation.

This validates the deployed DB trigger and SQL replacement-snapshot behavior,
not client permissions or a two-device/network reconnect test. It does not
require a new history updated_at trigger/backfill for these operations.

Added four store reconciliation regressions for invalidation, history deletion,
unit deletion and building deletion, retaining unrelated histories. These mock
the fetch boundary but exercise the real store reconciliation. The three
focused suites passed 34 tests. Removing the old-history removal expression
made all four new cases fail; the production expression was restored.

Do not simply remove the visits slice from foreground recovery yet:

- Time passing can age an unchanged history out of the rolling one-year window
  without producing any signal. Local expiry and a consistent cutoff are needed
  (full reads use 365 days; targeted reads currently use calendar-year subtraction).
- Service sessions are independent of building signals. Retain their refresh
  until a separate complete change-detection contract is tested.
- Unit moves are validated on the DB side only. Cross-batch/concurrent client
  reconciliation of moves still requires coverage before relying solely on it.
- The server signal timestamp is written before commit; the 30-second overlap
  does not establish correctness for arbitrarily long transactions. Watermark
  advancement, reconnect gaps and fallback behavior remain rollout checks.

No app runtime code, DB migration, production deployment or usage forecast was
changed in this verification. Prior 472/439 counts establish older recovery
paths were active, not dac6e37 savings. Foreground's exact bandwidth share remains
unattributed because request causes are not included in the logs.

## Follow-up: signal-backed history recovery (review only)

- Foreground/reconnect requests containing buildings and visits now wait for
  building recovery. Only a successful signal/index recovery permits skipping
  the global history read; service sessions still load completely.
- Missing checkpoints, disabled realtime, full-read reuse and failed recovery
  retain the full history path. Session-only in-flight reads cannot satisfy a
  manual full refresh or a recovery that failed to recover histories.
- The full and targeted history windows both use 365 days. Successful recovery
  also expires cached histories locally, including when no signal changed.
- Unit-move reconciliation retains histories belonging to an unaffected
  destination when the source-removal snapshot arrives afterward. Tests cover
  both sequential response orders. This is not a claim about every possible
  concurrent multi-snapshot race.
- Keep the complete building ID index: deleted buildings lose their signals.
  No new timestamp columns, backfill, migration or production rollout.
- Validation: 1,111 tests / 153 files pass, lint and build pass. Reverting the
  history-read optimization fails its new test; reverting move preservation
  fails the destination-first test. Both mutations were restored.
- Existing pre-commit timestamp/30-second-overlap limitations remain. No exact
  billed-byte savings are claimed; compare matching production windows after
  review and deployment. A fresh two-device demo check remains before rollout.
