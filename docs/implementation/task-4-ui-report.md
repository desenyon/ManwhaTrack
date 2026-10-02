# Task 4 — Manual tracking and chapter reassociation UI

## Implemented

- Manual fallback reachable in app menu and command palette, empty library and Detection Inspector when no series is tracked/detected.
- Native manual dialog prefills only the actual active tab's safe http/https address and existing tab title. Unsupported addresses leave the fields blank. Users can correct title/address and select status.
- Title/address validation, duplicate prevention during writes, visible errors and retained draft after failure. Successful storage write publishes library change, reloads and opens the actual added/existing series detail. No invented chapter/source URL.
- Existing chapter editor offers other nonremoved series as destinations. Selecting one shows meaningful confirmation text explaining preservation of progress/history and future detector association; the explicit Move chapter button confirms that operation.
- Move invokes root's transactional storage function, publishes both affected series and opens destination details. Storage errors leave the dialog and selection intact. Label edits and moves are separate explicit actions; the confirmation states that unsaved label changes are excluded.
- Chapter label save now shows errors and prevents invalid numeric ordering values and concurrent save/move requests.

## Verification

- Typecheck and build pass. Full unit suite passes: 26 files, 186 tests.
- UI regression tests pass: 3 files, 6 tests. Added manual URL scheme rejection and failed-write draft retention/successful retry publication tests.
- Root owns transactional storage tests and Chromium QA, including restart/redetection, move history fidelity and browser focus behavior. No E2E files modified by this worker.

## Files

`src/sidepanel/components/ManualSeriesDialog.tsx`, `src/sidepanel/App.tsx`, `src/sidepanel/views/HomeView.tsx`, `src/sidepanel/views/InspectorView.tsx`, `src/sidepanel/views/SeriesView.tsx`, `tests/ui/manual-series.test.ts`.
