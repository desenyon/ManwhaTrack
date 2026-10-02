# Sidebar and expanded-library polish

This report records the earlier polish pass. The subsequent visible-motion, viewport-sizing and reading-time work is documented in [motion-time-verification.md](motion-time-verification.md).

## Changes

- Simplified the shared mark and Chrome icons to one violet bookmark silhouette. The header uses a compact system-font wordmark; editorial headings remain separate.
- Increased list rows from 68 to 88 px, with 42 px covers, readable title text, separate chapter/read-percentage chips, and friendly source badges. Original hostnames remain in tooltips and source details. Virtual scrolling and keyboard navigation use the same new row height.
- Rebuilt expanded series details around identity/actions, four labeled progress facts, metadata/sources/notes, and a separately scrollable chapter timeline. Sidebar details stack the same content at narrow widths.
- Reworked list creation, editing and assignment spacing, long-name wrapping and action placement at desktop and 280 px widths. Removed an older auto-margin/font override that misaligned short list names.
- Added bundled engraving layers with independent subtle hand and cloud movement. Visibility observers pause artwork off-screen and in hidden tabs; reduced motion disables animation. The bridge footer scales with visible collection size.
- Scoped Madara and MangaThemesia chapter extraction to their primary chapter-list containers. Previously, recommendations using the same chapter class could incorrectly raise the latest-known chapter. Both regression tests failed before the fix and passed afterward.
- The manual progress editor now starts with the full chapter label rather than an internal numeric ordering value, preserving season/part labels in the visible form.

## Verification

| Check | Evidence |
| --- | --- |
| TypeScript, unit tests and production build | `npm run check`: 243 tests across 36 files passed. |
| Package | `npm run package` built the extension ZIP. CRC is valid; all 20 files match `dist/` byte for byte, including the full-library page, icons and both new engraving layers. |
| Existing browser acceptance | All 12 existing scenarios passed across the consolidated and focused runs: tracking, updates, offline use, backups, worker recovery, exact Resume, persistent lists/tags, bulk actions, focus, scale and responsive screenshots. The update assertion affected by chip text spacing now passes. |
| New polish acceptance | Final replay passed in 9.8 seconds: 88 px rows; source badges with hostname tooltips; no horizontal overflow or off-screen controls at 280/380 px; independent cloud movement; reduced motion; visibility-handler pausing; expanded detail columns; 304 actual chapters excluding recommended Chapter 999; Chapter 153 edited to 153.5 and preserved after reload; short-name left alignment and long-name list creation/editing; footer resizing from one to eleven visible series; off-screen animation pausing; no page errors. Together, all 13 distinct browser scenarios passed across the acceptance runs. |
| Local scale fixture | 1,000 series / 20,000 chapters: 190 ms initial load, 115 ms search, zero HTTP requests during measured library operations. |
| Visual review | Light/dark sidebar, expanded library, expanded details, narrow list manager and expanded list editor renders inspected. Final manager captures inspected at 280 and 1,280 px: short/long names align, long names wrap, count and actions remain visible, and completed forms have consistent spacing. |
| Patch hygiene | `git diff --check` passed. |

Current screenshots are in [polish-screenshots](polish-screenshots/), including [expanded details](polish-screenshots/polished-details-dark.png), [light details](polish-screenshots/polished-details-light.png), [narrow sidebar](polish-screenshots/polished-sidebar-dark-280.png), [expanded list manager](polish-screenshots/polished-list-manager-expanded.png), [narrow manager](polish-screenshots/polished-list-manager-280.png) and [expanded list editor](polish-screenshots/polished-list-edit-expanded.png).

Commands used the cached Chrome for Testing executable through `PW_CHROMIUM_PATH` and captured images with `SCREENSHOT_DIR=docs/implementation/polish-screenshots`:

```sh
npm run check
npm run package
npm run test:e2e -- ui-polish collections-resume upgrades screenshots core-flow background
npm run test:e2e -- ui-polish background screenshots
npm run test:e2e -- ui-polish
```

## Limits

Nanoshine's specific source URL and incorrect value were not supplied. The recommendation-contamination regression is reproducible and fixed, but is not proof that the user's existing Nanoshine record is repaired. Existing chapter/history records have not been deleted or automatically rewritten. Tests use local fixture pages and disposable Chromium profiles; no live-site universal detection claim is made.

Headless Chromium reports background pages as visible, so the tab-visibility handler was tested with a controlled document visibility event. Actual off-screen IntersectionObserver pausing and reduced-motion behavior were verified in Chromium. Manual visible-browser tab hiding and screen-reader certification were not performed.

The computer-use browser blocks inspection of installed `chrome-extension:` pages. The installed library could therefore not be inspected directly. No alternative access to the user's profile was attempted; the isolated extension fixture checks are unaffected.

No dependencies, remote fonts, runtime services or permissions were added. Artwork is bundled locally. No publishing or installation into the user's Chrome profile occurred.
