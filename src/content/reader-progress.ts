// Measures progress through the chapter reader and active reading time.
// Scroll measurements are coalesced; settled positions are checkpointed while the
// tab is still alive because Chrome may discard messages sent during tab teardown.

import { containerProgress } from "../detection/generic/reader";
import type { ReadingPosition } from "../shared/types/models";
import type { ReadingActivity } from "../shared/messages";

const TICK_MS = 1000;
const IDLE_AFTER_MS = 90_000;
const SEND_EVERY_MS = 5000;
const POSITION_CHECKPOINT_MS = 300;

export interface ProgressSink {
  (update: { progress: number; readingTimeDeltaMs: number; final?: boolean; readingPosition?: ReadingPosition }): void;
}

export class ReaderProgress {
  private maxProgress = 0;
  private sentProgress = 0;
  private pendingTimeMs = 0;
  private lastActivity = Date.now();
  private lastSend = 0;
  private scrollQueued = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private stopped = true;
  private measureTimer: ReturnType<typeof setTimeout> | undefined;
  private completionBlocked = false;
  private userActive = true;
  private positionDirty = false;
  private latestPosition: ReadingPosition | undefined;
  private checkpointTimer: ReturnType<typeof setTimeout> | undefined;
  private lastClock = 0;
  private timeActive = false;
  private sessionMs = 0;
  private lastActivityReport = "";

  constructor(
    private readonly getContainer: () => HTMLElement | null,
    private readonly threshold: number,
    private readonly send: ProgressSink,
    /** Page-count progress for paged readers; used when larger than scroll progress. */
    private readonly getPagedProgress: () => number | null = () => null,
    private readonly canMeasure: () => boolean = () => true,
    private readonly capturePosition: () => ReadingPosition | undefined = () => undefined,
    private readonly reportActivity: (activity: ReadingActivity) => void = () => undefined,
  ) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.lastActivity = Date.now();
    this.lastClock = this.lastActivity;
    this.timeActive = this.isActive();
    this.emitActivity();
    addEventListener("scroll", this.onScroll, { passive: true });
    for (const ev of ["mousemove", "keydown", "touchstart", "wheel", "click"]) addEventListener(ev, this.onActivity, { passive: true });
    document.addEventListener("visibilitychange", this.onVisibility);
    addEventListener("pagehide", this.onPageHide);
    addEventListener("blur", this.onBlur);
    addEventListener("focus", this.onFocus);
    this.timer = setInterval(this.tick, TICK_MS);
    this.measure();
  }

  /** Stops tracking and flushes remaining progress/time. */
  stop(final = true, discard = false): void {
    if (this.stopped) return;
    if (!discard) this.settleTime();
    if (!discard && this.userActive) this.measure();
    this.stopped = true;
    this.timeActive = false;
    this.emitActivity();
    removeEventListener("scroll", this.onScroll);
    for (const ev of ["mousemove", "keydown", "touchstart", "wheel", "click"]) removeEventListener(ev, this.onActivity);
    document.removeEventListener("visibilitychange", this.onVisibility);
    removeEventListener("pagehide", this.onPageHide);
    removeEventListener("blur", this.onBlur);
    removeEventListener("focus", this.onFocus);
    if (this.timer) clearInterval(this.timer);
    if (this.measureTimer) clearTimeout(this.measureTimer);
    if (this.checkpointTimer) clearTimeout(this.checkpointTimer);
    this.timer = undefined;
    this.measureTimer = undefined;
    this.checkpointTimer = undefined;
    this.scrollQueued = false;
    if (!discard) this.flush(final);
    this.pendingTimeMs = 0;
    this.latestPosition = undefined;
  }

  get progress(): number {
    return this.maxProgress;
  }

  /** Reconcile an explicit user correction without treating the old scroll position as new reading. */
  reset(value: number): void {
    this.maxProgress = this.sentProgress = Math.max(0, Math.min(1, value));
    const position = this.getPagedProgress() ?? this.scrollProgress();
    this.completionBlocked = value < this.threshold && position >= this.threshold;
  }

  /** Restored scrolling is not new reading evidence. Wait for the reader's own input. */
  waitForActivity(): void { this.userActive = false; }
  resumeActivity(): void { this.userActive = true; this.lastActivity = Date.now(); }

  private isActive(): boolean {
    if (this.stopped || !this.userActive || !this.canMeasure() || document.visibilityState !== "visible" || !document.hasFocus() || Date.now() - this.lastActivity >= IDLE_AFTER_MS) return false;
    const el = this.getContainer();
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < innerHeight;
  }

  private onActivity = () => {
    if (this.stopped) return;
    this.settleTime();
    this.userActive = true;
    this.positionDirty = true;
    this.lastActivity = Date.now();
    this.settleTime();
    // Paged readers flip pages on click/keys without scrolling.
    if (!this.scrollQueued) {
      this.scrollQueued = true;
      this.measureTimer = setTimeout(() => {
        this.scrollQueued = false;
        this.measure();
        this.checkpoint();
      }, 300);
    }
  };

  private onScroll = () => {
    if (this.stopped) return;
    this.settleTime();
    this.lastActivity = Date.now();
    this.settleTime();
    if (this.userActive) this.positionDirty = true;
    if (this.scrollQueued) return;
    this.scrollQueued = true;
    this.measureTimer = setTimeout(() => {
      this.scrollQueued = false;
      this.measure();
      this.checkpoint();
    }, 250);
  };

  private checkpoint(): void {
    if (this.stopped || !this.userActive || !this.canMeasure() || !this.positionDirty) return;
    const delay = POSITION_CHECKPOINT_MS - (Date.now() - this.lastSend);
    if (delay <= 0) this.flush(false);
    else if (!this.checkpointTimer) this.checkpointTimer = setTimeout(() => {
      this.checkpointTimer = undefined;
      if (this.stopped || !this.canMeasure()) return;
      this.measure();
      this.checkpoint();
    }, delay);
  }

  private onVisibility = () => {
    this.settleTime(document.visibilityState === "hidden");
    if (document.visibilityState === "hidden") { this.measure(); this.flush(false); }
    else { this.lastActivity = Date.now(); this.settleTime(); }
  };

  private onBlur = () => { this.settleTime(true); this.flush(false); };
  private onFocus = () => { this.settleTime(); this.lastActivity = Date.now(); this.settleTime(); };
  private onPageHide = () => { this.settleTime(true); this.stop(true); };

  private settleTime(boundary = false): void {
    const now = Date.now();
    const active = this.isActive();
    const elapsed = Math.max(0, Math.min(now - this.lastClock, TICK_MS, this.lastActivity + IDLE_AFTER_MS - this.lastClock));
    const idleBoundary = now >= this.lastActivity + IDLE_AFTER_MS && document.visibilityState === "visible" && document.hasFocus() && this.canMeasure();
    if (this.timeActive && (active || boundary || idleBoundary)) { this.pendingTimeMs += elapsed; this.sessionMs += elapsed; }
    this.lastClock = now;
    this.timeActive = active;
    this.emitActivity();
  }

  private emitActivity(): void {
    const key = `${this.timeActive}:${Math.floor(this.sessionMs / 1000)}`;
    if (key === this.lastActivityReport) return;
    this.lastActivityReport = key;
    this.reportActivity({ active: this.timeActive, sessionMs: this.sessionMs });
  }

  private tick = () => {
    if (this.stopped) return;
    this.settleTime();
    this.measure();
    if (Date.now() - this.lastSend >= SEND_EVERY_MS && (this.pendingTimeMs > 0 || this.positionDirty || this.maxProgress - this.sentProgress >= 0.02)) this.flush(false);
  };

  private measure(): void {
    if (this.stopped || !this.userActive || !this.canMeasure()) return;
    this.latestPosition = this.capturePosition() ?? this.latestPosition;
    let p = this.getPagedProgress() ?? this.scrollProgress();
    p = Math.max(0, Math.min(1, p));
    if (this.completionBlocked) {
      if (p >= this.threshold) return;
      this.completionBlocked = false;
    }
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
    if (!this.userActive) return;
    if (this.maxProgress === this.sentProgress && this.pendingTimeMs === 0 && !this.positionDirty && !final) return;
    const delta = this.pendingTimeMs;
    this.pendingTimeMs = 0;
    this.sentProgress = this.maxProgress;
    this.lastSend = Date.now();
    this.positionDirty = false;
    this.send({ progress: this.maxProgress, readingTimeDeltaMs: delta, final, readingPosition: this.canMeasure() ? this.capturePosition() ?? this.latestPosition : this.latestPosition });
  }
}
