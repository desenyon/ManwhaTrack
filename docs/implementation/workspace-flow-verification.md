# List flow, expanded workspace and settings

## Scope

Personal lists now have an in-page **Add series** picker using existing local library records. The picker includes cover previews and search; membership changes share the existing transactional repository. Save closes the picker and refreshes membership; Cancel discards the draft. Filtering the picker does not remove hidden selections. Manual tracking while a list is open also assigns the new series to that list. Membership edits do not change reading status, progress or chapter history. A list with no filter matches is distinguished from an empty list, with a direct Clear filters action.

Cards use quiet borders, interior padding and capped widths. The comfortable width is 224 px on desktop, with compact and large choices; narrower expanded views use readable columns rather than shrinking desktop cards. Personal lists omit the duplicate featured Continue banner. Expanded navigation separates primary views, personal lists and tools; status views stay available under More views. The rail keeps native keyboard interaction separate from series-navigation shortcuts.

Outer scenery reuses locally bundled pixel artwork only outside the 1,440 px application frame on screens at least 1,600 px wide. Clouds move slowly in steps. It does not intercept pointer events or enter the accessibility tree. Saved motion preferences, reduced motion and page visibility govern animation. Background scenery can be disabled independently.

Scrollbars are hidden by default without disabling overflow. The main library scroller is keyboard-focusable. A preference can restore scrollbar visuals. Settings organize Appearance, Library layout, Reading and New chapters into labeled sections with semantic On/Off switches, including source-check and local-rule switches. Old preferences gain safe defaults; explicit off choices survive. A regression reproduced one preference being lost during concurrent writes within a page; writes are now queued in that context.

## Verification

- `npm run check`: TypeScript, 271 unit tests across 41 files, and the production build passed. The rapid-preference-change test first reproduced a lost value and passes with queued writes.
- Complete browser suite on the final 1.1.2 build: 17 local scenarios passed in 2.4 minutes, with the optional live-site case skipped. This includes list editing, manual addition, restart persistence, scrolling, settings propagation, animation, Resume and timer behavior. The final rail keyboard guard and narrow-screen switch alignment checks passed.
- Rendered review: inspected fresh captures of the [desktop cards](workspace-flow-screenshots/refined-grid-dark-1280.png), [outer scenery and list page](workspace-flow-screenshots/workspace-list-dark-2560.png), [320 px list picker](workspace-flow-screenshots/workspace-list-picker-320.png), and [mobile settings](workspace-flow-screenshots/settings-general-dark-320.png). Cover previews load in the picker and list. The corrected mobile switches align beside their labels; controls remain inside the viewport.
- Package: 1.1.2 ZIP built and validated; all 20 files match the production build and ZIP integrity checks pass.
- Publication gates: commit each changed file separately, verify the pushed remote SHA, require GitHub CI to pass before creating the release, and compare the downloaded release ZIP with the local package. Earlier execution restrictions were resolved before this final browser run; those failed launch attempts were infrastructure failures, not passing test evidence.

Browser acceptance uses disposable profiles, local fixture pages and generated fixture covers. It checks direct list membership, Cancel, search-hidden selections, full-profile restart, settings propagation, keyboard and wheel scrolling, reduced motion, hidden-page animation pause, scenery bounds and narrow-screen controls. Existing tests continue to cover chapter repair, saved-position Resume in a separate window, timer activity boundaries, collection backups, bulk actions and storage upgrades.
