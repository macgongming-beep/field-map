# Restaurant removal refresh

2026-10-19. Demo only; no database or permission changes.

The v2 assignment mutations received `refetchResources`, which refreshes assignments and informal assets but not buildings/units. Successful restaurant removal therefore left stale rows until reload; realtime was not a reliable substitute for post-write refresh.

Restaurant list removal, place deletion, legacy building flag changes and bulk flag changes now use a separate callback: refresh the affected buildings/units/histories, recompute card stats, and refresh resources. On targeted-read failure, fall back to full buildings/cards/visits/resources reads. Informal/assignment-only mutations retain their existing resource refresh.

Deletion semantics are unchanged. A server response of `requested` does not hide a place. Once a unit is deleted, refresh runs even if empty-building cleanup returns an error, throws, or becomes a deletion request. Unrelated buildings remain untouched.

Verification: 1,413 tests / 184 files, lint and build pass. Nine new cases cover store wiring, list/place removal, fallback, partial deletion and request-only results. Removing the store callback makes all three new store integration cases fail; restored before full verification. Live demo validation pending.
