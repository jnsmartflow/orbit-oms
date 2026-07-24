import { useEffect, useRef } from "react";

// The RAIL's live-sync = the Mail Orders pattern: a plain 30s refetch (a new
// import appears on its own). Deliberately NOT the marker hook — the rail is a
// different mechanism (design §13), and there is no shared abstraction.
export const FLOOR_RAIL_POLL_MS = 30_000;

/**
 * Fires `onTick` every 30s (the caller does the full board refetch). Skips while
 * the tab is hidden and fires one immediate tick on becoming visible again. While
 * `paused` is true it does nothing — the caller is mid-action (a selection is up
 * or the detail panel is open) and a full refetch would move the ground under a
 * hand. Renders nothing; cleans up its timer + listener on unmount.
 */
export function useFloorRailPoll({ paused = false, onTick }: { paused?: boolean; onTick: () => void }): void {
  const onTickRef = useRef(onTick);
  const pausedRef = useRef(paused);
  useEffect(() => {
    onTickRef.current = onTick;
  }, [onTick]);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;

    function tick(): void {
      if (pausedRef.current) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      onTickRef.current();
    }
    function start(): void {
      if (intervalId === null) intervalId = setInterval(tick, FLOOR_RAIL_POLL_MS);
    }
    function stop(): void {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    }
    function onVisibility(): void {
      if (document.visibilityState === "visible") {
        tick(); // one immediate refetch on returning to the tab
        start();
      } else {
        stop();
      }
    }

    if (typeof document === "undefined" || document.visibilityState === "visible") {
      start();
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibility);
    }

    return () => {
      stop();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
    };
  }, []);
}
