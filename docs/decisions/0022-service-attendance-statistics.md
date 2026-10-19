# Service attendance statistics

- Status: demo implementation; production unchanged
- Date: 2026-10-19

## Decision

Add a separate Service Attendance tab to the existing desktop Statistics route.
Reuse the calendar snapshot, with no additional database requests or schema changes.
Select a month and weekday (Monday through Sunday), then show exact meeting start
times separately in monthly averages or individual meeting rows. Export the selected
view to CSV. This is attendance, not territory outcomes or service duration.

## Counting contract

Applicants represent actual attendees, as requested. Union normal and cart applicants
using the existing normalized name key; do not count guests/assigned arrays again.
Deduplicate within a meeting, not across different meetings. Include zero-attendance
service meetings in the denominator; do not invent meetings on dates without events.
Average is cumulative attendance divided by actual meetings at that weekday/time.
Exclude future dates and future start times today. Past unknown times have a separate
group. Application closure is not cancellation. Deleted events are absent from the
snapshot, which has no separate cancellation field. Invalid dates are excluded.

## Verification

- 1,315 tests / 181 files passed; lint and production build passed.
- Seven added tests cover counting, exact time grouping, zero attendance, future
  exclusion, local weekdays, CSV safety, month/day/view changes and separate tabs.
- Removing future exclusion makes three focused tests fail; restored before full run.
- Local synthetic UI preview verifies the table, tabs and weekday interaction.
- No production data writes. Demo verification does not establish historical data
  completeness; totals reflect the calendar snapshot available to the signed-in role.

## Rollout

Demo only. Existing statistics permission/routing is unchanged. No new mobile menu.
Review real calendar totals in the demo before authorizing production separately.
