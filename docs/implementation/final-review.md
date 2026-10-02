# Final independent data and tracking review

Verdict: changes requested for backup preservation of manual association overrides. The previously reported tracking lifecycle issues have been corrected under inspection, with the remaining commit-boundary caveat recorded in task-2-review.md.

Scope: read-only review of manual.ts, automatic tracking's association override paths, schema factories/repair, migration 3, backup export/parse/apply and chapter merge helper. UI integration remains in progress and is not certified by this report. No product edits, subagents, commits or test reruns.

## P2 — Import into an existing chapter loses the imported association override

`src/storage/backup.ts`'s existing-chapter branch calls `mergeChapterInto(same, ch, true)` in merge mode, while replace mode only copies visitCount and progress fields. `src/storage/repositories/sources.ts:31-44` never copies `associationOverridden`. Thus an incoming chapter with associationOverridden=true matching an existing chapter with the marker false/undefined remains unprotected under either mode. New chapter copies preserve the marker and parseBackup/repairChapter preserve it, so a clean restore works; import into existing data does not.

Concrete consequence: import a corrected backup into a library that already has that URL on the destination source but no marker (for example, an older backup). The imported correction is not protected; revisiting the originally misdetected page can resolve its original source and recreate the erroneous association because `trackChapterOpened` only chooses corrected ownership from marked chapters. Repeated detected chapter lists also bypass the skip intended for overrides. Source merges collapsing two chapters through the same helper can likewise drop a marker from the absorbed record.

Preserve explicit association protection when merging duplicate chapters, and apply a defined override rule in replace mode. Add regressions that import the marker into an existing false/unmarked chapter under merge and replace, then redetect the wrong page/list and confirm no unwanted chapter is recreated. Also verify source merging does not erase protection.

## Data behavior verified by inspection

- Manual addition validates title/URL/status, stores a user-owned title, adds no invented opened/completed evidence and restores an existing URL without overwriting existing metadata.
- Chapter reassociation moves chapter identity and linked events in one transaction, preserves reading evidence, increments its progress revision, updates both series' derived state and broadcasts reconciliation after commit.
- Fallback source creation keeps the known chapter URL and true hostname, marks its parent URL inferred and disables update checking rather than inventing a series URL.
- Automatic chapter redetection resolves marked canonical ownership first and preserves the chosen series metadata; chapter-list upserts skip marked URLs.
- Migration 3 preserves records and existing progress revisions. Its combined chapter transform avoids competing cursor snapshots during 1-to-3 upgrades.
- Backup export includes the marker as chapter metadata; repairChapter normalizes it, and new chapter import copies preserve it. The missing path is merging/replacing an already present chapter.

## Remaining tracking boundary limitation

Guarded writes check policy at each wrapped mutation and after the transaction callback; delivered mid-mutation revocation aborts the transaction. They do not subscribe active transactions to revocation after the last callback check while waiting for the commit event. Close that gap if the acceptance target is every delivered pre-commit revocation; otherwise document the final-mutation ordering guarantee precisely. See task-2-review.md for details.

Verification evidence is limited to code inspection and the implementation's reported targeted suite. This review does not imply browser end-to-end verification or final UI acceptance.

## Commit-fence resolution

The subsequent db.ts patch registers guarded active transactions and policy changes call revokeDisallowedWrites after updating the policy. This aborts disallowed transactions during the commit wait and preserves the expected rollback/error result. The remaining tracking limitation above is resolved. Final actionable finding is the association marker import/merge omission; UI acceptance remains outside the data-review scope.

## Final correction re-review — resolved

Inspected the subsequent marker and manual-field fixes. mergeChapterInto now preserves associationOverridden from either record and adopts imported label/number overrides when the destination has no local override, retaining local explicit choices otherwise. Replace explicitly applies the imported marker and manual chapter fields while retaining the existing chapter identity. New chapter copies and repair/export paths continue to preserve the marker. Thus the reported import/source-merge omission is resolved.

Also inspected moveChapter's duplicate destination rejection and trackChapterOpened's restoration of removed corrected series. These retain the original corrected chapter identity without creating a conflicting destination duplicate. The added tests exercise merge/replace marker adoption, corrected backup restore, destination conflict rejection, restored corrected series and label/number redetection; their reported passing results were not rerun here. Active transaction abort remains correctly wired to policy changes.

Final verdict for the reviewed data/tracking scope: approved under independent code inspection. No remaining material actionable defect found in the inspected fixes. This verdict does not certify final visual/browser UI behavior; that requires the separate UI/browser evidence.

## QA-driven additions — independent re-review

Inspected the subsequent openDb retry cleanup, blocked ownership recovery in the content script, native Dialog focus handling, Cover failed-URL recovery, App modal shortcut guard, row/grid title buttons, view-button semantics, contrast tokens and detail control ordering. Also viewed library-light.png and detail-dark.png as representative screenshots; the library image predates the latest compact-hero adjustment, so it is not evidence for that final layout.

No new material actionable defect found in these additions. The openDb catch removes only its own rejected cached promise, permitting a later retry without evicting a newer connection. A blocked automatic response discards old progress and forces a new observation, allowing changed chapter/source ownership to bind correctly while current privacy checks still gate the rerun. The dialog uses native modal behavior and explicitly wraps visible enabled controls at the Tab edges; App checks for an open modal before opening the command palette. Failed cover state applies to the failed Blob URL, allowing a refreshed asset URL to render. Titles now have native button activation and accessible labels, view controls expose pressed state, and the primary reading action precedes secondary detail controls. The inspected theme tokens retain readable foreground hierarchy on both surfaces.

Approval remains based on independent code/screenshot inspection, with the implementation's reported targeted regressions supporting the changed behaviors. Browser replay/live verification is running separately and was not duplicated by this reviewer. No implementation edits or test reruns were made.

## Import chooser and expanded QA coverage review

Inspected Data.tsx's file-input reset/read-error handling, Retry/footer styling, upgrades.spec.ts's source-removal scenario and screenshots.spec.ts's utility/narrow-settings coverage. No tests or browser replay were rerun. Viewed the available error-dark-320.png; it shows the earlier pale Retry control, while current HomeView uses btn primary, so that screenshot is stale for the final control contrast.

**P2 — Overlapping file selections can import the wrong selected backup.** DataSection.onFile awaits both file.text() and previewImport without a selection generation or disabling the chooser. Select A, then B before A finishes: B may finish and show its preview, then A can finish later and replace parsed with A. The subsequent Import applies A although B was the most recent selection. A late failed A can similarly replace the error state after B succeeds. Guard preview/error writes by a selection request ID (and invalidate pending selection when canceled), or serialize chooser reads. Add a deferred-file regression resolving the first selection after the second and confirming only the second file remains importable.

The same-file input reset itself correctly captures the File before clearing input.value, allowing repeated selection of the same backup. Read/preview errors are caught before any library writes and expose a precise unchanged-library message. Retry now uses the themed primary button; tile footer is a compact flex row with text that can truncate.

Expanded E2E coverage is substantive: the source-removal test removes through the real menu/confirmation, checks Continue uses the remaining source's real series URL, and compares chapter/event identities to establish retained history. Utility screenshots cover queue, history and inspector at 280px; settings iterate all eight sections at 320px. Their document-width checks establish lack of global horizontal overflow but do not prove every locally clipped control is reachable; the stronger upgrades noOverflow helper separately measures control bounds. These checks remain planned/reported evidence until the separately running replay completes.

Current additional-scope verdict: changes requested for the asynchronous chooser race. Prior data/tracking approval is unchanged.

## Backup selection race resolution

Independently inspected the selection-generation fix in DataSection. Both file-read and preview await paths now verify the captured generation before publishing a preview; the catch publishes errors only for the current generation. Cancel and unmount invalidate pending work. File chooser and Cancel are disabled during an import. These changes close the older-selection overwrite issue; the two added regressions exercise delayed file reads and delayed previews separately. Reported passing tests/typecheck were not rerun by this reviewer.

The footer illustration is now in normal flow after its prose, avoiding decorative overlap. Source header layout allows metadata badges to wrap while preserving hostname space. No further material actionable defect found in this final correction scope. Final code-inspection verdict returns to approved; browser replay evidence remains separate.

## Last rendered-QA refinements

Inspected HistoryView's separate event/series controls and matching narrow CSS, route scroll reset in App.useLayoutEffect, resize-driven Menu placement and listener cleanup, contextual General/shortcut control labels, and Sources table data-label/stacked-row styles. No material actionable defect found. The history series button retains its full accessible name/title while its displayed text wraps to two lines; route changes reset the actual main scroll container before paint; menus reclamp on resize without replacing focus; source headers remain present for assistive technology while narrow cells expose their visual labels. These refinements do not change persistence or tracking.

Viewed the available history-dark-280.png, which still shows the earlier inline truncated event/series layout. It is therefore stale for the new separate series control. The separately running screenshot/browser replay must supply the final rendered evidence. The reported npm run check results (201 tests across 29 files) were not rerun. Final inspection verdict remains approved for this correction scope.

## Final navigation/layout adjustments

Inspected the narrow options grid row sizing, Options route-ID scroll reset, sidepanel route-keyed main scroller and added screenshot assertions. No material actionable defect found. Auto-sized settings navigation no longer shares stretched viewport rows with short content; scroll reset targets the options window; remounting the panel's scroll container on route/series navigation gives Inspector and other route headers a fresh origin. View-only changes retain the existing explicit top reset.

The new assertions check narrow navigation height and zero window offset across settings sections, and check Inspector Back placement both before and after capture. These are appropriate checks for the rendered failures that motivated the edits. Root reported the preceding replay passed 5/5 with nine acceptance checks; the queued post-edit replay was not rerun or inferred successful by this reviewer. Final code-inspection verdict remains approved for this scope.

## Final rendered evidence

Independently viewed the refreshed inspector-dark-280.png and settings-rules-dark-320.png after the final replay. Inspector's Back control and full header are visible at the top, its detection empty-state text remains readable, and its manual fallback control stays within the narrow panel. The settings capture has compact wrapping navigation above Site rules, with its heading, explanation and Add site rule control visible without the prior stretched navigation area. No material visual defect found in these representative final captures.

Root reported final browser replay passed 5/5 after the keyed scroller and options fixes, including native Back visibility ratio 1, narrow navigation height and zero route offsets; this reviewer inspected the resulting captures without duplicating the replay. Native checkbox/radio accent styling is local/theme-based; selected backup filename is exposed with wrapping; revised Merge text describes combining records without falsely promising every manual correction retains the greatest numeric progress.

Final independent verdict: approved for reviewed data/tracking/code scope and the representative rendered UI evidence. All actionable findings raised in this review chain are resolved. Final check/build/package completion remains root's delivery responsibility.
