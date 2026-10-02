import type { Chapter, ReadingPosition } from "../shared/types/models";
import { sanitizeReadingPosition } from "../shared/reading-position";
import { canonicalizeUrl } from "../detection/normalization/url";

interface ResumeIntent { chapterId: string; url: string; revision: number; at: number }
const key = (tabId: number) => `resume:${tabId}`;

/** Written before navigation, durable across worker termination, never sent to a website. */
export async function expectResume(tabId: number, chapter: Chapter | undefined, url: string): Promise<void> {
  if (!chapter?.readingPosition || chapter.readingPosition.progressRevision !== (chapter.progressRevision ?? 0)) {
    await chrome.storage.session.remove(key(tabId));
    return;
  }
  await chrome.storage.session.set({ [key(tabId)]: { chapterId: chapter.id, url, revision: chapter.progressRevision ?? 0, at: Date.now() } satisfies ResumeIntent });
}

export async function takeResume(tabId: number, chapter: Chapter, url: string, revision: number): Promise<ReadingPosition | undefined> {
  const data = await chrome.storage.session.get(key(tabId));
  const intent = data[key(tabId)] as ResumeIntent | undefined;
  if (!intent) return;
  // An early unknown/series detection does not consume an intent; only the matching
  // validated chapter asks here. A stale/redirected chapter cannot receive another one's position.
  await chrome.storage.session.remove(key(tabId));
  if (intent.chapterId !== chapter.id || intent.revision !== revision || revision !== (chapter.progressRevision ?? 0) ||
      Date.now() - intent.at > 2 * 60_000 || canonicalizeUrl(intent.url) !== canonicalizeUrl(url) ||
      canonicalizeUrl(chapter.canonicalUrl) !== canonicalizeUrl(url)) return;
  const position = sanitizeReadingPosition(chapter.readingPosition);
  return position?.progressRevision === revision ? position : undefined;
}
