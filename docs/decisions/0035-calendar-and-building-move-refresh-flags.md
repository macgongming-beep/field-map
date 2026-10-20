# Independent calendar edit and building move opt-ins

- Date: 2026-10-20
- Status: production flags remain disabled; supersession notification follow-up below
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

## Follow-up: expected supersession is not a connection failure

External review reproduced a manual full refresh superseded by a building move:
the saved result was correct, but `fetchAll` reported the abandoned read as a
connection failure. The same full-read cancellation path exists for calendar edits.

Building and calendar guards now throw `SupersededReadError`. `fetchAll` preserves
the rejection (so callers do not treat incomplete reads as successful snapshots)
without showing an error toast for that type when a complete snapshot has already
loaded. An interrupted first load retains the recoverable error screen: a newer
building-only read does not guarantee that calendar and other slices have loaded.
Genuine failures still use the existing error UI. Targeted mutation fallbacks are unchanged.
No message-text matching is used.

Parallel snapshot reads also check sibling outcomes after a supersession. A real
failure in another slice takes precedence, rather than being hidden by whichever
cancelled read rejected first. Ordinary failures still reject immediately; the
existing full-load deadline continues to bound the refresh.

This follow-up does not enable either flag, change production configuration,
write database data, or claim a new real-device/network-volume measurement.

Follow-up verification:

- 1,632 tests / 191 files passed; lint and build passed.
- Building/calendar flags true and false, before and after first complete load:
  supersession UI and genuine network-failure UI are covered independently.
- Actual building movement and single event editing during `refetchAll` preserve
  saved state without an error toast; building movement also verifies both totals.
- Removing the UI suppression fails four regressions. Removing sibling failure
  checking fails its dedicated test. Both mutations were restored.
- Independent review identified the incomplete-first-load exception; it is now
  explicitly protected and tested. No remaining code blocker was found.
