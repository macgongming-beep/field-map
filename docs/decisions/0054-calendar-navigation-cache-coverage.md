# Reuse complete calendar coverage on frequent navigation

- Date: 2026-10-30
- Status: demo verification in progress; production unchanged
- Related: 0043 bounded windows, 0045 personal calendar, 0047 leader routes, 0053 scoped histories

## Audit and scope

Home, calendar, My Service and leader zone already retain exact calendar keys for
two minutes. A base personal-service scope and a map targeting an event have
different keys, even when the target is already in the base snapshot. A miss
starts calendar/index/assignment reads and, in recipient mode, refreshes the
recipient territory, cards and histories again. A hit avoids that entire path.

The existing foreground handler still calls `fetchAll(true)` after its two-minute
cooldown. Calendar caches are deliberately invalidated on recovery. Building
delta recovery and bounded histories/sessions do not mean that cards, resources,
settings and the requested calendar scope are unchanged-data checks. This change
does NOT reduce that foreground refresh or extend its cooldown.

## Decision

`VITE_CALENDAR_NAVIGATION_REUSE_ENABLED` follows `(flag ?? VITE_DEMO_MODE) === 'true'`.
Production remains opt-in after review. The existing exact-key cache behavior
is preserved when disabled. With the feature enabled, navigation may also reuse:

1. A complete containing date window, filtered inclusively to the requested
   dates. October 16-November 30 covers November, but not the entire October.
2. A base `service:[user,date,null]` snapshot for `service:[user,date,target]`
   only if user/date match and the target event is already present. Return the
   entire base snapshot, with all participants, all teams and old/future events.

No reverse reuse from a targeted snapshot to a base/other target, no cross-user
or cross-day reuse, no partial-window reuse, and no full statistics/editor reuse.
Missing targets still read the server. Derived snapshots do not renew timestamps
or grow the cache; the existing six-entry bound and two-minute TTL remain.
Only memory is reused; no new personal data is persisted on the device.

## Invalidation safety

- Enabled navigation reuse also guards cache publication with an invalidation
  epoch. An older in-flight read cannot repopulate a cache cleared by a queued
  mutation/recovery, even when the replacement later fails.
- Queued/running invalidating refreshes block cache hits until settled; navigation
  must not supersede the required authoritative refresh using cached data.
- Resource refresh clears calendar caches because restaurant assignments affect
  personal-service membership. Restaurant assignments and participants are subscribed
  on the existing calendar channel, behind the same flag and two-second debounce.
  Participant updates must refresh coverage even when cart applications are off.
  These tables are already present in the baseline realtime publication. No DB
  migration, new channel or permission change is introduced.
- Foreground, reconnect, writes, manual refresh and identity changes retain
  invalidation. Display cache never becomes a recipient authorization snapshot.

## Verification

- Helper tests cover flag precedence, target presence, user/date isolation,
  window containment, all-team preservation, TTL inheritance and clock reversal.
- Store tests cover home/service/map/leader-zone trips, next-month navigation,
  exact old behavior with false, all invalidation causes and changed applicants.
- Recipient integration runs both flag states: disabled map navigation invokes
  calendar, cards and histories plus recipient refresh; enabled navigation adds
  zero mocked table reads and does not refresh/replace buildings or histories.
- Queued recipient read -> invalidation -> old response -> failed replacement ->
  navigation is tested; the old participants must not return from cache.
- Realtime tests check opt-in subscriptions, debounce, cleanup and another person
  joining before a containing home window is reused for next-month navigation.
- Browser demo verification and final suite results are recorded below when done.

Request-count assertions above are instrumented tests, not wire captures. No
monthly saving, foreground saving or production-byte claim is made.

## Remaining work

Prioritize a separate fresh-service-calendar reuse audit: the same operation's
complete personal calendar may replace duplicate recipient assignment discovery.
A TTL-cached display window cannot do so. Foreground version checks for low-change
slices require complete server change signals before skipping reads. Avoid merely
lengthening the cooldown or hiding real-time participant/comment updates.

## Rollback

Set the new flag to false and rebuild/redeploy; installed clients apply the PWA
update. This restores exact-key navigation caching and removes the additional
restaurant subscription. No production activation is included in this task.
