# Privacy

ManwhaTrack is built so that your reading history never leaves your computer.

## What is stored, and where

Everything ManwhaTrack knows — series, chapters, reading progress, history, notes, tags, ratings, covers and settings — is stored in your browser's local storage for the extension (IndexedDB and `chrome.storage.local`). It is not synced to your Google account and there is no ManwhaTrack server to send it to.

## Network requests

ManwhaTrack makes network requests only to the reading sites you already use:

| When | Request |
| --- | --- |
| You open a series page | Downloads the series cover image once, to cache it locally |
| Update checks are on (Settings → General) | Occasionally requests tracked series pages to look for new chapters — at most one request per site per run, with longer waits after errors. For MangaDex, its public API is used instead of the page. |
| You choose a different detected cover | Shows the candidate images from the source site, then downloads the one you pick |

These requests are sent without cookies. The only header ManwhaTrack adds is the site's own address as `Referer`, because many image hosts refuse requests without one.

There is no analytics, telemetry, advertising, remote configuration, remote code, crash or error reporting, and no account.

## What ManwhaTrack reads on pages

The content script runs on web pages to recognize reading pages. On ordinary pages it does a quick check and stops. On reading pages it reads the page text and link addresses needed to identify the series and chapter, and measures how far you've scrolled through the chapter. Page content is never uploaded anywhere.

## Incognito

Incognito windows are ignored by default. If you turn on *Settings → Advanced → Track in Incognito windows* (and allow the extension in Incognito on `chrome://extensions`), Incognito reading is added to the same local library.

## Your control

- Export your whole library at any time (*Settings → Import & export*).
- Clear reading history, cached covers or everything (*Settings → Storage & privacy*).
- Removing the extension deletes all of its local data.
