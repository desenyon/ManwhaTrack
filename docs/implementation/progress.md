# Upgrade execution ledger — docs/implementation/2026-10-01-plan.md

Accepted scope: audit remediation and approved Violet/Folio design in production, with missing manual workflows and QA.
Ruling: proceed without another spec approval — user explicitly approved the prototype/audit and requested complete implementation — routine implementation choices remain reversible.
Ruling: retain shared authorized checkout and uncommitted changes — git metadata is read-only in this workspace — no publishing/merge requested.
Ruling: A2 may return committed-library success plus settings warning — two independent local storage systems cannot provide one atomic transaction — matches audit acceptance alternatives.

Preflight dependencies:
| Pair | Interface/file overlap | Resolution |
|---|---|---|
| 1 / 2 | Chapter manual-progress revision, models/messages | Storage task defines revision if needed; lifecycle consumes it; communicate exact field before edits. |
| 1 / 3 | ImportResult and Data.tsx | Storage owns Data warning only, UI later styles final view. |
| 1 / 4 | repositories/chapter/source | Manual workflows begin after integrity task integration. |
| 2 / 3 | Cover diagnostics and UI retry | Prefer source/meta records, UI reads finalized interface. |
| 3 / 4 | SeriesView and manual dialog | Sequential edits to avoid UI conflicts. |
| all / 5 | Cross-layer QA | Integration tests and review after APIs stable. |
Task consistency: each task preserves existing architecture; meaningful failure tests for stateful behavior; visual edits use rendered QA rather than implementation-mirroring tests.

- Task 1: implemented; independent review corrections resolved and re-reviewed.
- Task 2: implemented; independent lifecycle/privacy review corrections covered by red/green tests.
- Task 3: implemented; fresh browser captures reviewed and sizing/contrast/footer refinements applied. Final affected browser replay passed; captures inspected.
- Task 4: storage and UI implemented; correction/redetection and offline backup flow exercised. Browser same-file reselection and asynchronous selection defects fixed; final correction/backup replay passed.
- Task 5: 201 unit tests / typecheck / build / package pass; core Chromium, offline search, worker/update and storage recovery pass; scale 1,000/20,000 passes. All nine unique browser acceptance checks pass across final runs; affected UI suite replay 5/5 green, final captures reviewed and verification report complete.

- Subsequent user authorization: commit every changed file individually, push to GitHub, and build a shareable extension. Visible motion, viewport-aware footer sizing and locally recorded reading time are the current delivery scope; see motion-time-verification.md.
