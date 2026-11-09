# Retire chat on demo, preserve comments

- Status: implemented on demo; production not changed
- Date: 2026-11-09
- Predecessor: 0078 (production orphan photos already removed separately)

## Decision

`chatDisabled()` uses `(VITE_CHAT_DISABLED ?? VITE_DEMO_MODE) === 'true'`.
Production defaults to the old behavior; demo defaults to retirement; explicit false
restores the frontend. This is a build-time flag, not a runtime kill switch.

The header, calendar detail buttons (mobile/desktop), notification settings, chat
modal, and chat room honor the same flag. `useUserChats` itself skips initial reads,
polling, subscriptions, forced refresh and mark-all-read. Disabled results are empty,
and in-flight results cannot repopulate the cache. Hooks are not conditionally called.
The previous active-chat marker is cleared through the existing helper. No service
worker changes, publication changes, or changes to account-cache cleanup.

Old `openChat` links open the event's comments instead of a chat modal. The desktop
calendar selects the event's day and scrolls to its card. Normalized legacy path
links also become `openEvent`. Invalid/ambiguous links do not expand access.

**Explicit boundary:** existing calendar detail links still use the full calendar
scope. Merely renaming openChat to openEvent does NOT remove that read. A targeted
detail read is a separate optimization, not claimed as completed here.

## Notifications and comments

The migration deletes type `chat`, plus type `mention` with a recognized legacy
chat link. It does NOT delete `comment`, comment mentions (`openEvent`), event-change
alerts even when they use `openChat`, assignment alerts, or other notification types.
The frontend hides retired chat alerts too, covering stale cached notification lists.
Delivered OS push notifications cannot be recalled; their old links remain usable.

The initial implementation also exposed previously hidden plain comment notifications.
That expansion was withdrawn after review: plain `comment` and legacy `notice` alerts
remain hidden from both badge and list regardless of the chat flag. Comment mentions
remain visible, as before. Server comment creation and mention recipient/push filters
are unchanged. Mention preferences remain visible; only chat preferences hide.

Review reported 954 unread comments across 47 production users (maximum 76/person),
and 33 old chat alerts to delete. These counts are reviewer-provided, not remeasured
in this follow-up. No production deployment, notification deletion, mark-read bulk
operation or server trigger change is authorized by that review alone.
Whether to expose plain comment alerts, mark the backlog read, or stop generating
them is a separate product decision. New event-change links still use openChat on
the server; replacing that with openEvent is also a separate compatibility change.

## Server

`20261109_2100_retire_chat_writes.sql` keeps the signatures and grants of
`send_chat_message`, `send_chat_image`, and `create_system_chat_message`, verifies the
session and rejects before any message/auto-participation write. It removes only
`storage.objects.chat_attachments_upload`. Reads, existing messages, storage objects,
cleanup jobs, retention and privacy descriptions are unchanged.

This does not extend the existing retention period. Message preservation remains
subject to existing cleanup. Production photo deletion was a separate authorized action.

## Demo database verification

Tool: `DEMO_ENV_FILE=../chinese-territory-app/.env.test.local node scripts/chatRetirementDemo.mjs apply --confirm-demo`.
The script rejects any project other than `itjlykpjmlcvanqpmkmc` and checks DB+API
identities. Backup precedes `psql --single-transaction`; no transaction commands inside
the migration. Verified backup and exact old function/upload policy rollback:
`backups/chat-retirement-demo-1794224394702/` (private, ignored by git).

Before and after: messages 0 -> 0; notifications 81 -> 81. There were no old demo
chat notifications to remove. Synthetic chat/mention rows subsequently verified the
cleanup predicate, while comment-mention/event-change rows survived. Production old
notifications have NOT been deleted.

Live smoke (two isolated disposable accounts):
- All three old-client chat write RPCs rejected; no messages, auto-participants or
  notifications were created by rejected writes.
- Valid PNG upload rejected by RLS; chat read RPC still succeeds.
- Writer posts plain comment, reader reads it and receives `comment` with event link.
- Writer posts mention comment, reader reads it and receives `mention` with event link.
- Synthetic accounts, comments, event and notifications removed in finally.

The first upload probe used text/plain and was rejected by bucket MIME validation
before RLS. It was corrected to a PNG; only the second result proves RLS rejection.
Push delivery to a physical phone was not tested (no synthetic account subscriptions).

Browser verification on deployed demo (mobile-width in-app browser):
- Applied PWA update; header chat button disappeared.
- Opened `/calendar?openChat=137`; event detail and comments opened, not chat.
- As demo volunteer, selected the demo administrator mention and saved a comment.
- Logged into demo administrator: the Chinese notification center showed the comment
  mention; clicking it opened the same event and saved comment. Badge cleared on read.
- Notification preferences displayed mention only, not chat messages.
- Removed the synthetic event/comment/notification, restored the volunteer login.
- Screenshot: `scratch/demo-chat-retired-comment-20261109.jpg` (local artifact).

Actual browser check is distinct from the ten-minute hook network harness; no claim
of a physical iPhone or push-delivery test is made.

Ten-minute measurement completed: **600,032 ms, HTTP requests 0, realtime channels 0**.
`scripts/measureChatRetirementDemo.mjs` mounted the actual hook in badge and full
modes plus chat room/modal/notification-center components, with a real Supabase
client and real timers in jsdom. It forced refresh and dispatched visibility/online
events each minute. Login was performed once before the measurement and excluded.
This isolates chat-owned requests, not all application traffic. Raw result is in
`scratch/chat-retirement-ten-minute-results.json`.

## Tests

- Full suite: 2,306 tests, 231 files; lint and build pass.
- Flags: production opt-in, demo default, explicit false, disabled leaf components.
- Ten fake-timer minutes: no chat-owned table/RPC reads or subscriptions, including
  force refresh, modal, notification center and chat room entry.
- Pending read at retirement cannot restore rows/cache; re-enabling fetches again.
- Mobile/desktop old chat links preserve the comments surface and never mount chat.
- SQL execution in PGlite verifies write denial, upload denial, read preservation,
  and preservation of comment mentions and event-change notifications.

Mutation checks (source restored before shipping):
- Force retirement false: hook-only zero-read test fails with 36 table reads;
  header test fails because chat is visible. Combined leaf test also fails early
  at an intentionally unsupported ChatRoom mock; this is not the network proof.
- Replace the three SQL rejection statements with returns: three tests fail.
- Delete all mention notifications: preservation test fails.
- Keep upload INSERT policy: upload-denial test fails.

## Review follow-up: preserve hidden plain comments

The header continues excluding `comment` and `notice` regardless of chat retirement.
Comment mentions and event-change notifications remain visible. No existing comment
notification was marked read or deleted by this correction.

- Focused verification: 32 tests across header notifications/badges and retirement
  logic/SQL passed; lint and build passed. The full-suite count above belongs to the
  original implementation verification, not a new full-suite run for this correction.
- Regression fixtures contain 50 notifications, including 44 hidden plain comments.
  Both badge-only and full reads show the same three eligible notifications, before
  and after opening the panel; hidden comments never appear in the panel.
- Mutation: restoring the original retirement-dependent comment filter fails both
  cases, showing badge 47 instead of 3. Corrected source was restored and retested.

## Rollback and production

Frontend: set `VITE_CHAT_DISABLED=false`, rebuild/redeploy, apply app update.
This alone does NOT reopen server writes or restore deleted notifications.
Server: restore the backed-up exact functions and upload policy in one transaction.
Restore selected notification rows from backup only if required; do not restore the
whole live DB. Reopening public upload deserves separate security review.

Production remains unchanged. Before production: review code+SQL, make a fresh
production backup, inspect actual overloads/upload policies/notification categories,
apply server migration, deploy with the flag, verify comments and mentions again.
Do not infer monthly MB savings from zero chat requests in a controlled demo test.
