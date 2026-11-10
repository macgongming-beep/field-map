# Production private visit reads

- Date: 2026-11-10 (Asia/Seoul)
- Status: production database applied and verified.
- Approved implementation: `5de7c4b`; production equivalent: `4b99e02`.
- Scope: anonymous reads of visit_histories, return_visits and return_visit_logs.
  Phone/login-ID separation, units.memo, comments and notification queries remain separate.

## Emergency spreadsheet dependency

The user approved marking the old copy and proceeding with security, rather than
restarting an obsolete anonymous-key backup.

Read-only inspection found the owned Google Sheet:
`https://docs.google.com/spreadsheets/d/1B9Qmt9xw24x32SJ9x6wMS7eTVc0TlYKlCA-NaJifDnc/edit`

- Its metadata was last modified June 6, but the actual backup timestamp in
  `갱신정보!B1` was June 2, 2026. These are different timestamps.
- Bound Apps Script project: `1A97RQGdbaN4da4S_6RdHLcDs6UKqrxE7z8GxRRPpSnIT9iGXIpg3BElH`.
- Project overview showed zero executions over the past seven days; current
  account's trigger list showed zero triggers.
- Sheet renamed to `[옛 사본·갱신 중단] Field Map 동기화`.
- Only `갱신정보!B2` was replaced with an old-copy/manual-refresh warning;
  column B width and row 2 wrapping/height were adjusted for readability.
  Last-refresh date and all data tabs were preserved. Connector readback and
  Google-rendered visual inspection confirmed the warning.
- No script execution, trigger creation or credential change was performed.
- `docs/google-sheet-backup.gs` now carries a retirement warning. Its historical
  anonymous-query implementation must not be used to refresh this copy: a 200
  response with empty protected results can overwrite data without an error.

## Preflight and backup

Production-only `scripts/privateVisitReadsProduction.mjs` requires
`--confirm=qdxemvdorasoryfysuoq`, validates both API and session-pooler target,
keeps the database password only in the child process environment, and uses
restrictive filesystem permissions. The demo tool still refuses production.

Preflight verified:

- All three tables absent from the Realtime publication.
- Exactly three original permissive SELECT policies, each `USING(true)`.
- 64 distinct approved/active users with unexpired sessions.
- Existing helper definition fingerprint recorded and unchanged during application.

Backup directory in this worktree:
`backups/private-visit-reads-production-1794318459092/`

An independent copy is also in the long-lived demo checkout's `backups/` directory.
The backup contains a public/private schema-and-data custom dump, checked with
`pg_restore --list`, original policy metadata, counts/content hashes, migration
text and a narrowly scoped rollback SQL. Backups are excluded from Git.

The approved migration was applied using `psql --single-transaction`, a five-second
lock timeout and a 30-second statement timeout. Within the short transaction,
the runner compared before/after row fingerprints and existing write policies;
any mismatch would roll back. Only the three restrictive SELECT policies were added.

## Actual production verification

The production-based checkout passed 2,271 tests / 229 files, lint and build.
The SQL migration suite passed all ten tests. Existing build deprecation warning remains.

Live REST/RPC/WebSocket smoke passed **39 checks**, using four disposable accounts
and an isolated synthetic card/building/unit/return visit:

- Missing, malformed, unknown and expired tokens receive zero detail rows.
- Anonymous units-to-visit_histories embedded reads contain no visit details.
- User, leader, admin and developer exact counts equal direct database counts
  for each protected table, preserving the existing statistics read scope.
- Visit memo save returns its representation; unit status reflects the write.
- Another account receives the territory signal and can read the saved visit.
- Visit invalidation removes the valid record and restores unit status; the
  other connection receives a signal and reads the corrected data.
- Linked return visit retains address/building/unit, its card is returned by the
  recipient-scope invoker RPC, and the connected map building/units remain readable.
- Return detail add, edit and invalidate succeed.
- The metadata-only signal table remains anonymously readable; its policy and
  publication are unchanged.
- Disposable accounts, sessions/logs, records and physical fixtures were removed.

The first smoke attempt used `event:*` plus a building filter with a 15-second
deadline and timed out waiting for its first signal. Its fixtures were cleaned up.
Read-only diagnosis found the signal publication/read policy/definer trigger intact.
The runner was changed to the application's actual INSERT/UPDATE subscriptions
with `card_id=in.(...)`, and a 45-second transport deadline. The rerun passed save
and cancel delivery and received four signals total. No production application,
trigger or policy was changed to make this rerun pass. The initial timeout's exact
transport cause was not established; do not describe it as a proven policy regression
or a separately fixed production bug.

After cleanup, all three tables matched their complete pre-apply content hashes:
visit_histories **1,445**, return_visits **96**, return_visit_logs **10**.
Valid-session user count remained 64. Local report:
`scratch/private-visit-reads-production-results.json` (excluded from Git).

This is real API and WebSocket verification, not a two-physical-phone UI test or
a new visual comparison of statistics screens.

## Deployment and rollback

This protection is in the database, so it is already effective for the current
deployed app and does not require the user to apply a PWA update. Existing HTTP
session headers supply authentication. There is no new frontend behavior/flag.

The backed-up rollback drops only the three new restrictive policies. It would
reopen anonymous disclosure and is not an automatic fallback. Do not use it casually
for an expired-login problem; inspect authentication first.

Existing logged-in users still have their prior read scope. This is not a complete
privacy audit or per-user ownership restriction. Next: preserve call buttons while
separating contacts/login IDs, then audit units.memo and realtime comments separately.
