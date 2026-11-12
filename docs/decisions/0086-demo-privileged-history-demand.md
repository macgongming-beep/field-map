# Defer privileged full visit history until a complete-record consumer opens

- Status: demo implementation; production not approved or changed
- Date: 2026-11-12
- Flag: `VITE_PRIVILEGED_HISTORY_DEMAND_ENABLED`

## Why

The observed broad building query count also includes `select=id` recovery-index
reads, not just full building payloads. Those indexes are a deletion-recovery
safety net and are not removed here. Admin/leader first loading still reads a
year of complete visit history even without opening statistics. Ordinary zone
lists need visit dates, not visitor names, results or memos.

## Conservative first phase

Only actual admin/leader roles opt in. App and store both check the flag/role.
Undefined inherits demo; explicit false disables demo too; production defaults
off. User scoped history and developer statistics remain unchanged.

Before any full-history consumer has loaded:

| Screen | History requirement |
| --- | --- |
| Home and calendar, desktop/mobile | Dates only |
| Mobile zone list and restaurant list | Dates only |
| Desktop zone, map, My Service | Full |
| Statistics, service logs/export, settings, unknown routes | Full |

Date projection: `id,unit_id,visited_at,created_at`. Both readers retain
`invalidated_at IS NULL`, the rolling 365-day `created_at` cutoff and complete
1,000-row pagination. This reduces columns, not row count or page requests.

`VisitRecency` is a separate type/state/context. Only three audited date consumers
use it: AdminMobileZone, ZoneAssignScreen and RestaurantsTab. It is never cast into
VisitHistory objects for cancellation, map invitation flags, statistics or CSV.
Buildings, cards, assignments and sessions are not narrowed by this change.

Entering a full consumer requests only the history slice. The App gate waits for
all pages, or shows a retry action on failure, before mounting maps/statistics.
It does not mount a new account/store or reload buildings to change history mode.
Once a complete history read succeeds, the session **stays promoted to full**.
Returning home and reopening the map does not download full history repeatedly.
Existing full-mode foreground delta/fallback behavior resumes after promotion.
Logout/new AppSession resets this state. This is deliberately not a permanent
"statistics-only" history reader: map mutation/undo still needs complete rows.

## Races and recovery

- History reads capture mode generation and read version. Late responses after
  navigation, account disposal or an authoritative building patch are discarded.
- Pending full reads superseded by save/cancel patches retry at most twice, then
  expose retry rather than opening with incomplete history or spinning forever.
- Targeted building reads update dates using the same unit replacement rules as
  full history. Cancelling the latest visit restores the previous visit date;
  building deletion clears those dates. Place-deletion signals also clear dates
  and supersede pending history reads.
- Successful building recovery may skip a history read only if the matching
  complete history-mode baseline exists. It cannot promote a date-only baseline.
- Existing recovery expires old records locally; date summaries use the same
  cutoff. Manual refresh and mutation fallback still refresh their usual slices.
- No DB policy, migration, signal trigger or production flag changes.

## Verification

- Full suite: 2,392 tests / 240 files; lint and TypeScript/Vite build pass.

- Store integration: admin/leader date projection; user/developer unchanged;
  full 1,001-row pagination and memo preservation; full gate and retry;
  late summary response; slow full read overlapping cancellation; targeted
  save/cancel/deletion date updates; full-to-home-to-full causes no extra reads.
- App gate: statistics, exports and maps remain closed on loading/failure.
- UI components: mobile zone, calendar assignment and restaurant last-visit
  dates render from separate summary context with no full histories.
- Flag combinations include production opt-in and demo explicit false.
- Mutation verification (restored after each): forcing full projection fails 2
  tests; removing targeted-patch history version guard fails 1; removing session
  promotion fails 2; removing App history gate fails 3.
- Removing the recovery baseline-mode check fails the foreground/full-demand
  overlap test. That test also checks a superseded request does not repeat an
  already completed replacement read. StrictMode and store-disposal tests pass.
- Existing EventLeaderContacts test explicitly enables retired-chat navigation
  to open its fixed old fixture date. Before that clarification it only passed
  accidentally on the fixture day. No phone implementation changed.

Actual demo API measurement, 2026-11-12, admin authentication:

| Reader | Rows/pages | JSON bytes | Locally gzipped bytes |
| --- | --- | --- | --- |
| Complete | 3 / 1 | 942 | 359 |
| Dates | 3 / 1 | 289 | 137 |

IDs/dates match exactly. Gzip excludes HTTP headers. This tiny demo dataset is
not representative production traffic; no monthly-savings claim is made.
Script: `scripts/measurePrivilegedHistoryDemo.mjs --confirm-demo`, with explicit
`DEMO_ENV_FILE` and optional private `DEMO_LOGIN_FILE`. Only demo host allowed.

## Deployed demo verification (2026-11-12)

- Code commit: `1e4545a`. Demo deployment `dpl_76qF6upRQ7uD8as5vKQA6sJgmKh7`
  is ready at `https://chinese-territory-app-demo.vercel.app`.
- The demo project's production environment was used for the prebuilt demo
  deployment, not the production app project. The built API origin is the
  allowlisted demo host; the deployed JS chunks match the local build and
  contain the reduced projection. No production deployment or DB change.
- Live browser: demo administrator, mobile viewport for home/zone/map and
  desktop viewport for statistics. A fresh home load and mobile zone showed
  the existing card and last-visit date (9/30), then its map and unit detail.
- Created one uniquely marked disposable unit under demo building 1 using
  `scripts/verifyPrivilegedHistoryDemo.mjs setup --confirm-demo`.
  Existing units and their records were not edited.
- UI absent-save: unit became absent, building completion changed 1/4 to 2/4,
  and unit detail showed one absent record. The authenticated API confirmed
  active 365-day histories changed 3 to 4. Desktop statistics displayed total
  4, absent 2, with one visit in November.
- UI cancellation: detail returned to zero records, building completion to
  1/4; the server record was invalidated and active histories returned to 3.
  Desktop statistics displayed total 3, absent 1.
- Guarded cleanup removed only the marked unit after verifying every test
  history was invalidated. Direct deletion was correctly blocked by existing
  permissions; cleanup uses the app's deletion-request/execute RPCs instead.
  The deletion request remains as a completed audit record. Final mobile home
  returned to the original 74 units, 2 completed; active histories remain 3.
- Screenshots: `/tmp/privileged-history-demo-saved.jpg`,
  `/tmp/privileged-history-demo-stats-four.jpg`,
  `/tmp/privileged-history-demo-cancelled.jpg`,
  `/tmp/privileged-history-demo-stats-restored.jpg` (local, not committed).
- These are actual UI/save/cancel checks, not a browser network capture.
  Projection/request assertions, leader behavior and delayed-response races
  were verified in automated tests; no real-device slow-network or live
  leader-account UI claim is made. Temporary viewport override was reset.

## Limits and next review

- Full buildings and their embedded unit memos remain unchanged.
- A session opening a map early gains little from this phase. No claim that all
  administrator/leader history traffic disappears.
- Loading only a selected unit's history is deferred: undo, invitation flags,
  desktop memo filters, restaurant visit editor and exports must be separated
  first. Do not pass summary rows into those existing consumers.
- Production remains off. Review first, then opt in and rebuild/PWA update.
  Rollback: false plus rebuild restores the previous complete-history behavior;
  no data restoration or DB migration is needed.
