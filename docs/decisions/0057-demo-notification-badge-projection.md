# Demo notification badge projection

## Scope

The header previously fetched up to 50 complete notification rows while its
notification panel was closed. Visible-document polling repeats this every
60 seconds. This change omits titles and bodies while closed, then requests the
original full RPC response when the panel opens. Header wiring is demo-only.
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
- Production still uses the full response. A production opt-in gate and review
  are required before enabling this optimization there.

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
