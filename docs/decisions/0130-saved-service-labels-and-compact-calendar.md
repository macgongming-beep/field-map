# Saved service titles, configured group names, and compact PC calendar

- Status: demo only; production unchanged
- Date: 2026-11-18
- Previous work: 0129 remains enabled in the demo artifact.

## Findings and scope

The scoped service list and detail heading replaced saved event titles with the
translated fixed label `집단 봉사`. Group choices, tabs, roster headings and list
labels used `serviceGroups[language]`, ignoring `app_settings.user_groups`.
This was a presentation issue; no production data was read or rewritten here.

## Changes

- The list uses the existing home-group representative's saved title. Detail
  uses the currently selected child's title. Only blank titles use the generic
  group-service label. Chinese titles retain native Chinese typography.
- Existing `globalSettings.user_groups` flows through home, PC/mobile calendar,
  detail and editor. A configured known group name is displayed unchanged,
  regardless of interface language. No additional request is made.
- Matching is by exact existing Korean/Chinese/English alias, never list order.
  Unknown custom names are not guessed or assigned to a code. Without an exact
  match, the existing language label remains. Arbitrary group renaming and
  canonical-code migration are outside this display fix.
- Event IDs, canonical target codes, grouping, own-group selection, server
  permissions, participant writes and assignments are unchanged.
- PC month-cell events are 24px rows with start time and ellipsized title on one
  line. Tooltip retains the full title, start/end time and leader. Full time
  ranges and normal touch spacing remain in home/mobile lists and detail.
- Long detail headings wrap without pushing the action menu outside its column.

## Verification

- Full suite: 269 files, 2,649 tests passed. Final focused group/editor/detail
  suite: 32 passed. Lint, TypeScript/build and diff whitespace checks passed.
- Mutation: restoring the fixed list title and language-only group names caused
  four new tests to fail. Restoring the original event title instead of the
  selected child's title caused the selected-tab test to fail. Restored afterward.
- Tests cover Chinese saved titles in Korean UI, configured group names in all
  three languages, reordered settings, unknown-name fallback, canonical code
  submission, precise application event ID, and unchanged private roster access.
- Browser: real demo PC calendar rows measured 24px at 84-85px cell-content
  width; no horizontal document overflow. Desktop calendar and mobile calendar
  were visually checked. A local fixture using the real list and app CSS showed
  Chinese titles/names and 66.5px home rows at 390px without horizontal overflow.
- Demo data still has Korean titles/group settings in some fixtures; those
  correctly stay Korean. Chinese configured-name coverage uses local fixtures
  and component tests, not edits to shared demo names or production data.
- Browser clicks on navigation/tabs did not produce an observable state change
  in this session; calendar rendering was checked via direct navigation. Do not
  count this as a successful end-to-end tab-click test. Component tests cover
  the tab and callback behavior.
- No SQL, API, authentication, notification or read-scheduling changes. Database
  request/response usage is unchanged by these presentation paths; no fresh
  network benchmark or physical-device run was claimed.

## Demo deployment

- Project: `chinese-territory-app-demo` only.
- Deployment: `dpl_DpZNRQ5bf9X5xvfiAQuMfs3j8z3B`, READY.
- Alias: https://chinese-territory-app-demo.vercel.app
- Fresh deployment: https://chinese-territory-app-demo-qykw656fh-gms-projects-3b3e1c8b.vercel.app
- Demo login was used to inspect existing screens; no shared schedules/settings
  were modified. Main, production deployment and production DB were untouched.
