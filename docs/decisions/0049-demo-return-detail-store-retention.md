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

## Production opt-in follow-up (2026-10-23)

Independent review approved the implementation, but required coordinated gates,
flag-combination tests, a live linked-building check, and explicit rollback.
This follow-up does not activate production.

- `returnDetailRetentionEnabled()` is the single predicate for both the
  recipient-store detail route and its calendar scope. It resolves
  `(VITE_RETURN_DETAIL_RETENTION_ENABLED ?? VITE_DEMO_MODE) === 'true'`.
- Existing recipient-store enablement and actual user role are still required.
  Leaders, administrators, developers, unsupported IDs and general maps retain
  their previous behavior. No RPC, policies or mutation callbacks changed.
- The calendar gate remains independent: retention on + calendar-window off
  retains the recipient store while reading the complete calendar. It does
  not enable calendar windows implicitly.
- Tests cover production opt-in, demo explicit false, defaults, role/global
  store precedence and malformed routes in both callers. Real-useStore keyed
  round trips cover demo fallback, production on/on and production on/off.
  The on/off case checks an unfiltered calendar read, one store mount and no
  further snapshot reads during the round trip.
- Focused suite: 240 passed. Full suite: 1,855 tests / 207 files passed.
- Lint and TypeScript/Vite build passed.
- Mutations: reverting the helper to demo-only fails six tests across both
  callers and real-useStore wiring; ignoring explicit false fails two caller
  tests. Both mutations restored before the full suite.

### Rollback and activation contract

Production activation requires a separate reviewed deployment with
`VITE_RETURN_DETAIL_RETENTION_ENABLED=true`. Leaving it unset in non-demo
production keeps the previous full-store detail behavior. Do not enable
`VITE_DEMO_MODE` in production to activate this feature.

Rollback: set `VITE_RETURN_DETAIL_RETENTION_ENABLED=false`, rebuild and redeploy.
After the user applies the PWA update, entering detail switches to the full
store and full calendar again; returning to the list can remount/refetch as
before. Other calendar and recipient optimizations stay enabled according to
their own flags. Existing running clients do not switch instantly.

The linked-building browser check is still required on the deployed follow-up;
record its exact fixture, observed route and cleanup separately below.

## Linked map regression discovered during live verification

On follow-up `60c615e`, the real demo volunteer opened return visit 24, linked
to building 79 / card 31 / unit label 104. The detail correctly had the
building, but its map button navigated to `/map?cardId=31`. MobileHome's normal
user map filters out cards without a current assignment, so the resulting
map displayed zero buildings. The old component test checked only the URL;
it did not render the map's parent scope calculation. This is a pre-existing
detail-map routing bug, not evidence that the recipient RPC omitted a building.

The list already uses `scope=regularVisits`, which resolves only the user's
target return visit and its unit. List and detail now share `returnVisitMapPath`
for this existing scope, linked-building focus and unlinked-address fallback.
No map access rule or recipient-store map opt-in is broadened. General maps
still use the full store. The routing fix is independent of retention flags,
so disabling retention restores full detail reads without reintroducing the
wrong map URL. It needs its own review alongside the flag follow-up.

Regression tests mount the real MobileHome and detail/list navigation with a
stubbed map renderer. They assert the exact card, building, focused building
and unit passed to that renderer, with no calendar/card/session assignment.
Both user and leader paths exclude an unrelated building and another person's
unit. Restoring the old detail card-map URL fails four tests (two navigation
tests plus two component route/fallback tests). Browser re-verification of
the deployed correction and test-only cleanup must be recorded below.

Separate observation: creating the fixture through the existing unit dialog
displayed a duplicate-registration error followed by success. The existing
dialog starts toggleRegularVisit without awaiting it, then calls
setRegularVisitor for the date, allowing two writes to race. The fixture was
present as return visit 24 after reload. This registration behavior was not
changed by the retention or map-route work and must not be reported as a
clean registration smoke; investigate separately.

## Linked-building live recheck completed (2026-10-23)

- Review commits: `60c615e` (coordinated production opt-in) and `d90e36c`
  (independent detail-map route correction). Production is unchanged; no flag
  was enabled there. Do not treat the earlier code approval as approval of
  this additional routing correction.
- Demo deployment: `dpl_8hvzTvYpY33tvQkFU2cx5R2E7hy2`, canonical
  `https://chinese-territory-app-demo.vercel.app`. Applied the normal PWA
  update and checked the actual document script changed from
  `index-BxhJRkYV.js` to `index-DhP72BqU.js`.
- Real demo volunteer, no service scheduled today: list showed test return
  visit 24 (`배분테스트 주택건물 4-1 104`, building 79 / card 31). Opened
  `/territory/regular/24`, then its Map button. Corrected destination:
  `/map?scope=regularVisits&returnVisitId=24&buildingId=79`.
- The rendered map showed one building and one unit, with the existing
  background map and card boundary. Opened 104's unit detail and confirmed
  its building, address, assigned demo volunteer and existing test memo.
  Other units in that building did not appear in this focused scope.
- Returned from the map to the same return detail. Then ended only return
  visit 24 using the normal end dialog with no place issue. No building/unit
  deletion or visit-history write was performed. The volunteer list showed
  zero active return visits immediately and after a full reload.
- Local screenshots (not repository assets):
  `scratch/demo-linked-map-before.png`,
  `scratch/demo-linked-map-fixed-d90e36c.png`,
  `scratch/demo-linked-map-cleaned-d90e36c.png`.
- Focused component suite: 30 passed. Full suite: **1,859 / 208 files**;
  lint and TypeScript/Vite build passed. The old-route mutation fails four
  tests; source restored before the full run and deployment.

Limits: Chrome mobile emulation, not a physical phone test. No new monthly
egress estimate or network-byte saving measurement. List/detail retention is
the optimization; entering the regular-visit map still switches to the
existing full-store map path and can show a loading state. This recheck proves
the linked fixture survives that transition, not zero-request map navigation.
