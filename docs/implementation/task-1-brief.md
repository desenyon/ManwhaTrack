# ManwhaTrack upgrade implementation plan

> Agentic workers: use superpowers:subagent-driven-development or superpowers:executing-plans, with scoped implementation and independent final review.

Goal: implement the approved audit fixes, finish its missing workflows, and apply the approved Violet/Folio UI to the actual local extension.
Architecture: retain React, deterministic detection, typed messaging, IndexedDB and Chrome local preferences. Upgrade existing functions; no parallel application or new framework. Bundled illustrations are decorative, actual cached series covers remain primary content.
Tech stack: TypeScript, React 19, native DOM/dialog, IndexedDB, Chrome MV3, Vitest and Playwright.
Spec: ../audit/2026-10-01.md, ../audit/art-direction.md, ../audit/ui-direction.html and ../../AGENTS.md. Audit A2 can use honest partial-success reporting rather than pretending a cross-store transaction exists.

## Global constraints
- Everything private stays local; no backend, analytics, accounts, AI features, remote scripts or fonts.
- Preserve reading history, user overrides, backups and original source identities; no destructive migration/reset.
- Default completion threshold 0.85; opened, completed and current remain separate.
- Validate navigation URLs as http/https.
- The user's approved direction and explicit request to implement everything authorize execution; do not introduce another approval gate for this work.
- Work in the authorized shared checkout. Leave changes reviewable and uncommitted; do not alter git state outside filesystem permissions.

## Review focus
- Late/stale content messages after privacy settings or manual progress changes must not write invalid evidence (tasks 1/2).
- Same backup imported repeatedly must preserve totals and event IDs; partial settings failures must be honest (task 1).
- Removed sources/series must remain coherent across Continue, export and history (task 1).
- Narrow widths, long labels, menus, dialogs and focus must stay usable in both themes (task 3).
- New manual workflows must preserve data and overrides across redetection and restart (task 4).

### Task 1: Storage integrity and safe source recovery
Files: src/storage/backup.ts, tracking.ts, summary.ts, repositories/{chapters,sources}.ts, schema.ts/migrations.ts only if persisted model changes; tests/storage/*; options/views/Data.tsx only for partial-result messaging.
Interfaces: existing applyImport, exportLibrary, editChapter, setProgressTo, removeSource, applyUpdateCheck. ImportResult may add settings warning for honest partial success; maintain existing call sites.
- [ ] Promote/recreate A2–A8 reproductions in tests/storage, run red baseline (existing docs/audit/repros.test.ts is evidence, not normal suite).
- [ ] Repeated snapshot merge: max counters instead of additive totals; real independent source/series merge remains additive where correct.
- [ ] Edited display chapter identity remains stable; reconcile canonical URL and retain overrides when listings/detection recur.
- [ ] Lower/manual unread resets completion evidence; expose a durable revision for active tracker synchronization if necessary, explicit migration/repair/export compatibility.
- [ ] Source removal preserves historical source/URLs; excludes removed source from active Continue, prefers matching remaining chapter or series URL. Do not assign old URLs to new source.
- [ ] Update-check observations require matching identity before ingestion; unrelated redirect rejected with source failure metadata.
- [ ] Export filters dependents/queue/covers against actually exported series IDs.
- [ ] Import-result reports settings failure after committed library precisely, or recovery strategy with fault-injection coverage. No false “nothing changed”.
- [ ] Run affected tests and typecheck; independently review diff before integration.

