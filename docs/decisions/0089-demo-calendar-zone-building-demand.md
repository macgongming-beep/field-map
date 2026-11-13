# Calendar names and mobile zone status projections

- Status: demo deployed and verified; awaiting independent review, production unchanged
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

Full suite: 2,439 tests / 241 files passed. Lint and TypeScript/Vite build passed.

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

## Deployed demo verification

- Code commit: `d3117d4`. Deployed only to the DEMO Vercel project, deployment
  `dpl_HMhkwqCFgtgcLCZXVZaCMfJKJRHB`, canonical demo alias ready.
- Remote build logs identify that commit; fetched public bundle includes both
  projections. Browser applied the update and loaded `index-CKO9CWUY.js`.
- Admin, mobile 430x932: calendar -> previous month -> 10/5 showed the existing
  applicant and confirmed team/card. Zone showed the same 9 cards, restaurant 4,
  region house/shop counts 21/22 and 4/5 as before deployment.
- Zone drilldown and needs-visit filter worked. Home -> calendar -> zone repeat
  showed the acquired screen immediately. App diagnostics recorded one
  `navigation:building-demand` promotion on first zone entry, none on that repeat.
  This is slice instrumentation, NOT a browser HTTP capture or byte measurement.
- Zone -> map showed 75 units including one disposable fixture. Selected detail
  waited first, then displayed the original memo. Saved absence on that fixture:
  DB active histories 3 -> 4, unit absent, building progress 1/4 -> 2/4. Cancelled:
  history invalidated, unit unvisited, active histories 4 -> 3, progress restored.
  Reopened detail immediately showed original memo and zero active records.
- Guarded demo-only fixture cleanup removed the temporary unit and verified the
  original active-history count. No existing record was edited or cancelled.
- Fresh mobile calendar -> assignment editor: loading then existing team; card
  selection showed 9 cards, map boundaries and house/shop counts. Closed without
  sharing changes. Fresh PC 1280x900 calendar also waited then showed that team.
  Browser reported no console errors; temporary viewport override was reset.
- Local proof artifacts: `scratch/demo-calendar-zone-demand-cancelled.png` and
  `scratch/demo-calendar-zone-demand-assignment.png`.

## Limits and next review

Live verification used an administrator, not a separately logged-in leader.
The follow-up below adds actual sharing/cancellation and two independently
mounted browser tabs, not two physical devices or two different logged-in
accounts. Both roles, all-team restaurant labels, other-device new-unit signals
and late-response/cancel races also have automated coverage. No claim of
physical slow-network testing.

Review the projection consumers, editor leaf gate, calendar summary refreshes,
and production-like delayed-history cancellation test before enabling production.
Calendar still fetches all name rows, and mobile zone still fetches all unit
statuses. Future server aggregate or assignment-scoped name reads require their
own design. Full promotion remains sticky and limits savings after editing.

## Live team change and cancellation follow-up

2026-11-13, same deployed code `d3117d4`; no application or production changes.
`scripts/verifyCalendarZoneTeamsDemo.mjs` requires `--confirm-demo`, allows only
the demo database host, and reads credentials from `DEMO_ENV_FILE` without
printing or persisting tokens. It sets up disposable data and checks DB state;
the change/share/cancel actions below were performed through the actual UI.

- Created disposable event 147 with two one-person teams. A (`team-a`) had card
  28; B (`team-b`) had card 29 plus restaurant building 75 / unit 163. Existing
  cards, buildings and units were referenced, not edited.
- Fresh mobile calendar load (430x932) displayed both teams using the names
  projection. Opening the assignment editor first showed its loading gate,
  then both teams, nine selectable cards and their house/shop counts.
- In A's card list, deselected card 28, selected card 30 and pressed Share.
  The detail immediately displayed A's new card. An independently mounted PC
  calendar tab also changed without manual reload. B's card and `+1` additional
  assignment stayed visible. DB checks confirmed B's participant, team key,
  card, restaurant and scope were unchanged; assignment row IDs can legitimately
  change during sharing, so checks compare semantic values.
- Pressed A's own Cancel Application in mobile detail. This was a **shared team
  cancellation**, not an unassigned cancellation. A's participant, assignment
  and card join disappeared; `team-a` scope/informal metadata was removed. B's
  participant, card 29, restaurant 75/163 and `team-b` metadata remained.
- The PC observer independently updated to one applicant and the remaining B
  team without reload. Mobile reload -> reopen detail still showed B's card
  and additional assignment. The remaining team is displayed as "Team 1"
  because the UI renumbers visible teams; its stored key remains `team-b`.
- At initial/change/cancel checkpoints, all unrelated event-card join rows
  matched the pre-test snapshot. No existing event was changed. The verifier
  refuses a 1000-row result rather than silently claiming complete coverage.
- Cleanup removed the disposable event, participants, card assignments/card
  joins, restaurant assignment and three fixture-linked service sessions.
  Before removing sessions, the verifier confirmed no visit history referenced
  them. Sessions are removed before the event to prevent orphaned active rows.
  Unrelated event-card assignments still matched afterwards. Login/audit logs
  from verification are not erased.

Local evidence: `scratch/calendar-zone-teams-demo-results.json` and
`scratch/demo-calendar-zone-teams-cancelled.png`. The report includes stage
timestamps, DB snapshots and cleanup assertions; no credentials. UI restaurant
label is collapsed to `+1`; the exact building/unit preservation was verified
in DB, not inferred from that label. No request-count or byte-saving claim is
made for this mutation run. Production rollout still awaits independent review.

Follow-up checks: 55 tests across buildingDemand, AssignmentEditor guards,
calendarRemoval, eventAssignments.scope and DesktopCalendar.assignment passed.
Lint and TypeScript/Vite build passed. The 2,439-test full-suite result above is
from the implementation run; it was not rerun for this script/document-only
follow-up. Review `d3117d4` together with this live verification record.
