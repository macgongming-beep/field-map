# Production linked return-visit map retention

- Status: Production enabled; deployed artifact verified
- Date: 2026-10-31
- Approved demo commit: `0e184d9`
- Production implementation: `143e683`
- Related: 0068

## Activation

The user explicitly approved production activation after external review.
Verified existing production values before deploying:

- VITE_RECIPIENT_STORE_ENABLED=true
- VITE_RETURN_DETAIL_RETENTION_ENABLED=true
- VITE_SCOPED_VISIT_HISTORY_ENABLED=true
- VITE_CALENDAR_WINDOW_ENABLED=true
- VITE_DEMO_MODE unset

Added only VITE_RETURN_MAP_RETENTION_ENABLED=true to the production environment.
The cherry-pick adds only the approved linked-map retention code, tests, demo
fixture helper and documentation. Unrelated local main changes and existing
uncommitted production notes were left alone. No database writes or migrations.

## Verification

- Production integration suite: 2,165 tests / 220 files pass; lint passes.
- Remote TypeScript/Vite production build succeeds.
- Deployment: `dpl_2rFfDTdH1zW8mFrekraV6k9EfDdL`, READY.
- Alias: https://chinese-territory-app.vercel.app
- Deployment URL: https://chinese-territory-jtebg6z4z-gms-projects-3b3e1c8b.vercel.app
- Previous deployment: `dpl_Gu9XHkiEDbEge3D7XQX139jrT5Vn`.
- Served entry: `/assets/index-C9mm6jru.js`.
- Served scope module: `/assets/TerritoryReportView-DAAfGW19.js`.

Fetched the actual public alias artifacts, parsed their functions with Acorn,
and evaluated the isolated compiled gate/route/recipient functions with node:vm.
The compiled default gate is true. Linked volunteer map returns true; explicit
false, recipient opt-out, leader/admin, address-only and duplicate building IDs
return false. Environment values were re-read after activation as well.

This verifies the delivered artifact, not a production volunteer UI session.
No production application/history data was written to manufacture a test case.
Actual linked map and unit 104 browser checks were performed in demo (0068).
Existing clients must apply the PWA update before using the new code.

## Exclusions and rollback

The address-only fixture's geocoded pin was not confirmed in demo. This behavior
is not diagnosed or fixed here; that route remains on its existing full-store
path. Only linked return-visit maps retain the recipient snapshot.

Rollback: set VITE_RETURN_MAP_RETENTION_ENABLED=false and rebuild/redeploy; users
must apply the update. Do not turn off unrelated recipient/detail/history flags.
No monthly savings are inferred from this deployment verification.
