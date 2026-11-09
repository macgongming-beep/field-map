# Production login security activation

- Date: 2026-11-09 (Asia/Seoul)
- Status: production database and frontend deployed and verified.
- User authorized production after approval of c7e77d2 and 8d5d8d6.
- Production code: 1cff3ca + b7387c4 on main, based on a6a9c18.
- No chat changes, daily lock or self-service unlock extension.

## Application

The live four-argument auth_login definition and app_users policies were read
before application. No two-argument overload or login guard was installed.
The production-only runner validates DB username, API URL, pooler port and an
explicit project confirmation. Applying requires the inspected function MD5,
expected installation state, a checked backup and psql --single-transaction.
The demo-only runner remains unchanged and still refuses production targets.

1800 and 1900 were applied in that order, each in its own transaction, with
separate public/private custom dumps (including privileges) and rollback SQL:

- `backups/login-security-production-2026-11-09T10-43-33.416Z/`
- `backups/login-security-production-2026-11-09T10-44-27.558Z/`

Final server definition MD5: `0812da6b3215e44af4155b1ca30d1d2d`.
Both the login guard and admin PIN-reset unlock trigger are installed.

## Verification

- Production branch: 2,238 tests in 226 files, lint and build passed. The demo
  branch has additional unrelated tests, so its total is intentionally different.
- 28 live checks passed with random disposable credentials/accounts, using
  actual REST/RPC requests and PostgreSQL connections.
- Normal user, leader, admin and developer login; fifth-failure lock; 12
  concurrent wrong attempts; correct PIN denied during lock; no deadline
  extension; successful login after expiry; existing session retained.
- Actual admin PIN PATCH resets the lock atomically and permits immediate login.
- Two DB connections confirm session FK inserts do not wait on the login lock.
- Application/cancellation, comment creation, recipient return-visit scope RPC,
  event-change notification creation and leader retrieval all succeeded.
- Notification delivery uses the app's `get_my_notifications` RPC. The first
  smoke used direct notifications SELECT and correctly received 401 because
  production is RPC-only. No permissions were changed to accommodate the test;
  the runner was corrected and the full smoke rerun successfully.
- Pending-signup transitions were NOT exercised in production: their trigger
  notifies real administrators. Demo and SQL tests cover that response instead.
- Notification recipients were only synthetic accounts attached to the test
  event. No device-push delivery claim is made.
- No intentional wrong-password attempt targeted an existing user. No existing
  user's PIN/session was changed or removed. Fixture users/events, comments,
  notifications, sessions, login logs and guard rows were cleaned up. Final
  inspection found zero synthetic users/events; background audit entries may
  remain.
- Guard table and unlock trigger function deny anon privileges; no old
  two-argument login overload remains; function uses FOR NO KEY UPDATE.
- Local report: `scratch/login-security-production-results.json`.

## Deployment / rollback

The frontend release is built from a git archive of b7387c4, not the demo
checkout or its local environment. Vercel target is explicitly production
project `chinese-territory-app` / `prj_cdo2L78J2YEEaBgxMMnNDfA5BDZs`.
No environment flags are changed. Old apps use server enforcement immediately;
the persistent failure hint appears after applying the app update.

Deployment `dpl_D2z8NdxeAUbhavpMpSbBukWaY2QS` is READY and aliased to
`https://chinese-territory-app.vercel.app`. Direct HTTP reads of that alias
confirmed `index-CXTx2Aiv.js`, `Login-CDUuvS9J.js` and `i18n-5ZA8sh6_.js`,
including the hint property, component wiring and Korean 15-minute guidance.
This was deployed-bundle verification, not a production browser login test;
the UI flow was already exercised in demo and actual production RPCs above.

Rollback is not automatic. To remove only 1900, use its backup rollback.sql in
a transaction; 1800 enforcement remains. A complete explicit rollback must
first remove 1900, then use the 1800 backup rollback.sql. It would restore the
old public directory policy and unthrottled login, so it is a security regression
and must not be performed casually. Frontend rollback alone only removes the
advisory hint. Private attempt rows can remain without being exposed.

15-minute lock only remains the user-approved policy. Slow guessing and
deliberate lockout are not fully solved; stronger authentication and further
rate controls remain separate decisions.
