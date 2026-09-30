# Boundary recovery and private subscriptions

- Status: demo validation pending; not released to production
- Date: 2026-10-01

## Evidence and decision

Production read-only inspection confirmed that anon has no SELECT privilege on
notifications.user_id or chat_read_status.user_id. Subscribing to those private
tables caused repeated `invalid column for filter user_id` errors. Do not grant
table access to fix a subscription: notifications contain private message text.

Remove both invalid subscriptions. Notifications use the existing authenticated
get_my_notifications RPC, at most once per minute while visible, with a bounded
foreground catch-up and no overlapping timer reads. Initial and explicit reads
remain. Notification badges may lag by one minute. OS push delivery is unchanged.
Chat message signals remain realtime; private read receipts continue using the
existing authenticated chat recovery/polling (two minutes). Building and visit
realtime subscriptions are unchanged. This does not claim that those subscription
errors caused a measured amount of the previous bandwidth consumption.

## Boundaries

Initial, manual and post-mutation refreshes read full boundary coordinates.
Automatic recovery reads a paginated card_id/updated_at manifest and requests
coordinates only for added/changed rows. Absence in the manifest removes deleted
boundaries. Versions are compared for equality, not against the browser clock.
All application boundary writers already update updated_at. External SQL edits
must also update that column; manual refresh always bypasses the cache.

The cache is per store and committed only after all reads succeed. Older requests
cannot overwrite newer requests. Failed recovery falls back to a full read;
failed full reads preserve visible boundaries and surface a loading error rather
than clearing the map. More than 200 changed boundaries use a full snapshot.
Unknown/null versions are always reloaded. Every query is paginated.

## Verification

Unit tests exercise real query construction and cache reconciliation. Store tests
verify recovery vs manual/mutation wiring. Subscription tests guard the absence
of private table subscriptions and retention of chat message signals. Timer tests
cover visibility, cleanup, disabled state, failure and overlapping requests.

Mutation check: restoring full boundary reads and the private chat subscription
caused seven new regression tests to fail (eleven other focused tests passed).
Mutations were reverted. Demo smoke also checks that a two-minute foreground
return fetches the boundary manifest, not the coordinate payload.

No DB schema, grants or policies are changed. Production rollout is separate.
