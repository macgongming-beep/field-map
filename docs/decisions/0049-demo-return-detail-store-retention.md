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

Pending demo deployment verification. Test-only return visit 23 was created
as `DEMO 왕복 조회 시험 1023` for the demo volunteer; no production writes.
Before this patch, both navigation legs showed the global loading screen.
DevTools REST filter showed 78,465 transferred bytes across the observed
round-trip window. Its 134 displayed rows include service-worker client and
network entries plus background activity, so they are NOT 134 server calls.
This is a demo observation, not a monthly saving or billing attribution.

## Production Gate

Do not enable this in production merely by merging a demo gate. Review the
production calendar-window and recipient-store gates together before opt-in.
Direct links to other users' records are not a new permission grant; server
policies remain authoritative. Live tests must not be described as proving
all cross-user deep-link or linked-building scenarios.
