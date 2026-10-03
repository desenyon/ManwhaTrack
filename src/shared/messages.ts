// Typed message contracts between content scripts, extension pages, the offscreen
// document and the service worker. Payloads from content scripts carry data scraped
// from hostile pages and are validated in the service worker before use.

import type { PageObservation } from "../detection/types";
import type { SiteRule } from "./types/settings";
import type { ReadingPosition } from "./types/models";
import { sanitizeReadingPosition } from "./reading-position";
import { isSafeHttpUrl } from "../detection/normalization/url";

// ---- content script → service worker
export interface PageObservedMessage {
  type: "page/observed";
  observation: PageObservation;
  errorPage?: boolean;
}
export interface ChapterProgressMessage {
  type: "chapter/progress";
  chapterId: string;
  progress: number;
  readingTimeDeltaMs: number;
  progressRevision?: number;
  final?: boolean;
  readingPosition?: ReadingPosition;
}
export interface ChapterNextClickedMessage {
  type: "chapter/next-clicked";
  chapterId: string;
  progressRevision?: number;
}
export interface ReadingActivity {
  active: boolean;
  sessionMs: number;
}
export interface ChapterActivityMessage extends ReadingActivity {
  type: "chapter/activity";
  chapterId: string;
}
export interface UndoTrackMessage {
  type: "track/undo";
  seriesId: string;
}

// ---- extension pages → service worker
export interface ContinueMessage {
  type: "continue/open";
  seriesId: string;
  newTab: boolean;
  newWindow?: boolean;
  tabId?: number;
  /** Open a specific chapter or source URL instead of the computed destination. */
  url?: string;
  /** Explicitly restore a saved viewport when reopening a specific chapter. */
  resume?: boolean;
}
export interface CheckUpdatesMessage {
  type: "updates/check";
  seriesIds?: string[];
}
export interface RefreshCoverMessage {
  type: "cover/refresh";
  seriesId: string;
  url?: string;
}
export interface TrackTabMessage {
  type: "tab/track";
  tabId: number;
}
export interface RedetectTabMessage {
  type: "tab/redetect";
  tabId: number;
}
export interface MarkCurrentMessage {
  type: "tab/mark-current";
  tabId: number;
  read: boolean;
}
export interface RefreshBadgeMessage {
  type: "badge/refresh";
}
export interface NotificationsChangedMessage {
  type: "notifications/changed";
}

export type ExtensionMessage =
  | PageObservedMessage
  | ChapterProgressMessage
  | ChapterActivityMessage
  | { type: "chapter/state"; chapterId: string }
  | { type: "chapter/resume-position"; chapterId: string; progressRevision: number }
  | ChapterNextClickedMessage
  | UndoTrackMessage
  | ContinueMessage
  | CheckUpdatesMessage
  | RefreshCoverMessage
  | TrackTabMessage
  | RedetectTabMessage
  | MarkCurrentMessage
  | RefreshBadgeMessage
  | NotificationsChangedMessage;

// ---- service worker → content script
export type ContentMessage = { type: "content/redetect" };

// ---- service worker → offscreen document
export interface OffscreenParseMessage {
  target: "offscreen";
  type: "offscreen/parse";
  html: string;
  url: string;
  siteRules: SiteRule[];
}

// ---- responses
export interface ProgressResponse {
  completed: boolean;
  progress: number;
  progressRevision: number;
  stale?: boolean;
}

export interface ObservedResponse {
  ok?: boolean;
  tracked?: {
    seriesId: string;
    seriesTitle: string;
    chapterId?: string;
    chapterLabel?: string;
    progressRevision?: number;
    progress?: number;
    created: boolean;
    restored: boolean;
  };
  showToast?: boolean;
  nextUrl?: string;
}

export interface TabState {
  tabId: number;
  observation: PageObservation;
  seriesId?: string;
  chapterId?: string;
  progress?: number;
  readingActivity?: ReadingActivity & { sampledAt: number; chapterId: string };
  errorPage?: boolean;
  updatedAt: number;
}

// ---- validation

const isStr = (v: unknown, max = 2048): v is string => typeof v === "string" && v.length <= max;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function cleanText(v: unknown, max = 300): string | undefined {
  return typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : undefined;
}

function cleanUrl(v: unknown): string | undefined {
  return isSafeHttpUrl(v) ? v : undefined;
}

/** Validates and sanitizes an observation received from a content script. Returns null if unusable. */
export function sanitizeObservation(raw: unknown): PageObservation | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const url = cleanUrl(o.url);
  const kinds = ["series", "chapter", "search", "listing", "unknown"];
  if (!url || !kinds.includes(o.kind as string) || !isNum(o.confidence)) return null;
  const obs: PageObservation = {
    url,
    hostname: new URL(url).hostname.replace(/^www\./, ""),
    kind: o.kind as PageObservation["kind"],
    confidence: Math.max(0, Math.min(1, o.confidence)),
    evidence: Array.isArray(o.evidence)
      ? (o.evidence as Record<string, unknown>[]).slice(0, 30).map((e) => ({
          signal: cleanText(e?.signal, 60) ?? "",
          weight: isNum(e?.weight) ? e.weight : 0,
          detail: cleanText(e?.detail, 120),
        }))
      : [],
    adapterId: cleanText(o.adapterId, 80) ?? "unknown",
    readerSelector: cleanText(o.readerSelector, 200),
    detectedAt: isNum(o.detectedAt) ? o.detectedAt : Date.now(),
  };
  const s = o.series as Record<string, unknown> | undefined;
  if (s && typeof s === "object") {
    const title = cleanText(s.title, 200);
    const seriesUrl = cleanUrl(s.seriesUrl);
    const canonical = cleanUrl(s.canonicalSeriesUrl);
    if (title && seriesUrl && canonical) {
      obs.series = {
        title,
        format: s.format === "novel" || s.format === "manhwa" ? s.format : undefined,
        genres: (Array.isArray(s.genres) ? s.genres : []).map(x => cleanText(x, 40)).filter((x): x is string => !!x).slice(0, 20),
        alternateTitles: (Array.isArray(s.alternateTitles) ? s.alternateTitles : []).map((x) => cleanText(x, 150)).filter((x): x is string => !!x).slice(0, 20),
        seriesUrl,
        canonicalSeriesUrl: canonical,
        seriesUrlInferred: s.seriesUrlInferred === true,
        coverUrl: cleanUrl(s.coverUrl),
        coverCandidates: (Array.isArray(s.coverCandidates) ? s.coverCandidates : []).map(cleanUrl).filter((x): x is string => !!x).slice(0, 6),
        storyEnded: typeof s.storyEnded === "boolean" ? s.storyEnded : undefined,
        chapterList: (Array.isArray(s.chapterList) ? (s.chapterList as Record<string, unknown>[]) : [])
          .slice(0, 3000)
          .map((l) => ({ label: cleanText(l?.label, 160) ?? "", url: cleanUrl(l?.url) ?? "" }))
          .filter((l) => l.label && l.url),
      };
    }
  }
  const c = o.chapter as Record<string, unknown> | undefined;
  if (c && typeof c === "object") {
    const label = cleanText(c.label, 160);
    const curl = cleanUrl(c.url);
    const canon = cleanUrl(c.canonicalUrl);
    if (label && curl && canon) {
      obs.chapter = { label, title: cleanText(c.title, 200), url: curl, canonicalUrl: canon, nextUrl: cleanUrl(c.nextUrl), prevUrl: cleanUrl(c.prevUrl) };
    }
  }
  return obs;
}

export function isProgressMessage(m: ExtensionMessage): m is ChapterProgressMessage {
  return m.type === "chapter/progress" && isStr(m.chapterId, 64) && isNum(m.progress) && isNum(m.readingTimeDeltaMs) && m.progress >= 0 && m.progress <= 1 && m.readingTimeDeltaMs >= 0 && (m.progressRevision === undefined || (Number.isInteger(m.progressRevision) && m.progressRevision >= 0)) && (m.readingPosition === undefined || !!sanitizeReadingPosition(m.readingPosition));
}

export function sendToWorker<R = unknown>(msg: ExtensionMessage): Promise<R | undefined> {
  return chrome.runtime.sendMessage(msg).catch(() => undefined) as Promise<R | undefined>;
}
