"use client";

import { useEffect, useRef } from "react";
import { usePickingMarker } from "@/lib/hooks/use-picking-marker";

/**
 * Tint Manager live-sync. New to this screen in the 2026-09-05 rebuild — the old
 * Kanban had NO polling of any kind (no setInterval, no marker), so a manager
 * only ever saw what was true when the page loaded.
 *
 * ── Why this is ONE mechanism where Floor has two ────────────────────────────
 * Floor runs a 15s marker probe for its board AND a separate 30s full refetch
 * for its rail, because those are two independent data sources with different
 * characteristics (CLAUDE_FLOOR §5: "Two DIFFERENT mechanisms, no shared
 * abstraction"). Tint Manager is not shaped that way: the rail and the table are
 * both rendered from the SAME single response of GET /api/tint/manager/orders,
 * so one refetch already updates both, and a second timer would just fetch the
 * same URL twice.
 *
 * The marker's predicate covers the rail too — arm 1 of
 * /api/tint/manager/marker is the three open stages, `pending_tint_assignment`
 * included — so a newly-imported OBD landing on the rail moves `count` and
 * triggers the same refetch. That is the rail's "a new OBD appears on its own"
 * behaviour, driven by the 15s probe rather than a 30s blind poll.
 *
 * `SLOW_REFETCH_MS` is a belt-and-braces floor, not a second mechanism: if the
 * marker probe itself is failing (network, auth expiry) the board still
 * reconciles every 60s once connectivity returns, instead of sitting stale until
 * someone reloads.
 *
 * ── Pause rules, copied from Floor ───────────────────────────────────────────
 * Never move the ground under a hand: no refetch while the detail panel is open
 * or rows are selected, and nothing at all while the tab is hidden (the marker
 * hook enforces the last one itself). A change that lands while paused fires
 * once on resume — that is `usePickingMarker`'s own pendingChange behaviour, not
 * something re-implemented here.
 *
 * READ-ONLY: the probe adds no write. Never let it — every board's live-sync
 * keys on MAX(orders.updatedAt), so one extra write here fires a false "changed"
 * on all of them (CORE §3 / PICKING §10 / FLOOR §10).
 */
const SLOW_REFETCH_MS = 60_000;

export function useTintManagerSync({
  paused,
  onChange,
  onProbe,
}: {
  /** True while the detail panel is open or a selection is up. */
  paused: boolean;
  /** Refetch the board. */
  onChange: () => void;
  /** Connection state for the strip — fed by the SAME probe, one poll for both. */
  onProbe: (connected: boolean) => void;
}): void {
  usePickingMarker({
    // Required by the hook's type and appended to the query string; the tint
    // marker route ignores every param (its set is fixed), exactly as the floor
    // marker ignores Floor's.
    scope: "openPending",
    url: "/api/tint/manager/marker",
    paused,
    onProbe,
    onChange,
  });

  const onChangeRef = useRef(onChange);
  const pausedRef   = useRef(paused);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  useEffect(() => {
    const id = setInterval(() => {
      if (pausedRef.current) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      onChangeRef.current();
    }, SLOW_REFETCH_MS);
    return () => clearInterval(id);
  }, []);
}
