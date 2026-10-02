# Task 1 implementation report

Implemented storage integrity and safe source recovery in the authorized shared checkout. Changes are uncommitted.

## Changes

- `backup.ts`: snapshot merges take maximum cumulative visits/time instead of summing them; independent source/series merges retain additive counters. Canonical chapter URLs reconcile edited identities during import. Export dependents, queue and covers are limited to actually exported series. Committed library import returns `settingsWarning` if Chrome settings fail; Data view displays that precise partial-success message.
- `chapters.ts`, `tracking.ts`: display label correction no longer changes detected chapter key. Canonical URL matching precedes detected-key lookup on chapter opening, listings and import, including compatibility with previously edited keys.
- Manual unread now resets partial progress even if not already completed. Lowering progress clears all completion evidence above the selected chapter, including automatic completions.
- Optional durable `Chapter.progressRevision` defaults to zero and increments for manual read/unread/progress changes. Automatic progress/next-link completions require matching revision; omitted legacy revision is accepted only at revision zero. Rejected progress returns stored progress/revision with `stale: true` and does not add reading time or history.
- `TrackResult.chapterProgressRevision` and `.chapterProgress` expose synchronization state. `ProgressUpdate.progressRevision`, `OpenOptions.completedViaNextRevision`, and fourth `completeChapter` argument carry automatic evidence revisions.
- Manual chapter mutations emit best-effort `chrome.storage.local` `reading:revision` `{ seriesId, at, token }` after committing. Notification failure never reverses committed manual data; durable revision rejection remains the fallback. Parent owns worker/content synchronization.
- Optional `SeriesSource.removedAt` preserves original source, chapter URLs, progress and history on removal. Active source lists and Continue exclude removed source records. Continue selects a matching remaining chapter or the remaining source series URL; no historical chapter is reassigned to another host. Export/import retains removed sources and their associated records.
- Update checks reject mismatched titles and unsafe/unmatched redirects before chapter ingestion and record source failures. Confident same-host/title relocation remains supported.
- Completed special chapters can continue through their next link.
- Database schema and portable export versions advance to 2 with explicit v1 migration; repairs default legacy revisions and retain optional removal metadata. Historical source IDs remain in `Series.sourceIds`; `listSources` returns active records.

## Evidence

- Promoted audit reproductions into `tests/storage/integrity.test.ts`; red baseline: 7 failed, 1 passed before implementation.
- Added meaningful coverage for repeated snapshot/event identity, corrected display identity, lowered manual and automatic completion, stale progress/next-link after database restart, notification failure, source preservation/backup roundtrip, matching remaining-source Continue, unrelated update failure metadata, legacy export migration, and actual v1 database migration.
- Updated existing source-removal expectation to historical identity preservation and export version expectation to 2. Missing-migration test now explicitly omits step 2 rather than assuming it does not exist.
- Latest `npm run check`: typecheck passed, 17 test files / 146 tests passed, production build passed (2026-10-01 during shared integration).
- Reviewed scoped diff for transaction boundaries, additive versus snapshot merges, original source identity, migration compatibility and partial-success reporting.

## Limits and integration notes

- IndexedDB and Chrome settings are intentionally not a cross-store atomic transaction. A settings failure leaves the valid committed library and reports this explicitly.
- This task does not reconstruct source identities damaged by older source-removal behavior; deleted historical associations cannot be inferred reliably. New removals preserve them.
- Parent must send observed revision with progress/completion and proactively reset active reader state when `reading:revision` changes. Storage rejects stale writes independently, but reader reset is necessary to avoid treating unchanged old scroll as new reading evidence.
- No new network services, dependencies or remote data flows were added.

## Independent-review corrections

Resolved both findings in `task-1-review.md`, scoped to `backup.ts` and additional import regressions in `tests/storage/integrity.test.ts`.

- Red baseline: four new targeted regressions failed for stale Replace progress, older snapshot erasing newer local unread, newer imported correction ignored, and replacement of an existing removed source. Corrected a test Chrome stub before recording the genuine four-failure baseline.
- Replace chapter progress now receives a durable revision strictly greater than both persisted and imported revisions, even if visible progress is equal. Post-commit `reading:revision` notification invalidates active readers. Notification failure preserves the committed library and revisions still reject stale messages.
- Merge progress policy: revision-zero legacy observations combine maximum evidence/counters; a greater imported revision supplies explicit completion/progress, with another revision advance when applying changed evidence; greater local or equal nonzero revisions retain local explicit completion/progress. Counters remain snapshot maxima in every Merge case. This conservative tie policy prevents snapshots from erasing current manual corrections; revisions from independently diverged backups do not establish wall-clock ordering.
- Existing matched sources retain internal identity and original URL fields. Replace applies imported `removedAt` and `disabled` in both directions. Merge preserves removal from either side and unions disabled state; it never silently reactivates a removed source. Continue derives from that restored active-source state.
- Added six import tests total, including both source removal directions, tie policy, stale write history/time invariants, notification success and failure.
- Green validation: all 22 integrity regressions pass. Full `npm run check` passed typecheck, 165 tests in 22 files and production build during shared integration; reran the integrity suite after making every Replace revision strictly greater.
