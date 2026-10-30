# Demo: skip redundant scoped history reads after verified recovery

- Status: code approved in external review; demo trial, production unchanged
- Date: 2026-10-30
- Related: 0053 scoped visit histories; recipientRecovery and territory change signals

## Problem

Recipient foreground recovery already reads changed buildings, their units and
their active annual histories. It then rereads histories for every loaded unit.
Removing that second read without tracking completeness would lose the existing
repair mechanism for missed signals and discarded concurrent responses.

## Contract

- Demo only, and only where scoped histories already apply (actual user role and
  recipient reader). `VITE_SCOPED_HISTORY_RECOVERY_ENABLED=false` disables the trial.
  An explicit true cannot enable production. Admin/leader/developer and statistics
  retain their existing read paths.
- A complete baseline requires a successful, fully paginated scoped history read
  matching the current building/card/unit scope and invalidation generation.
- Reuse only on existing foreground/realtime recovery, unchanged assignment scope,
  a previously complete baseline, no pending history/building sync and successful
  changed-building recovery. Initial, manual and changed-scope reads remain full
  **within the permitted scope**, not all congregation histories.
- Discarded building responses throw even when the caller did not request strict
  freshness. A concurrent full-building read also rejects the delta. Recovery must
  not acknowledge signals whose data was not applied.
- Failed history reads or syncs, full-building reads, disabled/unmounted stores and
  scope mismatch prevent reuse. A successful authoritative delta can update the
  scope of an already complete snapshot, but cannot promote incomplete data.
- A history response superseded by a successful save does not invalidate a prior
  complete snapshot by itself. A failed competing sync invalidates separately.
- Reuse never extends the deadline: at the next recovery **30 minutes after the
  last successful full read's start**, read the whole scoped history again. Clock
  reversal also prevents reuse. This is not a timer that polls in the background.
- On reuse, locally remove histories outside the existing 365-day `created_at`
  query contract. NULL timestamps remain excluded, matching full/delta SQL.
- Service sessions still refresh. Statistics remain full and paginated.

## Signal limits and risk

Signals are row-update timestamps, not transaction-commit timestamps. The existing
30-second overlap can miss a long transaction that commits later; trigger-bypassing
maintenance can also miss signals. The 30-minute reread limits persistence at the
next recovery, but does **not** guarantee immediate correctness for these cases.
Manual refresh remains a repair path. This trial adds no DB schema, trigger, RLS,
subscription or persistent-device-cache changes.

## Verification

Regression tests cover initial incompleteness, unchanged scope, manual refresh,
30-minute deadline without renewal, failed safety read, backwards clock, local
annual expiry, failed history load after changed units, successful-save supersession,
overlapping sync with failed replacement, cancellation/new units/building deletion,
and unchanged admin/leader/developer paths. Existing save/cancel race tests remain.

Full suite: 2,034 tests / 220 files passed; lint and production-mode build passed.
Mutation checks, restored before the final suite:

| Removed guard | Regression result |
| --- | --- |
| 30-minute deadline | 2 tests failed |
| Strict discarded-building rejection | 1 test failed |
| Local annual expiry | 1 test failed |
| Failed-sync completeness invalidation | 1 test failed |

Live demo command (credentials in a private environment file, never command args):

```sh
DEMO_ENV_FILE=/path/to/private-demo.env node scripts/measureHistoryRecoveryDemo.mjs --confirm-demo
```

The harness allows only `itjlykpjmlcvanqpmkmc.supabase.co`, creates a temporary unit
and assigned event, uses actual useStore mutations against the real demo DB, and
cleans its fixtures in finally. It compares admin statistics history IDs against
the DB, and verifies the original active history IDs are unchanged after cleanup.

Measured 2026-10-30, identical demo scope, flag off/on:

| Recovery | Flag off | Flag on | Scoped history requests |
| --- | ---: | ---: | --- |
| Stable second recovery | 17 requests | 16 requests | 1 -> 0 |
| After own save/cancel | 20 requests | 19 requests | 1 -> 0 |
| After other account save/cancel | 20 requests | 19 requests | 1 -> 0 |

The first recovery also reads the newly created fixture's signal; that changed-
building history read intentionally remains. Own and other-account save/cancel
both updated the hook state correctly. Manual refresh still fetched scoped
histories. Admin statistics matched all 3 active demo histories with either flag.
The original active histories were restored. Follow-up verification found that
the original unit DELETE had affected zero rows under the deletion policy; the
first harness did not verify the unit's absence. The leftover temporary unit was
later removed through `delete_place_or_request_tx` and its deletion request via
`execute_place_deletion_request_tx`, after checking the marker and all linked
histories. The harness now checks fixture identity, absence of unrelated linked
data, deletion results, and actual unit/event absence. A successful HTTP response
alone is no longer treated as successful cleanup.

These are **live API + application-hook state checks under JSDOM**, not screenshots
or two physical phones. Browser control timed out. Counts exclude unrelated app
hooks, assets, map tiles and push. Recorded body bytes are decompressed, not billed
egress; do not extrapolate monthly savings or compare them with production gzip.

## Follow-up: own-write realtime contention measurement

External review approved the safety contract but requested measuring reuse during
actual self-write realtime updates, rather than only isolated hook mutations.
No application behavior or production gate changes are made for this measurement.

```sh
DEMO_ENV_FILE=/path/to/private-demo.env node scripts/measureHistoryRecoveryDemo.mjs --confirm-demo --realtime
```

This mode mounts the actual `useTerritoryRealtime` hook beneath the store's
`TerritoryRealtimeContext` on a visible map. It requires a real SUBSCRIBED channel
and verifies that each save/cancel produces a real change signal. Four save/cancel
pairs run for each flag state at each latency profile: normal network and an
additional 250ms before delivering each GET response to the client. There are 32
eligible recovery samples in total. A logging wrapper observes coverage calls
without changing their decisions.

After each mutation and a three-second wait, it calls `refetchAll(true)`, the
existing eligible foreground path. It deliberately bypasses the visibility
listener's two-minute cooldown, so cooldown skips cannot inflate the reuse ratio.
The realtime subscription stays connected: this is not a physical phone
background/reconnect simulation. GET response delay is synthetic, not a measured
mobile RTT. The script compares each fixture's active history IDs in app state
against DB IDs after recovery, and counts the entire write/wait/recovery cycle's
history GETs as well as the foreground-only reads. The complete-cycle count also
includes save's existing-record lookup.

Results (2026-10-30; 4 saves + 4 cancels in each row):

| Added GET delay | Trial | Foreground skips | Foreground requests | Whole-cycle history GETs | Realtime superseded failures |
| --- | --- | ---: | ---: | ---: | ---: |
| 0ms | off | 0/8 | 240 | 28 | 0 |
| 0ms | on | 8/8 | 232 | 20 | 0 |
| 250ms | off | 0/8 | 240 | 30 | 0 |
| 250ms | on | 8/8 | 232 | 36 | 8 |

Every sample received its own real write signal and the active record IDs matched
DB after recovery. The final temporary unit and event were verified absent;
original active history IDs were unchanged. Build and lint passed. Application
source and the 2,034 previously approved tests were not changed in this follow-up.

**Decision: do not add the production gate yet.** The review concern is confirmed
in a different form: foreground skip rate stays high, but strict overlap handling
causes save-time fallback reads first. Those full scoped reads restore completeness,
so a later foreground skip masks their cost. On the delayed profile the total
history GET count rises from 30 to 36, despite all eight foreground reads being
skipped. This measures requests, not the relative byte sizes or billed egress of
each query, and does not establish a production-wide regression percentage.

Next investigate coordination between post-save and own realtime building reads.
Do not weaken strict freshness to improve the ratio. Any reuse of a newer sync's
success must prove that it refreshed **every required building** after the write;
newer failures, partial batches, scope changes, deletion and cancellation races
must still invalidate coverage or reread. Repeat this whole-cycle measurement
after such a change, not just the foreground-only counter. Physical mobile
background/reconnect verification remains outstanding.

## Rollback and rollout

Demo rollback: set `VITE_SCOPED_HISTORY_RECOVERY_ENABLED=false`, rebuild/redeploy,
then apply the PWA update. Production requires a separate reviewed gate change;
this commit must not be used as authorization to enable production.

Before production: review the completeness/strict-sync contract, verify actual
mobile UI save/cancel and foreground recovery, then measure same-scenario request
counts and transferred bytes. Full annual reads outside recipient mode are a
separate issue; this trial does not remove them.
