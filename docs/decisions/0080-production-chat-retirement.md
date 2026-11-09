# Production chat retirement

- Date: 2026-11-09 (Asia/Seoul)
- Status: production database and frontend deployed and verified.
- User explicitly authorized backup, deletion of 33 chat alerts and production retirement.
- Approved changes: db8a7fa, 6376178, 5a3db14; production equivalents ee65a2a,
  8b3cee7, cc882be, based on origin/main b3e58c7. Other demo changes are not included.

## Backup and database

`scripts/chatRetirementProduction.mjs` is production-only and requires explicit
project confirmation. The demo runner still refuses production. Before applying,
the runner checks API URL, DB username/pooler, exact function fingerprints and policy,
fresh backup, migration contents and the exact approved notification IDs.

Backup in this production worktree:
`backups/chat-retirement-production-1794226473791/`

A second copy is kept in the long-lived `field-map-recipient-perf` checkout under
the same relative path, independently of this production worktree's lifecycle.

- `npm run backup`: 42 tables, 28,261 rows; one nonexistent optional table skipped,
  zero failures, private merge-audit snapshot included. All four chat tables,
  comments and notifications are included. JSON snapshot is copied into the above
  timestamped directory so a later daily backup does not overwrite it.
- Additional public/storage custom dump, checked with `pg_restore --list`.
- Exact original three functions, privileges and upload policy in `rollback.sql`.
- `notifications-to-delete.json`: all 33 deleted rows, kept private alongside the dump.
- Files use a restrictive umask and are excluded from Git.

Applied migration `20261109_2100_retire_chat_writes.sql` using
`psql --single-transaction`, with a notification-table lock and exact row checks.
If counts or IDs change, application stops. Transaction-level set comparisons
confirmed every non-target notification and every chat message stayed identical.

Result: **33 chat notifications deleted, 4,711 other notifications preserved,
14 chat messages preserved**. No chat-linked mention was targeted. No comments,
comment mentions or event-change alerts were deleted or marked read.
All three sending RPCs reject after session verification; upload INSERT policy is
removed. Chat reads, retention jobs, service worker and realtime publications stay.

## Verification

- Clean production-based checkout: 2,261 tests / 228 files, lint and build passed.
- 13 live production REST/RPC checks passed with two disposable random-credential accounts:
  - all three chat writes rejected without auto-join, message or notification;
  - old-client read-receipt RPC still works;
  - valid PNG upload rejected by RLS;
  - plain comment and mention comment saved and read by the other account;
  - comment mention and ordinary comment notification retrieved via the receiving
    account's notification RPC with the correct event link;
  - event title changed via authenticated PATCH; leader receives event-change alert.
- Synthetic users, sessions, login logs, event, comments and alerts cleaned up.
  Test event is isolated in 2030 and has only a synthetic leader. No existing
  account's credentials or notification preferences were changed.
- This is actual API and DB verification, not physical-device push delivery.
  Ordinary comments are still hidden in the UI; server creation is unchanged.
- Report: `scratch/chat-retirement-production-results.json` (local only).

## Frontend and rollback

Production uses `VITE_CHAT_DISABLED=true`. Existing ordinary-comment/notice hiding
remains independent of this flag. Comment mentions and event-change alerts remain.
Old chat links open event details; their full-calendar-read behavior is unchanged.

The flag was saved in the production Vercel project before pushing main da009e8.
Git-triggered deployment `dpl_BHcR2oLmzDbLYWNunxMMpmEeTdWg` is READY, aliased to
`https://chinese-territory-app.vercel.app` (project `prj_cdo2L78J2YEEaBgxMMnNDfA5BDZs`).
Direct HTTP reads of the public alias confirmed `index-CnVtJp3y.js` and
`MeetingSettings-BQiSHtj4.js`: the shared retirement helper defaults to `true`,
the hook, room/modal, calendar button, preferences and header use that helper,
and the header excludes both `notice` and `comment` regardless of the flag.
This is deployed-bundle verification, not a new production browser login test.

Users must apply the PWA update to hide chat and stop client polling. Old clients
can still read but cannot send or upload. Disabling this frontend flag alone does
not reopen server writes or recover deleted notifications. An explicit server
rollback must restore the backed-up functions/privileges/upload policy. Only the
33 backed-up notification rows should be restored if needed, never the whole DB.

Generating event links as openEvent and stopping hidden ordinary comment alerts
remain separate decisions, not part of this deployment.
