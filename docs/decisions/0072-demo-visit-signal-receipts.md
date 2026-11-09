# Demo post-write / realtime signal receipts

- Status: demo verification; production remains unchanged
- Date: 2026-11-09
- Related: 0058 history coverage, 0059 building queue, 0061 gates, 0071 fanout audit

## Decision

Reuse an applied building snapshot only for the exact committed territory signal
it is proven to cover. Never ignore notifications for a fixed interval or by
assuming that a recent signal must belong to the current user.

`VITE_VISIT_SIGNAL_DEDUP_ENABLED=true` is an explicit opt-in, with no implicit
demo default. It requires the existing visit queue, scoped history recovery,
scoped histories, and the actual volunteer recipient mode. Admin, leader and
developer paths remain unchanged. Territory realtime must be enabled for the
optimization to be useful. No DB schema, RLS or mutation payload is changed.

## Ordering contract

1. A forced post-write refresh always enters the existing building queue. It
   cannot join a pre-write read and consider the write refreshed.
2. Before the three data reads, fetch only that batch's signal rows, validating
   building/card IDs, revision, timestamp and uniqueness. Signal rows committed
   after this proof cannot be credited to the snapshot.
3. Publish receipts keyed by card/building and exact revision/timestamp only
   after the data has successfully applied and `canApply` still holds.
4. Realtime callers wait for overlapping pending writes. They skip only matching
   receipts; a different revision, missing proof or uncovered building is read.
5. A signal-only read already has committed evidence before the read begins;
   it does not make an additional proof GET. This avoids adding a request to
   every receiving device. Evidence is captured before, never after, reading.
6. Full/scope reads and lifecycle resets discard receipts with the existing
   queue reset. Late/reset/superseded/failed reads cannot create receipts.

The existing 30-minute history repair, pending-work accounting, cancellation
freshness guard, foreground recovery and manual full refresh remain intact.
Proof failure follows the existing post-write repair path. Realtime failures
keep the existing bounded retry behavior; they are not acknowledged as success.

## Cost and limits

Each forced queued batch adds a small signal-proof GET. A successfully suppressed
self notification avoids three data GETs, for a net reduction of two. Signal
timing matters: an older or newer unmatched revision is conservatively read,
so a reduction on every save is NOT promised. Other clients still read changes.

This does not narrow building metadata edits, combine the two visit writes,
replace the existing recovery reader with the queue, or bound the existing
queue's repeated deferrals. Those remain separate work. No monthly savings or
Supabase billed-egress claim follows from the small demo dataset.

## Tests

- Store-level save and cancel invoke proof before data, wait for application,
  skip the exact self signal, and apply another person's newer revision.
- Forced cancellation supersedes an old response without publishing it.
- Partial batches, different parent cards, reset during a pending read, proof
  errors and data errors do not suppress necessary reads.
- Realtime wiring passes complete signal rows and acknowledges only success.
- Waiting work still blocks history skipping, with dedup both enabled and off.
- Flag default/off, queue/recovery dependencies and excluded roles are covered.
- Deliberate mutations: compare only building key (3 tests fail), move proof
  after data (2 fail), allow receipt publication after reset (1 fails), bypass
  realtime signal callback (2 fail). All mutations restored.

## Live verification protocol

`scripts/measureMutationFanoutDemo.mjs` uses three independent application-hook
clients against the allowlisted real demo DB and WebSockets. Two use the same
volunteer account; the administrator is a different actor. Initial/auth/setup/
cleanup reads are excluded; proof reads and all action reads/writes are counted.

Baseline: `--confirm-demo --map-scope --visits-only --slow --single-repeat`.
New path: add `--signal-dedup --overlap`. Each uses normal responses and 750ms
added delay per read response. Overlap holds a unit response while the other
account edits/restores the building, then releases it and verifies all clients.

This is not a physical-phone or browser UI test. Decoded bytes are not wire or
billing bytes. A disconnected first attempt is retained locally as interrupted
evidence and excluded from like-for-like comparisons; reconnection recovery
must not be mislabeled as per-save overhead. Test content is removed;
audit/session history may remain.

### Completed comparison

One repetition per condition, same four actions on all three clients: volunteer
save/cancel and administrator save/cancel (external changes to volunteers).
Requests below include the extra proof GET, and exclude writes/logging RPCs.

| Read requests | Before, normal | After, normal | Before, +750ms/read | After, +750ms/read |
| --- | ---: | ---: | ---: | ---: |
| Volunteer save, actor | 7 | 5 | 10 | 8 |
| Volunteer cancellation, actor | 6 | 4 | 6 | 4 |
| Volunteer save, each observer | 3 | 3 | 6 | 6 |
| Cancellation, each observer | 3 | 3 | 3 | 3 |
| Four actions, all three clients | 50 | 46 | 68 | 64 |

Writes remain 10 per condition (four actions). Thus total HTTP/read-RPC/logging
requests across the matched eight actions are 138 -> 130, not a 30% whole-app
reduction. Decoded read bodies: normal 9,892 -> 8,854 bytes; delayed 14,656 ->
13,618 bytes. Wire headers/compression and monthly egress are NOT inferred.

Four additional overlap actions held a real unit response while the distinct
administrator edited/restored the building. Save and cancellation remained
correct on all three clients in both delay conditions. These deliberately
concurrent writes do cause extra reads (actor 11 save / 7 cancel); they are not
mistakenly suppressed as self changes. No before/after savings claim for these
four actions, because the baseline did not contain them.

The checker passed 20 total baseline/new actions, 60 snapshots, 382 requests,
324 reads and zero unscoped data reads or captured errors in completed runs.
The interrupted run had CHANNEL_ERROR/recovery traffic and a later initial
loading timeout; it is not discarded as evidence of network behavior. It also
illustrates that delayed/mismatched notifications can cost the proof request
without eliminating a data bundle. No universal per-save reduction is claimed.

Outputs: `scratch/mutation-fanout-visits-map-results.json`,
`scratch/mutation-fanout-dedup-visits-map-results.json`, and the excluded
`scratch/mutation-fanout-dedup-interrupted-results.json` (local, not committed).
Full suite: 2,231 tests / 225 files passed. Lint and build passed; final demo
deployment verification is recorded separately below.

## Rollback / production boundary

Only the demo project is enabled. Set the flag false and rebuild/redeploy, then
apply the PWA update to restore the previous queue. Existing history recovery
and the queue themselves remain enabled. Production needs separate approval.
