"use client";

// Billing desk on the live change feed (2b-ii, 2026-09-30) — behind app_settings 'live.feed' AND
// 'live.feed.billing' (absent = OFF).
//
// Plan:  docs/prompts/drafts/code-plan-2026-09-30-billing-live-feed.md §D ("Client — the smallest
//        diff"), §E, decisions 5, 8, 9, 10. Server side: 2b-i (/api/live/changes?screen=billing,
//        POST /api/billing/sync). Record: docs/prompts/drafts/code-update-2026-09-30-billing-live-feed-2b-ii.md
//
// SHAPE. <BillingLiveRoot> is mounted by mail-orders-page ABOVE its `!loading` gate, so a date step
// never restarts the feed. It runs ONE useLiveFeed (the same adaptive glance as Floor) and, when the
// feed is live:
//   · on each glance with changes, ONE POST /api/billing/sync; each touched arm's subscribers are
//     fired through the SAME BillingMarkerApi contexts the four marker providers expose — the
//     providers register a handle here (billing-marker-provider.tsx) and keep their own pause
//     contract (a change arriving while held fires once on release);
//   · the pill counts come from sync answers (and one read of the four markers at start), published
//     to the tab bar and — through the Pick delete provider's value context — the popup;
//   · a mail_order change reloads the Orders list at most once per glance, held while the operator
//     is typing / smart-copying / has a popover or dialog open (the page supplies `ordersPaused`).
// When the feed is NOT live (off, unknown on a browser that never saw it on, fallback after errors)
// the context says `live: false`, every provider runs its own poll exactly as before, and nothing
// here fetches except the feed's own glance (60 s re-check while off).
//
// Debug log: localStorage "orbit.live.debug" = "1" → [live:billing] lines (lib/live/use-live-feed.ts).
// Never router.refresh() (CORE §3).

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { liveLog, readLiveHint, useLiveFeed } from "@/lib/live/use-live-feed";
import type { FeedMode, Work } from "@/lib/live/feed-core";
import {
  BILLING_ARMS,
  BILLING_TOPICS,
  armsToFire,
  initialCountRequests,
  markerCount,
  mergeCounts,
  syncBodyFromPatch,
  tooManyForSync,
  type BillingArm,
  type BillingCounts,
  type BillingShownKey,
} from "@/lib/billing/live-rule";

/** localStorage: "the Billing feed was on last time" (per browser). */
export const BILLING_LIVE_HINT_KEY = "orbit.live.billing";

/** The hint, for the page's first render (so the Orders marker does not start and stop at once). */
export function readBillingLiveHint(): boolean {
  return readLiveHint(BILLING_LIVE_HINT_KEY);
}

/** What a marker provider registers so the root can fire its subscribers. */
export interface BillingArmHandle {
  /** A change touched this arm: fire the subscribers now, or once when the last pause releases. */
  requestFire(): void;
  /** Pick delete only: publish a count to the popup (the provider's value context). */
  setValue?(v: { count: number; latest: string | null }): void;
}

interface BillingLiveApi {
  live: boolean;
  /** The pills' counts while live (null otherwise). */
  counts: BillingCounts | null;
  register(arm: BillingArm, handle: BillingArmHandle): () => void;
  /** The ids a surface currently shows for an arm (`key` = the surface); null clears. */
  setShown(key: string, arm: BillingShownKey, ids: readonly number[] | null): void;
  /** An immediate glance (≤ 1 per 3 s), e.g. when an Import on this screen finishes. */
  glanceNow(why: string): void;
}

const BillingLiveContext = createContext<BillingLiveApi | null>(null);

/** The root's API, or null on the non-billing face. */
export function useBillingLiveApi(): BillingLiveApi | null {
  return useContext(BillingLiveContext);
}

/** Is the Billing desk on the feed right now? */
export function useBillingLiveMode(): boolean {
  return useContext(BillingLiveContext)?.live === true;
}

/** The pills' counts while live; null when not live (callers keep their own marker path). */
export function useBillingLiveCounts(): BillingCounts | null {
  const api = useContext(BillingLiveContext);
  return api?.live ? api.counts : null;
}

/** Report the ids this surface shows for an arm (the `shown` of POST /api/billing/sync). No-op when not live. */
export function useBillingShownIds(key: string, arm: BillingShownKey, ids: readonly number[]): void {
  const api = useContext(BillingLiveContext);
  const sig = ids.join(",");
  useEffect(() => {
    if (!api) return;
    api.setShown(key, arm, ids);
    return () => api.setShown(key, arm, null);
    // `sig` stands in for `ids` (a fresh array each render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, key, arm, sig]);
}

/**
 * A no-network 30 s re-render while live — the Picking tab's "Xm ago" column moved only because
 * some fetch re-rendered it; on the feed nothing may re-render it for minutes. Not live → nothing.
 */
export function useBillingLiveTick(): void {
  const live = useBillingLiveMode();
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, [live]);
}

export interface BillingLiveRootProps {
  /** billingV2 — the non-billing face never starts the feed. */
  enabled: boolean;
  /** canView per arm — exactly the providers' `enabled` gates. */
  permitted: Readonly<Record<BillingArm, boolean>>;
  /** The header's day (the Picking marker's `date`). */
  date: string;
  /** The Orders tab's reload (mail-orders-page loadOrders). */
  loadOrders: () => void;
  /** True while the Orders pane must not change under the operator (plan §E). */
  ordersPaused: () => boolean;
  /** Tells the page whether the feed is live (it unmounts its Orders marker then). */
  onLiveChange?: (live: boolean) => void;
  children: React.ReactNode;
}

export function BillingLiveRoot(props: BillingLiveRootProps) {
  if (!props.enabled) return <>{props.children}</>;
  return <ActiveBillingLiveRoot {...props} />;
}

function ActiveBillingLiveRoot({ children, ...props }: BillingLiveRootProps) {
  const propsRef = useRef(props);
  propsRef.current = props;

  const handles = useRef(new Map<BillingArm, Set<BillingArmHandle>>());
  const shown = useRef(new Map<string, { arm: BillingShownKey; ids: readonly number[] }>());
  const [counts, setCounts] = useState<BillingCounts>({});
  const countsRef = useRef<BillingCounts>({});
  const flushingRef = useRef(false);
  const failuresRef = useRef(0);
  const flushRef = useRef<() => void>(() => {});
  const ordersPendingRef = useRef(false);
  const ordersTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const feed = useLiveFeed({
    scope: "billing",
    screen: "billing",
    topics: BILLING_TOPICS,
    hintKey: BILLING_LIVE_HINT_KEY,
    onPending: () => flushRef.current(),
    onMode: (m: FeedMode, prev: FeedMode) => {
      liveLog("billing", `mode ${prev} → ${m}`);
    },
  });
  // "Live" for the providers = on the feed, OR not known yet on a browser that saw it on last time
  // (the hint) — so the legacy polls do not start and stop within the first second. If the feed
  // turns out off / unreachable, `live` goes false and they mount then (Floor's start-up rule).
  const hintRef = useRef<boolean>(readLiveHint(BILLING_LIVE_HINT_KEY));
  const live = feed.mode === "live" || (feed.mode === "unknown" && hintRef.current);
  useEffect(() => {
    propsRef.current.onLiveChange?.(live);
  }, [live]);

  const fire = useCallback((arm: BillingArm) => {
    handles.current.get(arm)?.forEach((h) => h.requestFire());
  }, []);

  const applyCounts = useCallback((next: BillingCounts) => {
    countsRef.current = mergeCounts(countsRef.current, next);
    setCounts(countsRef.current);
    const pd = next.pickDelete;
    if (typeof pd === "number") handles.current.get("pickDelete")?.forEach((h) => h.setValue?.({ count: pd, latest: null }));
  }, []);

  // The Orders tab: at most one reload per glance, held while the operator is mid-action.
  const tryOrders = useCallback(() => {
    if (!ordersPendingRef.current) return;
    if (propsRef.current.ordersPaused()) {
      if (ordersTimerRef.current === null) {
        ordersTimerRef.current = setTimeout(() => {
          ordersTimerRef.current = null;
          tryOrders();
        }, 2_000);
      }
      return;
    }
    ordersPendingRef.current = false;
    liveLog("billing", "orders list reload");
    propsRef.current.loadOrders();
  }, []);
  const requestOrders = useCallback(() => {
    ordersPendingRef.current = true;
    tryOrders();
  }, [tryOrders]);
  useEffect(
    () => () => {
      if (ordersTimerRef.current !== null) clearTimeout(ordersTimerRef.current);
    },
    [],
  );

  /** The four markers, once (start / switch-on / a full refresh) — only the permitted arms. */
  const readMarkers = useCallback(async () => {
    const next: BillingCounts = {};
    for (const { arm, url } of initialCountRequests(propsRef.current.permitted, propsRef.current.date)) {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) continue;
        const c = markerCount(await res.json());
        if (c !== null) next[arm] = c;
      } catch {
        /* that pill keeps its number */
      }
    }
    liveLog("billing", "marker counts", next);
    applyCounts(next);
  }, [applyCounts]);

  /** Full refresh. At start / switch-on the page already has fresh data — counts only. */
  const full = useCallback(
    async (reasons: string[]) => {
      feed.controller.current?.noteFullLoad();
      await readMarkers();
      if (reasons.every((r) => r === "start" || r === "switch-on")) return;
      liveLog("billing", `full refresh (${reasons.join(", ")})`);
      for (const a of BILLING_ARMS) if (propsRef.current.permitted[a]) fire(a);
      requestOrders();
    },
    [feed.controller, readMarkers, fire, requestOrders],
  );

  const shownByArm = useCallback(() => {
    const out: Partial<Record<BillingShownKey, number[]>> = {};
    shown.current.forEach(({ arm, ids }) => {
      (out[arm] ??= []).push(...ids);
    });
    return out;
  }, []);

  const flush = useCallback(async () => {
    const ctl = feed.controller.current;
    if (!ctl || ctl.getMode() !== "live" || flushingRef.current) return;
    const work: Work | null = ctl.take();
    if (!work) return;
    flushingRef.current = true;
    let applied = false;
    try {
      if (work.kind === "full") {
        await full(work.reasons);
      } else if (tooManyForSync(work)) {
        await full(["too-many"]);
      } else {
        const body = syncBodyFromPatch(work, shownByArm());
        if (body.orderIds.length + body.tripIds.length + body.mailOrderIds.length > 0 || body.soTagChanged) {
          const res = await fetch("/api/billing/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            cache: "no-store",
          });
          if (!res.ok) throw new Error(`sync HTTP ${res.status}`);
          const data = (await res.json()) as {
            enabled?: boolean;
            touched?: Partial<Record<BillingArm | "mailOrders", boolean>>;
            counts?: BillingCounts;
          };
          if (data.enabled === false) {
            ctl.noteDisabled();
            return;
          }
          liveLog("billing", "sync", { touched: data.touched, counts: data.counts });
          applyCounts(data.counts ?? {});
          for (const a of armsToFire(data.touched ?? {}, propsRef.current.permitted)) fire(a);
          if (data.touched?.mailOrders) requestOrders();
        }
      }
      failuresRef.current = 0;
      applied = true;
    } catch (e) {
      failuresRef.current++;
      liveLog("billing", `apply failed (${failuresRef.current})`, e instanceof Error ? e.message : e);
      if (work.kind === "patch") ctl.requeue(work.orderIds, work.tripIds, work.extra);
      if (failuresRef.current >= 3) {
        failuresRef.current = 0;
        try {
          await full(["too-many"]);
        } catch {
          /* the next glance retries */
        }
      }
    } finally {
      flushingRef.current = false;
    }
    // Changes that arrived while this ran → one more pass; never after a failure (no hot loop).
    if (applied) setTimeout(() => flushRef.current(), 0);
  }, [feed.controller, full, shownByArm, applyCounts, fire, requestOrders]);
  flushRef.current = () => {
    void flush();
  };

  const register = useCallback((arm: BillingArm, handle: BillingArmHandle) => {
    let set = handles.current.get(arm);
    if (!set) {
      set = new Set();
      handles.current.set(arm, set);
    }
    set.add(handle);
    // A provider mounting while live (e.g. after a date step) gets the pill's current number.
    const c = countsRef.current.pickDelete;
    if (arm === "pickDelete" && typeof c === "number") handle.setValue?.({ count: c, latest: null });
    return () => {
      handles.current.get(arm)?.delete(handle);
    };
  }, []);

  const setShown = useCallback((key: string, arm: BillingShownKey, ids: readonly number[] | null) => {
    if (ids === null) shown.current.delete(key);
    else shown.current.set(key, { arm, ids });
  }, []);

  const glanceNow = useCallback(
    (why: string) => {
      feed.controller.current?.glanceNow(why);
    },
    [feed.controller],
  );

  const api = useMemo<BillingLiveApi>(
    () => ({ live, counts: live ? counts : null, register, setShown, glanceNow }),
    [live, counts, register, setShown, glanceNow],
  );

  return <BillingLiveContext.Provider value={api}>{children}</BillingLiveContext.Provider>;
}
