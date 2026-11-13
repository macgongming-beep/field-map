# Calendar names and mobile zone status projections

- Status: implemented; demo verification in progress, production unchanged
- Date: 2026-11-13
- Depends on: 0087 building demand (production integration recorded separately in 0088)
- Opt-in: `VITE_CALENDAR_ZONE_BUILDING_DEMAND_ENABLED`

## Consumer audit

Calendar detail uses buildings for shared restaurant building/unit labels, not
unit memos, coordinates, access history or visit-status filtering. Both mobile
and desktop assignment editors DO need complete buildings. The actual editor
leaf now waits for a successful full read before initializing its draft.

Mobile `/zone` uses AdminMobileZone, not MobileTerritory. Region/dong/card lists
need unit identity, status, usage, Chinese/restaurant flags, regular visits and
building access status for house/shop/needs-visit counts. They do not use memo
bodies, coordinates or access-event history. Restaurant management and PC zone
still edit/export complete data and remain full. My Service remains full here.

## Decision

For actual admin/leader roles only, outside volunteer recipient mode:

| Screen | Building projection |
| --- | --- |
| Home | Existing server card summaries, no building bodies |
| Calendar (PC/mobile) | All building/card IDs, names, addresses and unit IDs/numbers |
| Mobile zone list, informal tab | Above plus statuses, usage, regular visits and access status |
| Mobile map | Existing pin/list projection including coordinates/access metadata |
| Assignment editor, restaurant tab, PC zone, My Service, unknown routes | Complete buildings |

The new flag uses `(VITE_CALENDAR_ZONE_BUILDING_DEMAND_ENABLED ?? VITE_DEMO_MODE)
=== 'true'`, and requires `VITE_BUILDING_DEMAND_ENABLED`. Explicit false disables
the new modes even in demo. App routing and useStore both check it. Developer
statistics and volunteer recipient mode are unchanged. This is field reduction,
NOT a restriction to some teams/buildings; shared other-team labels remain.

In-memory acquired completeness only increases: home < calendar < zone < map <
full. Returning to a lighter route reuses richer data. A full promotion remains
full until the AppSession resets; this intentionally limits later savings.

## Safety contracts

- Name-only placeholders never initialize editors or compute card progress.
  Calendar/home use authoritative batched card summaries.
- FullBuildingGate is inside AssignmentEditor itself. Failure blocks the editor
  and exposes retry. The parent calendar stays mounted while its local editor
  requests full data; otherwise the selected event/draft would be lost.
- Full readiness requires the existing buildings/cards/visits loading contract.
  Updated participants reach the editor only after that gate opens.
- Calendar names do not establish a territory recovery baseline. Zone/map/full
  statuses can. Foreground recovery, manual refresh and mutation fallbacks stay.
- Targeted changes/deletions refresh calendar summaries. Unit-created signals
  preserve the new unit label and refresh summaries as well.
- Stale building/history responses cannot overwrite newer projections or revive
  cancelled histories. The history guard also works with the independently
  gated privileged-history optimization disabled (matching production).
- No SQL, assignment/cancellation RPC, permissions, memo writes or production
  settings changed. Existing progress UI remains.

## Automated verification

Tests cover route/role/flag combinations, the useStore guard, 1001-row pagination,
all-team restaurant names, rename/delete/new-unit signals, zone status equivalence,
home/calendar/zone reuse, full promotion failure/retry without parent unmount,
actual editor gating and late responses after map promotion or visit cancellation.
Controlled promises model slow/reordered responses; not physical network timing.

Mutation checks actually run:
- Remove AssignmentEditor leaf gate: editor test fails.
- Remove demand-building history invalidation: delayed history revives the
  cancelled visit and the test fails.
- Restore demo-only flag: four opt-in/explicit-false tests fail.

## Read-only demo measurement

`scripts/measureBuildingDemandDemo.mjs --confirm-demo` refuses non-demo hosts.
2026-11-13, 45 buildings, 9 cards:

| Payload | JSON bytes | Local gzip bytes | Requests |
| --- | ---: | ---: | ---: |
| Complete buildings | 30,560 | 3,162 | 1 |
| Calendar names | 9,740 | 1,816 | 1 |
| Additional calendar card summaries | 2,675 | 442 | 1 |
| Zone status | 23,205 | 2,402 | 1 |
| Existing map projection | 26,844 | 2,980 | 1 |

Calendar combined gzip is 2,258 bytes, not just 1,816; the extra summary request
has header overhead. Names and all selected zone-status fields matched the full
response exactly. These are local gzip estimates excluding HTTP headers, not
browser HTTP totals, production measurements or monthly savings. Existing card
directory/other slice reads are not included. A later editor still pays full cost.

## Rollout and rollback

Demo first, independent review before production. Production defaults to old
calendar/zone behavior until explicitly enabled and rebuilt. Disable only the
new flag and rebuild to restore full calendar/zone reads while retaining the
already-approved home/map optimization. No DB rollback is needed.

## Remaining work

Actual demo browser verification and final test/build results are recorded below
after deployment. No claim of live team-assignment cancellation until tested.
