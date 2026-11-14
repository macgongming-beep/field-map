# Mobile map: Chinese-marked units view

- Status: demo implementation and verification; independent review pending
- Date: 2026-11-14
- Production: unchanged; no database migration

## Decision

Place a person/check icon immediately before Search in the mobile map header.
It toggles a display-only view of units explicitly marked `isChinese === true`.
This uses existing recorded flags, not an inference about residents. Unmarked
units are not treated as Chinese-speaking. Turning the filter off restores the
current geographic/assignment scope. The default on each map mount is off;
the choice is not persisted to an account or device.

The legend does not gain another row. Active state is indicated by the pressed
header icon and the Chinese label in the list summary (also the assignment-map
subtitle). The icon has a localized accessible name and hover/focus tooltip.

## Consistency and write safety

- Filter by geographic/assigned-card scope first, then create a display copy
  containing matching units, then apply the existing house/shop and status
  filters. Omit buildings with no matching real units. Legacy `출입불가` fake
  units do not count. Do not widen assignment access or change a team's cards.
- Header unit counts, house/shop counts, aggregate markers, building pins,
  legend groups, list rows and displayed progress derive from that same copy.
  Legend counts remain building counts; progress remains handled-unit counts.
  Global card statistics and statistics screens are unchanged.
- Keep the established pin rules: building warnings/access blocks and unknown
  survey completeness remain intact. A pin's progress can differ from the
  unfiltered view because only displayed units contribute, as with usage
  filtering. The filter must not mark a building surveyed automatically.
- Pin selection expands the **displayed** status group, not the original
  building's group. This matters when the filtered subset is complete but
  other units in the building are still unvisited.
- Source `buildings` and unit objects are not mutated. Existing save/cancel
  callbacks still receive original building/unit IDs. Detail/edit paths keep
  their original full-detail gate and source lookups. No shortened array is
  passed to a bulk write.
- Suggest the next unit number from the source building, including hidden
  units. Successful unit creation clears the display filter so a new unmarked
  unit is visible. Failure retains the filter and typed unit number.
- Hide the whole-building survey-complete command while the partial view is
  active. It becomes available again after turning the filter off.
- Search still searches the original accessible data. Choosing a result clears
  the display filter, while preserving assignment/scope URL parameters.
  The assignment subtitle's card count follows the selected card scope instead
  of counting unrelated cards still held in the store.
- Store snapshots from save/cancel/realtime or changed card assignments
  recompute the view; removing a Chinese flag removes that unit from the view.
- Do not offer the filter on focused informal, return-visit or address-only
  maps, where hiding an explicitly requested target would be surprising.

## Gate and rollback

`(VITE_MAP_CHINESE_FILTER_ENABLED ?? VITE_DEMO_MODE) === 'true'` enables the
control. Production without an explicit value stays off. Explicit `false`
also disables it in demo. No role or recipient-store gate is changed. This
task deploys only the `chinese-territory-app-demo` Vercel project.

Rollback: set the flag to `false`, rebuild/deploy the demo, then apply the app
update. It removes the control and restores the existing unfiltered view;
there are no data changes to reverse.

## Tests and verification

- Added 17 helper/component tests: flag combinations, immutable projection,
  header/pin/legend/list/progress agreement, both assigned cards retained,
  saved/cancelled snapshots, Chinese flag removal, changed assignment scope,
  complete-subset pin expansion, no matches/reset, default-off reentry,
  source-based next number, failed creation, hidden survey command, search
  reset without losing routing, usage/aggregate counts and excluded map modes.
- Full suite: 2,456 tests across 243 files passed. Lint and TypeScript/Vite build
  passed. A first run hit an unrelated existing private-user SQL test flake:
  its `/010/` check matched `created_at` ending in `.010Z`, not a leaked phone
  number. The final unmodified-suite rerun passed; that test was not changed.
- Mutation checks: removing Chinese-unit filtering failed six tests; replacing
  the source-number lookup with the filtered lookup and exposing the survey
  command failed their two respective tests. All mutations were restored.
- Live Chrome mobile-size demo, administrator account: full map 74 units
  (35 house/39 shop) -> filtered 60 (26/34). Legend and aggregate/list counts
  changed with it. Search for Han-dong villa cleared the filter as intended.
- Live card view: 16 units -> 9 filtered units; 8 buildings -> 5. In that view,
  saving an absence at unit 102 changed displayed progress from 1/9 (11%) to
  2/9 (22%) and its building from 1/3 (33%) to 2/3 (67%). Cancel restored both
  counts. An additional same-day absence at 101 was also cancelled. Existing
  records were not deliberately deleted; only the new test saves were undone.
- Screenshot: `scratch/demo-chinese-filter-saved.png` (local evidence).
  Final header/list view: `scratch/demo-chinese-filter-ready.png`.
- Small-screen check: 320x740 with the app's 125% text setting. Header bottom
  113.5px, legend top 132.25px; no overlap or horizontal overflow in the counts
  or action buttons. The header now gives the count row the width beneath both
  title and actions, rather than stacking three counts beside the buttons.
  Local evidence: `scratch/demo-chinese-filter-320-large.png`.

This is a display feature, not an egress optimization. No data-reading API or
subscription was added; the existing realtime card scope stays unchanged.
Map SDK tile traffic is not measured here.
No live network-total measurement is claimed. Own-save/cancel was exercised
against the demo; assignment changes and incoming snapshots were tested in
components, not a new two-device live assignment exercise. Chrome viewport
testing is not a physical iPhone/PWA test. DesktopMap is outside this change.
