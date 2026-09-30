"use client";

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
 * ── No blind refetch (removed 2026-09-30 — do not re-add) ────────────────────
 * There used to be a 60s `setInterval` refetch here as a "belt-and-braces floor".
 * It was also, silently, the ONLY thing that showed a pause/resume, a split
 * start/status/reassign, a TI entry or a challan save/void — none of those write
 * `orders`, so the orders-only marker never moved. The marker route now folds
 * MAX(updatedAt) of tint_assignments, order_splits and delivery_challans into
 * `latest`, so the 15s probe sees all of them (within 15s instead of ≤ 60s), and
 * the blind tick went. Recovery after a failed probe needs no timer: the marker
 * hook keeps probing every 15s and probes once on becoming visible.
 * (docs/prompts/drafts/code-plan-2026-09-30-tint-live-feed.md §C1.)
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
}

/**
 * The legacy path as a component (tint step 4, 2026-09-30): the page renders this ONLY while the
 * Tint feed is not live (switch off, fallback after errors, or unknown on a browser that never saw
 * it on). Same props, same single useTintManagerSync call as the page made before the feed — so the
 * OFF path's marker is byte-identical. See use-tint-manager-live.ts.
 */
export function LegacyTintManagerSync(props: {
  paused: boolean;
  onChange: () => void;
  onProbe: (connected: boolean) => void;
}): null {
  useTintManagerSync(props);
  return null;
}
