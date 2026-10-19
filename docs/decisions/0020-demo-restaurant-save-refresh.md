# Restaurant visit save refresh

- Status: demo verification; not approved for production activation
- Date: 2026-10-19
- Related: 0012, 0019

## Reason

addRestaurantVisit reused the restaurant-request refresh and downloaded requests,
buildings and visit histories/service sessions after a single visit insert. Catalog
details deliberately do not enter the recipient store, so the general local-unit
lookup would fall back to broad reads for these restaurants.

## Decision

Only when VITE_DEMO_MODE is literal true, resolve the saved unit's current
building_id on the server, then use the existing version-guarded building/history
sync. This covers catalog-only restaurants and units moved since selection.
Recipient allowsCard still controls buildings admitted to the map; histories
remain globally retained for statistics and restaurant previews. Unrelated
histories and card summaries are preserved. Failed parent lookup or sync falls
back to the previous authoritative refresh without repeating the insert.

Registration, approval, rejection and request-memo refresh remain unchanged.
No DB, RLS, notification or realtime subscription changes. Production still uses
the original save refresh until a separately approved activation.

The history projections also need visit_type: the previous omission made
toVisitHistory default restaurant records to card. Include it in full, targeted
and recipient-prefetch history queries, preserving existing period/invalidation
filters and pagination.

## Verification

Store tests cover out-of-scope saves, retained unrelated histories/card summaries,
map scope preservation, parent lookup/sync failure, malformed parent IDs, failed
inserts and the production gate. Reverting the targeted callback to fetchAll
makes two new tests fail. Full and targeted projection tests require visit_type.

Successful targeted save reads a single unit parent plus the existing three
building/unit/history queries (additional pages only for large buildings).
It does not read restaurant_requests or service_sessions. This is a request
contract, not a measured billing saving or an explanation of 230 MB/day.

Physical two-device synchronization and production egress are separate checks;
automated store tests do not establish either.
