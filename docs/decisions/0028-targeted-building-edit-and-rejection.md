# Narrow building edits and restaurant rejection refreshes

- Status: demo deployed; production unchanged
- Date: 2026-10-20
- Code: `2e573a7`

## Decision

Restaurant rejection refreshes pending requests only, using the same injected
reader as request submission and memo editing. Approval still refreshes buildings
and histories because its transaction can create both.

Building information, access restrictions and units-surveyed edits refresh the
affected building through `syncChangedBuildings`. This also refreshes its units,
histories and derived card statistics. Moves, merges, imports and deletions retain
their existing refresh paths. A failed targeted read falls back to the existing
buildings/cards refresh; write failures do not start a refresh.

No schema, permissions, polling interval or realtime subscriptions change.
No monthly bandwidth saving is inferred from tests.

## Verification

- 1,425 tests across 185 files passed; lint and build passed.
- Reverting targeted building refresh caused six new assertions to fail.
- Reverting rejection refresh caused the new rejection test to fail.
- Hook tests verify immediate building snapshot replacement, unrelated building
  preservation and fallback reads without relying on realtime or page reload.
- Demo deployment: `dpl_58tyYQ6sKtQNBqg6NhFGXbKJEjNk`.
- Live demo UI: building 73 name changed and immediately reflected without reload;
  units-surveyed toggle checked/unchecked; access restriction set/cleared and map
  counts changed from 2 visit-needed / 0 forbidden to 1 / 1 and back. Original
  name, surveyed and access values restored through the UI.
- Created `DEMO-REJECT-1020` as demo volunteer through the restaurant request form.
  Demo admin rejected it: pending row disappeared without reload, existing four
  restaurants remained. The rejected test request is retained as review history;
  no building was created.
- Screenshots: `scratch/demo-building-targeted-2e573a7.png` and
  `scratch/demo-rejection-targeted-2e573a7.png` (local, not committed).
- Live offline testing was not repeated for this change; failure/recovery paths
  were checked with automated tests. No live transfer-byte savings measured.
