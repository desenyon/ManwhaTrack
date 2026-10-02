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

### Task 2: Tracking lifecycle, privacy, cover recovery and update locking
Files: background/{messages,covers,update-checker}.ts, content/{index,reader-progress}.ts, shared/messages.ts, tests/background/* and tests/content/*.
Interfaces: automatic progress/next messages validated against sender/tab chapter ownership and current settings; new revision from task 1 travels with observation and progress if used.
- [ ] Add failing tests for active incognito/ignored-host revocation, spoofed chapter ownership, transient observation failures, BFCache resume, canceled callbacks, unfocused reading time, cover errors/retry and concurrent lock acquisition.
- [ ] Guard all automatic write boundaries; stop without flushing on revocation; enable/re-detect when settings allow.
- [ ] Report key commits only after successful acknowledgment; bounded retry timer for transient failures; cancel on shutdown/route change.
- [ ] BFCache pageshow restarts detection/progress safely; hidden/unfocused/outside-reader time pauses; canceled timers cannot measure stopped chapter.
- [ ] Manual progress revision invalidates stale automatic completion, synchronize tracker and avoid immediate re-completion at old scroll position.
- [ ] Persist cover-failure metadata and retry affordance/recovery; reuse existing local metadata store where possible.
- [ ] Serialize update lock acquisition while retaining durable expiring worker lease.
- [ ] Run targeted tests and typecheck, review security/privacy boundary.

