# 0039 - Production calendar window opt-in

Enable the reviewed 0037/0038 home, calendar, and admin allocation date windows
with `VITE_CALENDAR_WINDOW_ENABLED=true`. This flag overrides `VITE_DEMO_MODE`;
explicit false disables the feature even on demo. Unset production stays full.

App scope selection, readiness gate, calendar context and store protections all
use the same helper. Statistics, export/editor workflows and unsupported routes
remain full history. Actual admin/developer role is still required to narrow
the allocation route. Partial visible events are never used as recipient
authorization. No database, RLS or mutation changes.

Only calendar commits c8cb803 and 235ac00 were cherry-picked onto production
8a4ffdc. Unrelated demo work is not included. Previous demo smoke checks covered
historical applicants, multi-month attendance and assignment save/reload/release.

Rollback requires setting the flag false, rebuilding/redeploying, and clients
applying the PWA update. It is not an instant runtime switch. No daily or monthly
savings claim is made without comparable authenticated transfer measurements.

Production validation is read-only; do not create real assignments to test this
release. Record the production build and smoke results after deployment.
