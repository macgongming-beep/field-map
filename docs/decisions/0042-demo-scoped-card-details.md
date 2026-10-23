# Scoped recipient cards and on-demand shared names

- Status: demo validation; production unchanged
- Date: 2026-10-23

## Decision

Initially required both VITE_DEMO_MODE=true and VITE_RECIPIENT_CARD_SCOPE_ENABLED=true.
The production-gate follow-up below replaces that environment condition; it still
requires actual role=user and an existing recipient reader. Admin, leader, developer,
statistics and ordinary-map full stores retain their existing card reads.

Read card details and get_card_summaries only for the authoritative recipient
scope. This is NOT merely card_assignments: retain the existing union of personal
cards, shared team cards, active-session primary cards, return-visit cards and
restaurant assignments. Keep empty assigned cards; do not derive scope from the
loaded buildings. Empty scopes issue no card-detail requests. Legacy-schema
fallback uses the same ids. Reject foreign/duplicate responses and retain the
existing complete-summary check. Recipient refresh queues recompute scope before
reading cards; revoked cards are replaced, not merged into a permanent cache.

Shared assignment detail (mobile and desktop) requests id/name only for the
opened event's missing cards. Drafts and full stores do not trigger extra reads.
No other team's summary, buildings or progress are fetched for this label.
Ignore responses from a previous selection; show card ids while unresolved and
offer retry on failure rather than incorrectly claiming the team is unassigned.
Names are not persisted between accounts. Missing/deleted card names retain #id.

RestaurantCatalog needs regions beyond the recipient's cards. On opening that
catalog only, read a separate id/name/area/region directory (no counts or nested
assignments); the existing restaurant pagination/search is unchanged. This is
still a full lightweight directory, not a claim that every read is scoped.

The initial audit also flagged manual return-visit location creation. Further
inspection found canCreateReturnVisitLocation admits only leader/admin/developer
(MobileTerritory), which never enter scoped-card mode. Its full-card address
fallback and unassigned-card lookup are therefore unchanged. Ordinary maps and
statistics remount the full store via the existing AppSession key. Historical
calendar applicants are unchanged; names load from each opened shared event.

## Production-gate follow-up (2026-10-23)

The user relayed external approval of the scoped-card implementation, with the
demo-only gate blocking production activation. The gate now uses
`(VITE_RECIPIENT_CARD_SCOPE_ENABLED ?? VITE_DEMO_MODE) === 'true'`.
Both App's on-demand card-directory context and useStore's card query use this
same helper. Actual `role === 'user'` and the recipient-reader condition remain
required. Leaders, administrators, developers and full stores retain full cards.

- Production with both values unset remains disabled.
- Explicit `true` enables the eligible recipient path without demo mode.
- Explicit `false` disables it even with demo mode enabled.
- An unset scope flag inherits demo mode. Existing deployed demo opt-in remains
  enabled; this follow-up does not change its card selection or hydration.
- This is a build-time switch. Enabling or disabling requires a new deployment
  and clients must apply the PWA update; it is not an immediate remote switch.

The helper's nine-case environment matrix checks role and reader guards. Store
tests exercise production opt-in, demo fallback and explicit false with both
modern and legacy schemas, asserting actual card filters and summary IDs.
Production tests also retain empty assigned cards and exercise grants/revocation;
full-store roles are checked in both demo and production configurations.
Unrelated store fixtures explicitly disable card scoping to keep their complete
summary fixtures independent of the new demo default.

Mutation checks: restoring the old demo-AND-opt-in gate fails three helper
cases; replacing the override with OR fails the explicit-false case. Both
mutations were reverted. The flag follow-up requires external re-review before
release. Production code, Vercel variables and database data were not changed.
Final verification: 1,792 tests / 204 files passed; lint and build passed.
This follow-up did not repeat browser checks or deploy either environment;
the prior demo UI evidence applies to the unchanged enabled behavior.

Release preparation must integrate the already-reviewed leader calendar changes
with main's existing `calendarWindowEnabled` gate, not overwrite it with the
demo branch's gate. Card scope uses this separate opt-in. Inspect the deployed
bundle and eligible/non-eligible role requests after activation; do not infer
production activation solely from a merge to main.

## Verification

Store tests cover legacy schema, empty cards, grant changes, revocation, foreign
rows and full-store roles. Directory/hook tests cover projection, server failure,
late response, retry, drafts and region visibility. Actual mobile detail and
restaurant catalog component tests verify other-team names and outside regions.

Disabling the scope helper makes all three new scoped-store tests fail.
No schema changes, production deploy or measured monthly saving is claimed.
Live demo verification and final test counts are recorded below when complete.

## Demo verification

- Code commit a811096; 1,731 tests / 203 files passed, lint and build passed.
- Removing the mobile shared-name wiring makes its rendered-component test fail.
- Demo opt-in enabled; deployment dpl_A7hR2q6booHq75KyqGUfyY3naa6s ready.
- Canonical demo served index-5PE4IPyV.js; browser updated to that exact entry.
- Actual demo volunteer login: October 5's prior applicant and assigned card still
  display. September 30 at 10:00 still displays six applicants and all three
  teams, including the other team's card 28 name (test distribution territory).
- Mobile 390x844: My Service loads, restaurant catalog offers both test regions;
  selecting the distribution region exposes its neighborhood outside the user's
  ordinary personal card list. Existing records/assignments were not modified.
- Empty scope, grant/revocation, summary progress updates, failure/retry, full
  statistics-store isolation and legacy fallback were verified by automated
  tests, not by inserting new live assignments in this run.
- No production settings or main commits changed. No monthly/billing saving
  estimate: synthetic and live UI correctness do not establish billed bytes.
