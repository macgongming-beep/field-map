# Separate the directory, own profile, and event leader contacts

- Status: demo verified; external review requested; NOT applied to production.
- Date: 2026-11-10
- Scope: ordinary user / leader directory reads, own profile, calendar call links.
- Follow-up to 0081 private visit reads. Does not change units, comments, chat, or notifications.

## Decision

Ordinary directory consumers need names, roles, groups and selection eligibility, not everyone's
phone number or login ID. A client projection alone is not an authorization boundary.

1. `get_user_directory()` requires a valid session and returns a fixed safe projection:
   id, name, role, approval_status, is_active, group_name, cart approval fields and created_at.
   No phone, login_id, PIN or last_login_at. Existing developer-account hiding is retained.
2. `app_users_self_admin_read` is a restrictive SELECT policy, ANDed with existing policies.
   A user/leader reads only their own row. Admin/developer can read the full directory and keep
   existing management writes. Existing column grants (including PIN exclusion) are unchanged.
3. `get_event_leader_contacts(event_id)` requires a valid session, matches the **server event's**
   comma-separated leaders and returns only active approved leaders' id/name/phone. It does not
   accept arbitrary user IDs. Mobile and desktop event detail request it on opening, with an
   explicit loading/retry state. No private-directory fallback on error.
4. Own profile reads still target self; login now loads self's phone after storing the session
   token, because auth_login does not return phone. Profile name uniqueness precheck uses the
   safe directory instead of a now-hidden other user's app_users row. Actual writes and rename
   propagation RPC remain unchanged.
5. Directory responses are guarded by account/role/token and read generation. Contact responses
   are guarded by event/leader set/token and effect lifetime. Old responses cannot cross accounts.

## Deliberate permission boundary

Event phone access is available to all logged-in roles who can browse the calendar, not only
applicants. A user can request another existing event's current leaders. This preserves the
existing ability to call a leader before applying; it is not a promise that all leader numbers
are secret from other members. It removes the **all-user phone/login directory**, not permitted
event contacts. Missing events return no contacts; revoked/expired/inactive sessions fail closed.

Directory metadata remains visible to members, including selection/approval/group fields, as
existing selectors need it. Name conflicts involving hidden developer aliases still rely on
the existing database uniqueness enforcement. No new row-ownership limit is imposed on events.

## Compatibility audit

- Demo app_users is not published to Realtime; enforcement aborts if that changes.
- Five dependent write policies (participant insert/delete, restaurant request insert/update,
  comment insert) refer only to the caller's own app_users row or admin helpers.
- `get_recipient_return_visit_card_ids` needs only the caller; live RPC smoke passes.
- `user_ids_in_name_list` is an invoker helper: direct member calls now see only self. It is not
  a frontend consumer. Notification triggers call it under their existing definer context;
  actual leader comment notification was preserved in the demo smoke.
- `filter_notification_recipients` has no ordinary client execution grant; notification owners
  keep their server access. No notification trigger or recipient filter was modified.
- Repository definer audit executed: both added functions are read-only and marked as having
  authorization checks. Fixed empty search_path, qualified tables and PUBLIC execute revoked.

## Switch and rollout (important)

`(VITE_PRIVATE_USER_READS_ENABLED ?? VITE_DEMO_MODE) === 'true'` selects the new frontend readers.
Unset production stays old; explicit false overrides demo. Admin/developer management remains
the old full table reader regardless of the switch.

There are **two SQL phases**, not an automatically safe one-shot rollout:

1. Back up public/private and install `20261110_1400_private_user_directory.sql` (additive RPCs).
2. Deploy the enabled client, verify phone links, self profile and management, and get old PWAs
   updated before enforcement. Login-token presence alone does NOT prove a new client version.
3. Back up again and apply `20261110_1500_private_user_rows.sql` with `psql --single-transaction`.
   Recheck active user/leader/admin clients and dependent writes.

**Do not apply phase 3 to production before review and an explicit old-PWA transition decision.**
An old member/leader app asks app_users for the whole directory; after enforcement it silently
gets only self, affecting selectors and leader calls. This is why the phase split is explicit.
Fresh installations run both migrations and must build with the new reader enabled.

Turning the frontend switch off after enforcement does NOT restore legacy directory behavior.
Preferred recovery keeps the privacy policy and repairs the new client/RPC. Emergency rollback
would drop only `app_users_self_admin_read`, restoring all logged-in users' access to private
columns; that is a privacy regression requiring explicit approval. Existing login-required
policies must stay. Backup-generated rollback files are local/private, not committed.

## Verification

- PGlite executes both actual SQL files against session helpers and permissive legacy policies:
  anonymous/malformed/unknown/inactive/expired/revoked rejection, four-role visibility, self
  UPDATE RETURNING, admin create/edit/delete, directory projection, exact event contact scope.
- useAuth integration: users/leaders never request a full private directory; self phone and
  login ID remain; nickname duplicate checks; own profile saves; admin/developer identity and
  PIN management; error has no private fallback; logout discards delayed responses.
- Hook/UI: independent true/false/unset/demo gates, changed event/account discards old contacts,
  failure/retry, mobile and desktop `tel:` links with no phones in participantUsers.
- Full suite: 2,343 tests / 236 files; lint and build pass (existing Vite PWA deprecation warning).
- Mutation verification: permissive policy instead of restrictive fails 7 tests; removing RPC
  session checks fails 3; removing event-ID restriction fails 1; bypassing the safe-directory
  branch fails the user and leader integration tests (plus no-fallback check).

### Real demo DB / UI

`scripts/privateUserReadsDemo.mjs` rejects non-demo project URLs, credentials and non-session
pooler connections. It backs up before each SQL phase, verifies dump readability and unchanged
user-row digest/write policies. Smoke uses disposable four-role accounts and exact cleanup.

- Backup directories (gitignored):
  `backups/private-user-reads-demo-apply-rpcs-1794319522516`
  `backups/private-user-reads-demo-apply-policy-1794319606881`
- API smoke: **33 checks**, all passed. Includes self edit, admin identity/group/PIN changes,
  login with changed credentials, application/cancel, comment insert, leader notification,
  return-card RPC and four-role reads. The initial runner used `comments.event_id` incorrectly;
  corrected to the actual target_type/target_id contract and reran successfully. No app bug
  or permission relaxation was involved.
- Browser: new PWA applied. Disposable leader changed synthetic phone, reloaded, value persisted.
  Disposable member opened its event and saw `tel:01000000009`, matching the saved phone.
  No real call was placed. Admin changed a disposable member's nickname and saw it in the list,
  with the private login ID preserved. These were mobile-layout in-app browser checks; physical
  phone dialer behavior and a live desktop viewport were not exercised (desktop covered by test).
- Screenshots under scratch: `demo-private-profile-saved.png`, `demo-private-leader-call.png`,
  `demo-private-admin-user-saved.png`. Fixtures are removed after verification.

Run locally:

```sh
npx vitest run src/lib/privateUserReads.sql.test.ts src/hooks/useAuth.privateDirectory.test.tsx src/hooks/useEventLeaderContacts.test.tsx src/components/EventLeaderContacts.test.tsx
PRIVATE_USER_READ_MUTATION=rows npx vitest run src/lib/privateUserReads.sql.test.ts
PRIVATE_USER_READ_MUTATION=session npx vitest run src/lib/privateUserReads.sql.test.ts
PRIVATE_USER_READ_MUTATION=leaders npx vitest run src/lib/privateUserReads.sql.test.ts
DEMO_ENV_FILE=/secure/path/.env.test.local node scripts/privateUserReadsDemo.mjs smoke --confirm-demo
```

## Review focus

Check the additive/enforcement rollout boundary; self/admin RLS composition; header-based session
validation in both definers; exact server event leader lookup; no directory fallback; nickname
precheck after row restriction; late-response isolation; and notification helper execution context.
Production, general hidden comment notification reads and units.memo/comments privacy remain
separate work. No production credentials or project were used for this task.
