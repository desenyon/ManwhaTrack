# ManwhaTrack upgrade verification — October 1, 2026

Scope: the approved audit remediation, missing manual workflows and Violet / Folio production UI. The extension remains local: no backend, account, analytics, remote scripts, fonts or new dependencies. Changes are uncommitted in the authorized shared checkout.

## Delivered behavior

| Area | Change and acceptance evidence |
|---|---|
| Automatic tracking privacy | Sender origin, frame, chapter ownership, incognito and ignored-host checks guard automatic evidence. Delivered policy revocation aborts active guarded transactions before commit. Privacy and transaction fault tests cover rejected writes without time, progress or history changes. |
| Manual reading corrections | Stable canonical identity survives label edits. Manual unread/lowered progress clears completion and advances a durable revision; live content trackers reconcile it. Old automatic evidence cannot reverse a correction. |
| Backup integrity | Snapshot merges preserve maximum counters instead of doubling them. Exports contain coherent dependents. Replace/merge preserve source removal, chapter association and explicit metadata. A preferences failure after library commit reports partial success precisely. |
| Safe sources | Removed sources retain their historical chapters and URLs but stop supplying Continue destinations. Update checks reject unrelated redirected series before ingesting chapters. |
| Tracking lifecycle | Acknowledged detection, bounded transient retries, SPA cancellation and BFCache resume. Reading time pauses for hidden, unfocused, inactive or out-of-reader content. |
| Cover/update recovery | Persistent local cover status, bounded retry/backoff, manual retry and refreshed-image recovery. Update checks serialize lease acquisition and retain an expiring restart-safe lease. |
| Missing workflows | Manual title/source/status entry validates actual http/https addresses without inventing reading history. Individual chapter reassociation preserves identity, history and progress transactionally and survives redetection and backup restore. |
| Production UI | Bundled violet hands and engraved landscape, warm paper/plum night, local serif headings and system controls. Compact Continue, reading-first detail hierarchy, list/grid parity, actual keyboard focus, native modal isolation and explicit Tab cycling, viewport-bounded menus, confirmed destructive actions and optimistic rollback. |
| QA discoveries | Fixed failed cached DB retries, stale chapter ownership, replacement cover decoding, duplicate palette results, same-file backup reselection and overlapping backup selections. Reproduced asynchronous file-read/preview races before fixing them. |

## Verification results

- `npm run check`: TypeScript, **201 tests in 29 files**, and production build passed.
- `git diff --check`: passed.
- `npm run package` and ZIP integrity/content verification: passed; `manwhatrack-1.0.0.zip` and `dist/` contain the built extension and bundled artwork.
- Chromium acceptance: **all eight functional checks passed** in the consolidated run: discovery/local cover/completion/current/restart Continue, offline search, update checking, service-worker restart, manual reassociation/offline backup/narrow interactions, large-library workload, storage Retry, and source removal with retained history. Final `upgrades screenshots` replay: **5/5 passed**, including the screenshot check and explicit native menu-resize, inspector visibility and narrow settings navigation assertions. The earlier ambiguous screenshot selector was corrected. Earlier native Tab escape and same-file reselection defects were corrected and the full manual flow now passes.
- IndexedDB fault injection in Chromium: loading, failure and Retry preserve the original series ID; passed.
- Synthetic browser workload: **1,000 series / 20,000 chapters**, virtualized rendering, local search, no HTTP requests. Latest recorded run: **86ms** reload-to-visible row, **91ms** search-to-visible result. These are observations on this machine, not a performance guarantee.

Browser commands use the installed Chrome for Testing binary:

```sh
SCREENSHOT_DIR=docs/implementation/screenshots \
PW_CHROMIUM_PATH='/Users/naitikgupta/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' \
npm run test:e2e -- core-flow background upgrades screenshots
# After screenshot-driven refinements, repeat only the affected suites:
# npm run test:e2e -- upgrades screenshots
```

The sandbox blocks localhost listeners and Chromium process launch. Acceptance tests use elevated execution in isolated disposable profiles. They do not alter the user's normal Chrome profile. Infrastructure failures are not counted as product defects.

## Live-site observations

`LIVE=1 ... npm run test:e2e -- live-sites screenshots` completed: two tests passed. The live test is a diagnostic report, not exhaustive supported-site certification. Inspected [raw report](live-site-report.json):

| Sample | Observed |
|---|---|
| WEBTOON series + reader | Series and chapter detected/tracked; sampled episode reached completion. |
| WEBTOON Canvas series | Series detected/tracked with cover and chapter links. |
| Tapas series + reader | Both detected/tracked; reader recorded about 70.5% and stayed incomplete. This run does not establish Tapas completion accuracy. |
| MangaDex series + reader | Both tracked; original opened chapter recorded completion. Final page redirected to its series page, so the report's final classification is Series. |
| MANGA Plus series + reader | Both detected/tracked; sampled reader recorded completion. Title page exposed no chapter links to detection in this run. |

Live requests went directly to source sites. These samples do not prove every page, lazy-loaded/paid reader, locale, source change or unsupported website works.

## Visual QA and artifacts

Fresh extension screenshots are in [screenshots/](screenshots/). Fixtures use explicitly fictional titles and generated cover art; the scale workload is synthetic. Both themes and 280/320/380/480/900px panel widths were checked for horizontal control overflow and ordinary secondary-text token contrast of at least 4.5:1 across common surfaces.

The visual pass tightened the narrow featured card, moved detail editing below Continue/position, corrected secondary text contrast, removed duplicate palette commands, kept refreshed covers visible, moved the footer illustration below its copy and wrapped source badges. Subsequent refinements put the history series on its own labeled line, reset scroll on route changes, reposition menus on resize, label settings controls and stack source facts at narrow widths. Final utility/settings captures were inspected after the passing replay: the inspector header is fully visible, history identifies each series, and short settings pages keep compact navigation. Native checkboxes/radios use the violet accent. Backup previews identify the selected file; Merge copy describes combined records without promising that manual corrections always move progress forward.

Additional final captures include `queue-light-280.png`, `queue-dark-280.png`, `history-dark-280.png`, `inspector-dark-280.png`, `source-removed-light-280.png`, `import-partial-success.png` and all eight `settings-*-dark-320.png` sections.

Representative files: `library-light.png`, `library-dark.png`, `detail-light.png`, `detail-dark.png`, `detail-long-dark-280.png`, `manual-light-280.png`, `manual-dark-280.png`, `menu-dark-280.png`, `grid-selected-dark-280.png`, `empty-light-320.png`, `loading-light-320.png`, `error-light-320.png`, `error-dark-320.png`, `panel-*-*.png`, `palette-dark.png`, `privacy-light.png`, `stats-dark.png`.

Independent review reports: [storage](task-1-review.md), [tracking](task-2-review.md), [integration](final-review.md). Reported material findings were corrected and re-reviewed; the latest integration verdict is approved under inspection. Independent source/screenshot review is distinct from root's executed browser QA.

## Boundaries

- DB/export version 3 migrates old records without reset. History lost by an older release cannot be reconstructed reliably.
- Library and Chrome preferences are separate local stores; committed-library partial success is deliberate and visible.
- Browser tests verify native keyboard/modal behavior; a manual VoiceOver audit was not performed.
- Chrome Web Store optional-host onboarding and store submission are a separate distribution decision. This delivery is the built unpacked/private extension, with no publishing or user-profile changes.
- The original audit and its deliberately red opt-in tests are historical evidence. Normal regression suites cover the adopted fixes; A2 uses the audit's allowed honest partial-success solution rather than a fictional cross-store rollback.
