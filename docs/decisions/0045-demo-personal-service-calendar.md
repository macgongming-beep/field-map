# Demo personal service calendar snapshots

Date: 2026-10-23

## Scope and contract

Only demo sessions with actual role `user` and a known user name use this
snapshot on `/territory` and `/map`. Other roles, chat/event deep links and
invalid explicit event IDs keep the existing full-calendar behavior.
Production is not enabled by this change.

Discover event IDs from today's events, the user's card assignments across
all dates, the explicit assignment event in the route, and the restaurant
assignment event index. The last index stays complete because map unit details
show other people's restaurant assignment dates. This is intentionally more
conservative than reading only the user's own restaurant assignments.

Fetch event bodies, participants, and ALL card assignment/team/link rows for
those IDs. Filtering the hydrated assignment rows by user would break shared
teams. Do not reuse this partial calendar as a complete recipient authorization
snapshot. Existing independent recipient scope discovery remains in place.

Cache these snapshots under user/date/explicit-event keys using the existing
two-minute, six-entry memory cache. Mutation, realtime, foreground, manual
refresh, role and identity invalidation remain in force. No new device storage
or database migration is involved.

## Costs and verification

Before this change, demo home-to-service and home-to-map trips each triggered
three unbounded calendar/assignment/link reads, including repeated trips.

On a first personal snapshot read, three small indexes precede the bounded
event and assignment reads (normally six requests for one batch). This can
increase initial request count while reducing response scope. Repeated trips
inside the cache lifetime should make zero calendar snapshot requests; this
does not mean zero requests overall. Recipient scope, notifications, and other
independent reads must be counted separately.

Automated coverage includes old and future personal assignments, other teams,
multi-card links, restaurant dates, explicit old event links, empty indexes,
pagination, foreign-response rejection, index failures, route round trips and
cache invalidation.

## Live demo verification

Code commit: `ac5cf73`. Demo deployment:
`dpl_F1vfSVpbG2BdbMEwtgZFHMMCxRMp`, alias
`https://chinese-territory-app-demo.vercel.app`. Applied the waiting PWA update
before measuring. Production was not deployed or modified.

- Full suite: 1,761 tests / 204 files passed. Build and lint passed.
- Volunteer first home-to-service entry: six calendar/index requests. Event
  bodies were restricted to IDs 19, 51, 98, not an unbounded calendar query.
  Four additional recipient-scope requests remained; do not count those as
  eliminated by this change.
- Home-to-service repeat within two minutes: zero filtered calendar/assignment
  requests, versus three unbounded snapshot requests in the preceding baseline.
- Home-to-assignment-map repeat, twice: zero calendar SNAPSHOT reads. Three
  separate header reads still occurred (own participant events, cart application
  events, and leader event metadata). This is not zero overall network traffic.
- Small demo snapshot transfer: approximately 6.8 kB on the first scoped read,
  versus 4.8 kB for the old full snapshot. The added indexes cost more than the
  small demo body saving on first entry. Warm round trips are the measured win;
  first-entry production savings are not established by this test.
- Mobile past service count stayed at three. Opened September 13, September 30,
  and October 5 details. September 13 still displayed the demo volunteer, demo
  leader and User2; September 30 retained the demo administrator teammate;
  October 5 retained the test administrator leader and demo volunteer.
- Different-team shared cards, multi-card links and far-future assignments are
  covered by automated fixtures. No new live shared-team fixture was created.
  The map request-count fixture (event 19) displayed zero cards before and after;
  it is not a claim that live shared-card pins were exhaustively verified.

Local request evidence: `/tmp/demo-service-calendar-first-20261023.txt`,
`/tmp/demo-service-calendar-repeat-20261023.txt`, and
`/tmp/demo-map-calendar-repeat{,2}-20261023.txt`. These are native DevTools
observations; ServiceWorker delivery rows were not counted as second requests.
UI proof: `scratch/demo-service-old-team-ac5cf73.png` (not committed).

No monthly or production billing saving is inferred from demo byte sizes.
