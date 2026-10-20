# Demo single-event edit and building-card movement refresh

- Date: 2026-10-20
- Status: implementation; live demo verification pending
- Production: unchanged; no DB or permission changes

Follow-up: decision 0035 adds independent production opt-in flags while retaining
the recipient exclusion and recovery behavior. It does not enable production.

## Investigation and scope

The calendar slice reads all events with participants and both assignment tables.
Single-event editing used this broad refresh. Building-card movement and bulk
coordinate reassignment reread all buildings and cards after saving.
These are confirmed broad reads, not a measurement of their daily egress share.

This patch narrows only two post-write paths in demo, outside recipient mode:

1. A single calendar event edit reads that event, its participants/cart applicants,
   and its two assignment collections. Existing transforms replace only that
   event in the complete calendar snapshot. Unrelated historical events remain.
2. A single building-card move reads the changed building with units and histories.
   All loaded card statistics are recalculated from the same new building
   snapshot, covering both the source and destination.

Both optional callbacks are gated by VITE_DEMO_MODE === 'true' and !recipientReader.
Without the callback, or if the narrow read fails, the existing broad refresh is
used. Writes, authorization, notification choices and return contracts stay intact.
No write is retried merely because refreshing failed.

## Preserved contracts

- Initial/calendar navigation reads remain complete, not month-filtered.
- Recurrence, creation/deletion, participant application/cancellation/removal,
  cart management and event assignment refreshes are unchanged.
- Recipient mode keeps the authoritative scope recalculation, including access
  revocation and buildings entering/leaving visible cards.
- Full and targeted reads coordinate versions. A pending full read makes the
  new mutation path use broad recovery. Superseded mutation reads cannot silently
  count as a successful refresh. Production read ordering is unchanged.
- Demo building updates compute the next snapshot before scheduling React state;
  deferred state updater execution must not leave card totals on the old snapshot.
- Calendar target readers reject failed, missing or foreign-event responses.
  Assignment collections are paginated to avoid silently truncating participants'
  card links.
- A calendar baseline whose assignment reads failed is not considered complete;
  editing forces broad recovery before narrow replacement is allowed again.

## Deferred

Bulk coordinate reassignment is not optimized here. Its current counter treats
error-free updates as success without checking affected rows; RLS can hide a
zero-row update. Confirmed affected IDs and partial-success tests should precede
targeted bulk refresh. This existing issue is not silently fixed as a side effect.

Lazy monthly calendar loading remains a separate design change. Calendar display,
multi-month attendance statistics, historical service and recipient assignment
scope share data today. They need separate completeness contracts before narrowing
the initial read; missing participants must never be interpreted as zero attendance.

## Review checklist

- Compare source/destination counts, units and histories after a building move.
- Confirm unrelated and historical events/participants survive single edits.
- Exercise full-before-target, full-during-target and superseded failed reads.
- Confirm recipient and production gates retain broad refresh.
- Confirm notification RPC and series behavior are unchanged.
- Independently review the final commit before enabling production.

## Automated verification

- Full suite: 1,584 tests / 190 files passed; lint and production build passed.
- Disabling the two demo callbacks made precisely the two demo-enabled integration
  cases fail, while their production-disabled counterparts passed.
- Two independent agent reviews completed. The calendar baseline completeness
  finding was fixed and both assignment-table failure regressions passed.
- Live demo artifact identifiers and save/reload observations are pending.

No monthly savings estimate is claimed.
