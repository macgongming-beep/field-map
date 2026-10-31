# Linked return-visit map store retention

- Status: Demo deployed; review ready; production unchanged
- Date: 2026-10-31
- Related: 0049, 0053, 0061

## Cause and scope

Volunteer return-visit detail retained the recipient store, but its focused map
route did not. AppSession's recipient/full key therefore changed in both
directions, reloading a global snapshot including annual visit histories.
This was navigation overhead, not a request made on behalf of statistics.

Keep the existing recipient snapshot on `/map` only when scope is exactly
`regularVisits`, returnVisitId and buildingId are unique positive safe integers,
and no address or competing map target is supplied. This is not a new API that
fetches exactly one building: the existing recipient snapshot still contains
assigned and return-visit cards. Cold entry still fetches that snapshot.

`VITE_RETURN_MAP_RETENTION_ENABLED` uses `(flag ?? VITE_DEMO_MODE) === 'true'`.
Production defaults off, explicit false overrides demo. The existing recipient
opt-in and actual role=user guard remain authoritative. Leader, administrator,
developer, generic return-visit maps and address-only maps keep existing behavior.
Malformed paths cannot opt into this new route; existing assignment-map behavior
is unchanged. URL IDs do not expand server-authorized recipient card scope.

No mutation, recovery, realtime, statistics, RLS, or SQL changes. The existing
`get_recipient_return_visit_card_ids` RPC already supplies connected return-visit
cards, including those without an event assignment. Calendar scope already maps
these routes to personal service scope; with calendar windowing off it stays full.
Detail retention should also be enabled to avoid remounting on the detail leg.

## Verification

- Full suite: 2,188 tests / 222 files pass; lint passes; remote demo build passes.
- Keyed useStore round trips, with calendar windowing both on and off: one mount,
  same scoped building/history, zero additional mocked snapshot/history reads.
- Gate tests cover production unset/true/false, demo fallback/false, actual roles,
  recipient opt-out, duplicate/invalid IDs, address fallback and conflicting URLs.
- Mutation check: removing the recipient route opt-in makes both keyed round-trip
  tests fail and triggers the full snapshot reader. Restored before final checks.
- Existing map/detail tests cover linked building/unit filtering and map routing.

Actual demo browser: volunteer account, linked return visit 24 -> map -> unit 104
-> detail -> map. One building (79), its connected unit (182), and the base map
rendered. Applied the final PWA update and repeated linked-map verification.
Evidence: `scratch/demo-return-map-retained-1031.png` (local, untracked).

Address-only fixture 25 reached the address route, but its geocoded pin was NOT
confirmed. The pre-existing map fallback also showed another personal return
building with zero matching units. Consequently address-only routes were removed
from this optimization and explicitly tested to retain the old full-store route.
Investigate that separate UI/geocoding behavior before expanding scope.

Fixture script: `node scripts/smokeReturnMapRetentionDemo.mjs setup --confirm-demo`
uses only the hard-coded demo project and demo volunteer. Fixture 24 reactivated
an ended test visit; fixture 25 was newly created. Neither wrote visit histories.
Cleanup uses the normal end-return-visit RPC, verifies ended_at, and checks that
unit 182 remains in its original status. No production records were touched.
Cleanup completed: visits 24 and 25 are ended; unit 182 is still `미방문`.

This is browser UI verification, not a live network byte measurement. The zero
additional read count above is an integration-test result. No monthly savings
estimate or physical-phone verification is claimed.

## Deployment and rollback

Demo deployment: `dpl_Etyi4uEZpyCNJvXsJBUS5z1e6qGd`, alias
https://chinese-territory-app-demo.vercel.app . The Vercel CLI production target
belongs to the demo project, not the operational app. No production deployment
or environment setting was changed.

After review, production would need an explicit opt-in and verification of its
existing recipient/detail/history flags. Roll back with
`VITE_RETURN_MAP_RETENTION_ENABLED=false`, rebuild/redeploy, and apply the client
PWA update. This restores the former full-store map path without changing data.
