// lib/live/feed-core.ts — the CLIENT half of the live change feed, pure (7b).
//
// Design of record: docs/prompts/drafts/code-discovery-2026-09-29-live-change-feed.md §E/§G
// Owner decisions:  docs/prompts/drafts/code-update-2026-09-30-live-feed-7b.md
// Tests:            lib/live/feed-core.test.ts   (npm run test:live-client)
// React wrapper:    lib/live/use-live-feed.ts
//
// No React, no DOM, no fetch: every clock, timer, random number and request is
// INJECTED, so the whole state machine runs under node:test with a fake clock.
//
// What it owns:
//   · the cursor (head first, then GET /api/live/changes?after=…);
//   · the MODE — "unknown" until the first answer, "live" while the switch is
//     on and the feed answers, "off" when the switch is off (re-checked every
//     60 s), "fallback" after repeated errors (the screen runs its old hooks
//     while this keeps retrying with backoff);
//   · WHEN to glance — adaptive (15 s active / 60 s idle, ±20 % jitter), extra
//     glances on input-after-idle / visible / focus throttled to one per 3 s,
//     nothing while hidden, exponential backoff with jitter on errors (≤ 2 min);
//   · WHAT is pending — order ids, trip ids, config, overflow, lag — accumulated
//     across glances until the screen is free to apply them (`take`);
//   · WHEN a full load is due instead of a patch (reset, overflow / > 300 ids,
//     config after 5 s at most once per 2 min, lag at most once per 2 min).
//
// What it does NOT own: fetching rows, merging, rendering. The screen does
// those when `onPending` tells it there is something to take.

export const ACTIVE_GLANCE_MS = 15_000;
export const IDLE_GLANCE_MS = 60_000;
export const IDLE_AFTER_MS = 120_000;
export const EXTRA_GLANCE_GAP_MS = 3_000;
export const JITTER_FRACTION = 0.2;
export const BACKOFF_BASE_MS = 5_000;
export const BACKOFF_CAP_MS = 120_000;
export const OFF_RECHECK_MS = 60_000;
export const FALLBACK_AFTER_FAILURES = 3;
export const MAX_PATCH_IDS = 300;
export const LAG_LIMIT_SECONDS = 120;
export const LAG_RELOAD_GAP_MS = 120_000;
export const CONFIG_DEBOUNCE_MS = 5_000;
export const CONFIG_RELOAD_GAP_MS = 120_000;
export const MIDNIGHT_JITTER_MAX_MS = 120_000;

export type FeedMode = "unknown" | "live" | "off" | "fallback";

export interface ChangeGroup {
  entity: string;
  ids: (number | string)[];
}

/** GET /api/live/changes, as the client reads it. */
export interface ChangesAnswer {
  enabled: boolean;
  cursor?: string;
  changes?: ChangeGroup[];
  more?: boolean;
  reset?: boolean;
  lagSeconds?: number | null;
  serverNow?: string;
}

export type FullReason = "start" | "switch-on" | "reset" | "overflow" | "too-many" | "config" | "lag";

/** What the screen should do now. */
export type Work =
  | { kind: "full"; reasons: FullReason[] }
  | { kind: "patch"; orderIds: number[]; tripIds: number[] };

// ── pure timing helpers ─────────────────────────────────────────────────────

/** ±20 % jitter, never below 0. `rnd` in [0, 1). */
export function jitter(ms: number, rnd: number): number {
  return Math.max(0, Math.round(ms * (1 + (rnd * 2 - 1) * JITTER_FRACTION)));
}

export function isIdle(now: number, lastInputAt: number): boolean {
  return now - lastInputAt >= IDLE_AFTER_MS;
}

/** The next regular glance: 15 s while active, 60 s when idle, jittered. */
export function glanceDelay(now: number, lastInputAt: number, rnd: number): number {
  return jitter(isIdle(now, lastInputAt) ? IDLE_GLANCE_MS : ACTIVE_GLANCE_MS, rnd);
}

/** After `failures` (≥ 1) consecutive errors: 5 s, 10 s, 20 s … jittered, capped at 2 min. */
export function backoffDelay(failures: number, rnd: number): number {
  const n = Math.max(1, failures);
  const base = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * Math.pow(2, n - 1));
  return Math.min(BACKOFF_CAP_MS, jitter(base, rnd));
}

/** At most one `take` per `gapMs`. */
export function createThrottle(gapMs: number) {
  let last = -Infinity;
  return {
    tryTake(now: number): boolean {
      if (now - last < gapMs) return false;
      last = now;
      return true;
    },
  };
}

/** When a pending config change may reload: 5 s after the LAST one seen, and ≥ 2 min after the last full load. */
export function configReloadAt(lastConfigSeenAt: number, lastFullLoadAt: number): number {
  return Math.max(lastConfigSeenAt + CONFIG_DEBOUNCE_MS, lastFullLoadAt + CONFIG_RELOAD_GAP_MS);
}

/**
 * Milliseconds from `serverNowIso` to the next IST midnight (IST = UTC+05:30, no
 * DST). Read off the SERVER's clock, so a depot PC whose clock is wrong still
 * reloads at the real day change. Null when the ISO does not parse.
 */
export function msToNextIstMidnight(serverNowIso: string): number | null {
  const t = Date.parse(serverNowIso);
  if (!Number.isFinite(t)) return null;
  const IST_OFFSET_MS = 330 * 60_000;
  const DAY = 86_400_000;
  const istMs = t + IST_OFFSET_MS;
  const nextMidnightIst = Math.floor(istMs / DAY) * DAY + DAY;
  return nextMidnightIst - istMs;
}

/** Split ids into chunks of at most `n`. */
export function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// ── the controller ──────────────────────────────────────────────────────────

export interface FeedDeps {
  /** GET /api/live/changes?after=… (null = head). Throws on network / non-2xx. */
  fetchChanges: (after: string | null) => Promise<ChangesAnswer>;
  now: () => number;
  random: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  isHidden: () => boolean;
  log: (msg: string, data?: unknown) => void;

  onMode: (mode: FeedMode, prev: FeedMode) => void;
  onHealth: (h: { connected: boolean; delayed: boolean }) => void;
  /** Every glance's raw ids (order + trip) — for "changed elsewhere" signals. Accumulation is internal. */
  onChanges: (batch: { orderIds: number[]; tripIds: number[]; config: string[] }) => void;
  /** Something may be ready to `take`. */
  onPending: () => void;
  onServerNow: (iso: string) => void;
}

export class LiveFeedController {
  private deps: FeedDeps;
  private mode: FeedMode = "unknown";
  private cursor: string | null = null;
  private timer: unknown = null;
  private inFlight = false;
  private stopped = false;
  private failures = 0;
  private lastInputAt: number;
  private missedWhileHidden = false;
  private extraThrottle = createThrottle(EXTRA_GLANCE_GAP_MS);

  // pending work
  private orders = new Set<number>();
  private trips = new Set<number>();
  private fullReasons = new Set<FullReason>();
  private configPending = false;
  private lastConfigSeenAt = 0;
  private lagging = false;
  private lastFullLoadAt = -Infinity;
  private configTimer: unknown = null;

  constructor(deps: FeedDeps) {
    this.deps = deps;
    this.lastInputAt = deps.now();
  }

  getMode(): FeedMode {
    return this.mode;
  }
  getCursor(): string | null {
    return this.cursor;
  }
  /** For tests / the debug log. */
  pendingSnapshot() {
    return {
      orders: Array.from(this.orders),
      trips: Array.from(this.trips),
      full: Array.from(this.fullReasons),
      config: this.configPending,
      lagging: this.lagging,
    };
  }

  /** Head cursor first (the screen full-loads on the "start" reason). */
  start(): void {
    this.stopped = false;
    void this.glance(true);
  }

  stop(): void {
    this.stopped = true;
    this.clear();
    if (this.configTimer !== null) this.deps.clearTimer(this.configTimer);
    this.configTimer = null;
  }

  // ── activity ──────────────────────────────────────────────────────────────

  /** Pointer / key / touch. The first input after 2 min idle glances at once. */
  noteInput(): void {
    const now = this.deps.now();
    const wasIdle = isIdle(now, this.lastInputAt);
    this.lastInputAt = now;
    if (wasIdle) this.extraGlance("input-after-idle");
  }

  noteVisible(): void {
    if (this.deps.isHidden()) return;
    this.missedWhileHidden = false;
    this.extraGlance("visible");
  }

  noteFocus(): void {
    this.extraGlance("focus");
  }

  private extraGlance(why: string): void {
    if (this.stopped || this.inFlight) return;
    const timerPending = this.timer !== null;
    // Off (60 s re-check) and erroring (backoff) keep their own pace — unless no
    // timer is pending, which happens when one fired while the tab was hidden.
    if ((this.mode === "off" || this.failures > 0) && timerPending) return;
    if (!this.extraThrottle.tryTake(this.deps.now())) {
      if (!timerPending) this.schedule(EXTRA_GLANCE_GAP_MS);
      return;
    }
    this.deps.log(`glance now (${why})`);
    this.clear();
    void this.glance(this.cursor === null);
  }

  // ── the screen's side ─────────────────────────────────────────────────────

  /**
   * A full load is starting (the screen's own, or one this asked for). Every
   * change already seen is covered by it — clear the pending ids and the
   * config / lag / overflow flags.
   */
  noteFullLoad(): void {
    this.orders.clear();
    this.trips.clear();
    this.fullReasons.clear();
    this.configPending = false;
    this.lastFullLoadAt = this.deps.now();
    if (this.configTimer !== null) this.deps.clearTimer(this.configTimer);
    this.configTimer = null;
  }

  /** A patch could not be applied (a load was in flight) — keep its ids for the next take. */
  requeue(orderIds: number[], tripIds: number[]): void {
    for (const id of orderIds) this.orders.add(id);
    for (const id of tripIds) this.trips.add(id);
  }

  /** A patch endpoint answered { enabled: false } — the switch went off between glances. */
  noteDisabled(): void {
    this.setMode("off");
    this.cursor = null;
    this.clear();
    this.schedule(OFF_RECHECK_MS);
  }

  /**
   * What to do now. `ordersPaused` = rows must not move (a selection is up):
   * trips are still handed out, order ids stay queued.
   */
  take(opts: { ordersPaused?: boolean } = {}): Work | null {
    if (this.mode !== "live") return null;
    const now = this.deps.now();
    const reasons = new Set<FullReason>(this.fullReasons);
    if (this.configPending && now >= configReloadAt(this.lastConfigSeenAt, this.lastFullLoadAt)) reasons.add("config");
    if (this.lagging && now - this.lastFullLoadAt >= LAG_RELOAD_GAP_MS) reasons.add("lag");
    if (this.orders.size > MAX_PATCH_IDS) reasons.add("too-many");

    if (reasons.size > 0) {
      if (opts.ordersPaused) return null; // a full load moves rows too — wait
      return { kind: "full", reasons: Array.from(reasons) };
    }
    if (this.configPending) this.armConfigTimer(now);

    const tripIds = Array.from(this.trips);
    const orderIds = opts.ordersPaused ? [] : Array.from(this.orders);
    if (orderIds.length === 0 && tripIds.length === 0) return null;
    this.trips.clear();
    if (!opts.ordersPaused) this.orders.clear();
    return { kind: "patch", orderIds, tripIds };
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private setMode(mode: FeedMode): void {
    if (mode === this.mode) return;
    const prev = this.mode;
    this.mode = mode;
    this.deps.log(`mode ${prev} → ${mode}`);
    this.deps.onMode(mode, prev);
  }

  private clear(): void {
    if (this.timer !== null) this.deps.clearTimer(this.timer);
    this.timer = null;
  }

  private schedule(ms: number): void {
    this.clear();
    if (this.stopped) return;
    this.timer = this.deps.setTimer(() => {
      this.timer = null;
      void this.glance(this.cursor === null);
    }, ms);
  }

  private armConfigTimer(now: number): void {
    if (this.configTimer !== null) return;
    const at = configReloadAt(this.lastConfigSeenAt, this.lastFullLoadAt);
    this.configTimer = this.deps.setTimer(() => {
      this.configTimer = null;
      this.deps.onPending();
    }, Math.max(0, at - now) + 50);
  }

  private async glance(fromHead: boolean): Promise<void> {
    if (this.stopped || this.inFlight) return;
    if (this.deps.isHidden()) {
      // Hidden: no request, no reschedule. noteVisible() glances once on return.
      this.missedWhileHidden = true;
      return;
    }
    this.inFlight = true;
    let answer: ChangesAnswer;
    try {
      answer = await this.deps.fetchChanges(fromHead ? null : this.cursor);
    } catch (e) {
      this.inFlight = false;
      if (this.stopped) return;
      this.failures++;
      this.deps.log(`glance failed (${this.failures})`, e instanceof Error ? e.message : e);
      this.deps.onHealth({ connected: false, delayed: this.lagging });
      // Before the first answer the screen may be waiting on us for its first
      // load (the "was on last time" hint) — fall back at once, never leave it blank.
      if ((this.failures >= FALLBACK_AFTER_FAILURES || this.mode === "unknown") && this.mode !== "off") {
        this.setMode("fallback");
      }
      this.schedule(backoffDelay(this.failures, this.deps.random()));
      return;
    }
    this.inFlight = false;
    if (this.stopped) return;
    this.failures = 0;

    if (!answer.enabled) {
      this.cursor = null;
      this.lagging = false;
      this.deps.onHealth({ connected: true, delayed: false });
      this.setMode("off");
      this.schedule(OFF_RECHECK_MS);
      return;
    }

    const wasMode = this.mode;
    if (answer.serverNow) this.deps.onServerNow(answer.serverNow);
    this.lagging = typeof answer.lagSeconds === "number" && answer.lagSeconds > LAG_LIMIT_SECONDS;
    this.deps.onHealth({ connected: true, delayed: this.lagging });

    if (fromHead || answer.reset) {
      // A head cursor: nothing before it will ever be delivered, so the screen
      // must full-load now (after the cursor was taken — design §F.1).
      this.cursor = answer.cursor ?? null;
      this.orders.clear();
      this.trips.clear();
      this.fullReasons.add(
        wasMode === "unknown" ? "start" : wasMode === "off" ? "switch-on" : this.fullReasons.has("overflow") ? "overflow" : "reset",
      );
      this.setMode("live");
      this.deps.log(`head ${this.cursor}`, { reasons: Array.from(this.fullReasons) });
      this.deps.onPending();
      this.schedule(glanceDelay(this.deps.now(), this.lastInputAt, this.deps.random()));
      return;
    }

    if (this.mode !== "live") this.setMode("live"); // recovered from fallback

    if (answer.more) {
      // A backlog bigger than one page: skip it — jump to the head and full-load.
      this.deps.log("page full — jumping to head");
      this.fullReasons.add("overflow");
      this.cursor = null;
      void this.glance(true);
      return;
    }

    this.cursor = answer.cursor ?? this.cursor;
    const orderIds: number[] = [];
    const tripIds: number[] = [];
    const config: string[] = [];
    for (const g of answer.changes ?? []) {
      for (const id of g.ids) {
        if (g.entity === "order" && typeof id === "number") orderIds.push(id);
        else if (g.entity === "trip" && typeof id === "number") tripIds.push(id);
        else if (g.entity === "config") config.push(String(id));
      }
    }
    for (const id of orderIds) this.orders.add(id);
    for (const id of tripIds) this.trips.add(id);
    if (config.length > 0) {
      this.configPending = true;
      this.lastConfigSeenAt = this.deps.now();
      if (this.configTimer !== null) this.deps.clearTimer(this.configTimer);
      this.configTimer = null;
    }
    if (orderIds.length + tripIds.length + config.length > 0) {
      this.deps.log("changes", { orderIds, tripIds, config, cursor: this.cursor });
      this.deps.onChanges({ orderIds, tripIds, config });
    }
    if (this.orders.size + this.trips.size > 0 || this.configPending || this.lagging) this.deps.onPending();
    this.schedule(glanceDelay(this.deps.now(), this.lastInputAt, this.deps.random()));
  }

  /** Test hook: was a glance skipped because the tab was hidden? */
  get skippedWhileHidden(): boolean {
    return this.missedWhileHidden;
  }
}
