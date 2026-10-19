# Demo restaurant browsing without territory preloading

- Status: approved, demo verification only; production is unchanged.
- Date: 2026-10-19
- Related: 0015 recipient loading, 0017 production recipient activation.

## Reason

The recipient scope included every card containing either a restaurant building or
a restaurant unit. Prefetch then downloaded ALL buildings, units and boundaries
on those cards before the restaurant sheet was opened. This weakened recipient
scoping even when the person never browsed restaurants.

## Decision

When `VITE_DEMO_MODE === 'true'`, remove the two global restaurant indexes from
recipient scope discovery. Keep personal restaurant assignments, normal card/team
assignments, active service sessions and return-visit scope unchanged. This replaces
only the global restaurant expansion part of 0015 in demo; production keeps it.

The mobile RestaurantServiceSheet opens with search and district/neighborhood
selectors. Opening alone makes no catalog request. Choosing a region, explicitly
choosing All, or typing a search requests 20 items plus one lookahead. Search waits
350 ms; changing filters resets the cursor and ignores obsolete responses.
Scrolling loads the next page, with an explicit load-more/retry fallback. Errors
never trigger a global restaurant/territory fetch.

The read-only `browse_restaurants` RPC runs under invoker permissions and checks
`verify_session`. It returns only names, addresses, parent IDs and card region/area.
Pagination uses `(building_id, coalesce(unit_id, 0))`, not offsets. Restaurant units
take precedence; a legacy restaurant building appears once only when it has no
restaurant units. Existing RLS is unchanged. SQL literal search treats `%` and `_`
as characters, not wildcards.

Selecting a result retrieves only that building and its units, validates the
parent/card and current restaurant classification, then enters the existing
preview/start/record workflow. Its data is not merged into the recipient territory
snapshot. Existing global visit histories remain available for the preview.
The existing restaurant-save refresh includes visits and remains unchanged.

Desktop administration/full territory views remain full. This change does not
claim to eliminate every broad query in the application.

## Verification

- SQL execution tests: idle guard, 21-row bound, cursor continuity, region/area,
  literal search, legacy/point semantics, RLS and invalid-session denial.
- API tests: lookahead, server response validation, account changes, single-building
  detail and rejection of moved/reclassified targets.
- Component tests: idle zero requests, region/page query, debounce, stale-response
  rejection, no overlapping next-page requests, detail selection and retry.
- Recipient test preserves personal assignments and excludes unrelated restaurants.
  Mutating the demo gate to false fails that test (1 failed / 26 passed); restored.
  Mutating the catalog idle gate to always render fails the opening-without-query
  test (1 failed / 3 passed); restored. The idle assertion advances fake time 500 ms.
- Full suite: 1,285 tests / 178 files passed; lint and production build passed.
- Actual demo volunteer reader, compared with `2faae76`, same data/session:

| Reader portion only | Before | After |
| --- | ---: | ---: |
| Buildings | 17 | 8 |
| Boundaries | 5 | 1 |
| Requests | 15 | 12 |
| Compressed response body bytes | 4,451 | 3,418 |

Loaded building/unit/boundary fields match the corresponding baseline subset.
This is NOT browser Transferred, billing egress, whole-app traffic, or a production
monthly prediction. Demo data is small. Catalog browsing costs are additional
when deliberately requested. No attribution of the reported 230 MB/day is made.

## Deployment

Demo DB `itjlykpjmlcvanqpmkmc` only: backup created and archive listing checked,
then migration applied with `psql --single-transaction`. No production SQL or
environment variable change. Forward migration and separate rollback are retained.
Disable/revert the demo client before dropping the RPC.

Demo app `09a92d9` deployed directly to Vercel, deployment
`dpl_ETAkEYnDqA8LUbev37gWH1XEV49d`, alias
`https://chinese-territory-app-demo.vercel.app`. GitHub branch push was rejected
by an expired/invalid Git credential; local commits are retained. No main push.

Local 390px browser: region and neighborhood queries, selected restaurant detail
and existing service-start card verified.

Deployed demo, 2026-10-19: in the demo leader account at 390px, searched for
restaurant 2, opened its detail, started service and saved a unique test memo.
Reopening the same restaurant displayed that memo in previous records; the DB
confirmed history 70 for unit 163 with visit_type restaurant. After verification,
the existing invalidation RPC successfully invalidated that test history. Unit
163 retained its original status (unvisited). Screenshot retained in scratch.
The same deployed 390px flow was then repeated after logging in as the actual
demo volunteer (role user, not a leader's volunteer view). Search, detail, start,
save and reopening previous records passed. DB history 71 identified the demo
volunteer and unit 163. The test history was invalidated using the existing RPC;
the original unvisited unit status was verified afterward. Screenshot:
`scratch/restaurant-catalog-volunteer-save.jpg`.
Real mobile-network testing remains separate from desktop mobile emulation.

Release preflight: origin/main still points to e0a49c8. The catalog client remains
demo-gated and its RPC has only been applied to the demo DB. Production activation
requires a reviewed production gate and backed-up production RPC installation
before deploying an enabled client; these UI checks do not imply deployment.

## Production opt-in (2026-10-19)

`VITE_RESTAURANT_BROWSE_ENABLED` overrides the demo fallback. Only literal `true`
enables the catalog; explicit `false` disables it even in demo. Missing both flags
retains legacy reads. The same helper gates the recipient scope and catalog UI,
so disabling the feature restores both together. Recipient role/view eligibility,
personal assignments and save/visit refresh contracts are unchanged.

Verification: 1,292 tests / 179 files passed, lint and build passed. Reverting the
helper to the old demo-only condition made three new flag tests fail. Production
installation uses a strict project allowlist, a permission-restricted pg_dump of
public/private schemas checked with pg_restore --list, then a single-transaction
migration. It refuses to overwrite an already installed function.

This is a build-time switch, not a runtime kill switch. Turning it off requires a
new build/deployment and client update. During rollback, keep the RPC installed
while any enabled PWA clients may still be running; do not drop it immediately.
No monthly saving or attribution of the reported 230 MB/day is claimed.
