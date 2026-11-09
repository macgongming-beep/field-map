# Remove unreferenced production chat images

- Date: 2026-11-09 (Asia/Seoul)
- Status: production deletion completed and verified.
- Scope: the five currently observed images in the production chat-attachments
  bucket only. No bucket deletion, chat-message deletion or policy changes.

The user explicitly approved deleting the chat photos after the chat retirement
review. A fresh read confirmed five JPEG/PNG objects totaling 13,983,844 bytes,
14 chat messages and zero non-null message image references. Deletion must use
the Storage API, not SQL DELETE against storage.objects, so backing objects are
removed too. Recheck the expected count, size, MIME types and references before
deletion; never empty the bucket broadly or include newly uploaded objects.

Do not download or make a new copy of the photos. Existing DB backups contain
database records, not these image bytes. Removal has no application undo.
Keep messages, comments, other buckets and existing retention settings intact.

This does not disable future chat uploads or retire chat. Those require the
separate reviewed feature/policy change. Storage absence does not establish
that pre-existing browser/CDN copies have been purged everywhere.

## Result

The Storage API removed the five explicitly selected paths (13,983,844 bytes).
A fresh database read found zero objects remaining in chat-attachments, with
all 14 chat messages unchanged and zero image references. No photos were read
or downloaded, and no other buckets, data or permissions were modified.
