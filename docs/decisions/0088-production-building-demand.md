# Production home building demand

- Date: 2026-11-13
- Status: enabled and verified in production
- Source: reviewed `c664ea5`, decision 0087
- Flag: `VITE_BUILDING_DEMAND_ENABLED=true`

## Scope

Enable the reviewed home building demand for actual admin/leader roles, outside
recipient mode. Developer and volunteer behavior remains unchanged. The supplied
operating-role counts imply 27 eligible users (8 admins + 19 leaders), not 28:
the developer is deliberately excluded.

The material benefit is home-only visits avoiding all building/unit bodies.
Mobile map memo omission is a small extra: the reviewed production memo total
was only 536 characters. Calendar, zone, My Service, PC map and statistics retain
their complete reads. Once promoted, data remains available in the AppSession.
Progress remains visible using card summaries. No monthly savings are promised.

## Production integration

Port only the approved building change onto production `3a73be6`. Do not include
the separate demo privileged-history-demand or hidden-comment-feed changes.
Production useStore accepts building demand as its sixth argument; demo has an
additional history-demand argument before it. Existing production history reads
and statistics stay unchanged.

Preserve history response invalidation for building-demand users independently
of that absent demo feature: full history reads, targeted building changes,
deletion signals and disposal participate in the history read generation.
An older full history response must not resurrect a targeted cancelled record.

No DB migration, permission change or production record edit is needed.

## Verification

- Full production suite: 2,326 tests / 234 files passed.
- TypeScript/Vite production build passed with production public flags and this
  flag explicitly enabled, demo mode disabled.
- Added a production race regression: delayed full history read, targeted cancel,
  then old history response. The old response is rejected and history stays empty.
- Mutation check: removing demand-building history generation invalidation makes
  that regression fail. Restored the protection before the full run.
- Existing desktop leader-contact test explicitly uses the already-deployed
  retired-chat flag, matching production navigation; no contact runtime changes.
- Read-only preflight (`inspectBuildingDemandProduction.mjs --read-only`) found
  the existing get_card_summaries function, session validation, 200-card batch
  limit and progress fields. Counts: 609 cards, 1,249 buildings, 3,655 units.
- Production territory realtime and calendar window flags were already true.
  Private-user reads was true. Privileged history demand, hidden comment skip
  and cart applications were unset; this rollout does not enable them.

Demo interaction evidence and its limits are recorded in 0087.

## Deployment evidence

- Production code commit: `7549e7c`, pushed to main.
- Vercel deployment `dpl_9pQdEdhy5RxisNJmRkQukpCdrq95` became Ready and
  aliases https://chinese-territory-app.vercel.app.
- Pulled production settings confirmed BUILDING_DEMAND, TERRITORY_REALTIME and
  CALENDAR_WINDOW enabled. This rollout only added BUILDING_DEMAND.
- Canonical deployed entry: `index-BPYwEmKp.js`. Its shared
  `useCardDirectory-syxSM6me.js` contains the compiled enabled role predicate
  `(admin || leader) && true` and plain-home/map/full demand selection.
- `TerritoryReportView-Rk39QqLQ.js` contains the home early return before building
  SQL, the map projection, detail lifecycle protection and demand retry path.
- Chrome production administrator: applied waiting updates using the normal UI,
  then verified the page loads the same `index-BPYwEmKp.js`. Home still shows
  609 cards, 329 in progress, 280 unassigned, 589 / 3,655 completed units (16.1%).
  Today's three service entries and meeting-note entry remain visible.
- Screenshot: local `scratch/production-building-demand-home.png` (not committed,
  contains production personal information). No production save/cancel or team
  assignment mutation was performed. No live HTTP count or egress claim is made;
  compiled artifact verification and the demo/automated request checks establish
  activation, not measured monthly savings.
- Lint passed. No production DB records or permissions were modified.

## Rollback and follow-up

Set VITE_BUILDING_DEMAND_ENABLED=false and redeploy. Users apply the PWA update;
no forced activation or cache-wide deletion is introduced. No SQL rollback.

Compare admin/leader full buildings-with-units requests on comparable service
days. Calendar/zone promotion remains a separate audit if whole-building reads
remain high. Distinguish current card completion from selected-period visit rate.
