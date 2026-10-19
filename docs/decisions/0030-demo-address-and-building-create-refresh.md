# Demo: targeted address and building creation refresh

- Date: 2026-10-20
- Status: deployed and browser-verified for demo full stores only

Address-only updates modify return_visits, not building rows. A full store can
refresh the parent list and log index without rereading every building.
Building creation and the map's existing-building response supply a server ID;
the existing targeted sync can insert/replace that building and recompute card
statistics without loading every building/card. Other pins remain present.

Initially both callbacks were wired only for VITE_DEMO_MODE=true and no recipientReader.
Recipient-scoped stores deliberately retain full scoped refresh: changing an
address or creating a building may affect the accessible card scope and linked
map target. Do not replace that scope calculation with an arbitrary-ID read.
Production continues existing behavior. No schema, permission or DB changes.

Missing callbacks retain old refresh behavior; targeted refresh errors fall
back to it. Failed address writes do not announce success or refresh. The PC
existing-building response still returns false rather than reporting creation.

Tests cover store projection selection for demo/non-demo, created/existing map
placement IDs and preservation of unrelated pins, narrow-refresh fallback and
failed address writes. Removing both demo callback connections failed exactly
the three new store tests; restored afterward.
Full suite: 1,453 tests / 187 files passed; lint and build passed.

Vercel previously rejected deployment with api-deployments-free-per-day. On
2026-10-20 the quota allowed deployment of 33d999a to the demo alias, deployment
dpl_5uSFj2eaie6ABC2mSoffLgcpC2Dz. The browser applied the PWA update and loaded
assets/index-Dxa6sWnb.js before verification.

Live Chrome verification with the demo admin (full store):
- Saved an address on disposable return visit DEMO-RV-LAZY-1020 (id 22).
  It appeared immediately, survived reload, and its map button opened existing
  building 41 with its pin and address.
- Created DEMO-PIN-1020 (building 130) from the regular-visit map. The app
  correctly explained that this unrelated building was outside that map scope;
  it was subsequently visible on the general map without a page reload.
- Created DEMO-PIN-LIVE-1020 (building 131) on the general map. Its pin and row
  appeared without reload; the unassigned building count changed 21 to 22 and
  existing pins remained. No units were added, so the unit count stayed 6.
- Submitted building 131's address again. The existing-building notice appeared,
  the map selected building 131, and the building count remained 22.

Fixtures remain in demo for review. Screenshots are in scratch/demo-address-33d999a.png,
scratch/demo-new-pin-live-33d999a.png and scratch/demo-existing-pin-33d999a.png.
This was browser verification, not a two-physical-phone or production test.
No production deployment was performed. Review before enabling in production.
No monthly egress savings estimate; scoped volunteer behavior is unchanged.

## Independent production opt-ins (2026-10-20)

Added VITE_RETURN_VISIT_ADDRESS_REFRESH_ENABLED and
VITE_BUILDING_CREATE_REFRESH_ENABLED. Each independently overrides VITE_DEMO_MODE;
unset inherits the demo default, explicit false disables even in demo, and true
permits targeted refresh in production full stores. Both retain !recipientReader:
scoped stores always re-evaluate their authoritative scope after these writes.
These are build-time flags; switching requires rebuild/redeploy and PWA update.
Neither new flag was set on production and this code was not released there.

Verification: 1,467 tests / 187 files passed, lint and build passed. Matrix tests
cover unset, production true, demo false, independent flags, created/existing
placement and other-pin preservation. Recipient tests call the actual mutation
with both flags enabled and verify a changed scope removes old buildings instead
of arbitrary-ID sync. Reverting flag support failed six matrix tests; removing
!recipientReader failed all three new scope tests. Both mutations were restored.

Flag commit e22022e deployed to demo as dpl_fvNTuSRYZ55H8sefZcLDXLg9neZt (Ready).
With both flags unset, the demo build retains the previously verified behavior
and identical entry asset index-Dxa6sWnb.js. Production remains the separate
0296f78 release documented in decision 0029; these opt-ins are not enabled there.

## Pre-activation review hardening (2026-10-20)

Independent Codex review (not Claude) found no flag regression but identified two
inherited address-path risks: a zero-row UPDATE could announce success, and an
older returnVisits read could overwrite a newer returnVisitDetails snapshot.
Activation was held while both were addressed.

Address UPDATE now selects its affected ID and returns false on zero rows, write
errors, or unrecovered refresh failure. Both mobile address editors preserve the
draft and release saving state on false/throw. Successful saves close normally.
The two return-visit slices share a response version so an older request cannot
overwrite the latest parent/log snapshots. No schema or permission changes.

Full suite: 1,475 tests / 187 files; lint/build passed. Removing the affected-row
guard and response-version guard failed exactly three new regressions. UI tests
cover draft preservation and retry in both list and detail editors. Live RLS
zero-row simulation and artificial overlapping responses are automated-test
coverage, not production-write experiments.
