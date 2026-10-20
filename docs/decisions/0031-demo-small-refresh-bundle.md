# Demo small refresh bundle

- Date: 2026-10-20
- Status: demo verification pending; production unchanged

Two independent small mutations reduce unrelated reads:

- Chinese-residence flag: refresh the affected building using existing targeted
  sync, only when DEMO_MODE=true and no recipientReader. Scoped stores retain
  authoritative scope refresh. Verify affected rows before reporting success.
- Informal group rename: read informal_groups only, using a new slice that does
  not trigger recipient scope recomputation. Other group mutations are unchanged.

Absent callbacks preserve existing reads. Failed narrow reads fall back to the
previous refresh. Final recovery failures report an error rather than success.
Group snapshots share a response version across resources and informalGroups,
so a late pre-save read cannot overwrite a renamed group. Demo group read errors
preserve the previous snapshot and propagate for recovery. Production retains
the previous nonfatal group-read error behavior.

Independent review found production startup error behavior had accidentally
changed and final rename recovery failure lacked feedback. Both were corrected;
re-review is pending. No schema, permission, or production environment changes.

Validation: 1,491 tests / 187 files, lint and build pass. Removing the two narrow
callback connections makes exactly two new integration tests fail; restored.
Tests cover demo/non-demo selection, correct building/other-building retention,
zero-row/error writes, fallback, final group refresh failure notification, stale
group responses, and production nonfatal startup. Real network-offline testing
is not claimed. No production egress estimate is inferred from these tests.
