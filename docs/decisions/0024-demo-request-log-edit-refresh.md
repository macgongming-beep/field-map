# Demo request and log edit refresh

- Date: 2026-10-19
- Status: demo verified; independent production review passed

Initially only VITE_DEMO_MODE=true injected the new callbacks. The user approved
production activation after independent review; the activation removes these
two gates only. The unrelated service-session refresh remains demo-only.

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

## Verification

Full suite: 1,345 tests / 182 files; lint and build passed. Removing both
injected callbacks makes exactly the four demo detail-change cases fail while
the four production cases pass. Restored source matches the committed tree;
the focused 57-test suite passes again.

Demo a73cdb1 deployed READY as dpl_24RisGcX2acZhEBHxiDpyvy6LvoB, alias
chinese-territory-app-demo.vercel.app. Applied the app's update prompt before
testing. Browser mobile layout, not a physical phone:

- Created synthetic return visit 21 (DEMO-1019-수정삭제검증), no linked address
  or building. Edited its absent log to met with a new memo. Both appeared
  immediately and persisted after reload.
- Invalidated that log through the UI: zero logs and latest visit "not yet"
  appeared immediately and persisted after reload. Ended the synthetic target;
  active return visits returned to zero. Original audit history is retained.
- Submitted DEMO-1019-신청검증 with an explicitly fake test address. It appeared
  in the pending list without reload (the list is hidden while search is set).
- Entered its request-service flow and saved a test memo. The success toast
  appeared and the active session cleared. The volunteer preview does not
  display saved request memos, so logged into the supplied demo admin account:
  the approval list showed the exact memo, including after reload.
- Rejected only the synthetic request. Pending list cleared, restaurant count
  remained four. No real building/restaurant was created. No production writes.

Screenshots in scratch: demo-log-edit-a73cdb1.png,
demo-log-delete-a73cdb1.png, demo-request-memo-a73cdb1.png.
Live UI proves persistence/rendering, not wire-byte savings. Request omissions
are verified by store tests, not measured browser network traffic.

## Production activation verification

Extended the four operation cases across user, leader, admin and developer,
with demo both true and false. All assert authoritative detail state, unchanged
building/history snapshots, and no territory scope refresh. Request read failure
preservation is also covered with demo false. Full suite: 1,372 tests / 182 files;
lint and build passed. No schema or environment-variable changes are needed.

Independent review found a committed memo write followed by a failed refresh
could leave the caller's saving state locked. The mutation now reports that the
memo was saved but the list refresh failed, preserves the old snapshot, and
resolves so the caller clears its saving state. Added demo/production failure
tests; removing the catch makes precisely these two tests fail. Chinese and
English messages distinguish successful writes from failed refreshes.
Independent re-review passed with no remaining blockers (84 focused tests).
