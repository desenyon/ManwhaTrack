# AGENTS.md — ManwhaTrack

## 0. Mission

ManwhaTrack is a completely local Chrome extension for automatically tracking manhwa reading.

Its core promise is simple:

> Open a manhwa. ManwhaTrack remembers it. Open a chapter. ManwhaTrack remembers where you are. Come back later and continue in one click.

The extension should remove essentially all manual bookkeeping from reading manhwa across the web.

A user should never need to:

- manually add a series they are already reading;
- manually paste a URL;
- remember which chapter they reached;
- hunt through browser history for the right source;
- remember which website they used;
- repeatedly find the series cover;
- create an account;
- send their reading history to a server;
- depend on an external database remaining online.

ManwhaTrack watches the pages the user intentionally visits, identifies series and chapter pages locally, extracts useful metadata from the DOM, and builds a private local library automatically.

Local-first is not a fallback mode. It is the architecture.

## 1. Non-negotiable product rules

These rules override convenience, implementation shortcuts, and feature requests.

### 1.1 Everything private stays local

ManwhaTrack must have:

- no backend;
- no account system;
- no cloud database;
- no analytics;
- no telemetry;
- no tracking pixels;
- no advertising;
- no remote logging;
- no remote configuration;
- no third-party analytics SDK;
- no user identifiers;
- no AI API calls;
- no external recommendation API;
- no silent upload of reading history;
- no external error-reporting service.

Reading history, titles, covers, source URLs, chapter history, settings, notes, tags, statistics, and cached metadata remain on the user's machine.

The extension may communicate directly with a manhwa website when necessary to:

1. inspect a page the user is currently visiting;
2. fetch a cover image to cache locally;
3. check a tracked source for new chapters when update checking is enabled.

It must never route those requests through a ManwhaTrack server because no ManwhaTrack server should exist.

Do not introduce Supabase, Firebase, MongoDB Atlas, PostHog, Sentry, Google Analytics, Mixpanel, Clerk, Auth0, or equivalent services.

### 1.2 Automatic tracking is the default

Tracking should occur from normal browsing behavior.

If a user opens:

```
Series page -> Chapter 1 -> Chapter 2 -> Chapter 3
```

ManwhaTrack should infer:

- the series;
- its source;
- its canonical series URL;
- its cover;
- available title metadata;
- Chapter 1 was opened;
- Chapter 2 was opened;
- Chapter 3 is currently being read;
- Chapter 2 is the latest completed chapter if completion detection succeeded;
- Chapter 3 is the best Continue Reading destination.

No "Add to ManwhaTrack" button should be required.

Manual addition exists only as a fallback.

### 1.3 Never confuse "opened" with "finished"

Track at least three concepts separately:

```
lastOpenedChapter
lastCompletedChapter
currentChapter
```

Opening Chapter 47 does not prove the user finished Chapter 47.

When a chapter is detected:

1. immediately record that it was opened;
2. store the chapter as the current/most recent reading position;
3. monitor reading progress when possible;
4. mark it completed only after a configurable completion condition.

Default completion heuristic:

```
Reader reaches approximately 85% of the meaningful chapter content.
```

Do not use raw document scroll percentage when a site contains enormous headers, comments, recommendations, or footers. Prefer the actual chapter-reader container when it can be identified.

Users must be able to manually mark any chapter read/unread.

### 1.4 Never lose user data

Any feature capable of changing persisted data must account for:

- upgrades;
- schema migrations;
- duplicate records;
- malformed records;
- missing covers;
- deleted sources;
- changed URLs;
- extension service-worker termination;
- partial writes;
- import failures.

Prefer preserving imperfect data over deleting it.

Destructive actions need explicit confirmation or a short undo window.

Do not silently reset storage because a schema changed.

## 2. Product architecture

Target Chrome Manifest V3.

Preferred structure:

```
src/
  background/
    service-worker.ts
    messages.ts
    update-checker.ts

  content/
    index.ts
    detector.ts
    reader-progress.ts
    observer.ts

  detection/
    adapters/
    generic/
    metadata/
    normalization/
    types.ts

  storage/
    db.ts
    schema.ts
    migrations.ts
    repositories/
      series.ts
      chapters.ts
      history.ts
      covers.ts
      sources.ts
      settings.ts

  sidepanel/
    App.tsx
    components/
    views/

  options/
    App.tsx

  shared/
    types/
    utils/
    constants/

  styles/
    tokens.css
    global.css

tests/
  fixtures/
  detection/
  storage/
  migrations/
  e2e/
```

Do not force this exact directory structure into an existing mature repository if doing so causes unnecessary churn. Preserve good existing organization.

Use TypeScript throughout new logic.

Avoid `any` unless interfacing with genuinely untyped external data.

## 3. Storage model

Use two local storage layers intentionally.

### 3.1 Chrome local storage

Use `chrome.storage.local` for lightweight extension state such as:

- preferences;
- UI configuration;
- schema metadata;
- last update-check timestamps;
- installation state;
- onboarding state;
- small indexes where useful.

Do not use `chrome.storage.sync`.

This extension is intentionally local.

Request `unlimitedStorage` if necessary.

### 3.2 IndexedDB

Use IndexedDB for the primary library and larger binary data.

Store:

- series records;
- chapter records;
- reading events;
- locally cached cover blobs;
- source records;
- user notes;
- tags;
- aliases;
- local statistics;
- update snapshots.

Do not encode hundreds of cover images as base64 strings inside one giant `chrome.storage.local` object.

Database writes should be transactional where related objects must remain consistent.

## 4. Core data model

Do not reduce the entire library to `{ title, chapter, url }`.

The model must survive source changes and future features.

Suggested conceptual model:

```ts
interface Series {
  id: string;

  title: string;
  normalizedTitle: string;

  alternateTitles: string[];

  coverId?: string;

  status:
    | "reading"
    | "completed"
    | "planning"
    | "on-hold"
    | "dropped";

  favorite: boolean;
  pinned: boolean;

  personalRating?: number;

  tags: string[];
  notes?: string;

  sourceIds: string[];

  preferredSourceId?: string;

  lastOpenedChapterId?: string;
  lastCompletedChapterId?: string;

  discoveredAt: number;
  lastReadAt?: number;
  updatedAt: number;

  totalReadingTimeMs?: number;

  hidden?: boolean;
}
```

Source:

```ts
interface SeriesSource {
  id: string;
  seriesId: string;

  hostname: string;

  seriesUrl: string;
  canonicalSeriesUrl: string;

  sourceTitle?: string;

  coverUrl?: string;

  latestKnownChapter?: ChapterIdentity;

  lastCheckedAt?: number;
  lastSuccessfulCheckAt?: number;

  adapterId?: string;

  disabled: boolean;
}
```

Chapter:

```ts
interface Chapter {
  id: string;
  seriesId: string;
  sourceId: string;

  title: string;

  chapterNumber?: number;
  chapterLabel: string;

  volumeNumber?: number;

  url: string;
  canonicalUrl: string;

  firstOpenedAt?: number;
  lastOpenedAt?: number;
  completedAt?: number;

  visitCount: number;

  maxProgress: number;

  readingTimeMs: number;

  discoveredAt: number;
}
```

Reading event:

```ts
interface ReadingEvent {
  id: string;

  seriesId: string;
  chapterId?: string;

  type:
    | "opened"
    | "progress"
    | "completed"
    | "manual-read"
    | "manual-unread";

  timestamp: number;

  progress?: number;
}
```

Cover:

```ts
interface CoverAsset {
  id: string;

  blob: Blob;

  mimeType: string;

  width?: number;
  height?: number;

  sourceUrl?: string;

  capturedAt: number;
}
```

All persisted models require schema versioning.

## 5. IDs and identity

Do not use titles as primary keys.

Titles change.

URLs change.

Capitalization changes.

Use generated immutable internal IDs.

Maintain normalized values separately for matching.

## 6. Automatic detection pipeline

Detection quality is the heart of ManwhaTrack.

Do not build a pile of hard-coded hostname `if` statements inside one content script.

Use an adapter architecture.

Every page should pass through roughly:

```
Page load
   ↓
Known-site adapter?
   ↓
Generic detector
   ↓
Page classification
   ↓
Extract metadata
   ↓
Confidence validation
   ↓
Normalize
   ↓
Persist/update
   ↓
Observe SPA changes
```

Possible classifications:

```ts
type PageKind =
  | "series"
  | "chapter"
  | "search"
  | "listing"
  | "unknown";
```

## 7. Site adapters

A site adapter should implement a shared interface.

For example:

```ts
interface SiteAdapter {
  id: string;
  hosts: string[];

  detectPageKind(document: Document, url: URL): PageKind;

  extractSeries(document: Document, url: URL): DetectedSeries | null;

  extractChapter(document: Document, url: URL): DetectedChapter | null;

  getReaderContainer?(
    document: Document
  ): HTMLElement | null;

  extractChapterList?(
    document: Document
  ): DetectedChapterLink[];

  normalizeSeriesUrl?(url: URL): string;
  normalizeChapterUrl?(url: URL): string;
}
```

Adapters should contain extraction logic, not persistence logic.

They return structured observations.

The tracking layer decides what to persist.

## 8. Generic detector

ManwhaTrack should still function on previously unseen sites.

Generic detection should combine multiple weak signals instead of trusting one brittle selector.

Useful signals include:

- `og:title`;
- `og:image`;
- canonical URL;
- JSON-LD;
- page headings;
- breadcrumb text;
- chapter navigation;
- URLs containing chapter-like tokens;
- links to previous/next chapters;
- repeated chapter links;
- image-heavy reader containers;
- title patterns;
- nearby metadata labels;
- DOM structure.

Example chapter patterns:

```
chapter-42
chapter/42
ch-42
ch/42
chapter_42
episode-42
episode/42
```

Do not assume chapter identifiers are integers.

Support:

```
12
12.5
12.1
001
Special
Prologue
Epilogue
Side Story 4
Chapter 31 Part 2
Season 2 Chapter 8
```

Numeric parsing is useful for ordering but must never replace the original label.

## 9. Detection confidence

Generic detection should produce a confidence score internally.

Example concept:

```ts
interface DetectionResult<T> {
  value: T;
  confidence: number;
  evidence: DetectionEvidence[];
}
```

Do not automatically insert a series into the library from a weak guess.

A chapter URL plus a reader container plus a clear title is strong evidence.

A random page containing the word "chapter" is not.

Create thresholds such as:

```
>= 0.80 -> automatically track
0.55–0.79 -> observe but do not persist automatically
< 0.55 -> ignore
```

Exact thresholds may be tuned through tests.

The UI does not need to expose fake precision to users.

## 10. SPA support

Many websites modify URLs and content without full page reloads.

Do not rely exclusively on `DOMContentLoaded`.

Handle:

- `history.pushState`;
- `history.replaceState`;
- `popstate`;
- meaningful DOM changes;
- client-side route transitions.

Use a debounced `MutationObserver`.

Never rerun expensive full-page detection on every individual mutation.

A reasonable model:

```
DOM mutation burst
→ debounce
→ determine whether meaningful structure/URL changed
→ rerun detector
```

## 11. Series discovery

When a user opens a confidently detected series page:

1. extract the best title;
2. normalize it;
3. extract alternate titles when available;
4. determine canonical series URL;
5. identify the hostname/source;
6. find the strongest cover candidate;
7. create or update the local source;
8. create the series if needed;
9. cache the cover locally;
10. store detected chapter information when available;
11. update timestamps.

Show a subtle temporary confirmation such as:

```
Tracking Solo Leveling
Undo
```

Do not interrupt reading with a modal.

## 12. Chapter discovery

When a user opens a chapter:

1. detect chapter identity;
2. infer its parent series;
3. automatically create the parent series if absent;
4. create/update the source;
5. create/update the chapter;
6. record `opened`;
7. set the series' current reading position;
8. begin progress tracking;
9. locate next/previous chapter URLs when possible;
10. update Continue Reading.

This must work even if the user never visits the series landing page.

## 13. Reading completion

Completion detection should be resilient.

Preferred evidence order:

1. user reaches end of the identified reader container;
2. user reaches the next-chapter section after traversing reader content;
3. user clicks a detected "Next Chapter" link;
4. fallback scroll heuristic.

When clicking Next Chapter from Chapter 41:

```
Chapter 41 -> completed
Chapter 42 -> opened/current
```

This is stronger evidence than simply opening Chapter 42 from an unrelated link.

Store the maximum progress reached.

Avoid firing storage writes for every scroll pixel.

Throttle progress updates.

## 14. Continue Reading

This is the most important action in the UI.

Every actively read series should have one obvious:

**Continue**

button.

Destination priority:

1. known next chapter after the latest completed chapter;
2. last opened incomplete chapter;
3. last chapter URL;
4. preferred source series page.

Clicking should immediately open the source URL.

No extra confirmation.

Support:

- open current tab;
- open new tab via modifier/middle click;
- optional setting for default behavior.

## 15. Multiple sources

A series may be read from more than one website.

Do not automatically create three separate library entries just because URLs differ.

At the same time, do not recklessly merge titles based on fuzzy text alone.

Maintain:

```
Series
 ├── Source A
 ├── Source B
 └── Source C
```

Track a preferred source.

When another likely duplicate appears:

```
Possible duplicate detected
[Merge] [Keep Separate]
```

The user can merge or split series later.

When merging, preserve:

- every source;
- every chapter;
- history;
- notes;
- tags;
- earliest discovery date;
- cover choices;
- progress.

## 16. Cover art

Covers must be cached locally.

Do not merely save:

```
coverUrl: "https://..."
```

because remote covers disappear when:

- the CDN expires URLs;
- the site changes;
- hotlink protections change;
- the user is offline;
- the source disappears.

Detection priority:

1. site-adapter cover selector;
2. structured metadata;
3. `og:image`;
4. image adjacent to the series title;
5. strongest likely poster/cover image.

Download the chosen asset and save a local Blob.

Keep the original remote URL only as source metadata.

Use a neutral placeholder if no cover can be determined.

Do not show broken-image icons.

Provide:

- Change cover
- Refresh cover
- Remove custom cover
- Choose another detected image
- Upload local cover

where practical.

## 17. Primary UI: side panel

The primary ManwhaTrack interface should be a Chrome side panel.

The toolbar icon should open it immediately.

The side panel survives the user's normal browsing flow better than a small popup and allows the library to remain visible beside a chapter.

Core panel structure:

```
┌───────────────────────────────┐
│ ManwhaTrack           Search  │
│                               │
│ Continue                      │
│ [cover] Title                 │
│         Ch. 83 → Continue     │
│                               │
│ Library                       │
│ Reading  New  All  Favorites  │
│                               │
│ [cover] Series         Ch. 52 │
│ [cover] Series         Ch. 18 │
│ [cover] Series         Ch. 91 │
│                               │
└───────────────────────────────┘
```

Keep it dense.

A reading tracker should feel closer to a polished native library than a SaaS analytics product.

## 18. Popup behavior

Do not create a second full application inside the action popup.

If a popup is retained, keep it extremely small:

```
Current page
Title
Chapter 42

[Continue]
[Open Library]
```

However, prefer configuring the toolbar action to open the side panel directly.

Avoid maintaining two large parallel interfaces.

## 19. Visual design rules

The interface must look intentionally designed by a human.

Avoid the recognizable "AI-generated dashboard" aesthetic.

Do not use:

- purple-to-blue gradients;
- gradient text;
- glowing cards;
- glassmorphism everywhere;
- enormous border radii;
- giant hero headings;
- floating decorative blobs;
- sparkles;
- random emoji;
- oversized whitespace;
- endless cards inside cards;
- four giant metric boxes at the top;
- useless motivational copy;
- "Welcome back 👋";
- "Your reading journey";
- unnecessary animated counters;
- marketing language inside a utility;
- every component having a shadow;
- excessive pill-shaped controls.

Prefer:

- strong spacing;
- compact rows;
- precise typography;
- quiet 1px borders;
- restrained shadows only where depth is actually needed;
- 6–10px radii;
- clear hierarchy;
- dense information;
- readable 2:3 covers;
- consistent icon sizing;
- fast hover states;
- native-feeling context menus;
- system fonts.

Recommended font stack:

```css
font-family:
  ui-sans-serif,
  -apple-system,
  BlinkMacSystemFont,
  "Segoe UI",
  sans-serif;
```

No remote fonts.

Support:

```
System
Light
Dark
```

Do not make dark mode pure black everywhere.

## 20. Library

The library is the heart of the extension.

Support both:

```
Grid
Compact list
```

Each series should expose at minimum:

- cover;
- title;
- progress;
- latest known chapter;
- source;
- last read;
- update indicator;
- favorite state.

Actions:

- Continue
- Mark read
- Mark unread
- Change status
- Favorite
- Pin
- Edit
- Open source
- Change preferred source
- View history
- Remove

## 21. Library sections

Useful built-in views:

```
Continue Reading
Recently Read
New Chapters
Reading
Completed
Plan to Read
On Hold
Dropped
Favorites
Pinned
All
```

"Continue Reading" should be the default landing view when useful.

Do not bury it beneath analytics.

## 22. Search

Search should be instant and entirely local.

Search against:

- title;
- normalized title;
- alternate titles;
- source title;
- tags;
- notes;
- hostname.

Support basic fuzzy matching and typo tolerance without introducing a remote search service.

Keyboard focus shortcut:

```
/
```

Optional:

```
Cmd/Ctrl + K
```

## 23. Sorting

Support:

- recently read;
- recently added;
- title A–Z;
- title Z–A;
- chapter progress;
- newest update;
- oldest update;
- source;
- personal rating.

Remember the user's selected sort per view.

## 24. Filters

Composable filters should include:

- status;
- source;
- favorite;
- pinned;
- has updates;
- unread chapters;
- tags;
- read recently;
- inactive;
- completed.

Do not force users through a giant modal for basic filtering.

## 25. Series detail view

Clicking a library item should open a focused detail view containing:

```
Cover
Title
Aliases
Status
Rating
Tags

Continue Reading

Progress
Last read
Latest known chapter

Sources

Chapter history

Reading history

Notes
```

Allow metadata editing because scraping will never be perfect.

All manual changes must survive future automatic detections.

Automatic extraction should never overwrite a user's explicit title, cover, status, tags, or notes.

## 26. Chapter history

A series should expose a chapter timeline.

Example:

```
✓ 42     Sep 27
✓ 41     Sep 26
◐ 40.5   Sep 25
✓ 40     Sep 24
```

Users can:

- reopen chapters;
- mark read;
- mark unread;
- select multiple chapters;
- mark all before X as read.

Never require a perfect complete chapter list to make progress tracking work.

## 27. Reading history

Maintain an append-oriented local history.

Example:

```
Sep 27
5:42 PM  Opened Chapter 83
5:31 PM  Finished Chapter 82

Sep 26
9:17 PM  Finished Chapter 81
```

Allow users to clear:

- one event;
- one series' history;
- all reading history.

Clearing event history should not necessarily delete the library or progress state. Make that distinction explicit.

## 28. New chapter detection

Provide local update checking.

When enabled, ManwhaTrack may periodically request tracked series pages directly from their original websites and compare detected chapter lists.

Requirements:

- rate-limit requests;
- avoid hammering sources;
- group checks intelligently;
- back off after errors;
- remember failures;
- allow per-source disable;
- provide manual Refresh;
- never use a central ManwhaTrack service.

Recommended default:

```
Check occasionally while Chrome is active,
with a conservative per-source interval.
```

Do not promise real-time updates.

## 29. Update indicators

When a known source contains chapters newer than the user's latest completed chapter:

```
3 new
```

Display the count subtly beside the series.

Toolbar badge may optionally show the total number of series with updates.

Do not turn the extension into a notification machine.

## 30. Notifications

Notifications are optional.

Settings:

```
Off
Only favorites
All tracked series
```

If notifications require an additional permission, request it only when the user enables the feature.

Example:

```
Omniscient Reader
Chapter 271 is available.
```

Clicking the notification should open the appropriate destination.

## 31. Smart source recovery

Websites change routes.

If a saved chapter URL fails or redirects:

1. preserve the old URL;
2. inspect the resulting page;
3. determine whether the series moved;
4. update canonical source data when confidence is high;
5. never destroy the reading history.

If a source disappears entirely, retain the series.

The library must remain useful even when the website no longer exists.

## 32. Local site rules

Provide an advanced local configuration mechanism for unsupported sites.

Users should eventually be able to specify selectors such as:

```
Series title selector
Cover selector
Chapter title selector
Reader container selector
Next chapter selector
Previous chapter selector
Series URL selector
Chapter list selector
```

Save these rules locally.

A useful advanced "Detection Inspector" can show:

```
Page kind: Chapter
Series: Example Series
Chapter: 42
Cover: detected
Reader: .reading-content
Confidence: High
Adapter: generic
```

This is far more useful than opaque failures.

Never send broken pages to a remote debugging service.

## 33. Context menu

Useful optional browser context actions:

```
Track this series
Open in ManwhaTrack
Mark current chapter read
Mark current chapter unread
Open series page
Refresh metadata
```

Only show context actions when relevant.

## 34. Keyboard behavior

Support useful keyboard navigation inside ManwhaTrack.

Examples:

```
/                Search
j / ↓            Next item
k / ↑            Previous item
Enter            Open/continue
f                Favorite
r                Mark read
Shift + r        Mark unread
Esc              Back/close
```

Do not override common browser shortcuts.

Make shortcuts discoverable.

## 35. Omnibox support

A future high-value feature is a Chrome omnibox keyword such as:

```
mt solo
```

which can locally search tracked series and open the selected result.

Example:

```
mt omniscient
→ Omniscient Reader — Continue Ch. 83
```

No remote search is required.

## 36. Quick switcher

`Cmd/Ctrl + K` may open a compact command/search palette.

Commands could include:

```
Continue Omniscient Reader
Open Library
Show New Chapters
Mark Current Chapter Read
Refresh Current Series
Export Library
Open Settings
```

Keep it functional.

No giant command palette framework is necessary for eight actions.

## 37. Tags

Allow arbitrary local tags:

```
Action
Murim
Regression
Caught Up
Read Weekly
Favorite Art
```

Tags should be:

- searchable;
- filterable;
- editable;
- removable;
- color optional.

Do not hard-code genre assumptions into the database.

## 38. Notes

Each series may have a plain-text note.

Examples:

```
Wait until Season 3 finishes.
```

or:

```
Official translation is 4 chapters behind.
```

Notes remain local.

Support simple plain text first.

Do not build a rich-text editor unless there is a real use case.

## 39. Personal ratings

Optional local rating.

Allow a simple numeric scale.

Never fetch or display social ratings unless a future feature explicitly adds source-page metadata extraction.

ManwhaTrack is primarily a tracker, not a review network.

## 40. Reading statistics

Statistics are local utilities, not the home screen.

Potential statistics:

- chapters read;
- series started;
- series completed;
- reading time;
- chapters by day;
- chapters by week;
- most-read series;
- recently active sources;
- completion counts.

Never invent data.

If reading time cannot be measured reliably, label it appropriately.

Pause reading-time accumulation when:

- tab is hidden;
- browser/window loses relevant activity for a sustained period;
- user leaves the chapter;
- chapter content is no longer active.

Do not count eight hours because someone left a chapter tab open overnight.

## 41. Backup

Because there is no cloud account, backup quality matters.

Provide:

**Export Library**

Produce a versioned local file containing all restorable metadata.

Prefer a structure conceptually similar to:

```json
{
  "application": "ManwhaTrack",
  "exportVersion": 1,
  "exportedAt": "...",
  "schemaVersion": 4,
  "series": [],
  "sources": [],
  "chapters": [],
  "history": [],
  "settings": {}
}
```

Where practical, offer:

```
Metadata-only export
Complete backup including covers
```

Do not bake volatile internal database implementation details into a supposedly portable format unless necessary.

## 42. Import

Import must validate before writing.

Flow:

```
Choose file
→ Parse
→ Validate
→ Preview
→ Determine duplicates
→ Import transactionally
```

Offer sensible conflict handling:

```
Merge
Keep existing
Use imported
```

A malformed import must not corrupt the current library.

## 43. CSV export

Optional CSV export is useful for portability.

Fields might include:

```
Title
Status
Last Completed Chapter
Last Opened Chapter
Preferred Source
Series URL
Last Read
Rating
Tags
```

CSV does not need to encode every internal detail.

JSON remains the complete backup format.

## 44. Privacy screen

Settings should clearly say:

```
Your library is stored on this device.
ManwhaTrack has no account and no server.
```

Also expose:

- estimated local storage usage;
- cover-cache usage;
- number of tracked series;
- clear cached covers;
- clear history;
- reset extension.

"Clear covers" should regenerate them when series are revisited rather than deleting series.

## 45. Incognito

Default behavior:

Do not record incognito browsing.

If support is later provided, the user must explicitly enable it and understand how Chrome's incognito extension mode behaves.

Never silently merge incognito reading activity into the normal library.

## 46. Security

Treat every source webpage as hostile input.

Never trust extracted HTML.

Prefer:

```
textContent
```

over `innerHTML`.

Never inject arbitrary scraped HTML into extension pages.

Do not use `eval`.

Do not execute remote scripts.

Do not load remote JavaScript bundles.

Do not load remote fonts.

Sanitize imported text where necessary.

Only open validated `http:` or `https:` reading URLs.

Avoid `javascript:`, `data:` navigation, and other unexpected schemes for saved source links.

Keep the extension Content Security Policy strict.

## 47. Permissions

Request the smallest permissions consistent with the intended experience.

Likely capabilities include:

```
storage
sidePanel
tabs as needed
alarms for update checks
contextMenus if implemented
notifications only if enabled
unlimitedStorage if needed
```

Host access is fundamental to universal automatic detection.

If ManwhaTrack is primarily distributed privately/unpacked, broad host access may be acceptable for the core behavior.

If preparing for Chrome Web Store distribution, investigate optional host-permission onboarding so users understand why page access is needed.

Do not request unrelated permissions "for later."

Every permission should correspond to an implemented feature.

## 48. Performance

The content script runs on browsing pages, so it must stay lightweight.

Rules:

- no giant framework injected into websites;
- no constant full-DOM scans;
- no mutation callback doing expensive work immediately;
- debounce route/DOM re-detection;
- cache selectors/results where safe;
- disconnect observers when unnecessary;
- throttle scroll handlers;
- batch storage writes;
- avoid large synchronous parsing loops.

The actual ManwhaTrack interface may use the project's normal UI framework.

The page-tracking script should remain small.

## 49. Offline behavior

The library must still open without internet.

Offline users should be able to:

- browse tracked series;
- see cached covers;
- search;
- filter;
- inspect history;
- edit notes/tags/status;
- inspect progress;
- export data.

Continue Reading may naturally fail if the source itself requires internet, but ManwhaTrack should still know where the user left off.

## 50. Error handling

Do not expose raw stack traces to normal users.

Use precise states:

```
Could not detect this page.
Cover could not be downloaded.
This source has not responded recently.
Import file is invalid.
Series page appears to have moved.
```

Do not use vague messages like:

```
Oops! Something went wrong.
```

Advanced diagnostics may expose technical details separately.

## 51. Empty states

Keep empty states factual.

Good:

```
No series tracked yet.

Open a manhwa and it will appear here automatically.
```

Bad:

```
Your epic reading journey begins here ✨
Discover your next adventure!
```

ManwhaTrack is a utility.

## 52. Microcopy

Prefer:

```
Continue
Mark read
3 new
Last read yesterday
No updates
Refresh
Open source
```

Avoid:

```
Dive back in
Embark on your journey
Explore your collection
Level up your reading
Powered by intelligent tracking
```

Never call deterministic parsing "AI."

## 53. Accessibility

Required:

- keyboard navigation;
- visible focus states;
- semantic buttons;
- proper labels;
- useful alt text for covers;
- sufficient contrast;
- no color-only state communication;
- reduced-motion support;
- sensible tab order.

Do not sacrifice accessibility for visual minimalism.

## 54. Responsive behavior

The side panel can become narrow.

Design from narrow widths first.

At small widths:

- title truncation should be deliberate;
- primary controls remain accessible;
- covers retain usable size;
- secondary metadata may collapse;
- actions can move into a `...` menu.

Do not simply shrink desktop cards until they become unreadable.

## 55. Fast interactions

Common actions should feel instantaneous because they are local.

Optimistically update UI for safe local operations such as:

- favorite;
- status;
- mark read;
- tags;
- pinning.

Rollback if persistence fails.

Do not display loaders for local operations that complete almost immediately.

## 56. Undo

Prefer lightweight Undo for reversible destructive actions.

Example:

```
Removed "Example Series"
Undo
```

Hard deletion should not be easier than marking something Dropped or hiding it.

## 57. Manual correction always wins

Scrapers make mistakes.

Users must be able to edit:

- title;
- alternate titles;
- cover;
- chapter number;
- series association;
- preferred source;
- progress.

Persist a distinction between:

```
detected metadata
user override
```

When the source is detected again, update the detected value without overwriting the user's override.

## 58. Deduplication

Normalize titles for candidate matching:

- lowercase;
- trim;
- collapse whitespace;
- normalize obvious punctuation differences;
- optionally strip known presentation suffixes.

Do not aggressively strip meaningful words.

Potential duplicates should be suggested rather than automatically merged unless identity is essentially certain.

## 59. Chapter ordering

Never assume lexical sorting.

This is wrong:

```
1
10
100
11
2
```

When numeric components exist, sort numerically.

Preserve specials and nonnumeric chapters.

A good chapter comparator should understand reasonable sequences such as:

```
10
10.1
10.5
11
```

and remain stable when parsing is ambiguous.

## 60. URL normalization

Canonicalization should remove obviously irrelevant tracking/query parameters where safe.

Do not casually strip query parameters that may identify the chapter.

Prefer:

- canonical metadata;
- adapter rules;
- known safe tracking parameters.

Store the originally visited URL when useful for recovery/debugging.

## 61. Source health

Track source health locally.

Possible state:

```ts
type SourceHealth =
  | "healthy"
  | "stale"
  | "failing"
  | "unknown";
```

This may be inferred from update-check results.

Do not delete a source after several failures.

## 62. Current-page integration

When the side panel is open beside a recognized chapter, show a small contextual area:

```
NOW READING

Omniscient Reader
Chapter 83

72% read
```

Possible actions:

```
Mark read
Series details
```

Keep this compact.

The extension should feel aware of the currently open chapter without injecting a large UI over the website itself.

## 63. Avoid intrusive page overlays

Do not place floating widgets over reading content by default.

The content script should mostly be invisible.

If an optional on-page progress indicator is eventually introduced, make it:

- disabled by default;
- tiny;
- configurable;
- removable;
- non-blocking.

The side panel is the UI.

The website remains the reader.

## 64. Favorites versus pinned

Treat these separately.

Favorite means personal classification.

Pinned means UI priority.

A user may pin something temporarily without calling it a favorite.

## 65. Queue

Provide an optional reading queue.

Users may reorder:

```
1. Series A
2. Series B
3. Series C
```

Queue membership must not alter progress or status.

Support drag-and-drop plus keyboard-accessible reordering.

## 66. "Caught up"

"Caught up" should usually be derived:

```
latest completed chapter >= latest known chapter
```

Do not necessarily make it a permanent series status because a new chapter can appear tomorrow.

Display:

```
Caught up
```

as a state.

Keep series status:

```
Reading
```

## 67. Reading statuses

Supported explicit statuses:

```
Reading
Plan to Read
On Hold
Completed
Dropped
```

Do not automatically mark a series Completed simply because the latest currently known chapter was read. An ongoing series may have more chapters later.

"Completed" should usually be user-controlled unless source metadata explicitly and reliably indicates the story itself ended.

## 68. Batch actions

For larger libraries, support multi-select.

Useful batch actions:

- set status;
- add tag;
- remove tag;
- favorite;
- unfavorite;
- mark chapters up to X read;
- export selected;
- delete selected.

Keep accidental batch deletion difficult.

## 69. Cover storage management

Large libraries may accumulate considerable image data.

Provide cache controls:

```
Storage used: ...
Covers: ...
Metadata: ...

[Clear unused covers]
[Rebuild cover cache]
```

When replacing covers, garbage-collect orphaned assets safely.

Do not delete a Blob that another record still references.

## 70. Import compatibility

Maintain versioned migrations for exports.

Future ManwhaTrack versions should attempt to import old ManwhaTrack backups.

Never require users to manually edit JSON because the schema changed.

## 71. Database migrations

Every persisted schema change must have an explicit migration.

Concept:

```ts
migrations = {
  1: migrate1To2,
  2: migrate2To3,
  3: migrate3To4,
};
```

Migrations must be:

- deterministic;
- tested;
- recoverable where practical;
- safe with missing optional fields.

Never write migration logic that simply catches an error and clears the database.

## 72. Service worker assumptions

Manifest V3 background workers may stop and restart.

Do not treat process memory as durable state.

Any important state must live in persistent local storage.

Listeners required after startup must be registered correctly whenever the worker initializes.

Long operations should be structured so unexpected worker suspension does not corrupt data.

## 73. Message contracts

Content scripts, side panel, and service worker should communicate through typed message contracts.

Avoid:

```ts
sendMessage({ type: "thing", data: stuff })
```

spread randomly throughout the repository.

Define shared message types.

Example:

```ts
type ExtensionMessage =
  | DetectSeriesMessage
  | ChapterOpenedMessage
  | ChapterProgressMessage
  | ChapterCompletedMessage
  | GetLibraryMessage;
```

Validate important payloads at boundaries.

## 74. Testing

Do not consider automatic detection complete without fixtures.

At minimum test:

**Storage**

- create series;
- update series;
- delete series;
- merge series;
- split source;
- transaction rollback;
- migrations.

**Detection**

- series page;
- chapter page;
- special chapter;
- decimal chapter;
- missing cover;
- malformed metadata;
- generic site;
- known adapter;
- SPA route change.

**Progress**

- chapter opened;
- partially read;
- completed;
- next chapter navigation;
- manual unread;
- repeated visits.

**Deduplication**

- exact same source;
- normalized URL;
- title variation;
- true duplicate;
- similar but distinct titles.

**Import/export**

- round trip;
- old version;
- malformed file;
- duplicate import;
- missing optional fields.

## 75. Detection fixtures

Save sanitized representative HTML fixtures for detector tests.

Tests should run against fixtures rather than depending on live websites.

A source changing tomorrow should not make the entire test suite nondeterministic.

When fixing a real detection bug:

1. add a fixture reproducing it;
2. write a failing test;
3. fix detection;
4. verify existing sites remain intact.

## 76. End-to-end tests

Where practical, test the extension in a real Chromium environment.

Critical flow:

```
Install extension
→ Open fixture series
→ Series appears automatically
→ Open fixture chapter 1
→ Progress updates
→ Finish chapter
→ Open chapter 2
→ Continue Reading points correctly
→ Restart browser context
→ Data remains
```

Persistence after restart is mandatory.

## 77. Performance tests

Test at meaningful scale.

The UI should remain usable with at least:

```
1,000 series
20,000 chapters
large reading history
hundreds of cached covers
```

Do not render 20,000 chapter rows into the DOM simultaneously.

Use sensible virtualization/pagination where needed.

## 78. Logging

Development builds may use structured local debug logging.

Production should not flood the console.

Never transmit logs externally.

Sensitive reading information should not be printed casually.

Debug output may be behind:

```
Settings -> Advanced -> Debug mode
```

## 79. Development principles for coding agents

Before modifying code:

1. inspect the relevant implementation;
2. identify the canonical data model;
3. inspect tests;
4. determine whether the change requires a migration;
5. make the smallest coherent architectural change;
6. run relevant tests;
7. verify the extension still builds.

Do not rewrite working modules simply because another pattern is fashionable.

Do not introduce a new framework for a small feature.

Do not leave duplicate legacy implementations behind.

Do not solve TypeScript errors using broad casts.

Do not disable lint rules to conceal bad code.

Do not add placeholder TODO features and claim them complete.

## 80. Dependency policy

Before adding a dependency, ask:

```
Can this reasonably be implemented in ~50 lines using browser APIs?
```

If yes, probably do that.

Dependencies are justified when they significantly improve:

- correctness;
- accessibility;
- database reliability;
- complex UI behavior;
- testing.

Avoid large dependencies for:

- class-name joining;
- one debounce function;
- one icon;
- one date format;
- trivial state.

No dependency may silently transmit data.

## 81. No AI features

Do not add:

- AI summaries;
- AI recommendations;
- AI title detection APIs;
- chat assistants;
- embeddings;
- LLM classification;
- semantic cloud search;
- "AI-powered" marketing.

Page detection should be deterministic and local.

A robust parser is more appropriate for this product.

The product's intelligence should come from good engineering.

## 82. Feature priority

Implement in this order.

**P0 — the product must work**

- Manifest V3 extension
- local database
- automatic series detection
- automatic chapter detection
- chapter progress
- cached covers
- Continue Reading
- side panel
- library
- search
- edit metadata
- robust persistence
- import/export
- generic detector
- adapter framework

Do not start building elaborate statistics before P0 is dependable.

**P1 — make it excellent**

- multiple sources
- new chapter checking
- favorites
- statuses
- tags
- notes
- history
- filters
- sorting
- grid/list views
- duplicate management
- custom covers
- batch actions
- keyboard navigation
- notifications
- storage controls

**P2 — power-user features**

- local site-rule editor
- Detection Inspector
- command palette
- omnibox search
- reading queue
- source-health view
- advanced statistics
- full backup with covers
- customizable keyboard shortcuts
- richer update management

P2 must not destabilize P0.

## 83. Core acceptance test

The extension is not ready until this experience works:

A completely new user installs ManwhaTrack.

They never create an account.

They never manually add a title.

They browse to a supported manhwa series.

Its title and cover quietly appear in ManwhaTrack.

They open Chapter 31.

ManwhaTrack records Chapter 31 as opened.

They read to the end and click Chapter 32.

Chapter 31 becomes completed and Chapter 32 becomes current.

They close Chrome.

Several days later they reopen Chrome and click ManwhaTrack.

The series is still there with its locally cached cover.

It clearly says where they stopped.

They click Continue once.

Chapter 32 opens.

That is the product.

## 84. Generic-site acceptance test

The extension must also demonstrate useful behavior on a site without a dedicated adapter.

Given a page with sufficiently strong generic signals, ManwhaTrack should identify:

```
Series
Chapter
Cover
Series URL
Current chapter URL
```

without hard-coded knowledge of that hostname.

When it cannot determine something confidently, it should preserve what it knows rather than manufacture metadata.

## 85. Local-only acceptance test

A developer should be able to inspect the extension and verify that:

- no ManwhaTrack backend exists;
- no account is required;
- no analytics endpoint is contacted;
- no reading history is uploaded;
- no remote JavaScript is executed;
- disabling internet still leaves the library functional;
- exported data can represent the user's library independently of the extension database.

## 86. UX acceptance test

A finished interface should survive these questions:

Can I find what I was reading in under two seconds?

If not, simplify.

Can I resume it with one click?

If not, simplify.

Can I tell which series updated?

If not, improve hierarchy.

Does a list of 200 series still feel organized?

If not, improve search/filtering.

Does the UI look like a reading utility rather than a startup landing page?

If not, redesign it.

## 87. Final design direction

ManwhaTrack should visually sit somewhere between:

```
a native media library
+
a good browser utility
+
a compact reading log
```

The interface should recede behind the content.

Covers provide most of the color.

Typography, spacing, alignment, subtle borders, and interaction quality provide the rest.

There should be almost nothing decorative that cannot explain why it exists.

## 88. Definition of done

A feature is not done because the happy-path screenshot looks correct.

A feature is done when:

- its data survives restart;
- its state survives navigation;
- loading state works;
- empty state works;
- error state works;
- dark/light mode works;
- keyboard interaction works where applicable;
- narrow side-panel width works;
- user overrides are preserved;
- migrations are addressed;
- tests cover important logic;
- no network privacy regression was introduced;
- no unrelated data can be accidentally deleted;
- the UI remains consistent with the rest of ManwhaTrack.

## 89. Governing principle

When choosing between automation and another manual control, prefer reliable automation.

When choosing between cloud convenience and local ownership, choose local ownership.

When choosing between adding another dashboard element and making Continue Reading faster, make Continue Reading faster.

When choosing between cleverness and data safety, choose data safety.

ManwhaTrack should become the kind of extension a reader forgets is doing work until they need to know one thing:

Where was I?

It should already know.

---

## Repository notes for agents

- `npm run check` — typecheck, unit tests, production build. Run before finishing any change.
- `npm run test:e2e` — builds, then runs the Chromium end-to-end suite in `tests/e2e/`. If Playwright's bundled Chromium is missing, point `PW_CHROMIUM_PATH` at a Chrome for Testing binary.
- `SCREENSHOT_DIR=… npm run test:e2e -- screenshots` — captures side panel and settings screenshots for visual review.
- The tracking layer (`src/storage/tracking.ts`) is the only automatic writer. Adapters and detectors return `PageObservation`s and never persist.
- Inside `withTx` callbacks, await only IndexedDB requests made through the `Tx` object (see `src/storage/db.ts`); anything else lets the transaction auto-commit early.
- Schema changes need a step in `src/storage/migrations.ts` and, if exported, an entry in `EXPORT_MIGRATIONS` in `src/storage/backup.ts`.
- New detection behavior needs a fixture in `tests/fixtures/` and a test in `tests/detection/`.
