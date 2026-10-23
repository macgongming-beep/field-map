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
cache invalidation. Live demo results will be recorded after deployment.

No monthly or production billing saving is inferred from demo byte sizes.
