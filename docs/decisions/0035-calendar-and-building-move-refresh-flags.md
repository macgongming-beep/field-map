# Independent calendar edit and building move opt-ins

- Date: 2026-10-20
- Status: automated verification and independent review passed; production flags are not enabled
- Scope: build-time gates only; no database or permission changes

## Flags

| Flag | Narrow post-write refresh |
| --- | --- |
| `VITE_CALENDAR_EVENT_REFRESH_ENABLED` | Single calendar event edit |
| `VITE_BUILDING_MOVE_REFRESH_ENABLED` | Single building-card move |

Each resolves independently as `(flag ?? VITE_DEMO_MODE) === 'true'`.
Unset production flags retain broad refresh. Unset demo flags retain the tested
demo optimization. Explicit `false` disables the optimization even in demo.
Example environment values are false; they are not production configuration.

Both mutation callbacks still require `!recipientReader`. Recipient scope must
be recomputed authoritatively rather than patched with one possibly inaccessible
building or event. Missing/failed narrow reads keep the existing broad fallback.
Calendar baseline completeness, exact target validation, assignment pagination,
and building/card snapshot consistency remain unchanged.

The corresponding full-read supersession checks use the same opt-in as each
callback. Enabling a callback without its stale-read defense would not preserve
the demo behavior under concurrent reads.

## Not included

- Initial or monthly calendar lazy loading.
- Calendar creation, recurrence, deletion, application, cancellation or assignment.
- Bulk building reassignment.
- Production environment changes or activation.
- Changes to notification or authorization behavior.

## Rollout

Review the flag change before production release. Enable at most one flag first
when evaluating cost; compare the same measurement windows without attributing
all egress to these paths. These Vite flags are compiled into the client: disabling
requires a new deployment and clients accepting the PWA update. They are not
instant runtime kill switches.

## Verification

- Full suite: 1,609 tests / 190 files passed; lint and build passed.
- Defaults and explicit overrides tested separately, including both flags unset,
  production true, demo false override, and opposite values for the other flag.
- Production-enabled races cover failed/superseding reads, late full snapshots,
  incomplete calendar assignment baselines, and both card totals after movement.
- Disabled guards preserve legacy full-read completion behavior.
- Recipient production-enabled tests retain broad scope refresh. Two deferred
  calendar refreshes execute serially and apply each fresh/revoked scope.
- Mutation checks: restoring demo-only callbacks fails four cases; restoring
  demo-only full-read guards fails five cases. All mutations were restored.
- Independent review found no blockers. Recipient building reads return before
  the full-store guard; recipient calendar operations serialize via their queue.
- No production configuration or deployment is part of this change. Earlier
  decision 0033 records live demo saves; this follow-up validates flag combinations
  automatically and does not claim new real-device or egress measurements.
