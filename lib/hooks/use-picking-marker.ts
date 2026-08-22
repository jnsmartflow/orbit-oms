import { useCallback, useEffect, useMemo, useRef } from "react";

/**
 * How often each client asks GET /api/picking/marker "has the board changed?".
 * Single source of truth — tune the whole picking live-sync cadence here.
 */
export const PICKING_MARKER_POLL_MS = 15_000;

// 'rolling' was a third value here until 2026-07-28; it belonged to the desktop
// picking board, which is archived (archive/2026-07-picking-desktop/). Mirrors
// PickingQueueScope in lib/picking/queue.ts — keep the two unions in step.
type MarkerScope = "single" | "openPending";

interface MarkerResponse {
  count: number;
  latest: string | null;
  scope: string;
}

interface UsePickingMarkerOptions {
  /** Must match the scope the caller's queue fetch uses, so the marker watches
   *  the SAME row set (buildPickingWhere is shared server-side). */
  scope: MarkerScope;
  /** Only meaningful for scope="single"; omit for "openPending". */
  date?: string;
  /** Optional per-picker narrowing — the marker then only moves when THIS
   *  picker's rows change (assigned-to / done / approved / unassigned-away).
   *  Omit for the board-wide marker (supervisor surfaces). */
  pickerId?: number;
  /** Fired once each time the marker moves off the last-seen baseline. */
  onChange: () => void;
  /**
   * While true, keep polling + tracking the marker but do NOT fire onChange —
   * the caller is mid-action (a detail/assign/approve screen is open) and the
   * ground must not move under them. When it flips back to false, if the marker
   * moved during the pause, onChange fires exactly ONCE.
   */
  paused?: boolean;
  /**
   * Marker endpoint. Defaults to `/api/picking/marker` — Picking passes nothing
   * and is byte-identical. Another board (Floor) points this at its OWN marker
   * route (`/api/floor/marker`) so it watches its own exact set rather than
   * silently depending on what picking's scope means. The `?scope=…&date=…` query
   * is still appended; a route that doesn't use those params simply ignores them.
   */
  url?: string;
  /**
   * Optional: called after EACH completed probe with whether the server was
   * reached (res.ok, no throw). Lets a caller drive a connection indicator off
   * the SAME poll instead of a second fetch. Not called on skipped ticks (tab
   * hidden / overlapping request). Picking passes nothing → no behaviour change.
   */
  onProbe?: (ok: boolean) => void;
  /**
   * Poll interval in ms. OPTIONAL — omitted, this is PICKING_MARKER_POLL_MS
   * (15s), so every caller that does not pass it is byte-identical to before:
   * Picking's two boards and Floor all omit it deliberately.
   *
   * Billing passes 30_000 (components/billing/billing-marker-provider.tsx): its
   * board is a desk handoff list, not a live floor, and the count it drives
   * moves a handful of times a day. Floor's 15s is load-bearing — the same poll
   * feeds its connection strip via `onProbe` — so do NOT slow that one down.
   */
  pollMs?: number;
}

/**
 * What `usePickingMarker` hands back: "I already have fresh data as of now —
 * re-baseline yourself and do NOT tell me about it."
 *
 * Await it after a refetch the CALLER performed (a user action), never after a
 * refetch the hook itself asked for. See the hook's own doc block for the
 * problem this solves.
 *
 * Every pre-existing call site ignores the return value and is byte-identical.
 */
export type MarkerResync = () => Promise<void>;

/**
 * Cheap "has the picking board changed?" poll, shared by all three picking
 * surfaces (supervisor mobile is the first consumer; desktop + picker face
 * reuse it later). Polls the tiny marker endpoint every 15s and calls
 * `onChange` only when {count, latest} differs from the last value it accepted
 * — the caller then does the ONE full queue refetch. This hook never fetches
 * the queue itself and renders nothing.
 *
 * Contract:
 *  - First successful response is stored as the baseline and never fires
 *    onChange (no spurious refetch on mount).
 *  - PAUSES entirely while the tab is hidden (clears the interval on
 *    visibilitychange→hidden); on becoming visible it fires ONE immediate
 *    check, then resumes the interval.
 *  - No overlapping in-flight requests — a tick is skipped while the previous
 *    marker request is still open.
 *  - A failed marker fetch fails SILENTLY (no toast, no error state, no console
 *    spam): the tick is skipped and retried next time. This runs all day.
 *  - Cleaned up on unmount — no leaked timers, no dangling listener.
 *
 * ── THE RETURNED `resync()` (2026-08-10) ────────────────────────────────────
 *
 * THE PROBLEM IT SOLVES. Every picking write action (assign / undo / release /
 * approve / mark-done) does its own full queue refetch the moment it succeeds,
 * so the acting user already sees the result. That same write also bumps
 * `orders.updatedAt` — and this hook has no way to know the change was already
 * shown, because `lastSeenRef` is advanced ONLY inside `check()`. So the next
 * scheduled tick, up to a full interval later, saw the identical change as
 * "new" and fired `onChange` → a SECOND full `getPickingQueue()` rebuild for an
 * update already on screen. Roughly half of all queue calls were that duplicate.
 *
 * `resync()` closes it by re-using this hook's OWN probe — the same request
 * `check()` makes — rather than having the caller recompute `{count, latest}`
 * from the queue response. That matters: the marker route's predicate
 * (`buildPickingWhere`) is server-side and can change; a client-side
 * reimplementation would silently drift out of step with it. One ~16ms marker
 * call instead of a ~23.5ms queue rebuild is the trade, and it is a clear win.
 *
 * What it does, precisely:
 *   1. probes the marker endpoint;
 *   2. stores the result as the new baseline — NEVER compares, NEVER fires
 *      `onChange` (the caller already rendered this data; firing would cause a
 *      THIRD reload);
 *   3. clears any deferred change queued while `paused` — that change is by
 *      definition covered by the fresh data the caller just fetched, so leaving
 *      it armed would fire on unpause for something already on screen;
 *   4. restarts the interval, so the next real tick is a FULL interval away
 *      from the action rather than a stray few seconds after it;
 *   5. invalidates any check already in flight (generation counter), so a probe
 *      that started before the action cannot land afterwards and re-fire
 *      `onChange` for the same change.
 *
 * A failed resync is silent and harmless: the baseline simply stays where it
 * was, and the next tick behaves exactly as it does today (one extra refetch) —
 * i.e. it degrades to the CURRENT behaviour, never to something worse.
 *
 * ⚠ READ-ONLY, and it must stay that way. This hook and the marker route it
 * calls perform no writes at all. Never add an `orders.update` to any picking
 * path to "help" the marker: the marker keys on `MAX(orders.updatedAt)`, so an
 * extra write fires a false "changed" on every board (CORE §3).
 */
export function usePickingMarker({
  scope,
  date,
  pickerId,
  onChange,
  paused = false,
  url,
  onProbe,
  pollMs = PICKING_MARKER_POLL_MS,
}: UsePickingMarkerOptions): MarkerResync {
  // Refs let the poll effect stay mounted for the component's life without
  // re-subscribing every render when onChange/paused identities change.
  const onChangeRef = useRef(onChange);
  const onProbeRef = useRef(onProbe);
  const pausedRef = useRef(paused);
  // Last marker value accepted as baseline. null until the first successful
  // response (which is stored, never fired).
  const lastSeenRef = useRef<{ count: number; latest: string | null } | null>(null);
  // The marker moved while paused → fire once on resume.
  const pendingChangeRef = useRef(false);
  // Guard against overlapping in-flight marker requests.
  const inFlightRef = useRef(false);
  // Bumped by resync(). A check() that started BEFORE a resync landed carries
  // the old generation and discards its own result rather than overwriting the
  // fresher baseline or firing onChange for a change already handled.
  const generationRef = useRef(0);
  // Set by the poll effect so resync() can restart the interval from outside
  // it. Null while unmounted or while the tab is hidden (no interval running).
  const restartIntervalRef = useRef<(() => void) | null>(null);
  // Guards resync() against landing after unmount.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ONE construction of the probe URL, shared by the poll effect and resync()
  // so the two can never ask different questions. Identity changes exactly when
  // (url, scope, date, pickerId) do — which is what re-subscribes the effect and
  // re-baselines, precisely as before this was hoisted.
  const requestUrl = useMemo(() => {
    const markerBase = url ?? "/api/picking/marker";
    // ⚠ The base may already CARRY a query (2026-08-22). MRN points this at
    // `/api/mrn/marker?tab=…` because its route is per-tab and 400s without
    // one; a hardcoded `?` would have produced `…?tab=x?scope=y` and the tab
    // would arrive as the literal string "x?scope=y". Picking, Floor and
    // Billing all pass a bare path, so this is byte-identical for them.
    const sep = markerBase.includes("?") ? "&" : "?";
    return `${markerBase}${sep}scope=${encodeURIComponent(scope)}${
      date ? `&date=${encodeURIComponent(date)}` : ""
    }${pickerId !== undefined ? `&pickerId=${pickerId}` : ""}`;
  }, [url, scope, date, pickerId]);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onProbeRef.current = onProbe;
  }, [onProbe]);

  // On unpause, flush a change that landed during the pause — exactly once.
  useEffect(() => {
    const was = pausedRef.current;
    pausedRef.current = paused;
    if (was && !paused && pendingChangeRef.current) {
      pendingChangeRef.current = false;
      onChangeRef.current();
    }
  }, [paused]);

  useEffect(() => {
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    // A new (scope, date, pickerId) subscription watches a DIFFERENT row set —
    // reset the baseline so its first response is stored, never fired (e.g. the
    // desktop queue stepping selectedDate). No-op for a caller whose inputs never
    // change (the mobile shell): this effect only re-runs when they do, and on
    // first mount lastSeenRef is already null.
    lastSeenRef.current = null;
    pendingChangeRef.current = false;

    async function check(): Promise<void> {
      // Skip if unmounted, a request is already open, or the tab is hidden.
      if (cancelled || inFlightRef.current) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      inFlightRef.current = true;
      // Snapshot the generation. If resync() lands while this request is open,
      // this probe's answer is stale by definition — it was taken BEFORE the
      // caller's own fresh fetch — so it must not touch the baseline or fire.
      const generation = generationRef.current;
      try {
        const res = await fetch(requestUrl, { cache: "no-store" });
        if (!res.ok) {
          onProbeRef.current?.(false); // reached the server, but it errored
          return; // fail silently — retry next tick
        }
        onProbeRef.current?.(true);
        const marker = (await res.json()) as MarkerResponse;
        if (cancelled) return;
        if (generation !== generationRef.current) return; // superseded by resync()
        const next = { count: marker.count, latest: marker.latest };
        const prev = lastSeenRef.current;
        if (prev === null) {
          lastSeenRef.current = next; // first response = baseline, never fires
          return;
        }
        const moved = prev.count !== next.count || prev.latest !== next.latest;
        if (!moved) return;
        lastSeenRef.current = next; // always advance the baseline
        if (pausedRef.current) {
          pendingChangeRef.current = true; // defer the fire to unpause
          return;
        }
        onChangeRef.current();
      } catch {
        onProbeRef.current?.(false); // network blip — could not reach the server
        // swallow, retry next tick
      } finally {
        inFlightRef.current = false;
      }
    }

    function startInterval(): void {
      if (intervalId !== null) return;
      intervalId = setInterval(() => void check(), pollMs);
    }
    function stopInterval(): void {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    }

    function handleVisibility(): void {
      if (document.visibilityState === "visible") {
        void check(); // one immediate check on becoming visible
        startInterval();
      } else {
        stopInterval(); // pause entirely while hidden
      }
    }

    if (typeof document === "undefined" || document.visibilityState === "visible") {
      void check(); // baseline + first live check
      startInterval();
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibility);
    }

    // Expose the restart to resync(), which lives outside this effect.
    restartIntervalRef.current = () => {
      stopInterval();
      startInterval();
    };

    return () => {
      cancelled = true;
      stopInterval();
      restartIntervalRef.current = null;
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibility);
      }
    };
    // `requestUrl` stands in for (url, scope, date, pickerId) — it changes
    // exactly when they do, so this re-subscribes and re-baselines identically.
    // `pollMs` joins the deps so a caller changing it re-subscribes with the new
    // cadence. Every existing caller omits it, so it is the same constant on
    // every render and this effect re-runs exactly as often as it did before.
  }, [requestUrl, pollMs]);

  /**
   * "I already have fresh data as of now." Re-baselines from this hook's own
   * probe and stays silent. Full contract in the doc block above.
   */
  const resync = useCallback<MarkerResync>(async () => {
    // Supersede any check() already in flight BEFORE awaiting anything, so a
    // probe that started earlier cannot land afterwards and re-fire onChange.
    generationRef.current += 1;
    try {
      const res = await fetch(requestUrl, { cache: "no-store" });
      if (!res.ok) {
        onProbeRef.current?.(false);
        return; // silent — baseline unchanged, next tick behaves as it does today
      }
      onProbeRef.current?.(true);
      const marker = (await res.json()) as MarkerResponse;
      if (!mountedRef.current) return;
      // Accept as the new baseline WITHOUT comparing and WITHOUT firing: the
      // caller has already fetched and rendered this state.
      lastSeenRef.current = { count: marker.count, latest: marker.latest };
      // Any change deferred while paused is covered by the caller's own fresh
      // fetch — leaving it armed would fire on unpause for data already shown.
      pendingChangeRef.current = false;
      // Next scheduled tick a FULL interval away from the action, not a stray
      // few seconds after it. No-op when no interval is running (tab hidden).
      restartIntervalRef.current?.();
    } catch {
      onProbeRef.current?.(false);
      // silent — see above
    }
  }, [requestUrl]);

  return resync;
}
