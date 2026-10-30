# Demo: coordinate post-visit and realtime building refreshes

- Status: demo deployed and live-hook measured; production unchanged; external review pending
- Date: 2026-10-30
- Related: 0058 scoped history recovery and its live realtime measurement

## Why

With 0058's strict overlap guards, a post-save read and its own realtime signal
can supersede each other. Under delayed communication this causes the existing
broad repair and realtime retry paths to run. Counting only foreground history
skips concealed that additional cost. Do not weaken completeness to improve a
skip ratio; measure the complete write, realtime settling and recovery cycle.

## Contract

- Only the demo scoped-history-recovery path uses the queue. The new
  `VITE_VISIT_REALTIME_QUEUE_ENABLED` defaults on in that path; explicit `false`
  restores uncoordinated reads. Production cannot enable it, even with `true`.
  Administrator, leader, developer and statistics paths remain unchanged.
- Only post-visit refreshes and the map realtime context use the queue. Other
  building mutations and foreground recovery keep their existing strict guards.
- Calls that have not started can merge IDs. A new caller never treats a read
  started before that call as its authoritative post-write result.
- If an overlapping caller arrives during an active read, check the queue before
  applying any building/history state. Do not publish that old response. Carry
  the WHOLE earlier batch (including non-overlapping IDs) into a new read with
  the pending calls. Resolve no caller until all required IDs have been applied.
- Read at most 20 buildings per batch. Partial failure rejects all merged callers;
  it does not acknowledge a successful subset as the whole request.
- Queued callers count as pending syncs, so foreground cannot reuse histories
  while a required refresh is waiting. Completion does not renew the 30-minute
  safety reread deadline or promote an incomplete baseline to complete.
- Full-building reads and store disposal reset pending work. Existing per-ID and
  full-snapshot generation guards still reject conflicts with other paths. Failed
  writes/reads retain their existing reporting and full repair behavior. Disposed
  stores do not start a new post-write repair.
- No new persistent cache, DB schema, RLS, trigger or subscription changes.

## Tradeoff

This is not a claim that every own-write realtime read disappears. An already
started read cannot safely stand in for a later committed write. A fresh trailing
read remains necessary; serializing it can add waiting time. The target is the
avoidable broad fallback/retry caused by colliding reads, not all followup reads.

Sustained overlapping edits can postpone completion until a fresh batch applies.
The existing realtime hook still batches signals and limits failed retries. Other
mutation/recovery paths are deliberately not folded into this queue.

## Tests

Full suite: 2,048 tests / 221 files passed. Lint and TypeScript/Vite build passed.

- Actual store save/cancel during an older realtime read, and the reverse order.
- Delayed fresh response: an old cancelled/pre-write history never appears even
  temporarily, not just at the end of the test.
- Queue retains non-overlapping IDs, waits for all chunks, reports failures,
  rejects pending/running work on reset and refuses invalid IDs.
- Failed queued save refresh uses the existing full scoped repair.
- Store disposal rejects work without a late full repair.
- Production true cannot enable; demo false disables; demo unset enables.
- Existing 0058 tests retain strict supersession, the 30-minute deadline, local
  annual expiry, manual repair, changed scopes and complete-baseline rules.

Mutation checks (restored before final validation): removing the pre-apply guard
fails both delayed save/cancel store tests. Acknowledging the older batch instead
of carrying it forward fails two queue tests.

## Review Follow-up: Queued Callers During Foreground

Added store-level save AND cancellation tests on 2026-10-31. Both establish a
complete history baseline, start an older realtime read, perform the actual
store mutation, then hold the microtask drain after the old batch has finished.
There is no active building read at this boundary, but the post-write refresh
is still queued and its caller must not resolve. Foreground recovery must query
the scoped histories and display the saved/cancelled result before that queue
is allowed to finish. Releasing the queue must preserve the same final result.

Mutation check: remove ONLY `syncVisitOrRealtime`'s pending-counter increment
and decrement, leaving `readChangedBuildings`'s active-read counter untouched.
Both tests fail because foreground makes zero history queries instead of one.
The mutation was restored; this follow-up changes tests/documentation only.
Final validation: 2,063 tests / 221 files passed; lint and TypeScript/Vite build
passed. No new deployment is needed for this test-only change.

Non-blocking review items remain separate: foreground recovery still uses its
existing strict direct read, and the queue has no postponement-count bound.
Neither is claimed fixed by these tests. Introducing a bound requires tests for
whole-batch rejection, all waiting callers and full-repair fallback, rather than
acknowledging an old or partially applied result. Production remains disabled.

## Live Demo Measurement

```sh
DEMO_ENV_FILE=/path/to/private-demo.env node scripts/measureHistoryRecoveryDemo.mjs --confirm-demo --realtime --queue
```

Both variants keep scoped-history recovery and all safety guards enabled. Only
the new queue differs. Each variant performs four save/cancel pairs against a
temporary demo unit, with real DB writes and real realtime signals. It waits
three seconds after each write/refresh and calls eligible foreground recovery.
Compare complete-cycle application HTTP requests, including writes, RPC reads,
repair and retry requests; fixture/verification queries are excluded.

Measured 2026-10-30, four save/cancel pairs (8 write/recovery cycles) per row:

| Added GET delay | Queue | All HTTP requests | GETs | History GETs | Foreground HTTP | RT sync failures |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 0ms | off | 304 | 252 | 20 | 232 | 0 |
| 0ms | on | 304 | 252 | 20 | 232 | 0 |
| 250ms | off | 464 | 380 | 36 | 232 | 8 |
| 250ms | on | 316 | 264 | 24 | 232 | 0 |

All rows skipped the broad scoped-history reread on all 8 foreground calls. That
metric alone would miss the regression. Queue-off delayed writes invalidated
coverage 24 times; queue-on had none. Whole-cycle requests fell 148/464 (31.9%)
in this delayed fixture run, while normal communication was unchanged. A delayed
save still requires a fresh trailing read, so it remains slightly above the
normal-communication count. This does not prove a production percentage.

All 32 post-cycle history ID sets matched the demo DB. Temporary records were
invalidated, the temporary unit and assigned event were removed through the
supported deletion paths, and the original active history ID set was unchanged.

This runs real app hooks in JSDOM, not a phone or browser-rendering test. The
250ms condition delays delivery of each GET response; it is not measured mobile
RTT. The realtime subscription remains connected and the recovery call bypasses
the normal two-minute visibility cooldown. Counts are not billed egress or a
monthly savings estimate. Browser automation was unavailable during this turn.

## Rollback / Production

Demo rollback: `VITE_VISIT_REALTIME_QUEUE_ENABLED=false`, rebuild/redeploy, then
apply the PWA update. Disabling scoped-history recovery also disables this queue.
Production activation requires a separate reviewed gate change; this work does
not touch production or add an operational production switch.

## Deployment Verification

Code commit `3fadbc1` deployed only to `chinese-territory-app-demo` on 2026-10-30.
Deployment: `dpl_9Ungh6tCigu8bWpc4mmLYkEAMFyi`, READY; canonical demo URL HTTP 200.
The served entry is `/assets/index-M5TXCaZm.js`; its
`TerritoryReportView-xaEbnCsi.js` dependency contains the new queue, disposal guard
and unchanged strict scope-version guard. It points to the demo DB. The demo
project has DEMO and TERRITORY_REALTIME configured and no queue override, so the
default demo-only queue applies where history recovery is eligible.

No production deployment or environment change was performed. The production
checkout remains at `5d42a735980583bc4556be8947f4a6f65a3f857c`. Existing demo PWA
clients must apply the update. Live measurement used source at the deployed code
commit; it did not drive the newly deployed UI. CUA connection timed out, so
physical-device/rendered-screen confirmation remains explicitly unverified.
