export type ThemePreference = "system" | "light" | "dark";
export type NotificationMode = "off" | "favorites" | "all";
export type LibraryLayout = "list" | "grid";

export type SortKey =
  | "recent-read"
  | "recent-added"
  | "title-asc"
  | "title-desc"
  | "progress"
  | "update-newest"
  | "update-oldest"
  | "source"
  | "rating";

export type ShortcutAction =
  | "search"
  | "next"
  | "prev"
  | "open"
  | "favorite"
  | "markRead"
  | "markUnread"
  | "back"
  | "palette";

export interface SiteRuleSelectors {
  seriesTitle?: string;
  cover?: string;
  chapterTitle?: string;
  readerContainer?: string;
  nextChapter?: string;
  prevChapter?: string;
  seriesUrl?: string;
  chapterList?: string;
}

export interface SiteRule {
  id: string;
  /** Hostname, optionally with a leading "*." wildcard. */
  host: string;
  /** Optional path regex a URL must match for the rule to classify it as a chapter. */
  chapterPathPattern?: string;
  selectors: SiteRuleSelectors;
  enabled: boolean;
  updatedAt: number;
}

export interface Settings {
  theme: ThemePreference;
  artworkMotion: "system" | "on" | "off";
  layout: LibraryLayout;
  /** Where Continue opens by default. Modifier/middle-click always opens a new tab. */
  continueIn: "current" | "new";
  /** Fraction of the chapter reader that counts as finished. */
  completionThreshold: number;
  showTrackingToast: boolean;
  updateChecks: boolean;
  /** Minimum hours between checks of the same source. */
  updateIntervalHours: number;
  notifications: NotificationMode;
  badge: boolean;
  trackIncognito: boolean;
  debug: boolean;
  ignoredHosts: string[];
  sortByView: Record<string, SortKey>;
  shortcuts: Record<ShortcutAction, string>;
  siteRules: SiteRule[];
}

export const DEFAULT_SHORTCUTS: Record<ShortcutAction, string> = {
  search: "/",
  next: "j",
  prev: "k",
  open: "Enter",
  favorite: "f",
  markRead: "r",
  markUnread: "Shift+R",
  back: "Escape",
  palette: "Mod+K",
};

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  artworkMotion: "system",
  layout: "list",
  continueIn: "current",
  completionThreshold: 0.85,
  showTrackingToast: true,
  updateChecks: true,
  updateIntervalHours: 12,
  notifications: "off",
  badge: true,
  trackIncognito: false,
  debug: false,
  ignoredHosts: [],
  sortByView: {},
  shortcuts: { ...DEFAULT_SHORTCUTS },
  siteRules: [],
};
