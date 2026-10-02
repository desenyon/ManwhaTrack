# Task 1 independent review

Verdict: **changes required**. Spec compliance is substantially improved, but backup conflict handling still bypasses two new integrity guarantees. Code quality is otherwise appropriate: scoped changes, transactional library writes, pure Continue derivation, and explicit compatibility defaults without destructive resets.

## Findings

### P1 — Replace import leaves an active tracker authorized to overwrite restored unread progress

Location: `src/storage/backup.ts:347–352`.

When an existing chapter is replaced, the import assigns `completedAt`, `completionSource` and `maxProgress`, but leaves its durable `progressRevision` unchanged. It also does not emit the manual-progress invalidation notification. Concrete sequence: an active tracker has revision 0 and has reached 90%; import a backup using Replace whose same chapter is unread with progress 0; the existing chapter remains revision 0; the pending `recordProgress(... progress: 0.9, progressRevision: 0)` is accepted and immediately completes it again. This defeats the newly added revision protection at an explicit user progress change. Merely copying the backup revision would also be unsafe because an old revision can equal the active reader's revision.

Increment the existing chapter's revision when replacement changes its progress/completion state, and synchronize affected active readers after commit using the same notification mechanism as manual mutations. Add a targeted test that imports a lowered chapter while an old observation remains in flight and verifies no completion/history/time is added by that observation.

### P2 — Existing-source imports ignore the backup's removed-source state

Location: `src/storage/backup.ts:334–342`.

`removedAt` survives a clean-database roundtrip because the source is copied only when no canonical match exists. When the source already exists, none of its imported fields are applied—even in Replace mode. Concrete sequence: back up a two-source series after removing source A; import that backup with Replace into a database where A and B already exist and A is active. A stays active, appears in `listSources`, and remains eligible for Continue because its `removedAt` was never restored. The opposite direction also fails: Replace cannot restore an active source over an existing removed source. This is an actual gap in backup compatibility for the newly persisted removal marker, beyond the clean-database case in the added tests.

Define source-state conflict semantics and apply at least `removedAt`/`disabled` for Replace to an existing canonical match while preserving internal identity and URLs. Verify both active-to-removed and removed-to-active replacement and the resulting Continue destination.

## Accepted areas

- Snapshot chapter counters use maxima; ordinary independent-series/source merges retain addition. Existing event IDs are skipped on reimport, so the covered repeated snapshot path is idempotent for counters and events.
- Edited chapter labels no longer alter the detected source key; canonical URL lookup covers older corrected keys for openings, listings and imports.
- Manual unread and lowered numeric progress clear completion evidence and invalidate stale observations transactionally. Legacy omitted revisions are accepted only at revision zero.
- New source removals preserve source IDs, original chapter URLs and history; active-source Continue selection avoids assigning historical URLs to another host. Export dependents and queue entries are restricted to exported series IDs.
- Update observations with an unrelated title or unsafe/unmatched redirect are rejected with failure metadata before ingestion. Same-host/title relocation remains supported.
- Schema/export version 2 has explicit v1 migration and repair defaults. Migration adds optional metadata without resetting prior records.
- Settings failures after committed library import return a precise partial-success warning, and the Data view surfaces it without entering the unchanged-library failure path.

## Review evidence and limits

Reviewed the supplied brief, report and scoped review diff plus the directly related import, source, summary, tracking, schema/migration and repository implementations. The supplied report records 146 passing tests, typecheck and build; these checks were **not rerun**, as requested. Findings above follow directly from the read/write paths and are not claims of newly executed reproductions. Parent-owned background/content work is outside this review.

## Scoped re-review after import corrections

Verdict for the requested Task 1 corrections: **pass**. The original P1 and P2 findings above are resolved in the current `backup.ts`; no further blocking defect was found in these scoped changes.

- Replace fences every matched chapter with a revision strictly greater than both local and imported revisions, including equal visible progress. Its post-commit reader notification cannot roll back the import; failed notification still leaves durable stale-write rejection intact.
- Merge preserves newer local and equal nonzero explicit progress, applies greater imported revisions with an appropriate fence, and retains snapshot maximum counters. The conservative equal-revision rule is documented; independent branches do not supply a global correction ordering.
- Existing matched sources now apply imported removal/disabled state in both directions under Replace. Merge keeps removal from either side and does not silently reactivate disabled sources. Original IDs and URLs remain unchanged.
- The additional targeted tests cover stale-write time/history invariants, notifications, correction precedence, and both source removal directions. The implementation report records a passing targeted suite and full checks; I did not rerun them.

Integration note: the subsequent Task 4 schema/export version 3 is intentional and outside these corrections. The current legacy-backup test in `tests/storage/integrity.test.ts` still expects the migrated output to be version 2; update that assertion to the current versions before final integrated validation. This is a stale test expectation, not a objection to the version 3 migration.
