"use client";

import { useEffect, useRef } from "react";

/** Missing-customers side list cadence while the tab is visible (plan §C2). */
export const MISSING_CUSTOMERS_POLL_MS = 5 * 60_000;

/**
 * The missing-customers side list, OFF the board reload (2026-09-30, plan §C2).
 * It lists orders of EVERY type whose customer is missing — it follows imports
 * and customer-master edits, not tint work — so it no longer rides on each
 * marker change. It is fetched: once on mount, once each time the tab becomes
 * visible, and every 5 minutes while visible. Hidden = no timer, no request.
 */
export function useMissingCustomersPoll(fetchMissing: () => void): void {
  const fetchRef = useRef(fetchMissing);
  useEffect(() => { fetchRef.current = fetchMissing; }, [fetchMissing]);

  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;
    const hasDoc = typeof document !== "undefined";

    function start(): void {
      if (intervalId !== null) return;
      intervalId = setInterval(() => fetchRef.current(), MISSING_CUSTOMERS_POLL_MS);
    }
    function stop(): void {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    }
    function handleVisibility(): void {
      if (document.visibilityState === "visible") {
        fetchRef.current();
        start();
      } else {
        stop();
      }
    }

    // Mount: fetch once whatever the visibility (as the page always did), and
    // run the timer only if visible.
    fetchRef.current();
    if (!hasDoc || document.visibilityState === "visible") start();
    if (hasDoc) document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      stop();
      if (hasDoc) document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);
}
