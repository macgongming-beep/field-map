# Calendar production release and route audit

Date: 2026-10-23 (Asia/Seoul)

## Production release

- Approved demo commit: `1522e4d`.
- Production commit: `8e6812f`, fast-forwarded from `b38d8b2` to main.
- Preserved production `calendarWindowEnabled` / `VITE_CALENDAR_WINDOW_ENABLED`
  opt-in and the existing production gate tests while resolving the test conflict.
- Production verification: 1,669 tests / 196 files passed; build and lint passed.
- Vercel deployment `dpl_4qnAA52c8ZsNw81vhPoFpnr4r36g` reached Ready and
  received the `chinese-territory-app.vercel.app` alias.
- Served `TerritoryReportView-CXzRDUHJ.js` contains the production flag default
  `true`, home end-of-next-month calculation, SQL `event_date` upper bound,
  and the nonnegative, under-120000ms cache reuse check and invalidations.
- No DB writes or migrations. Existing unrelated checkout changes were not staged.
- Rollback: set `VITE_CALENDAR_WINDOW_ENABLED=false` and rebuild/redeploy.
  Installed clients must apply the new PWA bundle; this is not an instant switch.

## Live demo observations

Demo: `https://chinese-territory-app-demo.vercel.app`, demo volunteer account.
Chrome Network panel, normal browser cache enabled. Clear the request log before
each leg. Count actual network rows, not the additional ServiceWorker delivery
rows. The measurements below exclude initial page load, notifications, chat
polling, recipient authorization reads, and calendar metadata reads unless noted.

| Navigation | Calendar snapshot requests | What was read |
| --- | ---: | --- |
| Home -> My service (mobile emulation) | 3 | Entire events, assignments, assignment-card links |
| My service -> Home within 2 minutes | 0 | Home snapshot reused |
| Home -> My service again | 3 | The same three full reads repeat |
| Home -> assignment map (desktop, browser Back) | 3 | Entire events, assignments, assignment-card links |
| Assignment map -> Home within 2 minutes | 0 | Home snapshot reused |
| Home -> assignment map again | 3 | The same three full reads repeat |

The three full reads transferred about 2.6 + 1.2 + 1.0 kB in this small demo.
These are DevTools displayed transferred sizes, not production sizes or billing.
The initial cold map page load is excluded from the navigation comparison.
The map route used an existing assigned event ID; this was a request-count test,
not a pin-completeness test for that event.

Zero snapshot requests on the return leg does NOT mean zero network requests.
Participant/cart/leader event metadata and notification/chat reads still occur.
The first home window load, or an invalidated/expired cache, reads its bounded
events plus scoped assignment tables. Recipient scope can separately fetch the
user's assigned event IDs and data, regardless of the visible calendar window.

Local evidence: `/tmp/demo-calendar-roundtrip-20261023.txt` and
`/tmp/demo-calendar-roundtrip-20261023.png` (not committed).

## Assignment preservation

- Live mobile My service still showed 3 past services. The October 5 entry
  retained its leader and demo-volunteer team member.
- Live desktop October 5 calendar detail retained its applicant and confirmed
  team, with the assigned test card name. No demo records were modified.
- Added two store-level route round-trip tests (`/territory`, `/map`) with an
  August event, an August event's separate team, and an August 2027 assignment.
  Both round trips retain all these assignments. They also pin the observed
  3 full reads on each outward leg and cached home return behavior.
- Focused tests: 48 passed across calendar scope, store scope, team members,
  and recipient preview. The other-team fixture is automated verification;
  a newly shared multi-team live fixture was not created during this audit.

## Scope needed before optimizing these routes

`MobileTerritory` consumes today's events, all future personal assignments, all
past personal assignments (despite an obsolete comment saying 30 days), and an
explicit target event. `DesktopMyService` uses today's assignments. Assignment
maps resolve `assignmentMap` to an event, which can be old. Restaurant map detail
also resolves assignment event metadata. Team membership depends on full team
rows, not just the current user's assignment row.

Do not apply the home's date window to these routes unchanged. A safe follow-up
must separate visible event data from authorization/card scope and retain:

1. Explicit assignment-map events regardless of date, with complete shared
   assignment rows for that event/time and existing role/access rules.
2. Personal future assignments outside the home window.
3. All past assignment navigation, with full selected historical event details.
4. Team identity/card scope, multi-card links, restaurant/informal assignments,
   and other-team display metadata where the UI already permits it.
5. Cache invalidation on mutations, realtime, foreground recovery, manual refresh,
   and identity/role changes; stale responses must not overwrite a newer scope.

No map/My service query behavior was changed in this audit. The measured next
target is the repeated full calendar snapshot when entering those routes, not
an assumed number of megabytes per day. Production savings remain unmeasured.
