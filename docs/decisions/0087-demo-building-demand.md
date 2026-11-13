# Demo home summaries and on-demand building details

- Status: implemented in demo; production unchanged, awaiting review
- Date: 2026-11-13
- Flag: `VITE_BUILDING_DEMAND_ENABLED`

## Why

Admin/leader home previously loaded all buildings with units, building/unit memos
and access-event memos even though home only displays card summaries. Removing
the progress UI alone would not remove these shared store reads. Separate demand
instead, preserving existing card counts and progress through `get_card_summaries`.

## Scope and deliberate limits

The flag follows `(VITE_BUILDING_DEMAND_ENABLED ?? VITE_DEMO_MODE) === 'true'`.
Only admin/leader, outside recipient mode, use the new App route demand.
Explicit false restores previous behavior in demo too. Developer statistics and
the existing volunteer recipient scope are unchanged.

| Entry point | Initial building data |
| --- | --- |
| Home with no query/deep link | No building body; existing card directory plus batched card summaries |
| Mobile `/map` | Pin/list fields, unit identities/status/regular-visit identity; no memo bodies |
| Selected unit detail | That building's full units/memos and active visit histories via existing targeted reader |
| PC map, calendar/editor, My Service, zone, statistics, unknown/query routes | Existing complete read |

This is NOT viewport-only loading or per-unit SQL. A unit detail loads its whole
building. Mobile map retains access-event actor/date metadata for the blocked
building label. Statistics retain complete records. Calendar/zone can promote
the store to full before a later map visit; this phase does not claim to remove
that cost. Their restaurant names, filters, assignment editors need a separate
consumer audit before narrowing them.

## Cache and correctness

- In-memory, per AppSession/account; no extra persistent memo storage.
- Demand only promotes home -> map -> full. Returning home does not downgrade
  acquired data. Reopening a loaded detail reuses it.
- Readiness is separate from placeholder memo values. `BuildingDetailGate` blocks
  the actual mobile memo editor until the building is complete, with retry on
  failure. Full consumers wait for buildings/cards/visits to succeed together.
- A home-only empty building set must never establish a realtime recovery baseline
  or overwrite server card totals with zero. Home mutation signals refresh summaries.
- Existing foreground/map subscription recovery, save/cancel, assignment writes,
  manual refresh and their fallback paths remain. Cache is not permission to skip
  these freshness checks.
- Targeted writes obsolete old full reads. Full reads obsolete old targeted reads.
  Per-building versions prevent late old details resurrecting cancelled histories.
  A deleted building loses completeness; disposed account responses are rejected.
- No SQL migrations, permissions, production flags or production data changed.

## Verification

Automated tests cover home zero building reads, map projection, pagination,
targeted detail/cache reuse, full promotion, failure/retry, incomplete card load,
save/cancel and late response races, building/card moves, deletion, account disposal,
role/flag combinations, App route wiring and actual MobileMap memo gate wiring.
Assignment editors remain on the old full path; live team assignment cancellation
was not performed in this verification. Existing assignment tests remain in suite.
Full suite: 2,419 tests / 241 files passed. Lint and TypeScript/Vite build passed.

Mutation checks actually run:
- Remove both per-building stale filtering and stale rejection: slow old detail
  test fails (cancelled status becomes met again). Removing only rejection is
  insufficient: the independent filtering still protects displayed data.
- Remove the MobileMap detail gate: integration test fails because ensure is
  never called. This checks actual component wiring, not only the gate in isolation.

Demo browser, admin, installed update:
- Home still displayed 9 cards and 2/75 completed units.
- Direct mobile map showed 75 units, pins and lists.
- Created one disposable unit, opened detail: loading first, then original memo.
- Saved absence: checkbox and building count changed; API active histories 3 -> 4.
- Cancelled: unchecked, unit returned to unvisited; history invalidated, count 4 -> 3.
- Reopened detail: original memo and zero active records appeared immediately.
- Fixture removed with guarded demo-only script; active history baseline restored.
- Browser proof: `scratch/demo-building-demand-cancelled.png` (local artifact).
- Slow response ordering tested with controlled promises, not a physical handset
  network-throttling run. No claim of measured browser HTTP totals.

Read-only demo payload measurement (`scripts/measureBuildingDemandDemo.mjs`):

| Data | JSON bytes | Local gzip bytes | Requests |
| --- | ---: | ---: | ---: |
| 45 complete buildings | 30,791 | 3,244 | 1 |
| 45 map summaries | 27,006 | 3,010 | 1 |
| Home card summaries, 9 cards | 2,675 | 441 | 1, with zero building body requests |

Pins, coordinates and unit statuses matched. This tiny demo has few memos, so the
map projection reduction is modest. Gzip numbers exclude response headers; they
are not monthly savings or operating-project measurements. Home still reads card
directory and other existing slices; this is not a claim of zero home requests.

## Progress is a separate product decision

No progress UI was deleted. `DesktopStats` already has a per-card selected-period
visit rate (distinct visited units / units). Current card completion uses current
unit statuses; it is not the same statistic. A future statistics-only completion
view must label both distinctly. Home progress can remain without full unit bodies.

## Rollout / rollback

Demo only. Production requires review and explicit opt-in. Set the flag false and
rebuild to restore eager full building reads. No DB rollback is necessary. Existing
clients must apply the app update; no forced service-worker activation was added.
