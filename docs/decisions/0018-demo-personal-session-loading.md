# 0018: Personal settings continuity and demo session reads

Date: 2026-10-15
Status: Production enabled on 2026-10-15 (rollout details below)

## Problem

AppSession is keyed by authenticated user ID and recipient/full store mode.
Personal settings routes previously switched a recipient to a full store, then
back on return, causing two new store loads. Separately, recipient views received
every service session although their consumers select the current visitor.

## Changes

- Keep the recipient mode on an explicit list of mobile and desktop personal
  settings routes. Do not enable arbitrary settings descendants or statistics.
- In demo only, filter service_sessions by user_name for an actual user with a
  recipient reader and recipientUser. Apply the filter to every page and every
  visits-slice read, including foreground and post-mutation refreshes.
- Keep all dates and statuses for that user. Do not cap results at 1,000 rows.
- Full-store routes (including /stats), admins, and production session reads
  remain global. Existing AppSession remounts isolate partial and full stores.
- Keep global visit histories and calendar reads unchanged. Volunteers can
  browse and join events they have not attended, so filtering calendar by
  participation would break functionality.

This is read-volume optimization, not a new authorization boundary. Existing
server permissions and the application's name-based session identity stay intact.

## Validation and limits

- Tests assert server-side equality filters on initial/recovery/mutation reads,
  preserve 1,001 older personal sessions, and exclude another person's session.
- Tests preserve global production/full-store sessions and global histories.
- Settings route tests cover mobile/desktop, disabled flags, actual roles, and
  unsupported data-dependent pages.
- No database/schema/policy changes. No monthly byte reduction is claimed.
- Phone testing of start/end session and statistics navigation remains required
  before production. Calendar range loading is separate future work.

## Production opt-in

`VITE_PERSONAL_SESSIONS_ENABLED` explicitly controls the session optimization.
Unset falls back to `VITE_DEMO_MODE`; explicit `false` disables it even in demo.
Only the exact value `true` enables it. The actual `user` role, recipient reader,
and nonempty recipient user name are still required. Full/statistics stores and
admin/developer/leader roles retain global reads even when the flag is enabled.

This is a Vite build-time flag, not a live runtime switch. Changing it requires
a rebuild/redeployment; clients must receive the new bundle. A prior deployment
can also be restored. No production environment or deployment was changed when
adding this opt-in. The earlier demo-only description refers to the first patch.

## Production rollout: 2026-10-15

- User explicitly approved production deployment. Remote main was still
  7f26883; fast-forwarded it to reviewed e0a49c8 (including 4a934aa).
- First deployed with PERSONAL_SESSIONS unset:
  dpl_HuNkrpKhE1DRaDDptjCpjoYYhSET, READY. The served sessions query remained
  unfiltered; existing admin login loaded home and settings successfully.
- Added VITE_PERSONAL_SESSIONS_ENABLED=true to production project
  chinese-territory-app only, then rebuilt that deployment.
- Final deployment dpl_7em4uxF73fcE6u8gr11jkwBC6sm7 was READY and serving
  https://chinese-territory-app.vercel.app by 21:01:56 KST.
- Served TerritoryReportView-C8UaY7av.js includes user-role, reader and name
  guards followed by eq(user_name, name). The prior bundle had no filter.
- No DB, schema, policy or application records were edited for this release.
  Pre-release validation: 1,274 tests, lint and build passed. Actual volunteer
  phone validation was on demo, not repeated with production record writes.
- PWA users need to accept the update. Compare complete daily egress windows
  after rollout, not cumulative totals across the 10/17 billing reset. No
  measured saving or free-tier guarantee is claimed.
- Rollback: restore the first deployment above to disable personal-session
  filtering while retaining settings continuity, or set the flag false and
  rebuild. Already-open clients still need to load that replacement bundle.
