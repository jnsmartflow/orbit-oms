"use client";

// Tint Operator on the live change feed (tint step 5, 2026-10-01).
// Behind app_settings 'live.feed' AND 'live.feed.tint' (absent = OFF).
//
// Plan:   docs/prompts/drafts/code-plan-2026-09-30-tint-live-feed.md §D (operator face), §E, Step 5.
// Server: step 3 (acf0ba0b) — GET /api/live/changes?screen=tint&face=operator&held=<his order ids>
//         keeps only order ids in the SESSION user's my-orders set now, or held (so a job LEAVING
//         him — cancelled, reassigned — still wakes the screen). Never a client operator id.
// Record: docs/prompts/drafts/code-update-2026-10-01-tint-live-feed-5.md
//
// TWO PATHS, ONE SWITCH. With the feed live: a hit → ONE my-orders refetch that KEEPS his selected
// job (refetch({ keepSelection: true })); a config change / reset → the same. Held while `hold`
// (a modal / sheet / popup open, or one of his own actions in flight) and applied ONCE on release.
// Not held for a running timer — a cancelled or reassigned running job must reach him.
// One extra guard: if the change touches the job he has OPEN and he has typed into its TI form
// (`tiTyped`), it is NOT applied under him — the "Changed — Reload" strip is shown instead, and it
// applies once he saves / clears the form or taps Reload.
// Off the feed: nothing here fetches anything but the switch check (the screen had no background
// sync before this and has none now). Never router.refresh(). Debug: localStorage
// "orbit.live.debug" = "1" → [live:tint-operator] lines.

import { useCallback, useEffect, useRef, useState } from "react";
import { liveLog, readLiveHint, useLiveFeed } from "@/lib/live/use-live-feed";
import { HELD_MAX } from "@/lib/live/cursor";
import { isTintLive } from "@/components/tint/manager/use-tint-manager-live";

/** localStorage: "the Tint feed was on last time" on this operator's device. */
export const TINT_OPERATOR_LIVE_HINT_KEY = "orbit.live.tint-operator";
const SCOPE = "tint-operator";

export interface TintOperatorLiveOptions {
  /** A modal / sheet / popup is open or one of his actions is in flight. */
  hold: boolean;
  /** He has typed into the open job's TI form (unsaved). */
  tiTyped: boolean;
  /** The order id of the job he has open, or null. */
  openOrderId: number | null;
  /** Every order id his list shows — read at each glance (`?held=`). */
  heldIds: () => number[];
  /** my-orders refetch that keeps his selected job when it is still there. */
  refetch: () => Promise<void>;
}

export interface TintOperatorLive {
  live: boolean;
  /** The open job changed elsewhere and was not swapped under him. */
  openJobChanged: boolean;
  /** Apply now (the strip's Reload). */
  reloadNow: () => void;
}

export function useTintOperatorLive(opts: TintOperatorLiveOptions): TintOperatorLive {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const holdRef = useRef(opts.hold);
  holdRef.current = opts.hold;

  const flushingRef = useRef(false);
  const stashRef = useRef(false); // work taken but not applied (it touched his open, typed-into job)
  const flushRef = useRef<() => void>(() => {});
  const [hint] = useState<boolean>(() => readLiveHint(TINT_OPERATOR_LIVE_HINT_KEY));
  const [openJobChanged, setOpenJobChanged] = useState(false);

  const feed = useLiveFeed({
    scope: SCOPE,
    screen: "tint",
    topics: "order,config",
    hintKey: TINT_OPERATOR_LIVE_HINT_KEY,
    params: () => ({ face: "operator", held: optsRef.current.heldIds().slice(0, HELD_MAX).join(",") }),
    onPending: () => flushRef.current(),
    onChanges: (b) => {
      const id = optsRef.current.openOrderId;
      if (id !== null && b.orderIds.includes(id) && (holdRef.current || optsRef.current.tiTyped)) {
        liveLog(SCOPE, `open job (order ${id}) changed elsewhere — strip`);
        setOpenJobChanged(true);
      }
    },
    onMode: (m, prev) => liveLog(SCOPE, `mode ${prev} → ${m}`),
    onMidnight: () => {
      liveLog(SCOPE, "IST midnight — his list reloaded");
      void optsRef.current.refetch();
    },
  });

  const apply = useCallback(async (why: string) => {
    flushingRef.current = true;
    stashRef.current = false;
    setOpenJobChanged(false);
    try {
      liveLog(SCOPE, `his list: ${why}`);
      await optsRef.current.refetch();
    } finally {
      flushingRef.current = false;
    }
  }, []);

  const flush = useCallback(async () => {
    const ctl = feed.controller.current;
    if (!ctl || ctl.getMode() !== "live" || flushingRef.current || holdRef.current) return;
    const work = ctl.take();
    if (!work && !stashRef.current) return;
    if (work?.kind === "full") ctl.noteFullLoad();
    const open = optsRef.current.openOrderId;
    const touchesOpen =
      stashRef.current || (open !== null && (work?.kind === "full" || (work?.kind === "patch" && work.orderIds.includes(open))));
    if (optsRef.current.tiTyped && touchesOpen) {
      stashRef.current = true;
      setOpenJobChanged(true);
      liveLog(SCOPE, "held: the open job has unsaved TI input");
      return;
    }
    await apply(work?.kind === "full" ? `full (${work.reasons.join(", ")})` : "changed");
  }, [feed.controller, apply]);
  flushRef.current = () => {
    void flush();
  };

  // Released (modal closed, action finished, TI form saved / cleared) → apply what waited, ONCE.
  // (With tiTyped still true, flush applies only work that does not touch his open job.)
  useEffect(() => {
    if (!opts.hold) flushRef.current();
  }, [opts.hold, opts.tiTyped]);

  // A different job opened → the strip belonged to the old one.
  useEffect(() => {
    setOpenJobChanged(false);
  }, [opts.openOrderId]);

  const reloadNow = useCallback(() => {
    const ctl = feed.controller.current;
    const w = ctl?.take(); // whatever is queued is covered by this refetch
    if (w?.kind === "full") ctl?.noteFullLoad();
    void apply("reload (strip)");
  }, [feed.controller, apply]);

  return { live: isTintLive(feed.mode, hint), openJobChanged, reloadNow };
}
