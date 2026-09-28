# Contributing

Thanks for helping make ManwhaTrack better. A few ground rules keep it fast, private and reliable.

## Principles

- **Local only.** No servers, analytics, telemetry, remote code or remote fonts. Network requests go only to the reading sites a user visits.
- **Never lose data.** Schema changes need a migration in `src/storage/migrations.ts` (and an export migration in `src/storage/backup.ts` if the export format changes). Never "recover" by clearing data.
- **Automation over buttons, safety over cleverness.** Weak detections are observed, not saved.
- **Small content script.** No UI framework or heavy work runs inside web pages.

The complete product specification lives in [AGENTS.md](AGENTS.md).

## Setup

```bash
npm install
```

```bash
npm run check
```

`npm run check` must pass before you open a pull request. For changes that affect the browser, also run `npm run test:e2e`.

## Fixing detection for a site

1. Save the relevant HTML (remove anything personal) as a fixture in `tests/fixtures/`.
2. Write a failing test in `tests/detection/`.
3. Fix the adapter in `src/detection/adapters/` or the generic detector.
4. Run the whole suite to make sure other sites still work.

Adapters only return observations; persistence decisions belong to `src/storage/tracking.ts`.

## Style

TypeScript throughout, no `any` unless handling untyped external data, no broad casts to silence errors. Match the surrounding code. UI copy is plain and factual — "Continue", "Mark read", "3 new".
