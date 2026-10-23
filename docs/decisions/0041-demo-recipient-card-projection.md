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

## Follow-up live demo smoke (2026-10-23)

User authorized a temporary test card assignment. Used the demo's public client
and an authenticated demo admin session (not service-role access); the script
rejects any origin except itjlykpjmlcvanqpmkmc.supabase.co. Existing fixture card
28 (10 units) had no personal recipients. Added only assignment 4 for the actual
demo volunteer. The volunteer's My Service view showed one card and ten units.

Inserted marked test history 73 for unit 159 through the demo API. The open
volunteer map changed without reload from 0/10 (0%) to 1/10 (10%), and its
building from 0/4 to 1/4 (25%). Changed that test record from absent to met and
re-entered the card from My Service: the record and percentages persisted.
An authenticated volunteer compact-card read retained the recipient and both
leader names; get_card_summaries returned completed=1, units=10, progress=10.

Important distinction: the personal-card link opens /map?cardId=28, which uses
the full store, whereas My Service uses the compact recipient store. This smoke
therefore covers recipient listing, full-map realtime updates, and authenticated
compact projection/summary responses separately. It does not claim an end-to-end
scoped assignment-map UI test. The My Service card itself does not show a numeric
percentage. Existing summary/transform semantics exclude absent from completed;
the map's visited counter includes absent. No counting semantics changed here.

The map was read-only without an active service session, so the test writes used
the demo API, not the volunteer's visit buttons. No write-UI validation is claimed.
The first browser tab stopped reacting to clicks; a fresh tab worked normally.

Cleanup: invalidate_visit_history_tx successfully invalidated test history 73
(audit retained), restored unit 159 to unvisited, and the open map returned to 0%.
Deleted only test assignment 4; My Service then showed zero assigned cards.
Existing units, cards, leader assignments and other histories were not changed.
Proof: scratch/demo-card-projection-progress.png. Production remains unchanged.
