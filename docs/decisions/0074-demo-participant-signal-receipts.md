# Demo self-application participant signal receipts

- Date: 2026-11-09
- Status: live demo data verification passed; demo deployment pending; production unchanged
- Related: 0055 participant realtime, 0056 application refresh, 0071 fanout audit

## Scope

Reduce the writer's duplicate membership read after an ordinary application or
cancellation. Keep the write RPCs, post-cancellation assignment-safety probe,
team cancellation, application-kind switching and broad recovery unchanged.
No database schema, RLS or trigger changes. No production data or settings change.

## Proof, not a time-based suppression window

The required post-write participant read optionally includes participant row IDs.
Only after the response passes the existing lifecycle, cache epoch, read version
and scope checks and is applied to the visible snapshot may it create a receipt:

- INSERT: the snapshot contains the exact participant ID, authenticated user and
  ordinary-application role. The signal must also match that event/user/role.
- DELETE: an earlier successful own post-write read observed that user's ordinary
  application ID, and the new applied snapshot no longer contains the ID. A
  primary-key-only DELETE can then match this explicit missing-row proof.
- UPDATE, foreign IDs/users/events, incomplete INSERTs, unknown DELETE IDs and
  changed roles are never skipped. Unknown DELETE retains the loaded-events
  membership refresh, not a guessed event ID.

This relies on the database's normal unique participant ID allocation; manual
identity reuse is not a supported mutation path. Receipts expire after two
minutes, never renew on a signal, and require matching account, scope, epoch
and read version. Full reads in progress cannot reuse them. Identity changes and
unmount reset all evidence; at most 100 event snapshots are retained in memory.

Check the receipt on signal arrival and again at the existing debounce flush.
The second check allows a successful post-write read to cover a signal that
arrived before the read completed. Other signals still invalidate caches and
refresh; broad assignment signals always take precedence. A failed/discarded
read cannot create a receipt. Existing invalidation retries stay in place.

## Deliberate limits

A cold cancellation with no earlier observed participant ID still performs the
duplicate fallback read. Do not add another pre-write query just to avoid it.
Other clients continue receiving membership updates. Their unknown DELETEs may
still refresh participants for all loaded events. Parent-bearing deletion
signals and building-metadata deduplication remain separate work.

## Gate and rollback

`(VITE_CALENDAR_PARTICIPANT_DEDUP_ENABLED ?? VITE_DEMO_MODE) === 'true'` additionally
requires application refresh and calendar navigation reuse. Explicit false
disables in demo; unset stays off in production. It applies to ordinary self
applications for every role, not administrator membership editing. Setting only
this flag false and rebuilding/redeploying restores the previous membership
projection/refresh; team recovery and all other flags remain unchanged.

## Automated verification

- Full suite: 2,256 tests / 226 files passed; lint and build passed.
- Store-level apply then cancel creates receipts only when enabled. Cancellation
  still probes the authoritative assignment state first. Shared/failed probes
  trigger calendar, assignments, visit histories and session recovery.
- Invalidated delayed reads retry and include another person's membership;
  failed reads cannot acknowledge signals. Unmount clears receipts.
- Hook checks cover signals before/after the post-write read, another user's
  unknown DELETE and broad assignment precedence. App wiring is separately tested.
- Removing the exact participant-ID comparison causes both a receipt unit test
  and the real store apply/cancel test to fail. Mutation was restored.

## Live demo verification

Use `scripts/measureMutationFanoutDemo.mjs --confirm-demo --map-scope
--applications-only --slow --single-repeat --overlap`, then repeat with
`--participant-dedup`. Credentials enter via stdin; demo host is allowlisted.

Three independent hook/DOM/client instances connect to the real demo database
and WebSockets: writer volunteer, second connection of that volunteer, and a
distinct administrator. Test ordinary application/cancellation by both accounts,
then hold a writer's old membership response while the administrator joins or
cancels before releasing it. Repeat normally and with 750 ms injected read
response delay. Verify all clients' exact applicant lists after each operation.

These are real DB/realtime tests of application state, not three physical phones,
browser rendering, packet loss, billed egress or monthly savings. All generated
fixtures must be removed; no existing user event or membership is edited.

Completed baseline and enabled runs: 12 scenarios / 36 client snapshots each,
including four held-response overlap scenarios. All 72 snapshots agreed with
expected membership; zero captured hook/HTTP errors. Fixture cleanup passed in
both runs. Across these action windows all reads were membership-only or the
required post-cancellation assignment probe; no buildings, cards, sessions,
boundaries, complete event bodies or visit histories were fetched.

| Writer action | Before GETs | After GETs |
| --- | ---: | ---: |
| Ordinary apply, normal | 2 | 1 |
| Ordinary cancel, normal | 3 | 2 |
| Ordinary apply, +750 ms response delay | 3 | 2 |
| Ordinary cancel, +750 ms response delay | 3 | 2 |

Both the volunteer and administrator writing their own applications showed the
same counts. Non-writing clients retained one membership read per action.
Cancellation still includes its assignment probe. Slow apply still retries an
invalidated response; this change does not suppress that safety read.

- Eight ordinary scenarios, three clients: 46 -> 38 requests including writes
  (38 -> 30 reads; eight writes unchanged).
- Including held-response overlap: 80 -> 73 requests (64 -> 57 reads; 16 writes
  unchanged). Decoded read bodies: 21,586 -> 17,254 bytes, not wire/billed bytes.
- Normal overlapped cancellation used one MORE writer read (3 -> 4); delayed
  overlapped cancellation stayed at four. Another person's invalidation can
  still discard a read and prevent receipt reuse. Do not claim every action wins.
- Unique fixture events/buildings were deleted and fixture sessions checked
  inactive. Test action/audit history may remain; this is not an audit purge.

Local reports: `scratch/mutation-fanout-applications-map-results.json` and
`scratch/mutation-fanout-participant-dedup-applications-map-results.json`.
Team cancellation is covered by mutation/store regression tests, not by these
unassigned live fixtures. Physical-phone and deployed UI tests are not claimed.
