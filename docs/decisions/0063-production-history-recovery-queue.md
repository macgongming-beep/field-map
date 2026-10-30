# Production: scoped history recovery and visit/realtime queue

- Date: 2026-10-31
- Status: approved; production activation authorized by user
- Reviewed source: f613b1c, 3fadbc1, 93f5c4e, 55cb779
- Production baseline: 6fe2894 (cached screen already enabled and user verified)
- Supersedes inactive-production statements in 0058, 0059, 0061 and 0062.

## Scope

Port only the reviewed scoped-history coverage and visit/realtime queue code,
tests and demo measurement script. Keep main's existing production gates. Do not
merge the unrelated demo informal-group/asset changes. No DB/schema/RLS changes.
The reviewed module implementations match 55cb779. Store differences from that
source are limited to the unrelated informal-group/asset paths left out here.

## Flags

Enable VITE_SCOPED_HISTORY_RECOVERY_ENABLED and VITE_VISIT_REALTIME_QUEUE_ENABLED.
Keep VITE_CALENDAR_CACHED_SCREEN_ENABLED=true. Production DEMO remains unset.
Prerequisites verified true in Vercel before activation: scoped visit histories,
recipient store, territory realtime, calendar window and calendar navigation reuse.

Recovery/queue apply only to the actual user role with a recipient reader and
scoped histories. Admin, leader and developer keep their existing history path.
Queue true cannot bypass recovery false. An unchanged scope alone is insufficient:
coverage must be complete, no history read/sync may be pending, and signal-based
building recovery must succeed before the redundant scoped read may be omitted.

## Preserved Safety

- A full scoped history read is required after 30 minutes from its start time.
  Successful deltas and failed reads cannot extend this deadline.
- Scope changes, failed delta application and incompatible concurrent reads
  invalidate coverage; existing fallback/manual refresh remains available.
- Queued callers count as pending while waiting. Pre-write overlapping responses
  cannot publish; the entire deferred batch must be refreshed before completion.
- Saved/cancelled records use authoritative building reads; old responses cannot
  resurrect cancelled history. Annual expiry is pruned locally on skipped reads.
- Reset/unmount rejects queued work and prevents late fallback after disposal.

## Verification Before Deployment

- Production integration: 2,065 tests / 219 files passed; lint passed.
- Build with production environment and both new flags true passed (TS + Vite).
- Coverage includes production true/default-off/false, demo false, roles, queue
  dependency, 30-minute safety, save/cancel races, queued foreground reads,
  scope changes, incomplete reads, cleanup and calendar cache regressions.
- Counts differ from demo because unrelated demo-only changes are not ported.
- Existing live demo slow-network measurement is preserved in 0059; it is not
  claimed as a fresh production network measurement.

## Rollback / Limits

Set recovery=false to disable both features, or queue=false to disable only
serialization. Rebuild/redeploy and apply the client PWA update. Cached screens
can remain enabled independently. No database rollback is necessary.

Queue postponement has no explicit retry ceiling in this reviewed implementation.
Foreground recovery still uses the direct guarded sync, not the queue. These
remain separate follow-ups; this deployment does not claim to fix them or to
establish a monthly egress saving.
