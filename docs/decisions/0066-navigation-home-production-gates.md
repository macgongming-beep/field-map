# Navigation and home read production opt-in

- Status: Review ready; production activation NOT performed
- Date: 2026-10-31
- Supersedes only the demo-only activation rules in 0065
- Reviewed implementations: `9f3def1`, `ba8b767`

## Flags

Each flag uses `(explicitFlag ?? VITE_DEMO_MODE) === 'true'`.
Production defaults off; true opts in; false overrides demo. These are build-time
flags, not live database settings. No deployment or Vercel settings were changed.

| Flag | Prerequisites | Behavior when false |
| --- | --- | --- |
| `VITE_CALENDAR_NAVIGATION_RECOVERY_ENABLED` | Actual recipient user; scoped visit histories; scoped history recovery; territory realtime with valid baseline | Uncached calendar navigation loads the existing full scoped territory snapshot |
| `VITE_LEGACY_NOTICES_SKIP_ENABLED` | None | Reads the retired notices slice as before |
| `VITE_HOME_SUGGESTION_REUSE_ENABLED` | Home's selected-body reader (`VITE_HOME_SUGGESTION_BODY_ENABLED`) | Revalidates the index and downloads the selected body on each entry |
| `VITE_HOME_MEETING_META_REUSE_ENABLED` | Meeting feature enabled (`VITE_SERVICE_MEETING_NOTES_ENABLED`); home metadata request | Fetches full note metadata on each home entry |

The four switches are independent. Neither home switch controls the other.
MeetingProvider and the metadata API use one `homeMeetingMetaReuseEnabled`
function. Full metadata reads for management/reader screens remain full even if
home reuse is enabled; the API requires the explicit homeReuse argument too.

Navigation recovery cannot bypass `VITE_SCOPED_HISTORY_RECOVERY_ENABLED=false`.
Existing recipient/role/scoped-history gates and territory realtime checks remain
unchanged. Turning off history recovery disables this navigation optimization
and its previously documented visit queue dependency, not the home optimizations.
Turning off navigation recovery alone leaves foreground recovery enabled.

## Unchanged contracts

- Recheck authoritative assignment scope. Scope changes and recovery failures
  fall back to fresh scoped details, including revoked cards and histories.
- Navigation only: mutation/manual refresh paths are not narrowed.
- Thirty-minute complete-history deadline, pending-write guards and late-response
  rejection remain unchanged.
- Home suggestion and meeting note caches still expire after two minutes without
  extension. Visibility/version validation precedes reuse; identities stay isolated.
- Bell notifications, maintenance announcements, administrator full suggestion
  reads and meeting article body loading are unchanged.
- No DB/RLS changes, new persisted cache or cache invalidation policy changes.

## Verification

Four relevant files: 303 tests pass. Added actual store/API/provider tests for
production true, production unset/false, demo fallback and explicit demo false.
The sibling switch is deliberately set to the opposite value in the tests to
detect accidental coupling. The meeting API also verifies full reads stay full.
Navigation cases additionally cover history recovery false and realtime false.

Mutation checks (restored before final verification):

- Restore all four demo-only gates: 15 failures, covering production activation
  and explicit demo false, including both meeting provider and API wiring.
- Remove the navigation historyRecovery prerequisite: 2 failures (production
  and demo with navigation true/history recovery false).

Full suite: 2,158 tests / 221 files pass. Lint passes. TypeScript/Vite compilation
passes with DEMO=false and all four switches plus history/recipient/realtime and
home-reader prerequisites explicitly true (a local build only, not deployment).
This is a gate change: no new live deployment/UI measurement was performed.
The previous real DB/browser measurements and their limitations remain in 0065.
In particular, meeting metadata reuse was not exercised in the live demo browser
because the separate meeting feature was disabled there.

## Activation and rollback (not executed)

After review and explicit deployment approval, integrate these changes with main's
production gates, without promoting unrelated demo-only work. Verify prerequisites
in the target build before enabling selected switches.

Rollback: set the corresponding switch to false, rebuild/redeploy, and have clients
apply the PWA update. Disabling the meeting reuse switch does not disable meetings;
disabling suggestion reuse does not hide the suggestion. Neither rollback changes
server data. No new savings estimate is inferred from these gate tests.
