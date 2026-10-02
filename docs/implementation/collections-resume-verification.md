# Folio identity, Resume, collections and expanded library

This is the earlier acceptance snapshot. The simplified branding, roomier layouts, animated artwork and chapter-list scope correction are documented in [ui-polish-verification.md](ui-polish-verification.md).

## Implemented scope

- Violet folio/book monogram with engraved corner pixels, updated Chrome toolbar icons and a shared editorial wordmark. Local Baskerville/Palatino/Georgia font stack; no remote fonts or added dependencies.
- Latest reader viewport is stored independently from furthest progress, optionally anchored within the image crossing the viewport top. Resume registers a private one-use tab intent before navigation; ordinary page visits do not auto-scroll. Delayed layouts retry for up to 12 seconds; user input, navigation or manual progress corrections cancel restoration. Restoration alone records no reading time or completion.
- Named custom lists have stable IDs and transactional membership/name changes. They remain independent of reading status and arbitrary tags. Manager supports empty lists, per-list search/add/remove, rename/delete. Assignment is available from row menus, details and bulk selection. Deleting a list preserves series and history. Soft-removal membership is preserved for restoration; merges/splits/purge maintain consistent memberships.
- Continue and New form primary navigation. A compact list/view chooser retains all built-in views. New is limited to known unread chapters for Reading-status series that have actually been read. Continue displays +N new badges. Searching a selected list stays within it; global search still searches all records.
- A visible Expand library button opens `library.html`, a full local extension tab using the same database and UI bundle, with a navigation rail at wide widths. It opens reader destinations in a new tab so the library stays available. Settings also link to the full library.
- Schema/export v4 preserve existing data and migrate old backups. Lists and saved positions roundtrip with identity mapping; incompatible/stale positions do not override manual corrections. Backup preview includes lists and conflict handling.

## Verification ledger

| Check | Observed result |
| --- | --- |
| `npm run check` | TypeScript passed; **240 tests across 34 files passed**; production build passed. |
| `npm run package` | Built `dist/` and `manwhatrack-1.0.0.zip`. ZIP CRC passed; all **18 packaged files** match the built files byte for byte, including `library.html`. |
| Chromium tracking, updates, worker termination, offline, backup, recovery, scale and screenshot suites | **9 tests passed**. Scale fixture: 1,000 series / 20,000 chapters; 85 ms load, 87 ms search, zero HTTP requests during the measured local operations. |
| Chromium Resume/list/tag/expanded-library acceptance | **3 tests passed in 18.7 seconds** on the final production build: full persistent-profile restart, backup/import, individual and bulk assignment, scoped search, tag filters, cross-window rename, deletion preserving record identities and keyboard focus. Together with the nine other browser scenarios above, all **12 distinct scenarios** passed across the acceptance runs. |
| Resume regressions | Focused capture/restore/progress/storage tests passed. Rapid-close testing found the need for live checkpoints; root added a wheel-before-scroll regression that failed before the fix and passes after it. Chromium then verified the latest backward viewport after closing the reader and fully restarting Chrome, within **4 pixels**, while furthest progress stayed unchanged and the chapter remained incomplete. Ordinary visits stayed at the page top; a subsequent actual wheel scroll persisted its new viewport after closing. |
| Visual inspection | Light/dark sidebar at 280–900 px, expanded library at 1,100 px, long titles/list names, menus, manager/assignment dialogs, detail, grid, settings and error/empty states. Visible controls and document bounds checked in Chromium; long collection headings reduced to two lines, native selector chevron retained, featured Continue constrained to list membership. |
| Patch hygiene | `git diff --check` passed. No dependencies, permissions, remote services or remote fonts added. |

[Screenshots](collections-resume-screenshots/) include [the sidebar](collections-resume-screenshots/library-dark.png), [expanded library](collections-resume-screenshots/expanded-light-1100.png), and [narrow list assignments](collections-resume-screenshots/list-assign-dark-280.png). README now points at these current screenshots. Final list-manager and assignment renders were inspected at 280 px; long names wrap and all actions remain visible.

Browser commands used the cached Chrome for Testing executable via `PW_CHROMIUM_PATH` and the screenshot directory above:

```sh
npm run test:e2e -- collections-resume core-flow background upgrades screenshots
npm run test:e2e -- collections-resume
```

The first consolidated run passed 11 scenarios and exposed a test-harness variable scope error in the Resume assertion. Passing the saved coordinate into the browser evaluation corrected that assertion; the final focused replay passed all three new acceptance tests, including real wheel input after restoration. No outstanding acceptance failure remains.

## Boundaries

Paged/canvas readers use native page-navigation controls; this version restores chapter URLs rather than their page state. Legacy records gain a viewport on their next visit; no guessed viewport is created from furthest percentage. Changed reader content, removed images or loads exceeding 12 seconds can make the restored location approximate. Abrupt closure before the 250–300 ms coalesced checkpoint can retain the previous saved position. Tests use local fixture pages and isolated disposable Chromium profiles, never the user's normal Chrome profile. No live-site universal Resume claim or manual screen-reader certification is made.

Independent review: [collections-resume-review.md](collections-resume-review.md). Source delivery is uncommitted; no publishing or user-profile installation occurs.
