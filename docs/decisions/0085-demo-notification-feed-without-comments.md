# Exclude hidden ordinary comments from notification reads

- Date: 2026-11-10
- Status: demo deployed and verified 2026-11-11 KST; production unchanged.
- Scope: additive notification reader and opt-in client; no user-row restriction.

## Decision

The header already hides `comment` and `notice`. Reading the latest 50 notifications
and filtering in the UI still transfers hidden comments and can crowd out visible
mentions/events. Add `get_my_notification_feed(uuid, integer)` and exclude **only**
`type = 'comment'` inside the SQL query, before ordering/limiting.

The old `get_my_notifications` RPC remains unchanged for old apps and rollback.
The new SECURITY DEFINER RPC verifies the caller's session, selects that user's
rows only, has a fixed empty search path, and explicitly revokes PUBLIC execution.
It returns the same notification shape. Default limit is 50, bounded to 0..100;
null means 50. Equal timestamps are ordered by descending ID.

`VITE_NOTIFICATION_COMMENT_SKIP_ENABLED` follows `(flag ?? VITE_DEMO_MODE) === 'true'`.
The leaf hook selects the RPC for badge, full panel, polling and explicit refresh.
Badge projection still excludes title/body. Snapshot identity includes the read mode;
switching it cannot expose a previous-mode response. Failures do not silently fall
back to the old, unfiltered RPC. The UI's existing comment/notice/chat filters stay.

## Contracts and limits

- Comments, mentions, preferences, notification inserts, push dispatch and write RPCs
  are unchanged. No historical notification is deleted or marked read by the new reader.
- Ordinary comment push must continue even though its in-app notification is hidden.
- Mentions and all other types are preserved. This is not a general notification policy
  redesign; even `notice` and retired chat remain subject to their existing UI filters.
- The 50-row window is now 50 **non-comment** rows. Older mentions/events previously
  crowded out by comments can become visible and contribute to the badge. This is not
  re-enabling ordinary comments. The badge remains a count of this window, not all history.
- Mark-all/clear-read retain their existing server-wide semantics for the current user,
  including hidden rows when those operations are invoked.
- Request count/polling interval do not change. Payload savings depend on each account's
  mix of notifications; replacing comments with 50 older non-comments may save little.
- App-user DB restriction `20261110_1500` stays deferred in production. This task does
  not run it or change any policy. Demo already had its prior privacy test setup.

## Tests

- PGlite executes the real additive migration and old baseline getter: owner isolation,
  anon execution with valid session, invalid/null sessions, filtering before LIMIT,
  stable ties, unchanged stored rows/old RPC and bounded limits.
- The actual comment trigger migration is executed against a recording push stub:
  ordinary and mentioned recipients each retain their respective push/in-app type.
- Hook tests: production default off, production true, demo default on/explicit false,
  badge/full/minute polling, retry without fallback, read-mode isolation and existing
  mark-one/mark-all/clear-read calls.
- Mutation checks: remove SQL comment exclusion => 2 failures; remove owner predicate
  => 1 failure; replace flag with demo-only gate => 5 failures. All restored afterwards.
- Full suite: 2,359 tests / 238 files passed. Lint and production build passed.

## Demo procedure

`scripts/notificationFeedDemo.mjs` accepts only the explicit demo project/API/pooler
and `--confirm-demo`. `apply` backs up public/private schemas, checks the archive,
then applies only 1600 with `psql --single-transaction`. Existing notification/push
definitions and all policies must be byte-for-byte unchanged. The repository definer
audit is saved beside the backup. `smoke` uses disposable users/events/comments and
cleans only those exact fixtures in `finally`.

The live smoke compares old/new API payloads using 60 recent ordinary comments and
an older real comment mention. It checks badge projection, session isolation, read
actions, actual comment generation, and actual pg_net push queue entries inside a
transaction that is rolled back before dispatch. Demo has no push transport settings;
the probe supplies a transaction-local dummy URL/key, never persistent configuration.
Optional Playwright checks the
deployed demo bell/panel and RPC traffic. Physical phone push receipt is not claimed.

Demo backup: `backups/notification-feed-demo-1794322647618/before.dump` (private,
not committed). Existing functions/policies matched before/after and the new RPC
was classified as authenticated read in the definer audit.

### Completed live verification

- Implementation: `6eaf6d4`. Demo deployment `dpl_Edmx24MZ7Rv2sFtN9ubFb3Uh26u4`
  is READY at `https://chinese-territory-app-demo.vercel.app` (demo project's
  Production environment, NOT the real production app/project).
- API + deployed mobile-browser smoke: **20 checks passed**, fixtures cleaned.
  Browser requests were filtered badge -> filtered full panel -> filtered badge;
  no old getter requests or page errors occurred in this flow.
- Bell panel showed the real comment mention and none of the 60 synthetic hidden
  comments. Clicking the mention opened the correct event; both ordinary and
  mentioned comment bodies remained visible in the detail. Calendar consumes the
  `openEvent` parameter after opening, so the smoke asserts rendered content.
- Actual demo comment trigger + dispatch produced both `comment` and `mention`
  pg_net requests with the transaction-local dummy transport. The probe rolled
  back. Real phone delivery is **not verified**; demo has no configured transport.
- Synthetic old/full response: 50 rows / 11,051 JSON bytes / 352 locally gzipped
  bytes. New/full: 1 mention / 275 JSON bytes / 229 locally gzipped bytes. These
  repetitive fixtures are not representative operational traffic; gzip excludes
  HTTP headers. Do not extrapolate monthly MB or claim fewer HTTP requests.
- Evidence (untracked, synthetic accounts only):
  `scratch/notification-feed-demo-results.json`,
  `scratch/demo-notification-comment-skip.png`,
  `scratch/demo-notification-mention-comments.png`.

Reproduce (requires explicit demo credentials, never production):

```sh
DEMO_ENV_FILE=/secure/demo.env PLAYWRIGHT_MODULE=/absolute/path/playwright/index.mjs \
  node scripts/notificationFeedDemo.mjs smoke --confirm-demo
```

## Production and rollback

Production is not changed by this task. After review, install **1600 only** before
setting `VITE_NOTIFICATION_COMMENT_SKIP_ENABLED=true` and rebuilding/deploying.
Do not run all pending migrations: user-row restriction 1500 requires separate
client-update evidence and explicit approval.

Rollback: set the flag false and rebuild/deploy; users apply the PWA update. Keep
the additive RPC installed until no enabled clients use it. No data restoration is
needed because the migration does not alter notifications or existing functions.
