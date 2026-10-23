# Production recipient cards and leader calendars

Date: 2026-10-23

## Approved scope

Integrate the externally reviewed `a811096`, `0ec12b3`, `fde08fc` and `b13b881`
on production base `eed4c0f`. The user relayed final approval of the card flag
and requested this combined release. Historical demo evidence is retained in
decisions 0042 and 0047; their earlier pending-review statements describe that
earlier stage, not the current approval.

- `VITE_RECIPIENT_CARD_SCOPE_ENABLED=true`: actual users with a recipient reader
  fetch card details and summaries for the authoritative scope only. This is
  not merely their own team: shared/return-visit/restaurant/session/empty cards
  remain part of the existing scope. Other-team names and restaurant directories
  load on demand. Leaders/admins/developers and full stores retain full cards.
- Existing `VITE_CALENDAR_WINDOW_ENABLED=true`: leaders now share the service
  calendar on map, my-service and zone routes. Selected events still hydrate all
  teams, applicants and links, including old personal assignments and restaurant
  dates. Admin/developer routes retain their previous behavior.
- Preserve main's `calendarWindowEnabled` in App and store. Do not replace the
  production gate with the demo branch's `VITE_DEMO_MODE` condition.

No schema, permission or business-data writes. The production environment has
demo mode unset and recipient store/calendar windows already enabled. Existing
unrelated local edits in decisions 0039/0040/0041 are excluded.

## Verification before deployment

Production-integrated suite: 1,760 tests / 201 files passed; lint and build passed.
The production baseline has fewer tests than the demo branch; demo-only changes
outside this release were not imported. Production role/path matrices cover
user/leader/admin/developer on map, my-service and zone, flag-off restoration,
and leader home-zone-map-service cache reuse with other-team records retained.
Card tests cover modern/legacy filters, explicit false, role and reader guards,
empty cards, grants/revocations and matching summary IDs.

## Deployment and rollback

Stage a production-target build without promoting the live alias, then inspect
the actual built JavaScript before promotion. Verify both flag defaults and
role predicates on the artifact, and repeat against the canonical production
URL after promotion. This does not prove that installed PWAs have updated or
establish monthly billed savings.

Card rollback: set `VITE_RECIPIENT_CARD_SCOPE_ENABLED=false` and rebuild.
Calendar rollback: set `VITE_CALENDAR_WINDOW_ENABLED=false` and rebuild; this
also disables earlier home/month windows. Alternatively revert this release
to retain the earlier calendar optimizations. All options require users to
apply the PWA update; neither flag is an instantaneous server-side switch.
