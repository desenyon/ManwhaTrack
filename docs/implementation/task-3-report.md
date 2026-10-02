# Task 3 — Production Violet / Folio UI

Implemented in the authorized checkout, uncommitted. The approved prototype is the visual authority. Root owns browser QA and screenshots; this report does not claim those checks have passed.

## Changes

- Warm ivory/paper and plum-night tokens, violet accent, local Georgia headings, thin rules and compact utility typography across panel, detail, inspector, queue, history, settings and palette.
- Bundled approved hands/landscape in `public/assets`; existing static build copies them. Actual cached covers are preserved. Narrow featured Continue uses a compact engraved header; wide library uses an illustrated editorial split and four-column shelf. Current Now Reading series is excluded from the featured Continue composition.
- Native `dialog.showModal()` supplies browser focus containment/background isolation; mount-only lifecycle preserves focus while typing across callback changes, Escape uses the latest close callback, and closing restores the triggering control. Dialogs and menus are viewport bounded and scrollable.
- Grid/list selection parity, visible favorite/pin indicators, source and last-read metadata, action menus and modifier/middle-click Continue. Removed incomplete listbox semantics from library; list/listitem semantics retained. Items receive real DOM focus from j/k and arrow navigation, including virtualized rows.
- Loading/retry/error states for main library, chapter history and event history. Cover failure/pending diagnostics use root's local cover-status module and offer retry through the existing worker action.
- Confirmations for duplicate merge, source removal, local rule deletion, chapter deletion and individual event deletion. Existing full-history confirmation and series remove Undo retained.
- Series optimistic writes serialize and roll back only affected records. Queue writes serialize against their most recent recovered queue; failed reorder/removal/toggle produces a precise error. Drag reorder is persisted on drop, avoiding transient unpersisted global queue changes.

## Verification

- `npm run typecheck` passed.
- `npm run build` passed; bundled sidepanel and options CSS include local art references.
- `npm run test` passed: 22 files, 159 tests.
- Added `tests/ui/dialog.test.ts`: stable focus across rerenders, restored trigger, latest Escape callback.
- Added `tests/ui/library-mutations.test.ts`: failed record rollback preserves successful unrelated record edits; failed queue write is restored before a following edit persists.
- Tests run against JSDOM for React lifecycle and local hook behavior. Native focus containment, inertness, visual contrast, sizing and navigation require actual Chromium verification by root.

## Review notes and rulings

- Ruling: retain existing fixed-height 68px list virtualization. Editorial spacing is concentrated in shell/grid/featured area so large local libraries preserve compact performance.
- Ruling: use native browser confirm for narrow destructive single actions rather than add parallel confirmation-state machinery; existing multi-step merge/history workflows retain native dialogs.
- Ruling: no commits or new worktree; user authorized this shared checkout and requested reviewable uncommitted work.
- The parent worker should inspect 280/320/380/480/wide widths, both themes, long chapter labels, queue controls, source rows, grid selection, menu boundaries, native Tab/Escape focus behavior and middle-click navigation. This agent did not change E2E tests.
