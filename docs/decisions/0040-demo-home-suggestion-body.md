# 0040 - Demo home suggestion body read

Only the home useServiceSuggestions(true) caller opts in under VITE_DEMO_MODE.
Follow-up: VITE_HOME_SUGGESTION_BODY_ENABLED overrides the demo fallback.
Unset production remains full; explicit false disables even demo; true enables
only the home caller. Admin remains full. This is a build-time switch: changing
it requires a rebuild/deploy and clients applying the update. No production flag
or deployment was changed by this follow-up. Added production/admin/false gate
tests and a query-order regression for equal last-used dates.
AdminSuggestions uses the unchanged default full query. Production is unchanged.
MeetingSuggestions disclosure settings and existing default-open behavior are unchanged.

Home first pages visible id/last_used_at/created_at metadata, then reads one body
by id with visibility checked again. Selection preserves last_used_at with
created_at fallback and created-descending input order for equal effective times.
An id tie-break makes equal created timestamps deterministic. No schema migration.
This is not a single-request optimization: it removes unselected large bodies;
small metadata still loads, and a nonempty index requires a second request.
Deleted/hidden selected rows yield empty display until the next read. Errors do
not silently fall back to downloading every body.

Verification:
- Full suite 1,689 tests / 197 files passed, plus three hook gate/admin tests.
- Lint and build passed.
- Demo deployment dpl_aEN2v8EGba1DJ9xTdGJFKuWn6DMt READY.
- Browser loaded /assets/index-DC2sAf4Z.js.
- Demo initially had no suggestions. Created a labeled test suggestion through
  admin UI; after update its home text exactly matched the pre-deploy baseline
  and the disclosure remained open (question, bilingual scripture, next visit).
- Local screenshot: scratch/demo-home-suggestion-single.png.
- No production changes or claims about monthly billing savings.
