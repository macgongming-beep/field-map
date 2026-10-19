# Demo: targeted address and building creation refresh

- Date: 2026-10-20
- Status: implemented for demo full stores only; live browser verification pending

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

Vercel previously rejected deployment with api-deployments-free-per-day.
This work does not claim a new demo deployment, browser save verification or
production rollout. After quota reset: deploy demo, test address save/map link,
new/existing building placement and card counts, then review before production.
No monthly egress savings estimate; scoped volunteer behavior is unchanged.
