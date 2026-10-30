# Demo navigation recovery and home reads

Activation follow-up: [0066](0066-navigation-home-production-gates.md) adds independent
production opt-in switches. The implementation/measurements below describe the
original demo build; they are not evidence of production activation.

- Status: Demo implementation; not approved for production
- Date: 2026-10-31

## Contract

An uncached calendar navigation may reuse the existing recipient recovery path
only in demo, with scoped history recovery enabled. Recheck the authoritative
assignment scope first. A changed/unknown scope or failed recovery must load a
fresh scoped snapshot. Successful recovery still requires complete history,
no pending reads/writes, and the existing 30-minute safety deadline before
skipping history batches. Mutation/manual refresh behavior is not narrowed.

Home suggestion entry always reads the visible index. Reuse the selected body
for at most two minutes when identity and selection timestamps match. App edits
of visible suggestions update last_used_at; local mutations invalidate the cache.
Direct SQL edits that bypass this contract can remain stale until TTL expiry.
Administrator full reads are unchanged.

Home meeting collections remain fresh on every entry, including home_enabled.
Within two minutes, recheck note IDs, collection IDs and updated_at before
reusing note metadata. Hidden, archived, deleted or edited notes are not reused.
Metadata changes require an additional full metadata query; unchanged entries
save response text, not request count. Article bodies remain on demand.

Skip the unused legacy notices slice in demo. Do not change bell notifications,
maintenance announcements, chat badges or administrator notice writes.

## Verification (2026-10-31)

Implementation: `9f3def1`. Full suite: 2,123 tests / 221 files pass. Lint and
TypeScript/Vite build pass. Deliberate mutations, then restored:

- Treat changed assignment scope as unchanged: reassignment and revocation tests fail (2).
- Ignore suggestion index version: edited-body test fails (1).
- Ignore meeting note manifest differences: edited/archived/added/moved tests fail (4).

Store tests also cover scope-check failure, delta failure, production exclusion,
manual/mutation refresh preservation, the thirty-minute safety read, and applying
another user's cancelled history before skipping scope-wide histories.
Home tests cover account changes, expiry without renewal, clock reversal, hidden
content, failed index reads, local invalidation and late responses after edits.

### Deployed browser comparison

Headless Chromium, 430x932, fresh sessions, service workers blocked. Same demo
accounts, home -> calendar -> my service -> home three times; leader/admin also
visit zone. Then open two previously uncached earlier months using calendar buttons.
Scripts: `scripts/measureCalendarScreensDemo.mjs --confirm-demo --months`.

| Volunteer action | Before | After |
| --- | ---: | ---: |
| First calendar entry | 18 requests | 17 requests |
| First my-service entry | 23 requests | 22 requests |
| First uncached earlier month | 18 requests | 17 requests |
| Second uncached earlier month | 16 requests | 15 requests |
| Second/third calendar and my-service entries | 0 | 0 |
| Legacy notices on initial load | 1 | 0 |

The eliminated reads are `units` and scoped `visit_histories`; the building detail
read becomes `id,card_id`, with one added change-signal read. Scope authorization,
calendar, card summaries, region and boundary reads remain. Leader/admin calendar
behavior is unchanged. Zone returns for those roles have zero measured requests.
Ordinary volunteers do not have a zone tab; direct unsupported URLs were not added
to their authorization scope. All three roles had no browser exceptions/unexpected
writes. First my-service entry still needs its first dataset and briefly loads;
the second and third entries do not mount the global loading screen.

These are API request counts, not billed egress or wire bytes. Polling (including
administrator place-change requests and notifications) is included in the step
counts when it occurs, and can affect totals on another run.

### Real DB assignment/cancellation check

`scripts/measureHistoryRecoveryDemo.mjs --confirm-demo --navigation` runs the real
store against the allowlisted demo DB, with recovery disabled/enabled:

- Save and cancel a fixture visit; another client saves and cancels it; navigation
  recovers each change, and active record IDs match DB.
- Create a fixture team assignment to a card outside the user's current scope;
  navigation adds its building and calendar assignment.
- Remove that fixture participant; navigation removes the revoked card/assignment
  while preserving the other team's assignment in the same event.
- Manual repair still reads full scoped histories; administrator statistics match
  all 3 existing active demo histories after cleanup. Original histories unchanged.

One early rehearsal used a legacy non-team assignment and incorrectly expected a
participant DELETE to revoke its cards. It failed with the optimization disabled.
The fixture was corrected to use `assign_team_service_bulk_tx`, matching the team
cleanup trigger's actual contract; both variants then passed. No production data
or existing user assignments were modified.

Stable unchanged navigation: 18 -> 17 requests, decoded JSON body 17,006 -> 8,639 B.
With a new signal, the optimized path used 20 requests and about 9.9-10.3 KB decoded
body versus 18 and about 17 KB. Therefore this is NOT an unconditional reduction
in request count. These are JSDOM hook/real-DB results, not compressed transfer,
Supabase billing, physical-phone results or a monthly savings estimate.

### Home verification

`scripts/verifyHomeReadsDemo.mjs --confirm-demo` created one isolated visible demo
suggestion, checked the deployed volunteer UI, edited/hid it, then deleted it:

- Initial home: visible index + selected body (2 requests).
- Return unchanged: visible index only (1 request), body still displayed.
- Return after edit: index + fresh body (2), edited text displayed.
- Return after hiding: fixture text absent; browser errors none; cleanup passed.

Meeting-note reuse and provider wiring are covered by automated tests. The deployed
demo does not have `VITE_SERVICE_MEETING_NOTES_ENABLED` enabled, so meeting-note
metadata reuse was NOT exercised in that live browser run. Do not infer live
meeting-note savings from the suggestion measurement.

### Deployment and remaining work

Demo deployment: `dpl_GcubpVqGz8vpCkDrvvukENhLMDop`, READY.
Canonical: https://chinese-territory-app-demo.vercel.app
Verified entry changed from `index-BrCF_qA5.js` to `index-DLNkn6Og.js`.

No DB schema change and no production switch/deployment in this work. All new
read reductions require demo mode. Identity/late-response protection in the home
hooks is shared code, but no production build was published. Before production:
review this change, decide independent opt-in gates, and assess actual transfer
cost at operating scope sizes. Boundary coordinates and card/region reads remain
separate candidates; this work does not silently remove them.
