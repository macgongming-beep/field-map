# 0041 - Demo recipient card projection

Read-only production sampling (2026-10-23): public API key, no user session,
GET cards ordered by id, offset 0 / limit 1000, 609 rows, actual gzip body bytes:

| Projection | Bytes |
| --- | ---: |
| Card fields without created_at | 4735 |
| id + recipient names | 1561 |
| id + leader names/timestamps | 18536 |
| Existing full nested card query | 24186 |
| Explicit card fields + all assignment names, no leader timestamps | 6867 |

Separate projections compress differently and must not be added as exact cost
attribution. This is a single-response comparison, not billing or monthly savings.
Authenticated summary RPC traffic was not measured. No production writes.

Only actual role=user with recipientReader and VITE_DEMO_MODE=true uses the
compact projection. Full-store users, leaders, admins, developers and production
retain existing queries, including leader assignment timestamps. Both modern and
legacy missing-leader-table queries preserve all consumed card fields.

leaderAssignedAt is consumed only by DesktopAdminAssignment status modal. Names,
assignment removals, card status and fresh summary reads remain unchanged. No
cache/TTL or skipped recovery was introduced. Existing building change signals do
not cover card metadata or card assignment tables, so they cannot safely gate
all card recovery reads. Larger recovery optimization needs a separate contract.

Verification: 1709 tests / 199 files, lint and build passed. Projection tests cover
role/gate/fallback and transform parity except admin-only dates; useStore tests
verify compact query wiring and fresh progress on foreground card reads.

Demo deployed successfully: dpl_46PVTCmPHiT5SiBphZrH3pBY9DjW. Browser loaded
index-DlwTot5c.js, matching the canonical demo HTML. Actual volunteer login and
My Service rendering succeeded. The account currently has zero assigned cards,
so populated card UI and live assignment-change verification remain outstanding;
transform parity and fresh progress are covered by automated tests, not this UI
smoke. Screenshot: scratch/demo-card-projection.png. Production unchanged.
