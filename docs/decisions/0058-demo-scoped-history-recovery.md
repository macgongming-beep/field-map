# Demo: skip redundant scoped history reads after verified recovery

- Status: demo trial; production unchanged, external review pending
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
Fixture cleanup passed.

These are **live API + application-hook state checks under JSDOM**, not screenshots
or two physical phones. Browser control timed out. Counts exclude unrelated app
hooks, assets, map tiles and push. Recorded body bytes are decompressed, not billed
egress; do not extrapolate monthly savings or compare them with production gzip.

## Rollback and rollout

Demo rollback: set `VITE_SCOPED_HISTORY_RECOVERY_ENABLED=false`, rebuild/redeploy,
then apply the PWA update. Production requires a separate reviewed gate change;
this commit must not be used as authorization to enable production.

Before production: review the completeness/strict-sync contract, verify actual
mobile UI save/cancel and foreground recovery, then measure same-scenario request
counts and transferred bytes. Full annual reads outside recipient mode are a
separate issue; this trial does not remove them.
