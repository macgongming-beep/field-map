# Restaurant request failure recovery (demo)

2026-10-19. No database, permissions, or production changes.

- Pending approval/rejection handlers catch unexpected transport failures and always release their processing state. Edited fields remain available; unknown outcomes ask the user to refresh, rather than automatically replaying a write.
- Request memo mutation returns false for write errors or zero affected rows. MobileTerritory keeps the active restaurant session and draft on false or an exception, and releases the saving state for retry.
- A confirmed write followed by refresh failure is reported as committed but stale. Memo returns true in that case, so the completed session closes normally.
- This does not add durable memo drafts across reload/logout or change the separate existing-building visit callback contract.

Verification: 1,404 tests / 184 files, lint and build passed. Nine new cases cover memo false/throw/retry, approval/rejection exceptions and retained edits, zero affected rows, and committed-write refresh failures. Removing the memo false guard and button unlocks makes three UI cases fail; restored before full verification.

Deployment scope: branch and demo only. Demo code b592a65 deployed READY as dpl_HamHLKDBDuyrvDDPdhr7iYmv2oPg; production remains e9224b1.

Live demo: created disposable DEMO-1019-FAILURE, saved its request memo as the volunteer, and confirmed the exact memo in the administrator review card. Rejected the test request; pending card disappeared and restaurant count remained four. Restored the volunteer account. The attempted DevTools offline selection did not take effect (remained no throttling), so this was a normal-save smoke test, NOT live transport-failure validation. Failure/retry coverage is the rendered-component and mutation tests above. Screenshot: scratch/demo-restaurant-failure-b592a65.png.

## Follow-up: live offline retry verification

2026-10-19, same deployed demo code. Chrome DevTools Network Offline was confirmed selected and kept open while submitting requests. The memo PATCH, rejection PATCH, and approval RPC actually failed with `net::ERR_INTERNET_DISCONNECTED`; these were not mocked responses. This tests disconnection before submission, not an ambiguous server commit followed by loss of its response.

- Request 10 (`DEMO-OFFLINE-1019`): offline memo save retained the exact draft and active session, and re-enabled Save. After restoring No throttling, retry succeeded and the administrator review card displayed the exact saved memo. Offline rejection also retained the request and unlocked its buttons; online retry removed it from pending review.
- Request 11 (`DEMO-OFFLINE-REJECT-1019`): offline rejection and approval both retained the request/edited fields and unlocked both buttons. Online approval retry succeeded and restaurant count increased from four to five.
- Cleanup: removed the disposable approved restaurant through the demo UI. A separate stale-list issue was observed: after place deletion the row remained under its address, and after list removal it remained until page reload. Reload confirmed the original four restaurants and no test restaurant in the catalog. This separate cleanup refresh behavior needs investigation before claiming all restaurant actions refresh immediately.
- Network restored to No throttling and DevTools closed. No production deployment or source-code changes in this follow-up.

Evidence: `scratch/demo-offline-memo-retained.png`, `scratch/demo-offline-reject-recovered.png`, `scratch/demo-offline-approve-recovered.png`, and `scratch/demo-offline-approve-retry.png`. Existing 1,404-test result above belongs to the code verification; this docs-only follow-up does not claim a new full-suite run.
