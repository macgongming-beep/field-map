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
- Desktop and 390px iframe screenshots verify average and date tables without overlap.
- No production data writes. Demo verification does not establish historical data
  completeness; totals reflect the calendar snapshot available to the signed-in role.

## Rollout

Calendar follow-up (2026-10-19): the date view is now a Monday-first monthly
calendar, independent of the weekday-detail filter. Each date shows meeting times
and participant counts; selecting it shows meeting titles below. Empty months still
show their dates. Future dates are disabled and future meetings remain excluded.
Changing month resets selection. Daily CSV exports every counted meeting in that
month with its own weekday, not the previously selected weekday. No new queries.
Focused coverage includes a cross-weekday date, date selection, month reset,
Monday-first alignment and leap February. Restoring the old weekday filter makes
the calendar coverage fail. Desktop and narrow-layout checks use synthetic data.

Follow-up: rename the tab to Service Participation, remove cumulative attendance
from summaries, detailed tables and CSV, and default to a weekday-by-start-time
monthly-average matrix. Keep weekday details and individual date views. A missing
meeting is shown as a dash, not zero; actual zero attendance remains numeric zero.
The matrix export includes every weekday and the selected month.
Focused follow-up tests: eight passed. Shifting the weekday assignment by one day
makes two UI tests fail; restored before the full run. Desktop and 390px screenshots
confirm all seven weekdays fit. Lint and build pass.

Demo only. Existing statistics permission/routing is unchanged. No new mobile menu.
Review real calendar totals in the demo before authorizing production separately.

Demo deployed from `e89d3f2` on 2026-10-19: deployment
`dpl_4oVU9TjP2jJg97gPdgonCnkKGbbv` reported READY and was aliased to
https://chinese-territory-app-demo.vercel.app. Production was not deployed.
