# Visible motion, adaptive footer and measured reading time

## Implementation

The previous footer used only width and three collection-size buckets: reducing the viewport from 900 to 640 px left its image exactly 170 px high. The regression test reproduced that failure before the repair. A ResizeObserver now measures the library content and available scroll viewport, clamping the illustration to 84–360 px. It responds to changes in both content height and window height without growing as the user scrolls.

Hand and cloud layers move independently. The footer adds a slowly panning engraved landscape, a separate engraved cloud layer and a water shimmer, including when the current reader hides the featured Continue artwork. Visible animation uses stronger motion and shorter cycles. Off-screen/hidden artwork pauses. The footer's Play/Pause control saves the local preference; System follows reduced motion, while explicit Play opts into decorative motion only.

The reading tracker measures active elapsed time at one-second intervals and settles partial intervals on blur, visibility changes and stop. It excludes unfocused/hidden tabs, time outside the reader and inactivity after 90 seconds. A manual progress correction preserves independently measured pending time. UI-only settings changes no longer restart the reader session.

Concurrent per-tab session writes are serialized: the live clock and progress checkpoint can no longer overwrite each other, or recreate a tab after its queued clear. The concurrent-update regression failed before that repair.

Live activity is an authorized ephemeral Chrome session snapshot. It does not add chapter time a second time. Stale snapshots become paused after 3.5 seconds. Persistent totals remain in the existing IndexedDB chapter records; no database migration or new permissions are needed. The timer sits under the library heading and opens the expanded Time tracking page, which groups actual recorded totals by series and chapter.

## Verification

- `npm run check`: 259 tests across 40 files pass, with TypeScript and the production build.
- Regression coverage includes partial sessions, blur/focus, idle cutoff, manual correction, cumulative route/pagehide flushes, immediate between-tick heartbeat display, stale-heartbeat pausing, authorization and rejection of foreign/ignored/incognito/malformed activity messages, prevention of double-counted totals, and real multi-series/chapter aggregation with removal filtering and refresh after saves.

- Browser acceptance: all 15 distinct local-fixture scenarios pass across the consolidated run and corrected focused replays. Live-site testing remains opt-in and was skipped. The final affected replay passed motion/time and UI polish (3/3), then repeated motion/time under CI-style headless Chromium (2/2).
- Motion/footer checks verify actual changed screenshot pixels and more than 1 px image movement in 1.4 seconds; pause stability after the compositor settles; saved Off preference after reload; System reduced motion and explicit Play opt-in; no horizontal overflow at 280/380 px; image height shrinking by more than 30 px from 900 to 640 px and returning on resize; and compact 84 px artwork after six visible series.
- Timer checks verify a ticking measured clock, no session restart from theme/motion preferences, real focus loss with Playwright's artificial focus override disabled in the disposable reader, a stable paused clock, matching chapter/series/all-time totals, and identical totals after fully closing and reopening the profile. The live session resets after browser restart; the library and recorded totals persist.
- Final UI-polish replay covers metadata chips, source tooltips, reduced motion, off-screen/visibility pausing, expanded detail columns, editable chapter labels, list forms and narrow control bounds. The visibility-change handler uses a controlled event because Playwright normally emulates foreground visibility.
- Scale acceptance in the consolidated run: 1,000 series and 20,000 chapters; 91 ms initial load and 88 ms search, with no HTTP requests during measured library operations.
- Visual review: inspected [tall sidebar](motion-time-screenshots/sidebar-tall.png), [compact footer with six series](motion-time-screenshots/sidebar-many-series.png), short viewport, library, and [expanded time breakdown](motion-time-screenshots/time-tracking-expanded.png). Replaced the initial flat cloud silhouettes with the bundled engraved cloud texture before the final replay.
- Package: version 1.1.0; ZIP CRC valid; all 20 files match the production `dist/` bytes. No reading data, source maps, dependencies or docs are included in the ZIP.
- `git diff --check` passes. Release installation/update instructions are in [1.1.0.md](../releases/1.1.0.md).

## Scope and limitations

Browser fixtures use disposable profiles and local source pages; they do not access the installed user's library. Daily historical reading time is not fabricated from all-time chapter totals. Timer accuracy is intentionally conservative when the browser stalls. No universal live-site detection claim or repair of the unspecified existing Nanoshine record is made.
