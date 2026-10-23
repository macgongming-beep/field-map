# Return-visit detail navigation retains the recipient snapshot

- Status: demo verification; production unchanged
- Date: 2026-10-23

## Problem

`/territory` opts into the recipient store, but `/territory/regular/:id`
previously fell back to the full store. App's account/mode key therefore
remounted AppSession on both legs. Independently, the detail route selected
the full calendar scope. Fixing only one of these still causes broad reads.

## Decision

In demo only, a real `user` on a positive safe-integer return-detail route
keeps the recipient store and the same personal service calendar as the list.
Administrator, developer and leader behavior is unchanged. Invalid/unknown
routes retain the old fallback. Explicit recipient-store false still wins.
Ordinary map navigation remains full; this does not change map permissions.

The detail screen consumes return visits, target log details and a linked
building for map navigation, not the complete calendar. Existing recipient
scope resolution includes assigned/created return-visit cards through
`get_recipient_return_visit_card_ids`, including legacy address resolution.
Do not replace that RPC with only scheduled assignment cards.

This is not a new persistent cache. It retains the existing in-memory store.
Target log details are still fetched on opening, and snapshot changes after
saving still invalidate them. Account changes, foreground recovery, realtime,
manual refresh and all mutation refresh callbacks remain unchanged.

## Verification

- 1,805 tests across 205 files; lint and build pass.
- Real useStore + App's keyed-session pattern: list/detail/list/detail/list
  mounts once and issues no additional snapshot table reads.
- Removing the recipient detail opt-in fails the keyed-store test.
- Removing the calendar detail scope fails the same test with calendar,
  assignment, region and card reads.
- Detail component tests preserve title/address, target memo refresh after
  save, linked-card map navigation, unlinked-address map fallback, and missing
  record behavior. Existing hook tests cover retry/account isolation.

## Live Verification

Demo deployment verified: code `bab74e1`, deployment
`dpl_5vWXfYF5WiVLBnpWA3kh8Nbv18ib`, canonical demo URL updated. Test-only return visit 23 was created
as `DEMO 왕복 조회 시험 1023` for the demo volunteer; no production writes.
Before this patch, both navigation legs showed the global loading screen.
DevTools REST filter showed 78,465 transferred bytes across the observed
round-trip window. Its 134 displayed rows include service-worker client and
network entries plus background activity, so they are NOT 134 server calls.
This is a demo observation, not a monthly saving or billing attribution.

After applying the PWA update, opening the same detail read only its log
history (874 transferred bytes; two DevTools rows represent the client and
service-worker network legs of one request). Returning to the list did NOT
read cards, buildings, boundaries, global histories or complete calendars.
The round-trip observation contained 7,101 REST transferred bytes, including
header notifications/chat metadata and personal application-list queries.
Those independent queries remain; this is not a zero-request navigation claim.
The before/after observation windows differ in background activity and cannot
be used as a precise saving percentage. Native DevTools AX records were saved
locally under `/tmp/rv-{before,after}-{detail,roundtrip}-ax.txt`.

Live demo: saved an absent result and test memo, saw the history and list's
last-visit date update, reopened the detail, edited only the memo, and reloaded
the detail URL. The new memo and result remained present throughout. Linked
card-map and address fallback were verified by component tests, NOT live
linked-building UI tests: the demo fixture deliberately has no building.
Screenshots: `scratch/demo-return-detail-saved-bab74e1.png` and
`scratch/demo-return-detail-edited-bab74e1.png` (local evidence, not repository assets).
Cleanup completed through the normal UI: invalidated the test log (history
retained), ended only test return visit 23 with no place issue, and verified
the volunteer list returned to zero return visits. No buildings were changed.

## Production Gate

Do not enable this in production merely by merging a demo gate. Review the
production calendar-window and recipient-store gates together before opt-in.
Direct links to other users' records are not a new permission grant; server
policies remain authoritative. Live tests must not be described as proving
all cross-user deep-link or linked-building scenarios.
