# Restaurant request failure recovery (demo)

2026-10-19. No database, permissions, or production changes.

- Pending approval/rejection handlers catch unexpected transport failures and always release their processing state. Edited fields remain available; unknown outcomes ask the user to refresh, rather than automatically replaying a write.
- Request memo mutation returns false for write errors or zero affected rows. MobileTerritory keeps the active restaurant session and draft on false or an exception, and releases the saving state for retry.
- A confirmed write followed by refresh failure is reported as committed but stale. Memo returns true in that case, so the completed session closes normally.
- This does not add durable memo drafts across reload/logout or change the separate existing-building visit callback contract.

Verification: 1,404 tests / 184 files, lint and build passed. Nine new cases cover memo false/throw/retry, approval/rejection exceptions and retained edits, zero affected rows, and committed-write refresh failures. Removing the memo false guard and button unlocks makes three UI cases fail; restored before full verification.

Deployment scope: branch and demo only. Browser verification results will be recorded after deployment.
