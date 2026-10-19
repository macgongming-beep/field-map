# Demo: read return-visit detail bodies only when opened

- Status: demo verification in progress; production behavior unchanged
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
- Live demo results will be appended after deployment.
- No claim about monthly bill or total percentage savings; index/extra detail
  request costs must be included in any later measurement.
