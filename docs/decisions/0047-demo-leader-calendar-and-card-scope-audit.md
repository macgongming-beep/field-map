# Demo leader service calendar and volunteer card audit

Date: 2026-10-23

## Changes and boundaries

Extend the demo personal service calendar selector to actual role `leader`,
on `/map`, `/territory`, and (follow-up) `/zone`. Production gates are not changed or deployed.
Administrators and developers keep full calendars on these routes. Calendar
month navigation, statistics, event/chat deep links and editors are unchanged.

Leaders keep their full card and building stores. This is not recipient-store
authorization and must not narrow leaders' access to other teams' territory.

The audited consumers are MobileTerritory (today, personal past/future card
assignments, explicit assignmentEvent), DesktopMyService (today), MobileHome
and DesktopApp (explicit assignmentMap), and MobileMap/unit details (restaurant
assignment dates, including other people's assignments). All today's meetings
are retained, including meetings led by this leader without a personal card
assignment. Older/future leader-only meetings were not displayed by these
service screens before this change; the calendar remains their entry point.

Discovery and hydration reuse the existing service reader: today's events,
all personal card assignment history, all restaurant assignment event IDs,
and an explicit route event. For selected events, ALL participants, teams,
assignments and multi-card links remain. Nothing is filtered to the leader
while hydrating a selected event. Date, account, explicit target and existing
cache invalidation rules are unchanged.

## Volunteer cards already implemented

`a811096` / decision 0042 already scopes volunteer card details in the demo
under VITE_RECIPIENT_CARD_SCOPE_ENABLED plus demo/actual-user/recipient gates.
Do not replace it with a simple assignedUsers filter: active sessions, shared
assignments, return visits, restaurants and empty cards are part of its union.
Other teams' missing card names are loaded on demand for the opened shared
event. The restaurant browser loads a lightweight complete directory. Ordinary
maps and statistics retain their full-store fallback. Leaders remain full-card.

## Automated verification

- 1,767 tests / 204 files passed; lint and build passed.
- Leader and volunteer readers preserve old/future personal assignments,
  other teams, multi-card links, restaurant dates and explicit old map targets.
- A leader without any personal card assignment retains today's led meeting,
  guest and another team's card assignment.
- Both service routes reuse their snapshot over two home round trips for both
  roles, without unbounded calendar table reads.
- Existing scoped-card tests retain empty cards, grant/revoke changes, progress,
  foreign-response rejection, legacy reads and other-team card-name hydration.

## Live demo verification

Code `fde08fc`, demo deployment `dpl_EF9PgHJUCeSr4sQ4o9kx1ERHdyNa`, canonical
alias https://chinese-territory-app-demo.vercel.app. Applied the PWA update.
Used the actual demo leader and volunteer accounts, not an administrator's
volunteer view. No production deployment, schema change or business-data write.

- Before: leader home-to-service made three unbounded snapshot reads
  (calendar_events, event_card_assignments, event_card_assignment_cards).
- After: leader event-body read was restricted to event ID 19. Warm
  home-to-service reentry inside two minutes made zero snapshot reads.
  Three separate header event-metadata reads still occurred. Native DevTools
  showed approximately 7.6 kB before versus 2.8 kB warm after for the filtered
  calendar-related group; this excludes unrelated traffic. ServiceWorker
  delivery rows are not counted as additional network requests.
- Leader past service stayed at one September meeting. September 13 still
  displayed the demo leader, demo volunteer and User2. Calendar remained
  accessible. The full territory directory retained nine cards and both
  regions; the general map displayed all 74 units.
- Volunteer cards used `id=in.(1)` for detailed card rows rather than an
  unfiltered card list. Opening September 30 10:00 still displayed six
  applicants and all three teams. Other-team card 28 was resolved through
  `select=id,name&id=in.(28)`, not a full card/building load.
- Shared progress, empty-card grants/revocations, far-future assignments and
  leader-without-own-card cases are automated fixtures, not newly created live
  fixtures in this run. General leader map was visually checked; a repeated
  map-home-map network sequence is covered by store tests, not a new live
  measurement. The live request comparison above is home-to-service only.

Evidence (local, not committed): `/tmp/demo-leader-before-20261023.txt`,
`/tmp/demo-leader-repeat-20261023.txt`,
`/tmp/demo-volunteer-card-scope-20261023.txt`,
`scratch/demo-leader-old-team-fde08fc.png`,
`scratch/demo-leader-map-fde08fc.png`,
`scratch/demo-volunteer-shared-teams-fde08fc.png`.

## Remaining boundaries

The first deployment left leader `/zone` on the full calendar. The follow-up
below removes that route promotion. Unassigned-card lookup remains a separate
tiny request. The volunteer card-detail feature still needs a reviewed
production opt-in before any production rollout.

Request counts and small-demo bytes are not predictions of production billing
savings. Both changes need production-gate integration and review before use
outside the demo.

## Leader zone follow-up and combined review

MobileHome `/zone` passes cards, buildings, boundaries, histories and resource
data to AdminMobileZone, but no calendar. Its assigned-card count and filters
use assignedLeaders/assignedLeader/assignedUsers on cards. DesktopApp `/zone`
passes those same complete stores to DesktopTerritory or DesktopMap; neither
consumes calendarEvents. AppHeader has independent event-metadata reads, which
this change does not suppress.

Only actual demo leaders with a known account name now reuse the same service
calendar key on `/zone`, `/zone?scope=all`, and `/zone?view=map`. This avoids a
full calendar read merely to pass through the zone before opening a map. Cards,
their leader/user assignments, progress, buildings, restaurant requests and
resource assignment tables are unchanged. No event is filtered by team during
hydration. Admin/developer/user zone paths, unknown identity, production, and
openChat/openEvent links retain their previous behavior.

First entry can still need the service reader's index and body requests. This
is not zero calendar loading at cold start. Warm home-zone-map-service trips
share the same two-minute snapshot. Mutation/realtime/foreground/manual
invalidation remains mandatory.

Automated verification: 1,770 tests / 204 files, lint and build passed. New tests
cover the zone role/gate/view matrix, other-team links and old/future events,
and the complete home-zone-map-service-home-zone-map store sequence (two scoped
reads total: home and service, zero unbounded calendar reads).

Review together: volunteer card scope `a811096` (contract 0042), leader service
calendar `fde08fc` / evidence `e695049`, and this zone follow-up. Focus on
unchanged leader card/building scope, all-team hydration, old assignment/map
targets, cache invalidation, and production gates. External review is pending;
this document is a handoff, not an external approval.

### Zone live results

Code `b13b881`, demo deployment `dpl_GhBe7y6Dbha2WFfU8rZpiYJbAT4g`, same demo
alias. Applied the PWA update while signed in as the actual demo leader.

- Before: home-to-zone issued three unbounded calendar/assignment/link requests,
  approximately 4.8 kB transferred in this small demo.
- After: cold zone load requested calendar bodies with `id=in.(19)` and
  assignment rows with `event_id=in.(19)`. It did not request all event bodies.
- After visiting home, warm home-to-zone issued zero requests matching the
  calendar/assignment filter (five unrelated requests still occurred).
- Continuing through all-territory to the general map issued no additional
  calendar/assignment requests. This live check closes the previous map-trip
  measurement gap, but does not claim that all network traffic disappeared.
- Directory still showed nine total cards, six personally assigned cards, both
  regions, and four restaurants. The checked card retained 6% progress and
  September 30 last-service date. Region totals remained 17% and 0%.
- General map retained 74 units (35 residential / 39 commercial).
- Past service still showed September 13 with demo leader, demo volunteer and
  User2. Opening September 30 in the calendar retained six applicants, all three
  teams and other-team card names. The leader's team-allocation control remained
  visible. No allocation or participant data was changed during verification.
- Desktop zone/map routing is covered by the selector test and code audit;
  live UI verification in this run used the 390px mobile viewport.

Local evidence: `/tmp/demo-zone-before-20261023.txt`,
`/tmp/demo-zone-card-before-20261023.txt`,
`/tmp/demo-zone-repeat-20261023.txt`, `/tmp/demo-zone-map-after-20261023.txt`,
`scratch/demo-zone-map-b13b881.png`,
`scratch/demo-zone-shared-teams-b13b881.png`.

For external review, compare `8867944..b13b881` for the combined leader route
change; review `a811096` separately for scoped volunteer cards. Decision 0042
contains that feature's authorization and directory contracts. Production main,
production Vercel configuration and database schema remain untouched.

### External review and remaining release gate

On 2026-10-23 the user relayed Claude's approval of `fde08fc` and `b13b881`.
The review confirmed unchanged leader card/building scope, all-team hydration
and the zone consumer audit. Scoped volunteer cards (`a811096`) were accepted
for behavior, but production activation was withheld because the gate still
required demo mode. Decision 0042 records the subsequent production opt-in
correction and its tests; that correction is awaiting external re-review.
This is not a production deployment record. Once the gate is approved, integrate
the leader routes with main's existing calendar-window flag and activate scoped
volunteer cards separately, retaining complete leader/admin/developer cards.
