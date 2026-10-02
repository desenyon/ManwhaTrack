# Collections, exact Resume, and expanded library

Scope: approved local-only extension, preserving all earlier uncommitted work.

## Contracts and ownership

- Reading position packet: content reader/lifecycle, background messages, shared message contracts, Chapter optional readingPosition, schema/migrations (version 4), chapter repository, dedicated position tests. Position is latest viewport location, distinct from maxProgress. Validated against current chapter sender/revision, restore only upon explicit Resume, no scroll on ordinary visits. SPA/layout delays cancel on navigation/user input. Provide root message/type contract and report backup needs. Do not edit backup/UI/styles/build.
- Collections packet: standalone Collection type; records under IndexedDB meta key `collections`, stable generated ids + names + seriesIds. Transactional create/rename/delete/assign, deleting list preserves series, removed members excluded from counts. Preserve across reopen and backups. Own collection storage, hook, dialogs/components, SeriesView and BatchBar assignment controls, backup and tests. Do not edit shared models/schema/migrations/App/Home/styles/messages. Provide integration props to root. Tags remain arbitrary series metadata and get clear assignment UX.
- Root: App/Home navigation Continue + New + Collections chooser, expanded local library.html tab/entry/build, brand SVG and icons, typography/CSS, integration/E2E/visual QA/docs. Merge UI integration after leaf contracts available.

## Verification targets

1. Explicit Resume restores latest (including backward) reader viewport position after reload/worker restart without changing completion or creating progress from restoration. Invalid/stale position rejected. No auto scrolling on ordinary chapter opens.
2. Collections persist after complete browser profile restart, rename/delete/membership changes preserved, backup roundtrip works, duplicate names and invalid references validated. Deleting a list preserves all reading records. Tags persist/search/filter.
3. Sidebar primary navigation is compact at 280px; New reflects updates for active reading, Continue displays new count. Full library accessible from visible header control and retains same local data/actions.
4. Brand coherent and legible 16px toolbar through expanded header; fonts fully local. QA light/dark, narrow/wide, dialogs/focus, no overflow/remote requests.
5. Focused regression tests then whole check, browser acceptance, package integrity. No commit/push/install into user Chrome.

## Integration ledger

- Position and collections packets integrated without overlapping UI edits. Sources merge/purge additions use the collections transaction contract; position adoption is restricted to the same canonical chapter URL and matching adopted revision.
- Independent source review corrected input/revision cancellation, list search scope, viewport import conflicts and cross-library list identity ambiguity.
- First Chromium run passed list/tag/expanded-page/profile-restart and bulk assignment checks; rapid reader close exposed loss of the final position. Live coalesced checkpoints now write while tab authorization remains available, preserving the original sender guards. Root replay includes an explicit furthest-progress assertion.
- Visual review corrected oversized long list headings (two-line limit, full title retained for accessibility), limited collection featured Continue to its own members, and waited for theme transitions before capturing controls.
- Final integrated acceptance and packaging are recorded in collections-resume-verification.md.
- Delivery checks complete: TypeScript, 240 unit tests, production build/package, all 12 distinct Chromium scenarios across acceptance runs, final 280px dialog inspection and byte-for-byte ZIP verification. Resume was observed within 4 pixels after a full profile restart, and subsequent wheel movement persisted after reader closure.
