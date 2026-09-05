// Tint Manager board — the pure shaping layer. No React, no fetch, no DOM.
//
// Turns the four arrays GET /api/tint/manager/orders returns into (a) the rail's
// pending list and (b) the table's per-operator groups, with the Seq ranks and
// the reorder-arrow enablement already resolved. Kept separate from the
// components so the grouping rule can be reasoned about (and later tested)
// without mounting anything.

import type {
  BoardGroup,
  BoardRow,
  BoardRowStatus,
  CompletedAssignment,
  SplitCard,
  TintBoardPayload,
  TintOrder,
} from "./types";

/**
 * Order WITHIN one operator's section (mockup callout §4): what they are doing
 * now, what is next, what is stuck, then what is finished.
 *
 * The mockup put Paused after the Assigned queue, and that is kept: a paused job
 * is not "next" — nobody can start it but its own operator, and only by
 * resuming. Sorting it above the queue would put an unactionable row at the top
 * of the one list the manager reads to decide what to hand out.
 */
const STATUS_ORDER: Record<BoardRowStatus, number> = {
  tinting_in_progress: 0,
  assigned:            1,
  paused:              2,
  tinting_done:        3,
};

function siteNameOf(o: { customer: { customerName: string } | null; shipToCustomerName?: string | null }): string {
  return o.customer?.customerName ?? o.shipToCustomerName ?? "—";
}

/**
 * A whole-OBD order's board status.
 *
 * `paused` lives on the ASSIGNMENT, not the order: the pause route deliberately
 * writes no workflowStage (verified in the diagnosis pass), so a paused job sits
 * at `tinting_in_progress` exactly like a running one. `pauseSummary
 * .currentlyPaused` — derived server-side from the assignment rows — is the only
 * thing that separates them.
 */
function orderStatus(o: TintOrder): BoardRowStatus | null {
  if (o.workflowStage === "tint_assigned") return "assigned";
  if (o.workflowStage === "tinting_in_progress") {
    return o.pauseSummary?.currentlyPaused ? "paused" : "tinting_in_progress";
  }
  return null;
}

function splitStatus(s: SplitCard): BoardRowStatus | null {
  if (s.status === "tint_assigned") return "assigned";
  if (s.status === "tinting_in_progress") return "tinting_in_progress";
  if (s.status === "tinting_done") return "tinting_done";
  return null;
}

/** The timestamp the status pill shows. */
function statusAtOf(status: BoardRowStatus, a?: { startedAt: string | null; completedAt: string | null; updatedAt: string }): string | null {
  if (!a) return null;
  if (status === "tinting_done") return a.completedAt;
  if (status === "tinting_in_progress" || status === "paused") return a.startedAt ?? a.updatedAt;
  return a.updatedAt;
}

function rowFromOrder(o: TintOrder, status: BoardRowStatus): BoardRow | null {
  const a = o.tintAssignments[0];
  if (!a) return null; // an assigned order with no live assignment row is not renderable
  return {
    key:             `order-${o.id}`,
    type:            "order",
    id:              o.id,
    orderId:         o.id,
    obdNumber:       o.obdNumber,
    soNumber:        o.soNumber ?? null,
    siteName:        siteNameOf(o),
    route:           o.route ?? null,
    volumeLitres:    o.querySnapshot?.totalVolume ?? null,
    articleTag:      o.articleTag ?? o.querySnapshot?.articleTag ?? null,
    splitNumber:     null,
    operatorId:      a.assignedTo.id,
    operatorName:    a.assignedTo.name ?? "—",
    status,
    statusAt:        statusAtOf(status, a),
    isUrgent:        o.priorityLevel <= 2,
    isKeyCustomer:   o.isKeyCustomer ?? false,
    customerMissing: o.customerMissing,
    pauseCount:      o.pauseSummary?.count ?? 0,
    skipCount:       o.skipSummary?.count ?? 0,
    seqRank:         null,
    canMoveUp:       false,
    canMoveDown:     false,
    // Bulk targets are whole ORDERS still WAITING. In-progress and paused are
    // excluded because the server now REJECTS them with a 400 (the upsert would
    // mint a second assignment row and orphan the first one's startedAt /
    // accumulatedMinutes / pauseCount / currentProgress), and a done job cannot
    // be moved at all. Splits are excluded because they reassign through a
    // different endpoint (/api/tint/manager/splits/reassign) — the bulk bar
    // drives the whole-order one only.
    selectable:      status === "assigned",
    order:           o,
  };
}

function rowFromSplit(s: SplitCard, status: BoardRowStatus): BoardRow {
  return {
    key:             `split-${s.id}`,
    type:            "split",
    id:              s.id,
    orderId:         s.order.id,
    obdNumber:       s.order.obdNumber,
    soNumber:        s.soNumber ?? null,
    siteName:        s.order.customer?.customerName ?? "—",
    route:           s.route ?? null,
    volumeLitres:    s.totalVolume,
    articleTag:      s.articleTag,
    splitNumber:     s.splitNumber,
    operatorId:      s.assignedTo.id,
    operatorName:    s.assignedTo.name ?? "—",
    status,
    statusAt:        status === "tinting_done" ? s.completedAt
                   : status === "tinting_in_progress" ? s.startedAt
                   : s.createdAt,
    isUrgent:        (s.priorityLevel ?? 5) <= 2,
    isKeyCustomer:   s.isKeyCustomer ?? false,
    customerMissing: false,
    // Splits never get pause/resume — the operator route rejects splitId !== null
    // with a 400 (CLAUDE_TINT §5). So these are structurally zero, not unknown.
    pauseCount:      0,
    skipCount:       0,
    seqRank:         null,
    canMoveUp:       false,
    canMoveDown:     false,
    selectable:      false,
    split:           s,
  };
}

function rowFromCompletedAssignment(a: CompletedAssignment): BoardRow {
  return {
    key:             `order-${a.order.id}`,
    type:            "order",
    id:              a.order.id,
    orderId:         a.order.id,
    obdNumber:       a.order.obdNumber,
    soNumber:        a.soNumber ?? null,
    siteName:        a.order.customer?.customerName ?? a.order.shipToCustomerName ?? "—",
    route:           a.route ?? null,
    volumeLitres:    a.order.querySnapshot?.totalVolume ?? null,
    articleTag:      a.articleTag ?? a.order.querySnapshot?.articleTag ?? null,
    splitNumber:     null,
    operatorId:      a.assignedTo.id,
    operatorName:    a.assignedTo.name ?? "—",
    status:          "tinting_done",
    statusAt:        a.completedAt,
    isUrgent:        false,
    isKeyCustomer:   a.isKeyCustomer ?? false,
    customerMissing: false,
    pauseCount:      0,
    skipCount:       0,
    seqRank:         null,
    canMoveUp:       false,
    canMoveDown:     false,
    selectable:      false,
    completed:       a,
  };
}

/**
 * The rail: orders still waiting for an operator, oldest first.
 *
 * Strictly `workflowStage === "pending_tint_assignment"`. The old Kanban ALSO
 * showed part-assigned orders here (remainingQty > 0 at a later stage), which
 * worked because a card could sit in two columns at once; one flat table has no
 * such affordance, and the remainder flow was reachable only through Create
 * Split, which this screen drops by scope decision.
 */
export function buildRail(payload: TintBoardPayload): TintOrder[] {
  return payload.orders
    .filter((o) => o.workflowStage === "pending_tint_assignment")
    .sort((a, b) => {
      const ta = a.orderDateTime ? Date.parse(a.orderDateTime) : 0;
      const tb = b.orderDateTime ? Date.parse(b.orderDateTime) : 0;
      if (ta !== tb) return ta - tb;              // oldest first
      return a.obdNumber.localeCompare(b.obdNumber);
    });
}

/**
 * The table: every job on the floor, grouped under the operator holding it.
 *
 * ⚠ SEQ IS RANKED PER OPERATOR **AND PER ROW TYPE**. `orders.sequenceOrder` and
 * `order_splits.sequenceOrder` are two different columns, and
 * app/api/tint/manager/reorder/route.ts swaps within one table or the other —
 * never across. An operator holding 2 orders and 1 split therefore sees the
 * orders ranked 1-2 and the split ranked 1, not a merged 1-3. Inventing a merged
 * rank would show arrows that cannot do what they promise.
 *
 * The rank is computed here rather than read from `sequenceOrder`, because that
 * column is a sparse MAX+1 value (assign/route.ts) and is frequently still at
 * its `0` default — it orders correctly but does not count.
 */
export function buildGroups(payload: TintBoardPayload): BoardGroup[] {
  const rows: BoardRow[] = [];

  for (const o of payload.orders) {
    const st = orderStatus(o);
    if (!st) continue;
    const r = rowFromOrder(o, st);
    if (r) rows.push(r);
  }
  for (const s of payload.activeSplits) {
    const st = splitStatus(s);
    if (st) rows.push(rowFromSplit(s, st));
  }
  for (const s of payload.completedSplits) {
    rows.push(rowFromSplit(s, "tinting_done"));
  }
  // Whole-OBD completions. De-duplicated against anything already present:
  // Set B (completed-today orders) and Set E (completed assignments) overlap in
  // the payload, and a bill must appear once.
  const seen = new Set(rows.map((r) => r.key));
  for (const a of payload.completedAssignments) {
    const r = rowFromCompletedAssignment(a);
    if (seen.has(r.key)) continue;
    seen.add(r.key);
    rows.push(r);
  }

  // ── Per-operator, per-type Seq ranks ──────────────────────────────────────
  for (const type of ["order", "split"] as const) {
    const byOperator = new Map<number, BoardRow[]>();
    for (const r of rows) {
      if (r.type !== type || r.status !== "assigned") continue;
      const list = byOperator.get(r.operatorId) ?? [];
      list.push(r);
      byOperator.set(r.operatorId, list);
    }
    for (const queue of Array.from(byOperator.values())) {
      // Same ORDER BY the reorder route's list query uses — [sequenceOrder asc,
      // createdAt asc] — so the rank the manager sees and the index the server
      // swaps on cannot disagree.
      queue.sort((a, b) => {
        const sa = (a.type === "order" ? a.order?.sequenceOrder : a.split?.sequenceOrder) ?? 0;
        const sb = (b.type === "order" ? b.order?.sequenceOrder : b.split?.sequenceOrder) ?? 0;
        if (sa !== sb) return sa - sb;
        const ca = Date.parse((a.type === "order" ? a.order?.createdAt : a.split?.createdAt) ?? "") || 0;
        const cb = Date.parse((b.type === "order" ? b.order?.createdAt : b.split?.createdAt) ?? "") || 0;
        return ca - cb;
      });
      queue.forEach((r, i) => {
        r.seqRank     = i + 1;
        r.canMoveUp   = i > 0;
        r.canMoveDown = i < queue.length - 1;
      });
    }
  }

  // ── Group by operator ─────────────────────────────────────────────────────
  const groups = new Map<number, BoardGroup>();
  for (const r of rows) {
    const g = groups.get(r.operatorId) ?? { operatorId: r.operatorId, operatorName: r.operatorName, rows: [] };
    g.rows.push(r);
    groups.set(r.operatorId, g);
  }

  const out = Array.from(groups.values());
  for (const g of out) {
    g.rows.sort((a, b) => {
      const pa = STATUS_ORDER[a.status];
      const pb = STATUS_ORDER[b.status];
      if (pa !== pb) return pa - pb;
      // Inside the waiting queue, the rank IS the order. Orders before splits so
      // the two independent 1..N sequences read as two blocks, not interleaved.
      if (a.status === "assigned") {
        if (a.type !== b.type) return a.type === "order" ? -1 : 1;
        return (a.seqRank ?? 0) - (b.seqRank ?? 0);
      }
      // Everything else: most recent first.
      return (Date.parse(b.statusAt ?? "") || 0) - (Date.parse(a.statusAt ?? "") || 0);
    });
  }
  // Operators alphabetical — a fixed order, so a section never jumps as work
  // moves (the same reason Floor's picker cards are alphabetical, not worst-first).
  out.sort((a, b) => a.operatorName.localeCompare(b.operatorName, "en"));
  return out;
}

/**
 * A stable signature of one operator's queue for ONE row type, used to tell a
 * real reorder from the route's silent boundary no-op.
 *
 * PATCH /api/tint/manager/reorder answers `200 { success: true }` and writes
 * NOTHING when the row is already top or bottom, so a caller that assumes
 * success would toast a move that never happened. Comparing this before and
 * after the refetch is the only way to know.
 */
export function queueSignature(groups: BoardGroup[], operatorId: number, type: "order" | "split"): string {
  const g = groups.find((x) => x.operatorId === operatorId);
  if (!g) return "";
  return g.rows
    .filter((r) => r.type === type && r.status === "assigned")
    .map((r) => r.key)
    .join(">");
}

/** Flat walk order for the detail panel's Prev/Next: rail cards, then table rows. */
export function panelSequence(rail: TintOrder[], groups: BoardGroup[]): Array<{ key: string; orderId: number }> {
  return [
    ...rail.map((o) => ({ key: `pending-${o.id}`, orderId: o.id })),
    ...groups.flatMap((g) => g.rows.map((r) => ({ key: r.key, orderId: r.orderId }))),
  ];
}
