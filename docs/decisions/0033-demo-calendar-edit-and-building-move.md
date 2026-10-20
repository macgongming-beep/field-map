# Demo single-event edit and building-card movement refresh

- Date: 2026-10-20
- Status: demo deployed and live save/reload verification passed; production unchanged
- Production: unchanged; no DB or permission changes

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

## Live demo verification

- App commit: `f15f27e`; demo deployment `dpl_GspdqhWroYpXt1AuC8ikbJ7cgq5z`.
- Alias: https://chinese-territory-app-demo.vercel.app
- Loaded module verified against published HTML: `/assets/index-BBJmTsoa.js`.
- Actual demo administrator account; virtual fixture only, not production data.
- Created event 99 (`DEMO-REFRESH-1020`), then edited title, time to 13:00-15:00
  and description. Immediate calendar/detail rendering and reload persistence
  passed; mobile detail also displayed the edited values. The test event remains
  identifiable as `DEMO-REFRESH-1020 확인완료`, with no participants.
- Moved virtual building 74 from card 28 to card 30. The source building list
  dropped from two to one; the destination listed three buildings. Its map opened
  at `cardId=30&buildingId=74`, displaying the moved building and its four units,
  with destination totals of three buildings / twelve units. Reload retained it.
- Restored building 74 to card 28. Destination returned to two buildings; source
  returned to two buildings with six and four units. No units/history were edited.
- Screenshots: `scratch/demo-calendar-verified-f15f27e.png` and
  `scratch/demo-card-move-f15f27e.png`. Browser zoom restored to 100%.
- These browser checks verify save/display persistence, not request-byte totals
  or savings attribution. Targeted-versus-broad behavior and failure races are
  covered by automated integration/mutation tests. Real two-phone simultaneous
  editing was not exercised in this run.

No monthly savings estimate is claimed.
