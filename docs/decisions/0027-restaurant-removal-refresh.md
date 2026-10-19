# Restaurant removal refresh

2026-10-19. Demo only; no database or permission changes.

The v2 assignment mutations received `refetchResources`, which refreshes assignments and informal assets but not buildings/units. Successful restaurant removal therefore left stale rows until reload; realtime was not a reliable substitute for post-write refresh.

Restaurant list removal, place deletion, legacy building flag changes and bulk flag changes now use a separate callback: refresh the affected buildings/units/histories, recompute card stats, and refresh resources. On targeted-read failure, fall back to full buildings/cards/visits/resources reads. Informal/assignment-only mutations retain their existing resource refresh.

Deletion semantics are unchanged. A server response of `requested` does not hide a place. Once a unit is deleted, refresh runs even if empty-building cleanup returns an error, throws, or becomes a deletion request. Unrelated buildings remain untouched.

Verification: 1,413 tests / 184 files, lint and build pass. Nine new cases cover store wiring, list/place removal, fallback, partial deletion and request-only results. Removing the store callback makes all three new store integration cases fail; restored before full verification.

Live demo: code `874ae3a` deployed READY as `dpl_5pKrk6QVqDJyKj2QozumjypMpSLh`. Applied the PWA update before testing. Created and approved two disposable requests through the UI. `DEMO-REMOVE-LIST-1019` disappeared immediately after list removal (six to five restaurants); `DEMO-REMOVE-PLACE-1019` disappeared immediately after place deletion (five to four restaurants). No reload or navigation occurred between deletion and checking each result. The original four restaurant rows remained.

Fixture state: list-only test building 129 retains its non-restaurant unit by design; place test building 128 has zero units and is no longer a restaurant. These records were not forcibly purged past the existing safe-deletion contract. Evidence: `scratch/demo-restaurant-list-removed-874ae3a.png` and `scratch/demo-restaurant-place-removed-874ae3a.png`. Production unchanged.
