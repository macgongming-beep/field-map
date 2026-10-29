# Demo notification badge projection

## Scope

The header previously fetched up to 50 complete notification rows while its
notification panel was closed. Visible-document polling repeats this every
60 seconds. This change omits titles and bodies while closed, then requests the
original full RPC response when the panel opens. Initially header wiring was
demo-only; the independent build-time opt-ins below now prepare production use.
Production configuration, database functions, permissions, push delivery, chat
messages, polling intervals and the 50-row limit are unchanged.

The existing demo chat badge optimization (decision 0036) is separate and is
not changed or counted as new work here. This is not a claim that notifications
are the largest remaining billing item.

## Contract

- Use the same authenticated `get_my_notifications` RPC with a response column
  projection. Keep IDs, types, links, timestamps and read status. Do not access
  the private notifications table directly.
- Keep notice/comment filtering, active-chat suppression and badge counts.
- Metadata is never displayed as a notification body. Opening shows loading,
  and a failed body read has a retry action rather than an empty-list claim.
- Keep identity and read mode separate. Ignore old requests after mode, account,
  token or lifecycle changes. Older reads cannot undo optimistic read/delete.
- No persistent notification cache is introduced. Closed/open mode changes each
  cause one read; this can add requests for frequent panel toggling. Measure the
  tradeoff, not just projected body savings.
- Production keeps the full response unless its notification opt-in is explicitly
  enabled. Review and production rollout remain separate from this code change.

## Verification

- 21 focused tests pass, including real header/hook/panel integration and closing
  the panel before a read-status write is acknowledged.
- Full suite: 2,000 tests / 219 files pass. Lint and build pass.
- Coverage: same RPC/limit, metadata polling, full body loading, hidden legacy
  kinds, read actions, retry, old reads, account/token changes and unmount.
- `scripts/measureNotificationBadgeDemo.mjs` refuses any non-demo database,
  compares authenticated RPC rows, and optionally checks the deployed UI with
  Playwright. It logs counts/sizes, not tokens or notification content. Browser
  transfer measurements and decoded JSON sizes are separate; neither establishes
  monthly billable savings.
- No physical phone or OS push delivery test has been performed in this change.
- Authenticated demo RPC parity: one row, same ID/read state and metadata;
  decoded JSON 267 bytes full versus 160 bytes metadata. This tiny fixture is
  not representative of production, and these are not compressed transfer sizes.

## Deployed demo verification

- Code commit: `429140a`; demo deployment:
  `dpl_C7aNxmJ3kFfAAwJtU5y1JDZDorwg`, canonical entry `index-Dlo3SnCA.js`.
- A separate Chromium mobile viewport (430 x 932), with service workers blocked,
  opened the actual canonical demo. The app-internal browser connector was
  unavailable. This is not an installed-PWA or physical-phone check.
- Closed header / opened panel / closed panel produced three successful RPC
  reads: metadata / full / metadata. Real notification title and body rendered.
- CDP `Network.loadingFinished.encodedDataLength` for those H3 responses was
  899 / 1,003 / 898 bytes in the final run. CORS preflights are counted separately
  by the script. These browser-reported sizes are not Supabase billing evidence.
  For this one-row fixture the per-read difference is only about 100 bytes, and
  opening/closing adds reads compared with the old full-response header.
- Aborted the next full-body POST in the test browser. The panel showed an error
  with retry; retry loaded the real content. No page errors occurred.
- No notification rows were created, deleted or marked read in the live check;
  read/all-read/delete behavior is covered by automated hook/panel tests.
- Production deployment and configuration were not changed.

## Production opt-in follow-up

- Notifications: `VITE_NOTIFICATION_BADGE_ONLY_ENABLED`.
- Header chat badge: `VITE_CHAT_BADGE_ONLY_ENABLED` (decision 0036 loader).
- Each uses `(flag ?? VITE_DEMO_MODE) === 'true'`, independently. Unset on
  production leaves the old reads; explicit `false` disables even on demo.
- Notification mode still additionally requires the panel to be closed.
  Opening fetches full notification content regardless of either flag. Neither
  flag changes the full chat list in GlobalChatModal or NotificationCenter.
- No role, cache key, RPC, subscription, polling or write logic was changed in
  this follow-up. No database migration or server count RPC was added.
- Enable or roll back each flag independently. A build, redeployment and client
  PWA update are required; this is not a live server switch.
- Verification: 55 focused tests; 2,010 tests across 219 files; lint/build pass.
  Tests cover production on/off/unset, demo inheritance, explicit false, independent
  combinations, and real header/panel body loading and read actions.
- Mutation check: reverting both header gates to demo-only caused 9 of 17 header
  tests to fail. Restoring the opt-ins returned all 55 focused tests to passing.
- The authenticated demo byte comparison above is unchanged: H3 transfer roughly
  899 B metadata versus 1,003 B full for one row, not a production savings estimate.
- This follow-up prepares the switches only. Neither production flags nor any
  deployment were changed; the deployed demo remains `429140a` until next rollout.
