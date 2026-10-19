# Demo: read return-visit detail bodies only when opened

- Status: demo deployed and browser-verified; production behavior unchanged
- Date: 2026-10-20

## Why

The returnVisits slice loaded all valid return_visit_logs, including memo text,
on initial load and foreground recovery even when no detail screen was opened.
Removing that read outright would break the desktop record count and the home
latest-visit date, including memo-only entries whose date is newer than last_*.

## Decision

Only when VITE_DEMO_MODE is true, the shared store loads a paginated index of
id, return_visit_id and visited_at. Counts/latest dates retain the same meaning.
The return_visits parent list and its last-result summary remain unchanged.
This is body deferral, NOT elimination of the index or parent-list reads.

Mobile full detail, mobile quick-record sheet and desktop quick-record modal
load full bodies scoped to the opened return visit. Closing clears the displayed
detail; switching target/account cannot accept a late response from the old one.
The reader filters invalidated rows and verifies the returned parent ID. Pages
are ordered deterministically and read to completion, preserving interval stats.

A new store index snapshot triggers a detail read if open, including memo-only
edits with unchanged IDs/dates. This preserves save/edit/invalidation refreshes.
Loading and retryable error states never masquerade as an empty history. Detail
failure does not fall back to downloading everyone's memo bodies. Existing
production reads are unchanged. No DB/schema/permission changes.

## Verification

- 1,435 tests / 187 files passed, lint/build passed.
- Reverting the lightweight projection and removing the server target filter
  caused two new tests to fail; both mutations restored.
- Hook tests cover closed-screen zero reads, scoped open, memo-only refresh,
  close, account/target races and failed-read retry. API tests cover pagination,
  invalidation filter, wrong parent and mid-read account change.
- Demo code 820882e deployed as dpl_HeQ3UTHcabdKzhPkUT6GZYC2qJMk;
  canonical demo alias and browser module /assets/index-CTH9fPFC.js verified.
- Browser fixture DEMO-RV-LAZY-1020 (return visit 22): initial memo loaded on
  detail entry; same-date memo edit appeared immediately; adding an absent
  result raised the count from one to two; quick-record sheet showed both
  bodies; invalidating that test result returned the count to one. Reload
  retained the edited memo and excluded the invalidated result.
- Browser checks used the demo administrator's volunteer view. Desktop modal,
  was not separately browser-tested; shared reader/hook account races and
  retry behavior were covered by automated tests, not a live offline exercise.
  No production data was changed.
- Existing unrelated date-display issue observed: MobileTerritory fmtDate
  slices an ISO timestamp before parsing, so a post-midnight KST visit can
  show yesterday in the list but today in detail. That function is unchanged
  by this commit; retain as a separate follow-up, not a lazy-load regression.
- No claim about monthly bill or total percentage savings; index/extra detail
  request costs must be included in any later measurement.

## Date follow-up and combined review (2026-10-20)

- 4279870 fixes the list's UTC truncation: timestamps keep their instant before
  local-day comparison; date-only values are parsed as local midnight. No DB
  values or relative-label thresholds change.
- Demo deployment dpl_6zCdQRcyuzgAXqC4yAyoaL5BHRXy is Ready. A new test-only
  absent log on visit 22 showed yesterday before update and today after update;
  detail also showed today and both stored memo bodies. Production unchanged.
- Independent Codex review of 820882e plus the date fix found no confirmed
  actionable regressions. It independently ran 167 focused tests. This was
  not a Claude review or independent live-browser verification.
- Both suggested coverage gaps were added: same-target account switching and
  date-only values in America/Los_Angeles. Removing the relevant protections
  failed exactly those two tests. Restoring UTC truncation separately failed
  the three KST midnight/month/year-boundary cases.
- Final full suite: 1,442 tests / 187 files passed; lint/build passed. Browser
  proof: scratch/demo-return-visit-date-4279870.png. Desktop/offline live checks
  remain outside this verification; no monthly savings estimate is claimed.
