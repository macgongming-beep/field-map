# Demo request and log edit refresh

- Date: 2026-10-19
- Status: demo verification

Only VITE_DEMO_MODE=true injects the new callbacks. Production keeps its
existing refresh paths for these four operations.

Restaurant request submission and request memo edits read restaurant_requests
only. Approval, rejection, registration and visit writes keep their previous
contracts. A failed request read preserves the previous list. A committed
submission whose refresh fails returns success with an explicit warning so the
UI does not invite a duplicate insert.

Return visit log edits and invalidations read return_visits and return_visit_logs
through the existing detail-only slice. The RPCs also recompute the parent
summary, so both reads remain necessary. Membership-changing operations retain
the territory refresh. No SQL, permission or notification changes.

Store tests cover all four operations in demo and production, authoritative
updated/deleted state, unchanged building/history snapshots in demo, no scope
refresh in demo, and retained scope refresh in production. A failed request
read test checks snapshot preservation and exactly one committed insertion.
These tests are not measurements of production byte savings.
