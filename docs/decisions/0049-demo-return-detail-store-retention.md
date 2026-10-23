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

## Independent Review Packet (2026-10-23)

### Exact scope

- Implementation: `bab74e1`; live demo evidence: `19a584a`.
- Review the current implementation at `f40358f`, not just the original diff:
  `c017528` subsequently made the shared calendar gate production-capable but
  explicitly kept this return-detail branch demo-only.
- Production main was checked at `4ee7aee`. Home event direct detail is already
  deployed there; this return-detail retention is not included. Do not review
  or merge the entire demo branch as one production change.
- This packet changes documentation only. No new deployment, feature flag,
  database change or production write is requested by this review preparation.

```sh
git show bab74e1 -- src
git show 19a584a -- docs/decisions/0049-demo-return-detail-store-retention.md
git show c017528 -- src/hooks/calendarReadScope.ts src/hooks/calendarReadScope.test.ts
```

### Requested checks

1. Read `src/App.tsx`'s keyed AppSession together with
   `src/lib/recipientStore.ts`. List/detail/list must keep the same account
   and recipient-mode key. Explicit recipient-store false must still win;
   leaders, administrators and developers must retain their current behavior.
2. Read `src/hooks/calendarReadScope.ts` together with
   `src/utils/returnVisitDetailPath.ts`. A valid user detail route must retain
   the list's service scope. Invalid IDs, unsupported routes and event/chat
   links must not silently narrow full consumers. Production calendar opt-in
   must not by itself enable this pending demo feature.
3. Verify linked buildings still come from the existing
   `get_recipient_return_visit_card_ids` resolver, including return-visit cards
   absent from ordinary event assignments. Check resolver failure/reassignment
   behavior in `recipientStore.test.ts`; the resolver itself is unchanged.
4. Check detail consumers in `MobileRegularVisitDetail.tsx` and
   `useReturnVisitLogDetails.ts`: save/memo updates must invalidate target logs,
   map navigation and address fallback must remain intact, and delayed reads
   must not cross records/accounts. These consumers are unchanged by this
   feature; their tests are evidence for compatibility, not new behavior.
5. Treat production activation as a separate follow-up: both demo-only gates
   need coordinated production opt-in tests and a rollback plan. Do not merely
   remove one demo condition or assume the current calendar flag is sufficient.

### Evidence and limits

- Re-run at `f40358f`: focused five-file suite **229 passed**; full demo suite
  **1,844 tests / 207 files passed**. This is a demo-branch count, not the
  production count and not all tests are specific to this change.
- Lint and TypeScript/Vite build also passed in this preparation.
- The round-trip regression uses the real useStore with a mocked recipient
  reader and App's keyed-session pattern. It is not a mounted full-App browser
  test. It asserts one mount and no additional snapshot-table reads.
- The component save test checks the target ID, returned memo and refresh;
  live save/edit/reopen/list verification is the earlier `19a584a` evidence.
- Linked-building map navigation and address fallback have component tests.
  A live linked-building detail flow, another user's direct link, and physical
  iPhone/Android tests have not been established by this packet.
- No new live browser or network measurement was performed for this packet.
  The earlier transferred-byte observations have differing background traffic;
  do not turn them into a precise saving percentage or monthly GB estimate.
- Earlier mutation checks are recorded above; they were not rerun for this
  documentation-only preparation.

```sh
npx vitest run src/lib/recipientStore.test.ts src/hooks/calendarReadScope.test.ts src/hooks/useStore.recipient.test.tsx src/components/MobileRegularVisitDetail.test.tsx src/hooks/useReturnVisitLogDetails.test.tsx
npm test
npm run lint
npm run build
```

Requested review outcome: approve the demo implementation or identify blocking
issues, explicitly separating implementation correctness from production gate
readiness and the live coverage gaps above.
