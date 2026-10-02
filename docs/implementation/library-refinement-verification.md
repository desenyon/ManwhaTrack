# Library refinement and chapter identity repair

## Changes and evidence

The live [Asura Nano Machine page](https://asurascans.com/comics/nano-machine-3ec3b16f) was downloaded on October 2, 2026 and read with scripts disabled. Each chapter link has a dedicated chapter span, a separate subtitle span and a date span. For example, chapter 324 has subtitle `105. TP <2>` and a URL ending `/chapter/324`. Reading the parent link's `textContent` joined those into an invalid chapter number.

Detection now reads dedicated identities and validates numbered labels against chapter URLs. Generic detection and Madara/MangaThemesia adapters share the link correction. Prologue and side-story labels remain intact. The fixed pipeline processed the live downloaded HTML into 332 chapter identities. In an isolated, seeded database, rediscovery corrected a corrupted current record to Chapter 324, retained its ID, 56% progress and 1,250 ms time, and derived latest Chapter 332 with eight new chapters.

Schema 5 repairs the recognizable joined-number/subtitle pattern only when an explicit chapter URL proves the number. It preserves IDs, progress, completion, positions, revisions, time, titles and manual label/number overrides; refreshes affected series/source summaries; and corrects matching denormalized event labels. Related writes run in one upgrade transaction. A failing migration leaves the previous database intact. Rediscovery also repairs this pattern for records restored after migration.

Resume creates an `about:blank` tab in a separate browser window, stages navigation and saved-position intents locally, then navigates to the source. Modifier/middle-click retains new-tab behavior. Expanded and sidebar layouts have independent saved preferences: expanded defaults to cover cards; sidebar retains its compact list. Cards use readable chips and text actions; details use labeled controls, shorter progress summaries and roomier chapter rows.

The timer now excludes missing or disconnected reader content. A regression showed five seconds incorrectly counted without a reader before this fix.

## Verification

- `npm run check`: TypeScript, 267 unit tests across 40 files, and the production build passed.
- Regression tests first failed for joined labels, rediscovery, a separate Resume window, schema upgrade repair, and missing-reader time; they pass after the fixes. Ambiguous plain/decimal mismatches are not guessed, and manual corrections survive redetection.
- Initial complete browser run: 16 local scenarios passed; live-site browser checks were skipped. Final acceptance passed six affected flows (new-window Resume, lists/tags/backup/layout persistence, bulk controls, artwork motion/resize, timer totals/restart, and Nano Machine repair with responsive cards). A stale final animation assertion expected the removed Continue banner in All; it now switches to Continue before checking off-screen pause.
- Final UI-polish replay passed. All seven affected final scenarios pass across the final run and corrected replay.
- Visual review: inspected the final [expanded All grid](library-refinement-screenshots/refined-grid-dark-1280.png), [652 px light grid](library-refinement-screenshots/refined-grid-light-652.png), [expanded details](library-refinement-screenshots/refined-details-dark-1280.png), and [280 px details](library-refinement-screenshots/refined-details-dark-280.png). The All view puts cards and Resume actions above the fold without a duplicate featured banner; detail controls align and chapters are readable. Screenshots use generated fixture covers, not a user's library.
- The final responsive case checks grid widths of 652/960/1280/1440 px and details at 280/380/652/960/1280/1440 px. No horizontal overflow or out-of-bounds controls were found. Dark/light captures, reduced motion, list forms, artwork visibility and footer resizing were checked.
- Package: version 1.1.1; ZIP CRC valid; all 20 packaged files match the production build accepted during visual review. Reading data, source maps, dependencies and docs are excluded.
- Scale: the initial complete run loaded 1,000 series and 20,000 chapters in 89 ms and searched in 141 ms, without HTTP requests during measured library operations.

The live HTML check validates extraction and local summary calculation; it does not inspect the user's installed library or prove behavior on every source. Browser acceptance uses disposable profiles and local fixtures. Active time remains conservative when Chrome suspends execution; previous all-time totals do not imply a reconstructed daily history.
