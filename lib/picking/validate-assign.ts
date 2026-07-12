import type { PickingQueueRow } from "./types";

// No-jump guard (web-update-2026-07-12-picking-queue-v1-design-locked.md, §"No-jump
// guard"). A valid assign selection is EXACTLY the top N waiting rows of ONE dispatch
// window, in the queue's own spine order — never a middle chunk, never a skipped row 1,
// never a row that's already assigned. Pure — no Prisma, no sorting, no DB access, so
// this is trivially unit-testable in isolation; the caller supplies an already-sorted,
// already-unassigned-filtered row list (a fresh getPickingQueue().rows read, never a
// second hand-rolled sort). Route-boundary is deliberately NOT enforced — a clean top
// run may span multiple route blocks (V1 locked decision).
export interface TopPrefixCheck {
  ok: boolean;
  reason?: string;
}

export function validateTopPrefixSelection(
  orderIds: number[],
  waitingRows: PickingQueueRow[],
): TopPrefixCheck {
  if (orderIds.length === 0) {
    return { ok: false, reason: "No orders selected." };
  }

  const requested = new Set(orderIds);
  if (requested.size !== orderIds.length) {
    return { ok: false, reason: "Duplicate orderId in selection." };
  }

  // Every requested id must currently be a genuinely WAITING row — an already-assigned
  // (or otherwise vanished) id can never be part of a valid prefix.
  const rowById = new Map(waitingRows.map((r) => [r.orderId, r]));
  const firstMissing = orderIds.find((id) => !rowById.has(id));
  if (firstMissing !== undefined) {
    return { ok: false, reason: `Order ${firstMissing} is not currently waiting in the queue.` };
  }

  // All requested rows must belong to the SAME dispatch window — a batch can't
  // straddle two windows' waiting lines.
  const windowIds = new Set(orderIds.map((id) => rowById.get(id)!.windowId));
  if (windowIds.size > 1) {
    return { ok: false, reason: "Selection spans more than one dispatch window." };
  }
  const [windowId] = Array.from(windowIds);

  // The requested set must equal EXACTLY the first N waiting rows of that window, in
  // the spine's own order — a gap, a skipped row 1, or a non-prefix run all fail here.
  // Route-boundary is intentionally not checked — a clean top run may cross route blocks.
  const windowWaitingIds = waitingRows
    .filter((r) => r.windowId === windowId)
    .map((r) => r.orderId);
  const topN = windowWaitingIds.slice(0, orderIds.length);
  const matches = topN.length === orderIds.length && topN.every((id) => requested.has(id));
  if (!matches) {
    return {
      ok: false,
      reason: "Selection must start from the top of the queue — refresh and try again.",
    };
  }

  return { ok: true };
}
