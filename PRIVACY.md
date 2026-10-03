# Privacy

ManwhaTrack keeps your library and reading history on your computer. It does not upload them to the developer or an analytics service.

Last updated: October 3, 2026.

## Limited Use compliance

ManwhaTrack complies with the Chrome Web Store User Data Policy, including its Limited Use requirements. Reading-page data is used only to provide the extension's reading-tracking features. User data is not sold, used for advertising, transferred for unrelated purposes, or used to determine creditworthiness or lending eligibility. The developer does not receive or review your library, reading history, notes, or reading analytics.

## What is stored, and where

Everything ManwhaTrack knows — series, chapters, reading progress, history, notes, tags, ratings, covers, reading-time measurements and settings — is stored in your browser's local storage for the extension (IndexedDB and `chrome.storage.local`). It is not synced to your Google account and there is no ManwhaTrack server to send it to.

## Network requests

ManwhaTrack's automatic network requests go directly to your reading sources and their image hosts:

| When | Request |
| --- | --- |
| You open a series page | Downloads the series cover image once, to cache it locally |
| Update checks are on (Settings → General) | Occasionally requests tracked series pages to look for new chapters — at most one request per site per run, with longer waits after errors. For MangaDex, its public API is used instead of the page. |
| You choose a different detected cover | Shows the candidate images from the source site, then downloads the one you pick |

These requests are sent without cookies. The only header ManwhaTrack adds is the site's own address as `Referer`, because many image hosts refuse requests without one.

Source sites and image hosts receive normal requests, including the requested URL, your IP address, and any source-page Referer needed to load a cover. These requests do not contain an export of your library, notes, or reading analytics. Opening a source from the library is normal browser navigation and follows that site's own privacy practices.

There is no usage telemetry, external analytics, advertising, remote configuration, remote code, crash or error reporting, and no account. The Analytics page calculates reading patterns entirely on your device from local reading events, minute-level active-time measurements and observed backlog snapshots. It does not contact an analytics service. Older undated reading totals are kept separately rather than assigned invented dates.

## What ManwhaTrack reads on pages

The content script runs on HTTP and HTTPS pages to recognize reading pages. On ordinary pages it does a quick check and stops without adding them to your library. On reading pages it reads the titles, text, image addresses and chapter links needed to identify the series and chapter. It records reading-page URLs, progress, completion events and active reading time locally. It does not collect a general browser-history log or upload scraped page content.

## Incognito

Incognito windows are ignored by default. If you turn on *Settings → Advanced → Track in Incognito windows* (and allow the extension in Incognito on `chrome://extensions`), Incognito reading is added to the same local library.

## Your control

- Export your whole library at any time (*Settings → Import & export*).
- Clear reading history, cached covers or everything (*Settings → Storage & privacy*). Clearing history also clears dated analytics, while retaining chapter progress and lifetime reading-time totals.
- Removing the extension deletes all of its local data.

Data remains on your device until you clear it or remove the extension. An exported backup is a file under your control; sharing that file shares its contents. Support reports are sent only when you choose to submit them. Do not include a private backup or reading history in a public issue.

## Contact

Questions about privacy or the extension can be submitted at [ManwhaTrack support](https://github.com/desenyon/ManwhaTrack/issues).
