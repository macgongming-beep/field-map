# Demo navigation recovery and home reads

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

## Verification

Pending focused tests, mutation tests and demo network measurement.
No DB schema change and no production switch/deployment in this work.
