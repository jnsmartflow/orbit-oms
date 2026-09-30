// lib/live/use-live-feed.ts — the React wrapper around LiveFeedController (7b).
//
// Shared: nothing in here knows about Floor. A screen passes its topics and
// callbacks and gets back the feed's mode and health. The state machine and
// every timing rule live in lib/live/feed-core.ts (pure, tested); this file only
// wires the browser — fetch, timers, visibility, focus, pointer/key/touch, the
// IST-midnight timer and the debug log.
//
// Debug log (off by default): in the browser console run
//   localStorage.setItem("orbit.live.debug", "1")   → on (read on every line, no reload needed)
//   localStorage.removeItem("orbit.live.debug")     → off
//
// ⚠ Never calls router.refresh() (CORE §3) — the screen decides how to reload.

import { useEffect, useRef, useState, type MutableRefObject } from "react";
import {
  LiveFeedController,
  MIDNIGHT_JITTER_MAX_MS,
  msToNextIstMidnight,
  type ChangesAnswer,
  type FeedMode,
} from "./feed-core";

export const LIVE_DEBUG_KEY = "orbit.live.debug";

export function liveDebugOn(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(LIVE_DEBUG_KEY) === "1";
  } catch {
    return false;
  }
}

export function liveLog(scope: string, msg: string, data?: unknown): void {
  if (!liveDebugOn()) return;
  const t = new Date().toLocaleTimeString("en-GB", { hour12: false });
  if (data === undefined) console.debug(`[live:${scope}] ${t} ${msg}`);
  else console.debug(`[live:${scope}] ${t} ${msg}`, data);
}

/** The "feed was on last time" hint (per screen). Read/write never throw. */
export function readLiveHint(key: string): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}
function writeLiveHint(key: string, on: boolean): void {
  try {
    if (on) window.localStorage.setItem(key, "1");
    else window.localStorage.removeItem(key);
  } catch {
    /* private window / blocked storage — the hint is only an optimisation */
  }
}

export interface UseLiveFeedOptions {
  /** Short name for the log, e.g. "floor". */
  scope: string;
  /** Comma list for GET /api/live/changes?topics= */
  topics: string;
  /** Optional `?screen=` (2026-09-30: "billing" → enabled only when live.feed AND live.feed.billing).
   *  Omitted (Floor) → the request is exactly what it was. */
  screen?: string;
  /** Optional extra query params, read at EACH glance (2026-09-30: the picker face's `face` + `held`).
   *  Omitted (Floor, Billing) → the request is exactly what it was. */
  params?: () => Record<string, string>;
  /** localStorage key remembering whether the feed was on last time. */
  hintKey: string;
  onPending: () => void;
  onChanges?: (batch: { orderIds: number[]; tripIds: number[]; config: string[]; extra?: Record<string, (number | string)[]> }) => void;
  onMode?: (mode: FeedMode, prev: FeedMode) => void;
  /** IST midnight on the server's clock, plus 0–120 s jitter. Live mode only. */
  onMidnight?: () => void;
}

export interface LiveFeedHandle {
  mode: FeedMode;
  connected: boolean;
  delayed: boolean;
  /** The controller, for take() / noteFullLoad() / requeue() / noteDisabled(). Null before mount. */
  controller: MutableRefObject<LiveFeedController | null>;
}

export function useLiveFeed(opts: UseLiveFeedOptions): LiveFeedHandle {
  const [mode, setMode] = useState<FeedMode>("unknown");
  const [connected, setConnected] = useState(true);
  const [delayed, setDelayed] = useState(false);
  const controller = useRef<LiveFeedController | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const { scope, topics, hintKey, screen } = optsRef.current;
    let midnightTimer: ReturnType<typeof setTimeout> | null = null;
    let midnightFor: string | null = null; // the serverNow IST day a timer is armed for

    const ctl = new LiveFeedController({
      fetchChanges: async (after) => {
        const qs = new URLSearchParams({ topics });
        if (screen) qs.set("screen", screen);
        const extra = optsRef.current.params?.();
        if (extra) for (const [k, v] of Object.entries(extra)) qs.set(k, v);
        if (after) qs.set("after", after);
        const res = await fetch(`/api/live/changes?${qs.toString()}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as ChangesAnswer;
      },
      now: () => Date.now(),
      random: () => Math.random(),
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      isHidden: () => typeof document !== "undefined" && document.visibilityState === "hidden",
      log: (msg, data) => liveLog(scope, msg, data),
      onMode: (m, prev) => {
        if (m === "live") writeLiveHint(hintKey, true);
        else if (m === "off") writeLiveHint(hintKey, false);
        if (m !== "live" && midnightTimer !== null) {
          clearTimeout(midnightTimer);
          midnightTimer = null;
          midnightFor = null;
        }
        setMode(m);
        optsRef.current.onMode?.(m, prev);
      },
      onHealth: (h) => {
        setConnected(h.connected);
        setDelayed(h.delayed);
      },
      onChanges: (b) => optsRef.current.onChanges?.(b),
      onPending: () => optsRef.current.onPending(),
      onServerNow: (iso) => {
        const ms = msToNextIstMidnight(iso);
        if (ms === null) return;
        const day = new Date(Date.parse(iso) + 330 * 60_000).toISOString().slice(0, 10);
        if (midnightFor === day && midnightTimer !== null) return;
        if (midnightTimer !== null) clearTimeout(midnightTimer);
        midnightFor = day;
        const wait = ms + Math.floor(Math.random() * MIDNIGHT_JITTER_MAX_MS);
        liveLog(scope, `midnight reload in ${Math.round(wait / 1000)} s`);
        midnightTimer = setTimeout(() => {
          midnightTimer = null;
          midnightFor = null;
          if (controller.current?.getMode() === "live") optsRef.current.onMidnight?.();
        }, wait);
      },
    });
    controller.current = ctl;

    const onInput = () => ctl.noteInput();
    const onVisibility = () => {
      if (document.visibilityState === "visible") ctl.noteVisible();
    };
    const onFocus = () => ctl.noteFocus();
    // pointermove too: "move the mouse" after idle must count (cheap — one subtraction).
    const inputEvents = ["pointerdown", "pointermove", "keydown", "touchstart", "wheel"] as const;
    for (const ev of inputEvents) window.addEventListener(ev, onInput, { passive: true, capture: true });
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);

    ctl.start();

    return () => {
      ctl.stop();
      controller.current = null;
      if (midnightTimer !== null) clearTimeout(midnightTimer);
      for (const ev of inputEvents) window.removeEventListener(ev, onInput, { capture: true });
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  return { mode, connected, delayed, controller };
}
