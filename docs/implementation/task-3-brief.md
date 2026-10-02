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

### Task 3: Production Violet/Folio UI and interaction consistency
Files: styles/{tokens,global}.css, sidepanel/App.tsx and components/views, ui/{Menu,hooks}.tsx/ts, options views for consistent destructive confirms, useActions/QueueView for rollback, scripts/build.mjs for local assets.
- [ ] Use bundled violet-hands/landscape assets, warm paper and plum night, local Georgia serif headings and system utility fonts, thin rules, restrained radii. Real covers remain unaltered.
- [ ] Compact Continue composition at narrow widths, wider editorial shelf at library width; avoid art overwhelming controls. Do not duplicate current Now Reading series in featured Continue.
- [ ] Detail priority: Continue/progress, then editable metadata, chapters, sources, notes/history. All states share design tokens.
- [ ] Grid/list parity: checked checkbox/selection, favorite/pin, source/last-read metadata, menu, validated modifier/middle-click Continue.
- [ ] Semantic row controls and actual keyboard focus for j/k/arrow, no incomplete listbox semantics.
- [ ] Native dialog focus containment, background inertness, Escape/restore; menu scroll bounded to viewport and focus restore.
- [ ] Loading/error/retry/empty states precise; source/history/rule/merge destructive operations confirmed; queue and optimistic mutation failures restore only affected state.
- [ ] Match theme/settings/detail/queue/history/inspector/command palette; test long text at 280/320/380/480/wide widths.
- [ ] Run checks, review rendered screenshots and interactions, fix sizing inconsistencies.


Root will provide src/storage/cover-status.ts: getCoverStatus(seriesId): Promise<CoverStatus|undefined>, interface CoverStatus {state:'pending'|'failed'|'ready';url:string;attemptedAt:number;error?:string;retryAfter?:number}. Display failed status/retry in series cover dialog/details, use existing cover/refresh worker action; subscribe library changes already available. Do not edit that module.
React official docs fetched: native <dialog> showModal in mount effect, close in cleanup; intentional focus belongs to effect/event handlers. Avoid callback identity causing remount/refocus every render.
