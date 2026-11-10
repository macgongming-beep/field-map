# Production directory transition without row restrictions

- Date: 2026-11-10 (Asia/Seoul)
- Status: additive RPCs and enabled production client deployed; API and browser checks passed.
- User authorized the new RPCs and enabled app, explicitly NOT phase 1500.
- Approved source: e46ec15 and review follow-up 3b2d3c5; production equivalents c41bb03/fff4da7.

## Database scope and backups

Production runner `scripts/privateUserReadsProduction.mjs` validates the API project and
session-pooler target, requires explicit project confirmation, and has NO apply-policy mode.
It refuses to run if `app_users_self_admin_read` exists. All app_users policies are compared
inside the migration transaction and after it. Both applies used `psql --single-transaction`.

Private public/private custom dumps, checked with pg_restore --list, original function/policy
state and rollback SQL are under these gitignored directories in the production worktree,
with independent copies under the long-lived demo checkout's backups directory:

- `private-user-reads-production-additive-1794321269098` before original 1400.
- `private-user-reads-production-additive-1794321414051` before compatibility repair 1410.

1400 added only two RPCs. 1500 was not executed. Existing users still have their original
logged-in table access, so old clients remain compatible. **This rollout does not yet enforce
private directory access at the database boundary.** Anonymous access remains blocked.

## Deployment-blocking mismatch caught by live smoke

Production has no optional `cart_service_approved` or `cart_service_approved_at` columns.
The reviewed 1400 function referred to them directly, so its first live directory call failed
with 42703. The old app was unaffected; new-client deployment was held. Its production flag
was temporarily put back to false before any new build was published.

1410 replaces only get_user_directory, preserving its authentication, grants, definer context,
developer filtering and fixed safe result columns. The two optional values are read by fixed
JSON field names and cast to their original types. Missing columns produce null; installed
cart metadata is preserved. No private JSON object is returned, no table column/policy is added,
and no cart feature is enabled. The event-leader RPC is unchanged.

The PGlite test executes the actual migrations both with cart metadata and after dropping both
columns. All four roles retain safe-directory reads. Omitting 1410 makes this new test fail.
Full production-based suite after repair: **2,298 tests / 233 files**; lint and build passed.

Initial apply user digest was unchanged. During the repair, a before/after whole-row digest
changed. Read-only comparison against the dump identified only last_login_at on one existing
row; no existing identity/contact/PIN fields changed. Four additional rows at that comparison
were the smoke's disposable users. Do not claim a global unchanged digest across live logins.

## Actual production API checks

35 live checks passed after repair, with four disposable random-credential accounts:

- Safe directory for user/leader/admin/developer contains no phone, login ID, PIN or login time.
- Existing full table reads remain available to all four roles until phase 1500.
- Only the chosen event's actual leader phone is returned, including after own-profile edit.
- Missing/malformed/unknown sessions rejected; nonexistent event has no contacts.
- Self phone update, denial of someone else's edit, admin login ID/group/PIN changes and login
  with the new test credentials succeed. Developer management retains private identity fields.
- Application, cancellation, comment write, leader comment notification and recipient return
  card RPC succeed. No existing user's credentials or preferences were changed.
- All synthetic fixtures removed; app_users policies identical and phase 1500 still absent.

Local report: `scratch/private-user-reads-production-results.json`, excluded from Git.

The repository's definer audit was run against production. Both added functions are reported
as read-only with authorization checks. Post-cleanup inspection still shows exactly the same
five app_users policies, the two RPCs present and no app_users_self_admin_read policy.

## Deployed client and actual browser verification

Production flag VITE_PRIVATE_USER_READS_ENABLED=true was set before main 40dce17 was pushed.
Git deployment `dpl_5ozvBscPFCWk2Uss6rJmhdnyRaeD` is READY and the canonical
`https://chinese-territory-app.vercel.app` alias points to it.

Direct reads of the canonical alias confirmed index-BTheMCKh.js, the directory chunk
useCardDirectory-9J6yf1qi.js and contact code in MeetingSettings-SmWXEItE.js. The actual
compiled private-reader gate defaults to true; member/leader reads call get_user_directory,
while admin/developer keep the management reader. The contact hook calls
get_event_leader_contacts. The normal non-cart calendar projection remains in the artifact.

On the canonical production URL, applied the PWA update in the in-app browser, then verified:

- Existing administrator opened user management and changed only the disposable user's
  nickname. Success message and updated nickname appeared; its login ID remained visible.
- Disposable leader logged in, opened My Profile, changed synthetic phone 01000000000 to
  01000000009, saw success, then reloaded and confirmed the saved phone remained.
- Disposable member logged in and saw the updated nickname, opened the synthetic event from
  Home and received the link `tel:01000000009` for that event's leader. No call was placed.
- Test login signed out; four disposable users, their sessions/logs and the event were removed.
  The pre-existing Chrome login was not touched. The in-app browser's production login is now
  signed out after account switching; it was not restored using stored credentials.

Screenshots in scratch (not Git): production-private-admin-saved.png,
production-private-profile-saved.png and production-private-leader-call.png.
These are real production mobile-layout browser checks, not a physical phone dialer test.
Desktop call links are covered by component tests, not a separate live desktop run.
Temporary deployment URLs required Vercel login, so verification used the canonical public
alias rather than weakening deployment protection.

## Enforcement hold and rollback

Keep VITE_CART_APPLICATIONS_ENABLED unset/false. Before phase 1500, follow 0083's old-client
transition evidence gate (excluding legitimate admin/developer and self-profile table reads).
Inactive old PWAs are not proven updated by a zero-request day. Require separate user approval.

While 1500 is absent, VITE_PRIVATE_USER_READS_ENABLED=false plus redeployment restores the old
frontend reader without relaxing any DB policy. Additive RPCs can remain installed. Do not
apply or roll back unrelated visit/privacy policies. Current rollback need not delete data.
