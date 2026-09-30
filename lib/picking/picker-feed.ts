// lib/picking/picker-feed.ts — the picker face's view of the live change feed (live feed picking 4a).
//
// GET /api/live/changes?screen=picking&face=picker&held=<ids> hands a picker's phone only the order
// ids that concern HIM: assigned to the SESSION user now (pick_assignments.picker_id — never a
// client-supplied picker id), or in `held` — the ids his phone already shows, so a bill LEAVING him
// (unassigned, reassigned, approved away) still wakes it. The cursor still advances over every row,
// so nothing is replayed. Ids only either way; the filter is for battery and bandwidth.
// Plan: docs/prompts/drafts/code-plan-2026-09-30-picking-live-feed.md §D.2.

import { prisma } from "@/lib/prisma";

/** `ids` narrowed to those assigned to `pickerId` now, or in `held`. Keeps `ids` order. One indexed read. */
export async function filterPickerOrderIds(ids: number[], pickerId: number, held: readonly number[]): Promise<number[]> {
  if (ids.length === 0) return [];
  const heldSet = new Set(held);
  // uq_pick_assignments_order (order_id) — the page's ids are few.
  const mine = await prisma.pick_assignments.findMany({
    where: { orderId: { in: ids }, pickerId },
    select: { orderId: true },
  });
  const keep = new Set(mine.map((m) => m.orderId));
  return ids.filter((id) => keep.has(id) || heldSet.has(id));
}
