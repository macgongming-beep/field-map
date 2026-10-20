# Startup, foreground and closed-chat read audit

- Date: 2026-10-20
- Production baseline: `8a4ffdc`
- Scope: read-only production audit; demo-only chat reduction; no database changes

## Evidence and limits

The refreshed Supabase dashboard at about 23:04 KST reports the current cycle
(17 Oct to 17 Nov) at 0.349 GB for the organization and 0.329 GB for production.
These are cumulative, rounded, delayed dashboard readings, not daily rates or
proof of savings. The organization is still Free. The dashboard states a grace
period ending 10 Nov, with restrictions if the organization remains over quota.
Do not extrapolate an old 270 MB/day observation as the current measured rate.

The production Logs Explorer was queried read-only for Last 24 hours around
23:05-23:08 KST. Its built-in Top Paths template and one path-only aggregation
returned the following request counts (all methods; not unique users or bytes):

| Path suffix | Requests |
| --- | ---: |
| service_sessions | 616 |
| event_participants | 601 |
| calendar_events | 458 |
| buildings | 389 |
| rpc/get_my_notifications | 312 |
| rpc/get_chat_message_meta | 267 |
| rpc/get_my_chat_reads | 265 |
| visit_histories | 258 |
| cards | 242 |

The Top Paths query with parameters also showed the closed-chat loader's
membership, leader, participant-count and session projections repeatedly.
For one account, participant-count and session projections each appeared 240
times. Do not publish account identifiers or multiply these counts by an assumed
body size to claim billable MB.

Supabase's current documentation explicitly says API Gateway logs do not include
response byte data:
https://supabase.com/docs/guides/platform/manage-your-usage/egress#most-requested-api-endpoints
Thus "sum response sizes by path in ten minutes" is not supported by this log
source. Request frequencies help select scenarios for authenticated transfer
measurement, but cannot establish a byte ranking or identify manual versus
foreground reads with the same query.

## Current store behavior

`fetchAll(true)` still requests `ALL_SLICES`. It is not an all-delta refresh.

| Domain | Initial load | Foreground recovery |
| --- | --- | --- |
| Buildings | Full tree for full store; scoped tree for supported recipient routes | Index/signals and changed buildings, with fallback |
| Cards | All cards/assignments/regions; recipient summaries | Same broad reads |
| Boundaries | Device-cache validation or full coordinates; recipient scoped coordinates | Full-store manifest delta; recipient scoped coordinates again |
| Histories | Global valid last-365-day histories | Full store can skip after building recovery; recipient still reads global histories |
| Sessions | Personal for eligible recipient stores, otherwise global | Same filter, no date bound |
| Calendar | All events/participants and both assignment tables | Same, no date bound |
| Resources | Active assets, assignments and groups | Same broad reads |
| Notices | Latest 50 | Same |
| Return visits | Active records plus log index (detail bodies lazy) | Same |
| Other | Pending restaurant requests, periods, settings | Same |

Role and route matter: unsupported recipient routes, including statistics,
retain full-store behavior. Calendar's post-write optimization does not change
startup or foreground calendar reads.

Manual pull invokes `refetchAll()` without recovery, preserving a broad repair
path; it is absent on `/map`. No evidence here establishes how often people pull.
Keep this recovery mechanism unchanged for now.

## Closed-chat reduction

The mounted header calls `useUserChats` even when the chat overlay is closed.
Visible-document polling forces the loader every 120 seconds; reconnect/message
signals also refresh it. The header uses only unread counts and local mark-read.
Participant-count rows and session-ended rows are only needed by full chat lists.

The first demo change separates a badge-only loader mode from full-list caches,
skipping those two detail reads for the header. It must preserve room eligibility,
unread calculations, polling, realtime, local reads, and the full loader when a
chat list is opened. It does not drop messages or narrow time windows.

This is a verified repeated-read reduction, not the largest measured byte item.
The structural larger candidates remain unbounded calendar/participants,
global histories on recipient recovery, and full-store building trees. They need
screen-specific loading and completeness contracts before narrowing.

## Error monitoring follow-up

`PullToRefresh` explicitly captures actual rejected refreshes with the existing
Sentry client, excluding only `SupersededReadError` by type. A same-worded ordinary
Error is still captured. Spinner reset, retry, and the store-owned user error UI
remain intact; existing Sentry secret scrubbing is unchanged.

## Verification

- Full suite: 1,648 tests passed. Independent code review found no remaining blocker.
- Badge-only and full loaders have matching unread totals; old rooms, own messages,
  read receipts, local read updates, and subsequent full-list loading are covered.
- Badge cache/in-flight keys are session-specific and separate from complete lists.
  Render-history tests reject even a transient old-account badge on identity change.
- Header tests cover demo on, off and unset; full modal reads remain complete.
- Mutations removing detail-query gating and identity masking fail their tests.
- Actual errors are captured once by Sentry; typed cancellation is not captured.
- No production configuration or database changes are included.
