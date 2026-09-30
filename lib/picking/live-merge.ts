// lib/picking/live-merge.ts — PURE merge rules for the supervisor board on the live feed (picking 4b).
//
// Plan: docs/prompts/drafts/code-plan-2026-09-30-picking-live-feed.md §D.1. Server: POST
// /api/picking/sync (lib/picking/sync.ts), whose rows come from the SAME builder as the full queue
// (proven 18/18 in 4a). Tests: lib/picking/live-merge.test.ts.
//
// Client-safe: type-only imports plus the queue's own sort (lib/picking/sort.ts, no server code).
// After a merge the board is what a full load would return for those ids, re-sorted with the
// queue's own spine (sortPickingQueue, PICKING_SPINE — exactly getPickingQueue's call), and the
// bundling siblings re-emitted in row order, as the full queue emits them.

import { sortPickingQueue } from "@/lib/picking/sort";
import type { PickingQueueResult } from "@/lib/picking/queue";
import type { PickingSyncResult } from "@/lib/picking/sync";
import type { PickingQueueRow } from "@/lib/picking/types";

export interface PickingMergeResult {
  data: PickingQueueResult;
  /** Ids that were on the board and are not any more. */
  leftIds: number[];
  /** The answer is for another IST day → do a full reload instead (nothing was merged). */
  dateMismatch: boolean;
}

type Siblings = PickingQueueResult["waitingSkus"];

function mergeSiblings(prev: Siblings, fresh: Siblings, patched: ReadonlySet<number>, rows: PickingQueueRow[]): Siblings {
  const byId = new Map(prev.filter((s) => !patched.has(s.orderId)).map((s) => [s.orderId, s]));
  for (const s of fresh) byId.set(s.orderId, s);
  // Only rows still on the board, in the board's order (the full queue emits them in sortedRows order).
  const out: Siblings = [];
  for (const r of rows) {
    const s = byId.get(r.orderId);
    if (s) out.push(s);
  }
  return out;
}

/** Apply one POST /api/picking/sync answer to the board's data. */
export function applyPickingSync(data: PickingQueueResult, res: PickingSyncResult): PickingMergeResult {
  if (res.date !== data.date) return { data, leftIds: [], dateMismatch: true };
  const patched = new Set(res.patches.map((p) => p.id));
  const had = new Set(data.rows.map((r) => r.orderId));
  const kept = data.rows.filter((r) => !patched.has(r.orderId));
  const added = res.patches.flatMap((p) => (p.row ? [p.row] : []));
  const rows = sortPickingQueue([...kept, ...added]);
  const leftIds = res.patches.filter((p) => p.row === null && had.has(p.id)).map((p) => p.id);
  return {
    data: {
      ...data,
      rows,
      waitingSkus: mergeSiblings(data.waitingSkus, res.waitingSkus, patched, rows),
      oilSkus: mergeSiblings(data.oilSkus, res.oilSkus, patched, rows),
      ...(res.heldBack !== undefined
        ? {
            heldBack: res.heldBack,
            heldBackTrucks: res.heldBackTrucks ?? 0,
            heldBackUnplanned: res.heldBackUnplanned ?? 0,
          }
        : {}),
      ...(res.pickDeleted !== undefined ? { pickDeleted: res.pickDeleted } : {}),
    },
    leftIds,
    dateMismatch: false,
  };
}

/** Is this row WAITING (the only kind a supervisor can tick for assignment)? */
function isWaiting(r: PickingQueueRow): boolean {
  return !r.isAssigned && !r.isDone && !r.isChecked;
}

/**
 * Drop ticks on bills that are no longer waiting on the board ("selection is pruned, not frozen" —
 * PICKING §10). Returns the SAME set when nothing changes, so React skips the render.
 */
export function pruneSelection(selected: ReadonlySet<number>, rows: readonly PickingQueueRow[]): ReadonlySet<number> {
  if (selected.size === 0) return selected;
  const waiting = new Set(rows.filter(isWaiting).map((r) => r.orderId));
  let changed = false;
  const next = new Set<number>();
  selected.forEach((id) => {
    if (waiting.has(id)) next.add(id);
    else changed = true;
  });
  return changed ? next : selected;
}

/** The row a sync answer gives for one id (undefined = not in the answer; null = off the board). */
export function patchRowFor(res: PickingSyncResult, id: number): PickingQueueRow | null | undefined {
  const p = res.patches.find((x) => x.id === id);
  return p === undefined ? undefined : p.row;
}

/** Stable comparison of two rows (key order independent). */
export function sameRow(a: PickingQueueRow | null | undefined, b: PickingQueueRow | null | undefined): boolean {
  const s = (v: unknown) =>
    JSON.stringify(v, (_k, val) =>
      val && typeof val === "object" && !Array.isArray(val)
        ? Object.keys(val as Record<string, unknown>)
            .sort()
            .reduce<Record<string, unknown>>((acc, k) => {
              acc[k] = (val as Record<string, unknown>)[k];
              return acc;
            }, {})
        : val,
    );
  return s(a ?? null) === s(b ?? null);
}
