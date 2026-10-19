# Pending restaurant requests only

- Date: 2026-10-19
- Status: demo implementation; not approved for production

RestaurantServiceSheet displays the current volunteer's pending requests;
RestaurantsTab displays pending requests for review. Neither uses approved or
rejected rows. The shared restaurantRequests slice now filters status=pending
on the server only when VITE_DEMO_MODE=true. No rows are deleted, and no SQL,
permission, notification or write contracts change. Production retains its
existing unfiltered query.

All initial and post-save reads share the same filter. Submission and memo saves
still refresh the authoritative request list. Approval/rejection keep their
existing refresh paths, and reviewed requests disappear after the read. Read
failures preserve the previous snapshot and surface an error. This is not yet
lazy loading; pending requests still load with the initial store.

Tests cover server-side filters and reviewed-row removal in demo, unchanged
production queries, user/admin/developer roles, and the existing save/failure
suite. Live demo verification is required before claiming UI completion.
