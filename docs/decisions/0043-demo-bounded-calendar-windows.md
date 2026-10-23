# Demo: bounded calendar windows and short-lived month reuse

Date: 2026-10-23. Production is unchanged. Existing DEMO gate remains.

## Change

- Home/admin card allocation: last 14 days through the end of next month.
- Calendar: exact selected month, including arbitrary past/future months.
- Both date bounds are sent to the server; out-of-window responses are rejected.
- Assignment tables still read every page for the returned events. Participants,
  guests and assignment projections are unchanged.
- Up to six bounded windows remain in session memory for under two minutes.
  Revisiting a valid cached window restores it without a calendar read. This is
  not IndexedDB storage and not an authorization snapshot.
- Writes, realtime recovery, foreground and manual calendar reads clear cached
  windows. Targeted event refresh clears them too. Role/recipient changes and
  disabled stores clear them. AppSession already remounts per authenticated user.
- Full history is not cached here. Export, repeated-event editing, deep links,
  statistics and unaudited routes retain conservative full reads.
- The mobile subtitle now uses the selected month, not the current month whose
  rows may intentionally be absent from a historical-month snapshot.

## Validation

Full suite before final subtitle/role-clear changes: 1739 tests, 203 files passed.
Build and lint passed. Scope tests cover upper bounds, leap years/year rollover,
historical participants/guests/assignment and attendance counts, paging, foreign
rows, failures, timeout/retry, stale responses, cache revisit, expiration and
invalidation by foreground/realtime/writes/manual reads.

Live demo browser: September 14 retains one applicant and three cart applicants;
October -> September revisits render the month correctly. No demo rows modified.
Network request suppression is established by hook tests, not by a browser HAR.
No real-handset latency measurement or two-device mutation test was performed.

## Deliberately deferred

- Do not promote unaudited routes from full history to bounded history: map and
  personal-service consumers can use future/past assignment events. This remains
  a source of full reads, not a solved issue.
- Realtime still refreshes the whole currently demanded calendar scope; targeted
  event invalidation is a separate change.
- Service sessions already filter to the current user only when role=user AND
  recipientReader AND recipientUser and the personal-session flag is enabled.
  Other paths still read full history. Developer time statistics consume it.
  Do not globally restrict dates without auditing consumers and preserving active
  sessions regardless of age. Visit-history 365-day contract is unchanged.
- Short-lived display reuse does not promise instant updates for an event whose
  change notification has not yet arrived. Existing foreground/reconnect/manual
  refresh behavior is retained. No monthly egress reduction is claimed.
