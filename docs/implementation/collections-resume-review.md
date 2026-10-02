# Independent collections and Resume review

Reviewed the final source for the October 2 collections, reading position, branding, and expanded-library changes. This is an independent source and regression review; integrated Chromium and rendered visual evidence are recorded by the root implementation agent separately.

## Verdict

No outstanding material finding in the reviewed implementation. The previously identified issues were corrected before this verdict. This conclusion covers the paths and checks below, not certification of every third-party reader layout.

## Verified contracts

- Collections use stable IDs under IndexedDB `meta/collections`. Names and active series references are validated; rename and membership changes share a transaction. Concurrent writes serialize without losing membership. Malformed existing collection metadata aborts changes rather than being silently overwritten.
- Soft removal hides memberships while preserving them for restore. Merge remaps membership, source split adds the new series while retaining the original, and permanent purge removes dangling membership. Deleting a collection leaves series, chapters, and history intact.
- Full backups preserve empty and populated collections and tags. Partial exports restrict members to exported series. Import rejects ambiguous collection identities/names and dangling references, and maps members onto adopted local series IDs under keep/merge/replace policies. Older backup versions migrate to version 4.
- Reading position is the latest viewport, separate from maximum reading progress. Backward movement updates the bookmark without reducing furthest progress or completing a chapter. Captures have bounded coordinates, optional image anchors, timestamps, and progress revisions.
- Explicit Resume creates a private session intent before navigating. Ordinary visits receive no restore intent. Intent consumption checks chapter, canonical route, revision, expiry, sender frame, and existing automatic tracking authorization, including ignored hosts and incognito policy. No position is embedded in the source URL or sent to a server.
- Restoration waits for layout settling, stops on navigation or reader input, and suppresses automatic reading/completion evidence until reader activity. Manual correction or a stale revision response cancels active restoration. Old chapter DOM cannot supply a new route's viewport; final flushing uses the last valid capture.
- Existing-chapter backup merge/replace adopts a valid position from the adopted progress revision and rebases it when import advances that revision. Same-chapter merges retain only same-canonical-URL positions belonging to the adopted revision.
- Custom list search is constrained to member IDs. List names survive session-selected view restoration; deletion switches the view to All. Continue/New remain primary navigation; update badges remain available on Continue items. Expanded `library.html` uses the same App and local database, and opens reading destinations in new tabs to retain the library.

## Findings resolved

1. `reading-position.ts` originally resolved cancellation as `userInput: false` before attempting `true`. Centralized `finish(userInput)` now settles it exactly once with the correct result.
2. Manual progress revisions originally did not cancel a restore already settling. Revision responses now cancel it, and its current-page predicate also compares the saved revision.
3. Existing-chapter imports originally lost incoming viewport positions or invalidated them during Replace. Validated snapshot selection and revision rebasing now preserve them.
4. Custom list search originally returned global library results beneath a list heading and a “Search this list” field. It now filters membership before returning search results.
5. The root browser run exposed unreliable position writes during actual tab teardown after a short session. Scroll measurement now checkpoints the current position while the tab remains alive, coalescing at 250 ms with a 300 ms minimum send interval and a trailing checkpoint. Hidden-page transitions measure immediately. Same/backward position-only writes avoid series recomputation and library broadcasts while retaining the chapter write and sender/revision checks. Abrupt termination before a settled checkpoint can still leave the prior saved position; teardown delivery is not used as a durability guarantee.
6. Cross-library imports could collapse two distinct local collections when one incoming ID matched a list while its name matched another. Preflight matches are now computed against the original local collection snapshot; divergent or multiply consumed target identities reject the entire transaction with actionable rename guidance. Regression checks all keep/merge/replace modes preserve both list memberships and unrelated series notes.
7. A source-key fallback import could apply an incoming viewport from a different chapter URL. Incoming position selection now requires equal canonical URLs even under Replace; the regression preserves the existing URL and rejects the foreign bookmark.

## Executed checks

Independent final re-review after browser-driven corrections: TypeScript passed. Ten focused test files passed, **65 tests** total, covering reading-position capture/restoration and lifecycle, short-session/trailing/hidden-page checkpoints, reader progress, saved positions, Resume message authorization, privacy write guards, collections, import identity ambiguity rollback, cross-URL bookmark rejection, backups, database migrations, and reading update views.

Command:

```sh
npm run typecheck && npm test -- tests/content/reading-position.test.ts tests/content/route-flush.test.ts tests/content/reader-progress.test.ts tests/storage/reading-position.test.ts tests/background/resume.test.ts tests/background/privacy.test.ts tests/storage/collections.test.ts tests/storage/backup.test.ts tests/migrations/migrations.test.ts tests/shared/reading-updates.test.ts
```

## Boundaries

Paged readers retain chapter/progress tracking but intentionally do not receive scroll-based page restoration; changing a reader's own page control requires adapter-specific support. Coordinate/image anchoring can adapt to changing image dimensions, but arbitrary site redesigns cannot guarantee an identical visual location. Schema migration does not invent a bookmark from historical maximum progress. No manual screen-reader audit or live-site universal Resume certification was performed by this reviewer. The root agent owns full browser-profile restart, offline collection/tag, expanded-library integration, screenshot QA, and final packaging evidence.
