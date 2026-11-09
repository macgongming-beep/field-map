# Login guard review follow-up

- Date: 2026-11-09
- Status: demo database and frontend deployed and verified; production unchanged.
- Supersedes no security policy in 0075; adds usability and contention fixes.
- User decision: KEEP the existing 15-minute policy. Do NOT add a 24-hour
  cumulative limit or a 24-hour lock in this change. Long-term throttling is
  separate work because deliberate account lockout can deny legitimate access.

## Changes

1. After five credential failures for the same trimmed ID in this login view's
   15-minute observation window, show a persistent Korean/Chinese/English hint:
   the account MAY be locked; retry after 15 minutes or contact an administrator.
   Empty RPC results alone increment the count, not network/DB failures. A correct
   password response, new ID or expired window resets it. The hint is advisory:
   it never disables login, so admin reset allows immediate retry. No new server
   response differentiates unknown IDs and locked accounts. The counter is
   memory-only, not synced between tabs/devices and does not survive reload; it
   is not enforcement or a guarantee of the server's exact unlock deadline.
2. An AFTER UPDATE OF pin trigger deletes that user's private attempt state only
   when the hash changes AND the custom-session actor is admin/developer. PIN
   reset and unlock are in the same transaction. The existing admin PATCH is
   retained, including old clients. Regular profile edits, non-admin own PIN
   edits and unauthenticated maintenance do not implicitly unlock an account.
   Resetting to the same plaintext still changes bcrypt salt and unlocks.
3. Login takes FOR NO KEY UPDATE rather than FOR UPDATE. Account attempts still
   serialize; unrelated FK KEY SHARE inserts (sessions/notifications) need not
   wait. The function otherwise retains 0075's rules and response contract.

Implementation:
- `supabase/migrations/20261109_1900_login_guard_followup.sql`
- `useAuth.ts`, `Login.tsx`, `App.tsx`, locale strings.
- Apply 1800 then 1900 in that order for fresh installs. Do not reapply 1800
  alone afterward because it contains the previous login definition.

## Verification

- Full suite: 2,284 tests / 229 files passed; lint and build passed.
- Changing the client hint threshold from 5 to 99 makes two hook tests fail;
  restoring it makes all 14 hook/component tests pass again.
- SQL tests cover admin reset (new and same plaintext PIN), permission checks,
  non-PIN edit isolation and transaction rollback of reset + unlock.
- Removing the admin unlock condition with LOGIN_GUARD_MUTATION=unlock causes
  the reset test to fail. Prior lock/count/read mutation options now modify both
  migration definitions so the follow-up cannot mask those checks.
- Hook tests cover the fifth-failure hint, later successful login, ID/window
  isolation and excluding transport errors. Component tests cover all three
  languages and verify the hint never disables submit or follows another ID.
- Actual demo smoke: 29 checks passed. Random disposable accounts and one
  disposable event only; no failures against existing users.
- Concurrent login smoke: 12 wrong requests still stop at 5 and lock; correct
  password/legacy two-argument calls are rejected while locked.
- Actual admin PIN-reset PATCH clears the lock and permits immediate login.
- Participant application/cancellation and comment INSERT pass their policies.
- `get_recipient_return_visit_card_ids` succeeds with the custom-session header.
- Event edit creates an event_change notification, fetched with the synthetic
  leader's token. This verifies DB creation and API delivery, NOT device push.
- The FK contention test holds an actual auth_login transaction open on one
  PostgreSQL connection. Another connection inserts a session with a 500ms lock
  timeout before the first rolls back; it succeeds. This is not a mocked lock.
- Fixture event/comments/notifications, users/sessions/login logs/attempt rows
  are cleaned up. Background audit records can remain.
- Browser: applied the demo update, submitted five failures using a nonexistent
  synthetic ID (no existing account locked), and observed the persistent hint.
  Changing the ID hid it; the existing demo volunteer then logged in normally
  and remained logged in after reload. No existing PIN was changed.
- Screenshots: `scratch/demo-login-retry-hint-20261109.png` and
  `scratch/demo-login-followup-success-20261109.png` (local verification artifacts).
- Demo frontend deployment: `dpl_BdNJAATRMfHSwUWG9fKEA8xF2uL9`, READY and aliased
  to `https://chinese-territory-app-demo.vercel.app`. The CLI production target
  here belongs to the DEMO Vercel project, not the production application.

## Backup / rollback

`scripts/loginSecurityDemo.mjs apply-followup --confirm-demo` accepts only the
registered demo DB and requires 0075 already installed. It refuses repeat
installation. A fresh checked public/private dump and prior function/policies
are stored in:
`backups/login-security-demo-2026-11-09T10-23-51.933Z/`.

That directory's rollback.sql restores the PRE-FOLLOWUP login definition and
removes only the reset trigger/function, while retaining 0075's failure guard
and authenticated directory. Apply rollback only explicitly, in a transaction.
The private attempt table is retained. Reverting the frontend only removes the
hint, not server enforcement. Production needs its own backup and review.

## Scope notes

- Legacy name login is allowed only when that account's login_id is NULL, not
  for every member whose name is known.
- The review's multi-account risk estimate assumes known IDs, all numeric
  four-digit PINs and a particular guessing strategy; it is not an observed
  compromise rate. Slow attacks remain a real limitation of short PINs.
- No daily lock, IP throttling, stronger-PIN mandate, chat removal or production
  switch changes are included. Authenticated directory field minimization and
  anonymous access to other data remain separate audit items.
