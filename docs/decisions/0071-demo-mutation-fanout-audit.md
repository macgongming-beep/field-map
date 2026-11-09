# Demo mutation and realtime fanout audit

- Status: measured; no application behavior or production configuration changed
- Date: 2026-11-09
- Application source: `0687b85`
- Related: 0055 participant realtime, 0058 history recovery, 0059 refresh queue

## Question

After a visit save/cancel, ordinary application/cancel, or building name edit,
how many reads occur on the writer and another connected client? Do any reads
still fetch every building, the full calendar body, or all one-year histories?

## Method

`scripts/measureMutationFanoutDemo.mjs` runs the real `useStore`,
`useCalendarRealtime`, and `useTerritoryRealtime` against the allowlisted demo
project. Three worker threads have independent DOMs, auth storage, module
instances, stores, caches, queues and real WebSocket connections:

1. Volunteer writer.
2. A second connection for the SAME volunteer account.
3. A distinct administrator account, also the building-edit writer.

All three observe the fixture card as an open map would. This is NOT two
physical phones, a browser rendering test, or a whole-application network trace.
Headers, chat/badge polling, map tiles, assets and push delivery are not included.
Initial loading, authentication, setup and cleanup are excluded from action counts.
The unrelated startup `auto_close_stale_sessions` mutation is deliberately stubbed.

Run A uses a loaded single-day calendar window, 3 repetitions each with normal
responses and 250ms added read-response delay: 36 actions. Run B uses the actual
`calendarReadScope('/map', ...)` selection (volunteer service scope, admin full),
one repetition per delay: 12 actions. Each repetition is save, cancel visit,
join, cancel application, edit building name, restore building name.

The delay is injected after the real response, not a measured mobile RTT or a
packet-loss/offline test. Every action waits beyond the 2-second calendar
debounce and until tracked requests settle. A unique test building/unit and two
test events isolate writes from existing content. The application event is
unassigned; team-assignment cancellation is intentionally NOT exercised here.

## Counts

Successful GET/read-RPC requests per action, across both delay conditions:

| Action | Writer, run A | Other map client, run A | Writer, actual map scope | Other map client, actual map scope |
| --- | ---: | ---: | ---: | ---: |
| Visit save | 7-10 | 3-6 | 7 | 3 |
| Visit cancel | 6 | 3 | 6 | 3 |
| Apply | 2-3 | 1 | 3 | 1 |
| Cancel application | 3-4 | 1 | 3 | 1 |
| Edit building name | 6 | 3 | 6 | 3 |

Visit save includes one necessary existing-attempt lookup. Cancellation includes
the required post-write assignment-safety check. These are not all redundant.
Writes/logging RPCs are separate: visit save 3, visit cancel 2, application 1,
application cancellation 1, building edit 2. CART_APPLICATIONS is enabled, matching
the demo verification configuration; the ordinary application RPC is exercised.

No post-action read fetched unfiltered buildings, the entire calendar body,
cards/boundaries, sessions or unfiltered one-year visit histories. All building,
unit and history reads were constrained to the fixture building or unit.

## Remaining repeated reads

### Visit save and cancellation

`updateUnitStatus` first patches `units`, checks an existing attempt, and then
writes `visit_histories`. Two territory-change notifications were observed for
save. Depending on timing they caused one or two three-request building reads
on each observer. The writer also performs its required post-write refresh.

A building read is buildings + units + that building's active one-year histories.
Cancellation has one observed territory signal, but the writer still read the
three-request bundle twice. The refresh queue ensures ordering; it is not a
permanent deduplication mechanism for later signals after a read has finished.

### Building name edit

Both direct post-write refresh and the writer's own realtime signal read the
three-request bundle. Each other map client reads the bundle once. Units and
visit histories are included even though this fixture operation changes only
the building name. Territory signals do not identify which child collection
changed, so dropping those reads globally would not be a safe fix.

### Application and cancellation

The actor's direct participant refresh and its later realtime refresh both run.
Overlapping invalidation sometimes adds another participant-only retry.

For DELETE, the realtime payload did not provide the parent event ID. The
existing safe fallback refreshed participants for all currently loaded events.
In the actual map-scope run this was 5 volunteer events and 15 administrator
events. These were NOT full event bodies or territory reloads.

Decoded response bodies for cancellation's observer refresh were 730 bytes
(volunteer) and 1,436 bytes (admin), versus 87 bytes for a single-event join
refresh. These are tiny demo bodies, NOT compressed transfer or billed egress.
No extrapolation to production's November 7 usage is supported by this test.

## Validation and cleanup

- 48 actions / 144 client snapshots agree on history IDs, unit status, application
  membership and building name. No captured HTTP errors or hook warnings.
- `scripts/checkMutationFanoutResults.mjs` validates state and query scope from
  both result files. Initial-load requests are deliberately excluded.
- Unique test buildings and events removed; cancellation restored active visit
  state before cleanup. Generated fixture session cleanup was checked separately
  by fixture account/card and creation window; one matching session was verified
  inactive. Audit/session history may remain; this is not a full audit purge.
- `npm run build` passed. Measurement scripts pass ESLint and Node syntax check.
- Full application unit suite was not rerun: application source was not edited.

Local outputs (not committed): `scratch/mutation-fanout-results.json` and
`scratch/mutation-fanout-map-results.json` contain request filters, counts, decoded
body sizes, signals and snapshots. No tokens/PINs are written to the reports.

## Follow-up boundaries

Prioritize eliminating proven duplicate post-write/self-signal building reads.
Do not suppress signals with a blind time window: another person's write or a
cancellation can occur during it. Any reuse must prove the completed read covers
the signal revision, and preserve the existing freshness/coverage safeguards.

Separately evaluate building-metadata-only refresh and a parent-ID-bearing
participant change signal. Do not remove the unassigned-event cancellation
check or narrow team reassignment recovery as part of either change.

This audit does not identify the historical HTTP requests that produced the
November 7 production spike, and does not establish a monthly savings figure.
