# Demo leader service calendar and volunteer card audit

Date: 2026-10-23

## Changes and boundaries

Extend the demo personal service calendar selector to actual role `leader`,
only on `/map` and `/territory`. Production gates are not changed or deployed.
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

Live demo observations will be appended after deployment. Request counts and
small-demo bytes are not predictions of production billing savings.
