# Demo group creation and asset movement refresh

- Date: 2026-10-20
- Status: implementation and demo verification in progress

Group creation changes informal_groups. Asset group movement changes
informal_assets.group_id. Neither changes event assignments or building scope.
Demo-only callbacks therefore refresh groups after creation, and the active
asset list plus groups after movement. This is a catalog refresh, not a
single-asset delta. Bulk movement refreshes once after all writes settle,
including partial successes. Group deletion and asset deletion are unchanged.

Missing callbacks preserve existing production behavior. Failed narrow reads
fall back to resources; move recovery requires both groups and assets to load.
Failed strict reads preserve the previous snapshots. Asset response versions
are shared between resources and the new informalAssets slice so an older read
cannot overwrite a move. The new slice is not added to ALL_SLICES.

No schema, permission, notification, or production flag changes are requested.
Verification results will be appended after tests and live demo checks.

## Automated verification

- 1,542 tests passed across 188 files; lint and build passed.
- Disabling both demo callbacks makes exactly the two narrow-read assertions
  fail; their production-mode counterparts still pass.
- Independent review found two superseded-read races; both are covered with
  reversed completion-order tests and demo-only recovery semantics.
- Bulk refresh failure retains selection and suppresses success messaging;
  retry is covered in a component test. Partial write failures retain IDs.
- Production creation without the optional callback retains its prior rejected
  refresh contract. A confirmed demo insert returns its ID even if recovery
  fails, avoiding duplicate creation on retry.

## Next candidate: calendar (read-only investigation)

useStore's calendar slice currently reads all calendar_events with nested
participants, all event_card_assignments, and all event_card_assignment_cards,
paginating by 1,000 without a date condition. ALL_SLICES includes calendar, and
calendar mutations refresh that slice. This confirms a broad-read candidate,
not its daily request frequency or egress share.

Consumers prevent simply restricting the shared array to this month:
- ServiceAttendanceStats filters the passed events for multiple selected months.
- MobileHome uses the array for today's events, historical service views and
  assigned map scope.
- recipientStore reuses a supplied calendar to resolve accessible cards; when
  absent, recipientPreview separately reads the user's assigned event IDs.

Proposed follow-up: separate currently needed calendar pages from historical
month reads and authoritative assignment scope. Month switching and multi-month
statistics must explicitly load complete selected months, with loading/error
states, rather than showing missing participants as zero. Participant removal,
recurring edits and assignment revocation need cross-cache invalidation tests.
No calendar implementation or production-data measurement is included here.
