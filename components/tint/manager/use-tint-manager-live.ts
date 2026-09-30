"use client";

// Tint Manager on the live change feed (tint step 4, 2026-09-30).
// Behind app_settings 'live.feed' AND 'live.feed.tint' (absent = OFF).
//
// Plan:   docs/prompts/drafts/code-plan-2026-09-30-tint-live-feed.md §D, §E, Step 4 (owner: "agree all").
// Server: step 3 (acf0ba0b) — GET /api/live/changes?screen=tint&held=<board ids>&missing=<side-list ids>
//         narrows the order ids to this board (+ held, so a bill LEAVING still wakes it) and answers
//         `missingTouched` for the missing-customers side list.
// Record: docs/prompts/drafts/code-update-2026-09-30-tint-live-feed-4.md
//
// TWO PATHS, ONE SWITCH (the Picking 4b pattern):
//   · feed live → this hook: one glance (15 s active / 60 s idle, nothing while hidden), and on a hit
//     ONE board reload (decision 2: full reload, never a patch); a config change → reload; missingTouched
//     → the side list re-read. Held while `hold` is true and applied ONCE on release.
//   · feed not live → the page renders <LegacyTintManagerSync> (use-tint-manager-sync.ts, the 15 s
//     marker exactly as before the feed). `live` is also true while the mode is still "unknown" on a
//     browser that saw the feed on last time (the hint), so the marker does not start and stop at load.
// Own writes keep reloading at once in the page, as before. IST midnight → one full reload.
// Never router.refresh(). Debug: localStorage "orbit.live.debug" = "1" → [live:tint-manager] lines.

import { useCallback, useEffect, useRef, useState } from "react";
import { liveLog, readLiveHint, useLiveFeed } from "@/lib/live/use-live-feed";
import type { FeedMode } from "@/lib/live/feed-core";
import { HELD_MAX } from "@/lib/live/cursor";
import type { TintBoardPayload } from "@/components/tint/manager/types";

/** localStorage: "the Tint feed was on last time" in this browser. */
export const TINT_LIVE_HINT_KEY = "orbit.live.tint";
const SCOPE = "tint-manager";

/** Live, or still unknown on a browser that saw the feed on last time. */
export function isTintLive(mode: FeedMode, hint: boolean): boolean {
  return mode === "live" || (mode === "unknown" && hint);
}

/** Every order id the board shows (rail + table: whole orders, splits, completed), distinct. */
export function boardOrderIds(p: TintBoardPayload): number[] {
  const ids = new Set<number>();
  for (const o of p.orders) ids.add(o.id);
  for (const s of p.activeSplits) ids.add(s.order.id);
  for (const s of p.completedSplits) ids.add(s.order.id);
  for (const a of p.completedAssignments) ids.add(a.order.id);
  return Array.from(ids);
}

/** `?held=` / `?missing=` value: the route's cap (HELD_MAX), comma-joined. */
export function capIds(ids: readonly number[]): string {
  return ids.slice(0, HELD_MAX).join(",");
}

export interface TintManagerLiveOptions {
  /** Panel open, rows ticked, a re-sequence / write in flight, or any modal open. */
  hold: boolean;
  /** Read at each glance. */
  boardIds: () => number[];
  missingIds: () => number[];
  /** The order id the detail panel shows, or null. */
  panelOrderId: number | null;
  fetchBoard: () => Promise<unknown>;
  fetchMissing: () => Promise<void>;
  /** The open panel's bill is in a change batch — the page decides whether to show the strip. */
  onPanelBillChanged: () => void;
}

export interface TintManagerLive {
  live: boolean;
  connected: boolean;
  delayed: boolean;
}

export function useTintManagerLive(opts: TintManagerLiveOptions): TintManagerLive {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const holdRef = useRef(opts.hold);
  holdRef.current = opts.hold;

  const flushingRef = useRef(false);
  const missingPendingRef = useRef(false);
  const flushRef = useRef<() => void>(() => {});
  const [hint] = useState<boolean>(() => readLiveHint(TINT_LIVE_HINT_KEY));

  const feed = useLiveFeed({
    scope: SCOPE,
    screen: "tint",
    topics: "order,config",
    hintKey: TINT_LIVE_HINT_KEY,
    params: () => ({
      held: capIds(optsRef.current.boardIds()),
      missing: capIds(optsRef.current.missingIds()),
    }),
    onPending: () => flushRef.current(),
    onChanges: (b) => {
      const id = optsRef.current.panelOrderId;
      if (id !== null && b.orderIds.includes(id)) {
        liveLog(SCOPE, `open bill ${id} changed elsewhere`);
        optsRef.current.onPanelBillChanged();
      }
    },
    onAnswer: (a) => {
      if (a.enabled && a.missingTouched === true) {
        missingPendingRef.current = true;
        flushRef.current();
      }
    },
    onMode: (m, prev) => liveLog(SCOPE, `mode ${prev} → ${m}`),
    onMidnight: () => {
      liveLog(SCOPE, "IST midnight — full reload");
      void optsRef.current.fetchBoard();
      void optsRef.current.fetchMissing();
    },
  });

  const flush = useCallback(async () => {
    const ctl = feed.controller.current;
    if (!ctl || ctl.getMode() !== "live" || flushingRef.current || holdRef.current) return;
    const work = ctl.take();
    const missing = missingPendingRef.current;
    if (!work && !missing) return;
    flushingRef.current = true;
    missingPendingRef.current = false;
    try {
      if (work) {
        if (work.kind === "full") ctl.noteFullLoad();
        liveLog(SCOPE, work.kind === "full" ? `board: full (${work.reasons.join(", ")})` : `board: changed ${work.orderIds.join(",")}`);
        await optsRef.current.fetchBoard();
      }
      if (missing || work?.kind === "full") {
        liveLog(SCOPE, "missing-customers re-read");
        await optsRef.current.fetchMissing();
      }
    } finally {
      flushingRef.current = false;
    }
  }, [feed.controller]);
  flushRef.current = () => {
    void flush();
  };

  // Released → apply what waited, ONCE.
  useEffect(() => {
    if (!opts.hold) flushRef.current();
  }, [opts.hold]);

  return { live: isTintLive(feed.mode, hint), connected: feed.connected, delayed: feed.delayed };
}
