# Recovery, queued refresh and cached-screen production opt-in

- Status: review ready; production activation NOT performed
- Date: 2026-10-31
- Supersedes only the demo-only gate decisions in 0058, 0059 and 0060

## Flags

All three use `(explicitFlag ?? VITE_DEMO_MODE) === 'true'`. Production unset
stays off; true opts in; explicit false overrides demo. These are build-time
values, not runtime settings.

| Flag | Required prerequisites | False behavior |
| --- | --- | --- |
| `VITE_SCOPED_HISTORY_RECOVERY_ENABLED` | Scoped histories: actual user role and recipient store; existing recovery baseline/signal checks | Read scoped histories on recovery as before |
| `VITE_VISIT_REALTIME_QUEUE_ENABLED` | History recovery above | Independent post-write/realtime reads with strict guards and repair |
| `VITE_CALENDAR_CACHED_SCREEN_ENABLED` | Navigation reuse; calendar window mode for full snapshot caching | Prior rendering, without caching full snapshots |

Queue true cannot bypass recovery false. Recovery cannot bypass role/recipient
and scoped-history requirements. Admin, leader and developer histories remain
unchanged. Cached-screen behavior supports all four roles without changing their
data scope. In production, recovery true does NOT implicitly enable the queue;
navigation reuse true does NOT implicitly enable cached screens.

## Unchanged Safety

- History safety reread after 30 minutes from full-read start; manual repair.
- Strict overlap guards, queued callers counted pending, whole-batch completion,
  late pre-cancel response rejection and local annual pruning.
- Two-minute calendar TTL without renewal; scope/account matching; complete
  assignment responses; pending-refresh display guard and epoch rejection.
- Existing write/realtime/foreground/manual invalidation and shared-team history.
- No DB/schema/RLS changes, new persistence or production configuration changes.

## Validation

Full suite: 2,088 tests / 221 files passed; lint and TypeScript/Vite build passed.
A second local build with DEMO=false and all three flags plus scoped-history,
calendar-window and navigation-reuse flags true also passed. This was a compile
check, not deployment or live production behavior verification.

Store-level tests verify production opt-in/default-off/false, demo false, actual
foreground history read counts, queue serialization, four-role rendering and
full-calendar cache behavior. Recovery false blocks queue true. Admin, leader
and developer are excluded from the queue. Navigation reuse false blocks full
cache insertion. Existing cancellation and race tests remain intact.

Mutation checks, restored before final validation:

- Restore demo-only recovery/screen gates: 9 selected tests fail, including four
  production-role render cases and actual history/queue behavior.
- Restore queue implicit-true default while keeping recovery gate correct:
  2 store tests fail (production unset must not serialize).
- Ignore explicit false in demo: 4 tests fail across all three features.

## Activation and Rollback (Not Executed)

After review and deployment approval, merge with main's existing production
gates; do not promote unrelated demo-only work wholesale. Verify scoped histories,
recipient mode, territory realtime, calendar window and navigation reuse in the
target build. Enable selected flags and verify deployed behavior, not just env.

Rollback: set false, rebuild/redeploy, then clients apply the PWA update.
Recovery off disables queue too. Queue off alone retains recovery and its strict
repair path. Cached-screen off retains existing navigation reuse. No DB migration.

Remaining separate work: bound repeated queue postponement; consider sharing the
queue with foreground building recovery; reduce first-navigation scope reloads.
These are not included or claimed fixed here.

## Review References

- Implementations: `f613b1c`, `3fadbc1`, `a701ddb`
- Regression follow-ups: `93f5c4e`, `5a6e115`
- User confirmed the second demo navigation loop opens immediately; rendered
  browser measurements are in 0060. No new production test/deployment is claimed.
