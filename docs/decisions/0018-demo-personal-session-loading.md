# 0018: Personal settings continuity and demo session reads

Date: 2026-10-15
Status: Demo validation; no production rollout

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

## Production opt-in (not activated)

`VITE_PERSONAL_SESSIONS_ENABLED` explicitly controls the session optimization.
Unset falls back to `VITE_DEMO_MODE`; explicit `false` disables it even in demo.
Only the exact value `true` enables it. The actual `user` role, recipient reader,
and nonempty recipient user name are still required. Full/statistics stores and
admin/developer/leader roles retain global reads even when the flag is enabled.

This is a Vite build-time flag, not a live runtime switch. Changing it requires
a rebuild/redeployment; clients must receive the new bundle. A prior deployment
can also be restored. No production environment or deployment was changed when
adding this opt-in. The earlier demo-only description refers to the first patch.
