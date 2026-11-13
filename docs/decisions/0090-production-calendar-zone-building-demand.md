# Production calendar and mobile zone building demand

- Date: 2026-11-13
- Reviewed source: `d3117d4`, demo verification `042e553`, decision 0089
- Production integration: `617762a`, evidence ports `57bff1a` / `3ff2390`
- Flag: `VITE_CALENDAR_ZONE_BUILDING_DEMAND_ENABLED=true`
- Prerequisite: `VITE_BUILDING_DEMAND_ENABLED=true`
- Status: enabled, deployed and verified in production

## Scope and integration

Enable calendar name-only buildings and mobile zone status projections for
actual administrators/leaders outside volunteer recipient mode. Developer and
volunteer behavior remains unchanged. PC zone, restaurant management and
assignment editing retain complete building data. The editor requests full data
at its own leaf while preserving its parent calendar; it does not initialize
from name-only placeholders. Acquired full data stays full for the AppSession.

Production does not include the separate demo privileged-history-demand or
participant-dedup changes. Preserve those boundaries when porting. Production
useStore takes building demand as its sixth argument, not demo's seventh;
adapted the new tests accordingly. Existing production history-generation
guards already cover demand-building reads and targeted cancellation.

No SQL migration, record edit or permission change is part of this rollout.
Only the new calendar/zone environment flag is added. Preflight confirmed the
building-demand, territory-realtime and calendar-window flags were already true;
demo mode and privileged-history-demand were not enabled. A second production
environment pull confirmed the new flag and prerequisite are both true.

## Verification

- Full production suite: 2,346 tests / 234 files passed.
- Lint passed; TypeScript/Vite build passed with production public flags,
  the new flag true and demo mode false.
- Actual demo team share/change/cancel and independent observer-tab evidence is
  in 0089. No production team application/assignment was mutated for this rollout.
- No production egress reduction is claimed from a local build.

## Deployed evidence

- Production main `3ff2390` deployed as `dpl_GELeESFHKXpcc9bvb7HWaGt9neqL`,
  Ready, canonical alias https://chinese-territory-app.vercel.app.
  Vercel build logs identify main and commit `3ff2390`.
- Canonical HTTP entry is `index-yZ3GvPGA.js`. Fetched shared asset
  `useCardDirectory-BF7i1T_-.js` has the new switch compiled to `return true`,
  the admin/leader prerequisite compiled true, and the calendar/mobile-zone
  route selection, rank ordering and exact field projections present.
- `TerritoryReportView-BYjtSgyT.js` retains both reduced read branches and the
  full-editor readiness contract. This checks actual deployed activation, not
  merely a configured environment variable or presence of dead code.
- Chrome's logged-in production administrator applied the normal waiting-PWA
  update. DOM script sources then identified the same `index-yZ3GvPGA.js`.
  PC calendar retained today's 10 applicants and two confirmed five-person teams.
- Temporary 430x932 viewport: calendar showed 49 November events and today's
  three time slots. Mobile zone displayed 609 cards (329 assigned / 280
  unassigned), 16 informal assets and 386 restaurants. Region house/shop counts
  and progress rendered. These are observed values, not a before/after DB audit.
- Restaurant tab changed the URL to `/zone?tab=restaurant`, waited for data,
  then showed the 386-entry list and six pending requests. No approval, rejection,
  application, assignment or visit record was changed. Returned to the original
  calendar and reset the temporary viewport.
- Local screenshot: `scratch/production-calendar-zone-demand.png` (not committed).
  Production verification used one administrator's Chrome session, not a physical
  phone or separately signed-in leader. No browser HTTP request count was measured.

## Separate observation

Browser logs contain `Invalid Sentry Dsn` before and after this deployment:
the configured value appears to be a JavaScript setup example rather than a DSN
URL. UI navigation succeeded, but error reporting may not initialize. This
rollout did not change that setting; fix and verify monitoring separately. Do
not conclude a lack of Sentry events means an absence of production errors.

## Rollback and measurement

Set only `VITE_CALENDAR_ZONE_BUILDING_DEMAND_ENABLED=false` and redeploy to restore
full calendar/zone reads while keeping the approved home/map demand optimization.
Users apply the ordinary PWA update; no forced activation or cache purge.

Compare complete building queries for admin/leader users on comparable service
days. A query containing coordinates alone may be the reduced map projection;
distinguish full memo/access-history fields from map, zone and calendar columns.
Editor visits still promote the session to full, limiting subsequent savings.
The demo calendar gzip estimate including summaries was 2,258 vs 3,162 bytes
(about 29% smaller), excluding HTTP headers, not a one-third transfer size.
