# Demo login attempt guard and authenticated user directory

- Status: demo applied; awaiting independent review. Production NOT changed.
- Date: 2026-11-09
- Scope: `auth_login` server enforcement and `app_users` SELECT session gate.
- Chat and the approved participant-dedup production switch are unchanged.

## Why

The checked-in and demo login RPC verified bcrypt passwords but did not count
failures. Demo inspection found one four-argument `auth_login` overload and an
`app_users_select_all` policy with `USING (true)`. Existing column grants include
login IDs; removing write access did not remove anonymous directory access.
This change does not claim to independently reproduce the reported 72-user
production enumeration. No production security probe or failed login was run.

## Contract

1. Five wrong passwords within a fixed 15-minute window lock that account for
   15 minutes from the fifth failure. Correct passwords are also rejected while
   locked. Requests during a lock do not extend it. Successful authentication
   resets the counter. An expired lock/window starts a fresh counter.
2. State is keyed by canonical account ID, not caller-selected spelling. Trimmed
   IDs and the existing name fallback share account state. Login ID takes
   precedence over another account's legacy name in an ambiguous match.
3. `SELECT ... FOR UPDATE` serializes attempts on the account row. Time is read
   with `clock_timestamp()` after obtaining the lock, not transaction-start time.
   Failed authentication returns normally so the counter write is committed.
   Raising an exception here would roll back the guard.
4. Unknown ID, wrong password and locked account all return the same successful
   HTTP response containing `[]`, which the existing client displays as the same
   credentials error. Unknown IDs perform a dummy bcrypt check and do not create
   state rows. This is not a claim of constant-time execution under every load.
5. Correct-password pending/blocked accounts keep their previous UI response,
   without a token. Existing valid sessions are not revoked by login lockout.
   Deactivated, pending and expired sessions cannot read the directory.
6. Both two-argument legacy calls and four-argument clients use the guarded RPC;
   the old two-argument overload is removed. The apply tool refuses unexpected
   overloads. No password verification fallback bypass is added.
7. The private guard table has RLS and no public/anon/authenticated privileges.
   Its row count is bounded by existing accounts and account deletion cascades.
8. `app_users` SELECT requires the existing custom session helper. A restrictive
   policy also prevents other permissive SELECT policies from reopening access.
   Existing column grants and write policies remain unchanged. Logged-in users
   keep the existing directory (including assignment/mention UI); this is NOT a
   role-based directory redesign. No direct `app_users` realtime consumer was
   found; custom HTTP session headers are not available on realtime connections.

## Implementation

- `supabase/migrations/20261109_1800_login_attempt_guard.sql`
- `src/lib/loginAttemptGuard.sql.test.ts`: actual SQL + pgcrypto in PGlite.
- `src/hooks/useAuth.loginGuard.test.tsx`: real hook with mocked transport.
- `scripts/loginSecurityDemo.mjs`: fixed demo allowlist, inspect/apply/smoke.

No frontend behavior change or Vite feature flag is needed for enforcement.
The deployed demo frontend was tested against the migrated demo DB without a
new frontend deployment. Old clients receive the same login response shape.

## Verification

### Automated

- Full suite: 2,275 tests / 228 files passed; lint and build passed.
- 11 SQL tests: valid login, legacy RPC call, roles, failure threshold, lock
  duration/non-extension, reset, expiry, null/unknown credentials, pending and
  inactive accounts, directory RLS, private-table/hash permissions, and reapply.
- 8 hook cases: remember-me on/off, failure without fallback retries or session
  storage, approval UI, and verified session restoration before directory reads.
- Mutation runs alter only the SQL string in the isolated test database:
  - `LOGIN_GUARD_MUTATION=lock`: removing lock check fails 5 tests.
  - `LOGIN_GUARD_MUTATION=count`: removing failure increment fails 7 tests.
  - `LOGIN_GUARD_MUTATION=read`: removing both read guards fails 3 tests.
- PGlite uses a single serialized connection; it is NOT concurrency evidence.

### Actual demo server

Run with the explicit demo env file, never `.env.local` or `supabase --linked`:

```sh
DEMO_ENV_FILE=/path/to/demo.env node scripts/loginSecurityDemo.mjs inspect --confirm-demo
DEMO_ENV_FILE=/path/to/demo.env node scripts/loginSecurityDemo.mjs apply --confirm-demo
DEMO_ENV_FILE=/path/to/demo.env node scripts/loginSecurityDemo.mjs smoke --confirm-demo
```

The tool accepts only `itjlykpjmlcvanqpmkmc`, its HTTPS API and its session pooler
username on port 5432. Passwords go through process environment, not command
arguments. Apply takes a public/private schema+data dump, validates its archive
listing, captures previous function/policies and applies with
`psql --single-transaction` / `ON_ERROR_STOP=1`.

Backup: `backups/login-security-demo-2026-11-09T10-07-43.149Z/before.dump`.
Exact previous function/policy rollback: sibling `rollback.sql` (ignored by git).

20 live smoke checks passed, including user/leader/admin/developer login and
directory access. Smoke uses a random, synthetic account and random password, never deliberate
failures against the shared demo or production accounts. Actual concurrent HTTP
requests (12 wrong passwords) were all rejected, with exactly five failures and
a fixed lock deadline. Correct password and two-argument calls were denied
during the lock. Expiry was simulated by updating ONLY the fixture's deadline;
this is not a wall-clock 15-minute waiting test. Existing session verification
and directory access continued during the lock. Unknown IDs returned identical
bodies. Synthetic account, login logs, sessions and guard state were removed.
Generated audit entries may remain. Report: `scratch/login-security-demo-results.json`.

In-app browser: demo volunteer logout -> normal login -> settings showed the
correct role -> browser reload -> the same logged-in screen. Screenshot:
`scratch/demo-login-security-20261109.png`. No physical iPhone verification.
The existing pending app-update banner was not part of this database change.

## Rollback and production gate

- No production changes made. Review the SQL migration and these results first.
- This is DB enforcement, not a client switch: turning off a Vite flag cannot
  undo it and an app update is not required to enforce it.
- For demo emergency rollback, run the captured `rollback.sql` via the same
  allowlisted DB connection and `psql --single-transaction`. It restores the old
  RPC and read policies without deleting account/session data. The private guard
  table is retained; reapply does not reset locks. Rollback reopens the old
  weaknesses and needs explicit approval; it was not executed on the live demo.
- Production needs its OWN fresh backup, overload/policy/ACL review, existing
  session coverage check, guarded migration and smoke plan. Do not reuse demo
  backup contents in production. Code merge alone does not apply the migration.

## Remaining security limitations

- Account lockout can be abused to deny new logins to a known account. Fixed
  deadlines and preserving existing sessions mitigate disruption but do not
  eliminate it. There is no trusted per-IP/edge rate limiter in this change;
  do not trust caller-supplied forwarding headers as an IP identity.
- A four-digit PIN remains weak against slow or distributed attacks. Stronger
  administrator credentials/MFA and edge throttling remain follow-up work.
- `signup_tx` still reports duplicate IDs/names; hiding the directory does not
  remove every possible account-existence side channel. Registration abuse,
  authenticated directory field minimization, and unrelated RPC/read policies
  require separate review. This is not a complete application security audit.
- Wrong/null credentials and locked attempts do not produce login success logs.
  No raw attempted passwords or extra persistent IP/device records are stored.
