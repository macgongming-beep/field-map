# Demo: targeted address and building creation refresh

- Date: 2026-10-20
- Status: deployed and browser-verified for demo full stores only

Address-only updates modify return_visits, not building rows. A full store can
refresh the parent list and log index without rereading every building.
Building creation and the map's existing-building response supply a server ID;
the existing targeted sync can insert/replace that building and recompute card
statistics without loading every building/card. Other pins remain present.

Both new callbacks are wired only for VITE_DEMO_MODE=true and no recipientReader.
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
