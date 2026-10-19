# Session-only post-save refresh

- Status: demo only; production activation not approved
- Date: 2026-10-19
- Related: 0012, 0020

## Reason

startServiceSession and endServiceSession write service_sessions and service logs,
but their injected refetchVisits also downloads all retained visit histories.
Those histories do not change as a result of starting or ending a session.

## Decision

Add a serviceSessions-only slice sharing the existing session query, transforms,
pagination and personal-recipient filter with the visits slice. Only demo session
mutations use it. Production session mutations retain the combined visits read.
ALL_SLICES remains unchanged: first load, manual refresh and foreground recovery
keep their existing contracts. No DB, role, statistics or realtime policy change.

The new slice never replaces or prunes visit histories. A session read failure
throws without replacing existing sessions with an empty array; the successful
write is not repeated. Session writes and service logging remain unchanged.

## Verification

Store integration tests exercise start and end, preserve history identity, check
the updated session status/end time, and read more than 1,000 rows. Recipient
users retain personal filtering while developer sessions remain global. Failed
session-only reads preserve both snapshots and reject. Production retains its
combined refresh. Inverting the demo gate fails four regression cases.
Full verification: 1,308 tests / 179 files passed; lint and build passed.

No billing saving is inferred from a query removed. Physical two-device testing,
live demo save verification and production activation remain separate steps.

## Demo deployment

Source 4cf9956 deployed to demo project only, deployment
dpl_9zt8KhJ9oDVeL1Tug5o53mMvPx8u (READY), alias
https://chinese-territory-app-demo.vercel.app. Remote build passed.
Production main was not updated. No live session records were created in this
verification; start/end behavior was exercised by the automated store tests.

## Reachability correction and demo alignment (2026-10-19)

Demo redeployed from 56c0a7f, deployment dpl_DrGM617a4GoQAvs2gJmt8wNUfFKF
(READY), including production's multi-month participation and language controls.
Live demo UI verification confirmed both months and Chinese report switching.
Session refresh remains demo-gated; production behavior was not activated.

The earlier request to manually press start/end on a phone was incorrect for the
current UI. DesktopHome accepts but does not use either callback; DesktopMyService
and MobileTerritory retain unused end callbacks after removing the end button.
DesktopApp's start wrapper is only passed to DesktopHome. MobileHome forwards end
to MobileTerritory. No reachable current start/end control was found. Automatic
session closure remains the separate auto_close_stale_sessions path.

Re-ran useStore.recipient.test.tsx: 38 passed, covering demo start/end status and
end-time refresh, history preservation, role filtering, failed reads and unchanged
production behavior. These are mocked store integration tests, not live DB writes
or physical-phone tests. No session records were created or ended in this check.
Do not count this unreachable manual-save path toward observed egress savings or
ask the user to find removed controls. Investigate reachable read paths next.
