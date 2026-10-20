# Demo small refresh bundle

- Date: 2026-10-20
- Status: demo verified; production unchanged

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
independent re-review approved the demo change. No schema, permission, or
production environment changes.

Validation: 1,491 tests / 187 files, lint and build pass. Removing the two narrow
callback connections makes exactly two new integration tests fail; restored.
Tests cover demo/non-demo selection, correct building/other-building retention,
zero-row/error writes, fallback, final group refresh failure notification, stale
group responses, and production nonfatal startup. Real network-offline testing
is not claimed. No production egress estimate is inferred from these tests.

An additional Chinese-flag double-refresh-failure test passed in the focused
regularVisits suite (14 tests); the 1,491 count above precedes this extra test.

Demo deployment of 9bc0147: dpl_AFVsjrWnhb35u3feKy7QUdMqE8hC.
The browser loaded /assets/index-CJSuWFqs.js after accepting the PWA update.
Live admin UI checks:
- Renamed the existing informal group, observed the new name immediately with
  all three assets retained, reloaded and verified persistence, then restored
  the original name and verified it after another reload.
- Removed and restored the Chinese-residence flag on the demo building's 101
  unit. Both changes appeared immediately in the row and detail view. The
  existing visit history and building counts remained. Reloading confirmed the
  restored flag persisted.

Screenshots are local scratch/demo-small-group-saved.png and
scratch/demo-small-chinese-restored.png. No production deployment was performed.

## Production opt-in (2026-10-20)

User approved activating both changes together. Independent build-time flags:

- VITE_CHINESE_FLAG_REFRESH_ENABLED
- VITE_INFORMAL_GROUP_REFRESH_ENABLED

Each falls back to VITE_DEMO_MODE only when unset. Explicit false disables it.
Chinese refresh still excludes recipient stores; group-only rename does not
change scope, so remains available to recipient stores.

Rename recovery has an explicit strictGroups read option and dedicated fallback
callback. Unlike ordinary production startup, this recovery must preserve groups
and report an error if the group read fails. Strict reads cannot reuse an older,
non-strict in-flight request. Other resource mutations are unchanged.

Independent Codex review approved the changes with no actionable findings.
Full suite: 1,504 tests / 187 files, lint and build passed. Temporarily restoring
demo-only callbacks failed exactly four flag tests (eight passed); restored.
An additional recipient double-failure regression was added after that full run.
Activation/deployment verification is recorded below when complete. Disabling
either flag requires rebuilding/redeploying and users accepting the PWA update.

Both production flags were set to true before the fast-forward push of 0f77e9f
to main. Vercel Git deployment dpl_Htt4tnyyhqPMvwYSLCFShhC1S7rm is Ready and owns
chinese-territory-app.vercel.app. Public assets index-Mn92x-s-.js and
TerritoryReportView-ICu9xYYB.js confirm both targeted callbacks enabled, the
Chinese recipient guard retained, and strict rename fallback present.

The additional recipient suite passed 113 tests. Production PWA update loaded
the new entry asset; read-only UI smoke retained 16 informal assets in five
groups (609 cards and 387 restaurants also shown). No production records were
edited. Screenshot: scratch/production-small-refresh-0f77e9f.png.
Live mutation tests remain the demo checks above, not production experiments.
Egress impact is unmeasured; compare matching windows after client adoption.
