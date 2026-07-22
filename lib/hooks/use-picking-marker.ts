import { useEffect, useRef } from "react";

/**
 * How often each client asks GET /api/picking/marker "has the board changed?".
 * Single source of truth — tune the whole picking live-sync cadence here.
 */
export const PICKING_MARKER_POLL_MS = 15_000;

type MarkerScope = "single" | "openPending" | "rolling";

interface MarkerResponse {
  count: number;
  latest: string | null;
  scope: string;
}

interface UsePickingMarkerOptions {
  /** Must match the scope the caller's queue fetch uses, so the marker watches
   *  the SAME row set (buildPickingWhere is shared server-side). */
  scope: MarkerScope;
  /** Only meaningful for scope="single"/"rolling"; omit for "openPending". */
  date?: string;
  /** Fired once each time the marker moves off the last-seen baseline. */
  onChange: () => void;
  /**
   * While true, keep polling + tracking the marker but do NOT fire onChange —
   * the caller is mid-action (a detail/assign/approve screen is open) and the
   * ground must not move under them. When it flips back to false, if the marker
   * moved during the pause, onChange fires exactly ONCE.
   */
  paused?: boolean;
}

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
 */
export function usePickingMarker({
  scope,
  date,
  onChange,
  paused = false,
}: UsePickingMarkerOptions): void {
  // Refs let the poll effect stay mounted for the component's life without
  // re-subscribing every render when onChange/paused identities change.
  const onChangeRef = useRef(onChange);
  const pausedRef = useRef(paused);
  // Last marker value accepted as baseline. null until the first successful
  // response (which is stored, never fired).
  const lastSeenRef = useRef<{ count: number; latest: string | null } | null>(null);
  // The marker moved while paused → fire once on resume.
  const pendingChangeRef = useRef(false);
  // Guard against overlapping in-flight marker requests.
  const inFlightRef = useRef(false);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

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

    // A new (scope, date) subscription watches a DIFFERENT row set — reset the
    // baseline so its first response is stored, never fired (e.g. the desktop
    // queue stepping selectedDate). No-op for a caller whose scope/date never
    // change (the mobile shell): this effect only re-runs when they do, and on
    // first mount lastSeenRef is already null.
    lastSeenRef.current = null;
    pendingChangeRef.current = false;

    const url = `/api/picking/marker?scope=${encodeURIComponent(scope)}${
      date ? `&date=${encodeURIComponent(date)}` : ""
    }`;

    async function check(): Promise<void> {
      // Skip if unmounted, a request is already open, or the tab is hidden.
      if (cancelled || inFlightRef.current) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      inFlightRef.current = true;
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) return; // fail silently — retry next tick
        const marker = (await res.json()) as MarkerResponse;
        if (cancelled) return;
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
        // network blip — swallow, retry next tick
      } finally {
        inFlightRef.current = false;
      }
    }

    function startInterval(): void {
      if (intervalId !== null) return;
      intervalId = setInterval(() => void check(), PICKING_MARKER_POLL_MS);
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

    return () => {
      cancelled = true;
      stopInterval();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibility);
      }
    };
  }, [scope, date]);
}
