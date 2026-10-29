# Participant signals must not rebuild recipient territory

- Date: 2026-10-30
- Status: demo deployed (`0cf324f`); production not activated
- Deployment: `dpl_3WFDaXGbuuCdZcTTnDsZodhKfhRK`, aliased to
  https://chinese-territory-app-demo.vercel.app
- Related: 0054 calendar navigation cache coverage

## Finding and boundary

The participant subscription introduced in `adf6d37` dispatched
`refetchSlices(['calendar'])`. In recipient mode that also resolves territory
membership and refreshes cards, boundaries and histories. A membership-only
notification therefore caused unrelated reads on receiving clients.

Restaurant assignment changes are NOT equivalent to participant list changes.
`readServiceCalendar` includes restaurant event IDs, including other people's
assignments. Newly assigned events can be absent from the current snapshot, and
territory authorization can change. Invalidating a cache and refreshing only an
already loaded event is insufficient for that case. Restaurant/card assignment
signals deliberately keep the existing broad recovery, coalesced by the same
two-second debounce. Their traffic remains a separate candidate and a production
rollout consideration; this change does not claim to eliminate all fan-out.

## Decision

- Invalidate navigation caches immediately when a relevant signal arrives.
- Debounce participant-only notifications separately. Preserve both old and new
  event IDs on an update. A mixed batch with a real assignment/calendar change
  uses broad recovery once instead of running both paths.
- For participants, intersect event IDs with the currently loaded calendar
  snapshot and read only `id,event_participants(user_name,role)` for those events.
  Keep dates, all teams, card assignments and territory state unchanged.
- An event outside the loaded snapshot causes no read, but invalidates cached
  months. "Loaded" is not viewport visibility: a home window can contain future
  events, so these may also receive a membership-only update.
- DELETE can omit event_id under replica identity/RLS. In that case refresh the
  participants of all currently loaded events, in bounded batches, not the
  complete calendar or territory. This is not a promise of zero reads for every
  invisible DELETE. No DB/publication/RLS change is required.
- Queue behind recipient operations and wait for existing calendar reads before
  patching. Scope, read-version and invalidation-epoch guards reject old responses.
  Retain dirty event IDs across overlapping signals so rejecting one reply does
  not lose another event's update. No cache lifetime is renewed.
- Query failure preserves previous data, exposes the calendar retry state and
  is caught by the App realtime caller. It does not silently replace members
  with an empty list or trigger a territory fallback. Real errors are explicitly
  recorded to Sentry; SupersededReadError is excluded.
- The existing navigation-reuse flag gates the additional subscriptions. No new
  production flag is enabled. Explicit false removes them after rebuild/update.

## Verification

- Full suite: 1,952 tests / 215 files passed. Lint and build passed.
- Recipient integration asserts exactly one calendar-membership read for known
  and unknown parent IDs, zero recipient refresh/unchangedScope calls, identical
  building/card/history objects, and correct applicants/assigned/guests.
- Tests cover participant debounce, old/new IDs, unknown DELETE, mixed broad
  batches, projection/foreign-row checks, and bounded query batches.
- Store tests cover a participant signal during a full read, a second signal
  during a pending participant read, off-snapshot events and future-month reuse.
- Added the requested pending-refresh navigation test. Removing
  `calendarRefreshesPending > 0` makes it fail (expected three reads, received
  two); restoring the guard passes.

### Real demo request comparison

`scripts/measureParticipantRealtimeDemo.mjs --confirm-demo` uses the actual
`useStore` and `useCalendarRealtime` under a React/JSDOM harness, two authenticated
demo clients and the real Supabase WebSocket. One admin client inserts/removes
its participation in a uniquely named temporary event; a volunteer observer
receives the notification. The baseline is source from `adf6d37`; the candidate
is the working code. The observer is prevented from writing application data,
including suppressing auto-close side effects. The script removes its event.

| Observer scenario | Join requests | Cancel requests |
| --- | ---: | ---: |
| Original, event loaded | 18 | 18 |
| Corrected, event loaded | 1 | 1 |
| Corrected, empty off-date snapshot | 0 | 0 |

The old 18 included calendar events (2), both card-assignment tables (2 each),
and one each of sessions, restaurant assignments, card assignments, return-card
RPC, territory clock/signals, buildings, boundaries, regions, histories, cards
and card-summary RPC. The corrected request reads only calendar participants.
Join and cancellation assertions verify the receiver's actual store contents.
The final clean-source run used temporary event 108. Cleanup completed and an
independent fixture-prefix query returned no remaining measurement events.

Limits: not two browser windows/physical phones, not browser Transferred or
Supabase billing. Static assets, chat, push, map requests and whole-App effects
are excluded. Counts are per measured scenario, not a monthly saving estimate.
An initial harness attempt failed because JSDOM's global Event conflicted with
Node WebSocket; native Event was retained and its temporary fixture removed
before rerunning successfully. No production DB writes or deployment occurred.
The harness also isolates each bundled observer module so later scenarios cannot
reuse an earlier scenario's closed client; an initial repeated run timed out on
subscription before this harness correction. The final full run passed.

## Next

Review this correction before enabling navigation reuse in production. A full
two-browser UI/network capture remains useful to include chat and App effects.
Treat restaurant reassignment as authorization/membership recovery, not as a
participant-display-only event, in any future narrowing.
