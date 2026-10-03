# Analytics, novels and reading archive refinement — 1.2.0

## Scope

- Outer clouds move over 10 seconds rather than 32; opacity remains 0.09. The featured clouds use 5 seconds rather than 9. Reduced motion, hidden-page suspension and artwork controls remain effective.
- The sidebar keeps **Your Library**, with a compact timer on the right. Reading facts and source labels no longer need separate framed pills; Novel / Manhwa labels sit on covers.
- Expanded details place the chapter timeline in the main column, with reading actions above and separated organization controls in the secondary column.
- Substantial prose readers use the existing tracking, meaningful-content progress and saved-position Resume pipeline. Royal Road/Webnovel templates use visible identities instead of opaque chapter IDs; illustrated novels still use their prose reader. Same-named novels and adaptations remain separate, and explicit format/genre corrections survive detection.
- Analytics derives weekly activity, time/session/day patterns, series records, backlog, pace, retention, genre/source breakdowns, neglected titles, fingerprints and milestones locally. Daily data is available as text tables; activity cells support keyboard arrows. Secondary analyses are disclosures rather than a wall of small cards.

## Data integrity

Schema 6 and backup format 5 preserve earlier libraries, IDs, user edits, chapter progress and lifetime time. Upgrades from versions 1, 4 and 5 are tested, including the existing joined chapter-number repair.

Timed activity is persisted transactionally with chapter progress in minute buckets. Stale revisions, revoked writes, negative and non-finite time are excluded. Importing the same or a later snapshot of a minute bucket does not add that time twice. Backups include format, genres, dated time and backlog samples.

Earlier undated time remains visible in lifetime totals but never receives invented calendar dates, start hours or sessions. Initial source catalogs do not count as releases. Update delay means first observed after an established catalog, not publisher release time. Manual progress corrections do not count as dated reading activity. Backlog is known new chapters waiting, with unknown historical baselines left unknown. Catch-up times are labeled rough estimates.

Reading history excludes measurement bookkeeping. Clearing history also clears dated analytics and is explicitly described in the confirmation; chapter progress and lifetime totals stay intact. No permissions, runtime dependencies or external services were added.

## Executed checks

- `npm run check`: typecheck, **294 unit tests across 44 files**, production build passed.
- Full Chromium suite: **19 passed, 1 skipped**. The skipped case is the opt-in live-site run. The suite covers service-worker termination, exact Resume, browser restart, list/tag persistence, complete backup restoration, offline use, settings, narrow layouts and 1,000-series / 20,000-chapter scale.
- After the final prose-reader fix, targeted Chromium suite (`analytics-novels ui-polish core-flow motion-time workspace-flow`): **8 passed**. It includes automatic novel discovery, saved-position Resume, active-time pause behavior, analytics navigation and browser restart, genre edits, all range controls, keyboard heatmap inspection, daily data tables and secondary disclosures.
- Analytics unit scale check opens **150,000 minute measurements** without JavaScript argument-limit failures. Computation tests also cover midnight splitting, session grouping, duplicate completions, manual corrections, missing backlog baselines, release observations and censored retention cohorts.
- Responsive checks: sidebar **280 / 320 / 380 px**; expanded details and analytics **320 / 960 / 1280 / 2560 px**. Light/dark screenshots and visible-control bounds were checked. Wide-layout motion assertions verify transform changes, 10-second duration and unchanged opacity; reduced motion and hidden-page pause are tested.
- `git diff --check` passed. `npm run package` produced `manwhatrack-1.2.0.zip`: Manifest V3, version 1.2.0, 20 files matching `dist/`, ZIP integrity checked.

Chromium checks used an isolated Chrome for Testing profile, with `PW_CHROMIUM_PATH` pointing to the local Playwright-cached executable. No personal extension data was modified.

## Visual evidence

Screenshots are in [analytics-novels-screenshots](analytics-novels-screenshots/). They contain **synthetic local fixture covers and reading history**, not real reading statistics. The sidebar and details exercise actual automatic detection and progress; the analytics visual fixture seeds dated measurements solely in a disposable QA profile.

- [Compact sidebar, 320 px](analytics-novels-screenshots/archive-sidebar-320.png)
- [Reorganized series details](analytics-novels-screenshots/polished-details-dark.png)
- [Analytics, dark](analytics-novels-screenshots/analytics-dark-1280.png) and [light](analytics-novels-screenshots/analytics-light-1280.png)
- [Analytics, 320 px](analytics-novels-screenshots/analytics-dark-320.png)
- [Reading time and backlog](analytics-novels-screenshots/analytics-graphs-dark-1280.png)
- [Reading hours and pace](analytics-novels-screenshots/analytics-habits-dark-1280.png)
- [Series analytics](analytics-novels-screenshots/analytics-series-dark-1280.png)
- [Wide-screen margins](analytics-novels-screenshots/analytics-dark-2560.png)

## Limits

Novel platform extraction is verified against deterministic template fixtures, and generic prose tracking against a local browser fixture. This is not evidence that every live, protected, paginated or dynamically rendered novel reader works. Unusual readers may need local site rules or manual correction. Genre analysis uses only detected or explicitly supplied metadata. Analytics becomes more informative as dated local history accumulates; no example statistics are shipped into the user's library.
