# Production personal service calendar

Date: 2026-10-23

## Release scope

Port approved demo code `ac5cf73` to production on top of `8e6812f`.
The bounded home/month windows and two-minute cache are already deployed;
do not reapply the demo branch wholesale.

App passes `calendarWindowEnabled()` and the authenticated user's actual role
and name to `calendarReadScope`. With `VITE_CALENDAR_WINDOW_ENABLED=true`,
only actual role `user` uses the personal service snapshot on map/service
routes. Admin, leader and developer retain the existing full-calendar path on
those routes. Admin's volunteer-view toggle does not change the actual role.

Preserve today's events, all past/future personally assigned events, an explicit
route target and restaurant assignment event dates. Hydrate all teams and
multi-card links for selected events. Existing independent recipient access
discovery remains separate from this partial visible calendar snapshot.

## Checks before release

- Production origin/main was `8e6812f` before integration.
- Vercel production project: `prj_cdo2L78J2YEEaBgxMMnNDfA5BDZs`,
  `chinese-territory-app` (not the demo project).
- Production environment readback: calendar window flag `true`; demo unset.
- Focused calendar tests: 69 passed. Full production suite: 1,696 tests across
  197 files passed. Lint and build passed.
- New production-mode store tests cover user versus leader/admin/developer
  paths, and flag-off restoration of full volunteer reads.
- No schema/data mutation, migration or permission change. Existing unrelated
  decision-document edits are excluded from this release.

## Rollback and client propagation

The existing calendar flag controls the entire calendar-window feature,
including this personal scope. Setting it to false and rebuilding restores full
reads; it also disables the earlier bounded windows. Alternatively revert this
release to keep the earlier windows. Both require a deployment and clients must
apply the PWA update. It is not an instantaneous server-side switch.

Verify the production alias's served JavaScript after deployment, including the
enabled default, actual-role gate and personal scope implementation. A compiled
artifact check does not establish that every installed PWA has updated or that
monthly billed egress has fallen. No production write smoke is needed here.
