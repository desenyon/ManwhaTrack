// Measures progress through the chapter reader and active reading time.
// Throttled: at most one storage write every few seconds, never per scroll pixel.

import { containerProgress } from "../detection/generic/reader";

const TICK_MS = 5000;
const IDLE_AFTER_MS = 90_000;
const SEND_EVERY_MS = 10_000;

export interface ProgressSink {
  (update: { progress: number; readingTimeDeltaMs: number; final?: boolean }): void;
}

export class ReaderProgress {
  private maxProgress = 0;
  private sentProgress = 0;
  private pendingTimeMs = 0;
  private lastActivity = Date.now();
  private lastSend = 0;
  private scrollQueued = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private stopped = false;

  constructor(
    private readonly getContainer: () => HTMLElement | null,
    private readonly threshold: number,
    private readonly send: ProgressSink,
    /** Page-count progress for paged readers; used when larger than scroll progress. */
    private readonly getPagedProgress: () => number | null = () => null,
  ) {}

  start(): void {
    addEventListener("scroll", this.onScroll, { passive: true });
    for (const ev of ["mousemove", "keydown", "touchstart", "wheel", "click"]) addEventListener(ev, this.onActivity, { passive: true });
    document.addEventListener("visibilitychange", this.onVisibility);
    addEventListener("pagehide", this.onPageHide);
    this.timer = setInterval(this.tick, TICK_MS);
    this.measure();
  }

  /** Stops tracking and flushes remaining progress/time. */
  stop(final = true): void {
    if (this.stopped) return;
    this.stopped = true;
    removeEventListener("scroll", this.onScroll);
    for (const ev of ["mousemove", "keydown", "touchstart", "wheel", "click"]) removeEventListener(ev, this.onActivity);
    document.removeEventListener("visibilitychange", this.onVisibility);
    removeEventListener("pagehide", this.onPageHide);
    if (this.timer) clearInterval(this.timer);
    this.flush(final);
  }

  get progress(): number {
    return this.maxProgress;
  }

  private isActive(): boolean {
    return document.visibilityState === "visible" && Date.now() - this.lastActivity < IDLE_AFTER_MS;
  }

  private onActivity = () => {
    this.lastActivity = Date.now();
    // Paged readers flip pages on click/keys without scrolling.
    if (!this.scrollQueued) {
      this.scrollQueued = true;
      setTimeout(() => {
        this.scrollQueued = false;
        this.measure();
      }, 300);
    }
  };

  private onScroll = () => {
    this.lastActivity = Date.now();
    if (this.scrollQueued) return;
    this.scrollQueued = true;
    setTimeout(() => {
      this.scrollQueued = false;
      this.measure();
    }, 250);
  };

  private onVisibility = () => {
    if (document.visibilityState === "hidden") this.flush(false);
    else this.lastActivity = Date.now();
  };

  private onPageHide = () => this.stop(true);

  private tick = () => {
    if (this.isActive()) this.pendingTimeMs += TICK_MS;
    this.measure();
    if (Date.now() - this.lastSend >= SEND_EVERY_MS && (this.pendingTimeMs > 0 || this.maxProgress - this.sentProgress >= 0.02)) this.flush(false);
  };

  private measure(): void {
    let p = this.getPagedProgress() ?? this.scrollProgress();
    p = Math.max(0, Math.min(1, p));
    if (p > this.maxProgress) {
      const crossed = this.maxProgress < this.threshold && p >= this.threshold;
      this.maxProgress = p;
      if (crossed) this.flush(false);
    }
  }

  /**
   * Scroll progress through the reader. A reader that fits on about one screen is probably
   * paged: scrolling says nothing about reading, so it reports 0 (Next-link clicks and
   * manual marking still complete the chapter).
   */
  private scrollProgress(): number {
    const el = this.getContainer();
    if (el && el.isConnected) {
      const h = el.getBoundingClientRect().height;
      return h < innerHeight * 1.5 ? 0 : containerProgress(el, innerHeight);
    }
    const doc = document.documentElement;
    if (doc.scrollHeight < innerHeight * 1.5) return 0;
    const max = Math.max(1, doc.scrollHeight - innerHeight * 0.5);
    return Math.min(1, (scrollY + innerHeight) / max);
  }

  private flush(final: boolean): void {
    if (this.maxProgress === this.sentProgress && this.pendingTimeMs === 0 && !final) return;
    const delta = this.pendingTimeMs;
    this.pendingTimeMs = 0;
    this.sentProgress = this.maxProgress;
    this.lastSend = Date.now();
    this.send({ progress: this.maxProgress, readingTimeDeltaMs: delta, final });
  }
}
