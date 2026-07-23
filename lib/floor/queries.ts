// Floor Control — the four read feeds behind /floor. SELECT-only. Sequential
// awaits, never prisma.$transaction (CORE §3). Catalog is never touched here
// (the feeds are order-level aggregates); no sku id resolution, so the §13
// id-space landmine is not in play.
//
// THE SPLIT (design §3 / §6.4, the rule that governs everything):
//   - Left rail  = bills NOT yet released to the floor AND with no dispatch
//                  DECISION made. A bill enrichment successfully slotted is,
//                  by construction, already at pending_picking (enrichment's
//                  auto-done advanced it) with dispatchStatus="dispatch" — so
//                  it can never satisfy the rail predicate. No bill is in both.
//   - Floor      = released bills (dispatchStatus="dispatch") that are not yet
//                  pick_checked, plus today's checked. Floor's OWN carry-over
//                  scope — NOT lib/picking/queue.ts's WHERE.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getHideExclusion } from "@/lib/hide/visibility";
import { sortPickingQueue } from "@/lib/picking/sort";
import {
  STAGE_LADDER,
  PICKING_OPEN_STAGES,
  PICKING_ACTIVE_STAGES,
  PICK_ASSIGNED,
  PICK_DONE,
  PICK_CHECKED,
} from "@/lib/workflow-stages";
import { suggestSlot } from "./suggest";
import type {
  FloorScope,
  FloorRailCard,
  FloorBoardRow,
  FloorBoardResult,
  FloorHoldRow,
  FloorCancelledRow,
  FloorPicker,
  TintState,
  TintStage,
} from "./types";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// Pre-release stages (rank < 60 = before pending_picking). DERIVED from the
// ladder, never hand-written, so a new pre-picking stage joins automatically.
// order_created (10) is included for safety though import never writes it
// (route.ts:1102 creates orders at pending_support / pending_tint_assignment).
const RAIL_STAGES: string[] = STAGE_LADDER
  .filter((d) => d.rank !== null && d.rank < 60)
  .map((d) => d.stage);

// Step 3b — the render-time slot SUGGESTION is DEFERRED to Step 10 (after live
// sync), so the whole workflow can be tested before deciding what a good
// suggestion looks like. Flip this ONE constant to `true` to re-enable it;
// lib/floor/suggest.ts and the suggestSlot() call below are otherwise
// untouched, so Step 10 is a one-line switch, not a rewrite. Disabling it also
// removes the 23-Jul stale-date bug ("Release to Wed 16:00" on a Thursday)
// without patching it. The dispatch engine still auto-slots at enrichment —
// only this render-time rail hint is off.
const RAIL_SUGGESTIONS_ENABLED = false;

// Shared dealer projection — route/area/delivery-type/key-customer all come
// from the effective dealer's AREA (design §D3 / matches lib/picking/queue.ts).
const FLOOR_DEALER_SELECT = {
  id: true,
  customerName: true,
  isKeyCustomer: true,
  area: {
    select: {
      name: true,
      primaryRoute: { select: { name: true } },
      deliveryType: { select: { name: true } },
    },
  },
} as const;

// ── Date helpers (IST, UTC-midnight anchored — same basis as picking/queue) ──

function getISTTodayDateOnly(): Date {
  const istNow = new Date(Date.now() + IST_OFFSET_MS);
  return new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate()));
}

const DATE_STR_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Parse "YYYY-MM-DD" to a UTC-midnight Date (the @db.Date shape). Throws on a
 *  malformed or impossible calendar date so the route can surface a 400 rather
 *  than silently answer for the wrong day (mirrors picking's resolveTargetDate). */
export function parseFloorDate(dateStr: string): Date {
  if (!DATE_STR_RE.test(dateStr)) throw new Error(`Invalid date "${dateStr}" — expected YYYY-MM-DD`);
  const [y, m, d] = dateStr.split("-").map(Number);
  const dateOnly = new Date(Date.UTC(y, m - 1, d));
  if (dateOnly.toISOString().slice(0, 10) !== dateStr) throw new Error(`Invalid calendar date "${dateStr}"`);
  return dateOnly;
}

function istDayOf(date: Date | null): string | null {
  return date ? date.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) : null;
}

/** Whole IST days between an arrival timestamp and today, floored at 0. */
function arrivalAgeDays(arrival: Date | null, todayMs: number): number {
  const iso = istDayOf(arrival);
  if (!iso) return 0;
  const [y, m, d] = iso.split("-").map(Number);
  return Math.max(0, Math.floor((todayMs - Date.UTC(y, m - 1, d)) / MS_PER_DAY));
}

function inScope(deliveryType: string | null, scope: FloorScope): boolean {
  return scope === "All" || deliveryType === scope;
}

// ── Shared per-obd lookups ───────────────────────────────────────────────────

/** Bill-to dealer name per OBD, from import_raw_summary (latest row wins). Used
 *  for the "billed to {dealer}" sub-line on site bills (design §7.5 / §6.2). */
async function billToByObd(obdNumbers: string[]): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  if (obdNumbers.length === 0) return map;
  const rows = await prisma.import_raw_summary.findMany({
    where: { obdNumber: { in: obdNumbers } },
    select: { obdNumber: true, billToCustomerName: true },
    orderBy: { createdAt: "desc" },
  });
  for (const r of rows) {
    if (!map.has(r.obdNumber)) map.set(r.obdNumber, r.billToCustomerName);
  }
  return map;
}

// ── 0. PICKERS — active roster + current load, for the assignment bar ────────

/** Active picker-role users with their current "on hand" count (bills at
 *  pick_assigned). Read-only; drives the assign-bar dropdown (design §7.8).
 *  Two sequential reads, never $transaction (CORE §3). */
export async function getFloorPickers(): Promise<FloorPicker[]> {
  const pickers = await prisma.users.findMany({
    where: { role: { name: "picker" }, isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  if (pickers.length === 0) return [];

  const loads = await prisma.pick_assignments.groupBy({
    by: ["pickerId"],
    where: { order: { workflowStage: PICK_ASSIGNED, isRemoved: false } },
    _count: { _all: true },
  });
  const loadById = new Map(loads.map((l) => [l.pickerId, l._count._all]));

  return pickers.map((p) => ({ id: p.id, name: p.name, onHand: loadById.get(p.id) ?? 0 }));
}

// ── 1. RAIL — "needs your decision" ──────────────────────────────────────────

export async function getFloorRail(scope: FloorScope = "All"): Promise<FloorRailCard[]> {
  const hide = await getHideExclusion();
  const now = new Date();
  const todayMs = getISTTodayDateOnly().getTime();

  const orders = await prisma.orders.findMany({
    where: {
      AND: [
        { workflowStage: { in: RAIL_STAGES }, dispatchStatus: null, isRemoved: false },
        hide,
      ],
    },
    include: {
      customer: { select: FLOOR_DEALER_SELECT },
      shipToOverrideCustomer: { select: FLOOR_DEALER_SELECT },
      dispatchWindow: { select: { windowTime: true } },
      querySnapshot: { select: { articleTag: true, totalVolume: true } },
    },
  });

  const obds = orders.map((o) => o.obdNumber);
  const billTo = await billToByObd(obds);

  // Tint split counts + operator, one bulk read for the tint orders on the rail.
  const tintIds = orders.filter((o) => o.orderType === "tint").map((o) => o.id);
  const splits =
    tintIds.length > 0
      ? await prisma.order_splits.findMany({
          where: { orderId: { in: tintIds } },
          select: { orderId: true, status: true, assignedTo: { select: { name: true } } },
        })
      : [];
  const splitsByOrder = new Map<number, { status: string; op: string | null }[]>();
  for (const s of splits) {
    const arr = splitsByOrder.get(s.orderId) ?? [];
    arr.push({ status: s.status, op: s.assignedTo?.name ?? null });
    splitsByOrder.set(s.orderId, arr);
  }

  const cards: FloorRailCard[] = [];
  for (const order of orders) {
    const dealer = order.shipToOverrideCustomer ?? order.customer;
    const deliveryType = dealer?.area?.deliveryType?.name ?? null;
    if (!inScope(deliveryType, scope)) continue;

    const tint: TintState | null =
      order.orderType === "tint"
        ? buildTintState(order.workflowStage, splitsByOrder.get(order.id) ?? [])
        : null;

    cards.push({
      orderId: order.id,
      obdNumber: order.obdNumber,
      workflowStage: order.workflowStage,
      customerName: order.customer?.customerName ?? null,
      shipToOverrideName: order.shipToOverrideCustomer?.customerName ?? null,
      dealerName: dealer?.customerName ?? "(Unmatched)",
      billToName: billTo.get(order.obdNumber) ?? null,
      isShipToOverride: order.shipToOverrideCustomerId !== null,
      smu: order.smu,
      route: dealer?.area?.primaryRoute?.name ?? null,
      area: dealer?.area?.name ?? null,
      deliveryType,
      isKeyCustomer: dealer?.isKeyCustomer ?? false,
      priorityLevel: order.priorityLevel,
      isTint: order.orderType === "tint",
      volumeLitres: order.querySnapshot?.totalVolume ?? null,
      articleTag: order.querySnapshot?.articleTag ?? null,
      obdDateTime: (order.orderDateTime ?? order.obdEmailDate)?.toISOString() ?? null,
      ageDays: arrivalAgeDays(order.obdEmailDate ?? order.orderDateTime, todayMs),
      tint,
      suggestion: RAIL_SUGGESTIONS_ENABLED
        ? suggestSlot({
            smu: order.smu,
            deliveryType,
            emailDateTime: order.orderDateTime,
            punchDateTime: order.obdEmailDate,
            now,
          })
        : null,
      presetWindowTime: order.dispatchWindow?.windowTime ?? null,
      presetTargetDate: order.dispatchTargetDate ? order.dispatchTargetDate.toISOString().slice(0, 10) : null,
    });
  }

  // Oldest first, always (design §6.1). Nulls sink last.
  cards.sort((a, b) => {
    if (a.obdDateTime === b.obdDateTime) return a.obdNumber.localeCompare(b.obdNumber, "en");
    if (a.obdDateTime === null) return 1;
    if (b.obdDateTime === null) return -1;
    return a.obdDateTime < b.obdDateTime ? -1 : 1;
  });

  return cards;
}

function buildTintState(workflowStage: string, splits: { status: string; op: string | null }[]): TintState {
  const nonCancelled = splits.filter((s) => s.status !== "cancelled");
  const shadesTotal = nonCancelled.length;
  const shadesDone = nonCancelled.filter((s) => s.status === "tinting_done").length;
  const operatorName = nonCancelled.find((s) => s.op)?.op ?? null;

  let stage: TintStage;
  if (workflowStage === "pending_tint_assignment") stage = "waiting";
  else if (workflowStage === "tint_assigned") stage = "assigned";
  else if (workflowStage === "tinting_in_progress") stage = "mixing";
  else stage = "ready"; // pending_support = all splits done, awaiting release

  return { stage, shadesDone, shadesTotal, operatorName };
}

// ── 2. FLOOR — the live board (+ history mode) ───────────────────────────────

const FLOOR_BOARD_INCLUDE = {
  customer: { select: FLOOR_DEALER_SELECT },
  shipToOverrideCustomer: { select: FLOOR_DEALER_SELECT },
  dispatchWindow: { select: { id: true, windowTime: true, sortOrder: true } },
  querySnapshot: { select: { articleTag: true, totalVolume: true, totalWeight: true } },
  pickEarlyReleasedBy: { select: { name: true } },
  pickAssignment: {
    select: {
      pickerId: true,
      assignedAt: true,
      pickedAt: true,
      checkedAt: true,
      checkedBy: { select: { name: true } },
      picker: { select: { name: true } },
      assignedBy: { select: { name: true } },
    },
  },
} as const;

export async function getFloorBoard(
  opts: { mode?: "live" | "history"; date?: string; scope?: FloorScope } = {},
): Promise<FloorBoardResult> {
  const mode = opts.mode ?? "live";
  const scope = opts.scope ?? "All";
  const hide = await getHideExclusion();
  const todayDateOnly = getISTTodayDateOnly();

  // History anchors on the viewed day; live anchors on today.
  const anchorDate = mode === "history" && opts.date ? parseFloorDate(opts.date) : todayDateOnly;
  const anchorMs = anchorDate.getTime();
  const anchorIso = anchorDate.toISOString().slice(0, 10);

  // Floor's OWN scope filter — NOT buildPickingWhere().
  const base: Prisma.ordersWhereInput =
    mode === "history"
      ? {
          // What was PROMISED for that day (design §4.4): every released bill
          // dated D, any active stage. Read-only in the UI. Excludes legacy
          // 'closed' (PICKING_ACTIVE_STAGES omits it — workflow-stages.ts).
          dispatchStatus: "dispatch",
          isRemoved: false,
          dispatchTargetDate: anchorDate,
          workflowStage: { in: PICKING_ACTIVE_STAGES },
        }
      : {
          // Live: everything NOT yet pick_checked, whatever day it was due
          // (carry-over — Floor's fix over picking's rolling scope, design §4.2),
          // PLUS today's checked. Future-dated not-yet-checked rides along and
          // is separated by `zone` = upcoming per row.
          dispatchStatus: "dispatch",
          isRemoved: false,
          OR: [
            { workflowStage: { in: PICKING_OPEN_STAGES } },
            { workflowStage: PICK_CHECKED, dispatchTargetDate: todayDateOnly },
          ],
        };

  const orders = await prisma.orders.findMany({
    where: { AND: [base, hide] },
    include: FLOOR_BOARD_INCLUDE,
  });

  const activeWindows = await prisma.dispatch_slot_master.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
    select: { id: true, windowTime: true, sortOrder: true },
  });

  const billTo = await billToByObd(orders.map((o) => o.obdNumber));

  let rows: FloorBoardRow[] = [];
  for (const order of orders) {
    const dealer = order.shipToOverrideCustomer ?? order.customer;
    const deliveryType = dealer?.area?.deliveryType?.name ?? null;
    if (!inScope(deliveryType, scope)) continue;

    const targetDate = order.dispatchTargetDate;
    const noDispatchDate = targetDate === null;
    const isEarlyReleased = order.pickEarlyReleasedAt !== null;
    const zone: "due" | "upcoming" =
      !noDispatchDate && targetDate.getTime() > anchorMs && !isEarlyReleased ? "upcoming" : "due";
    const ageDays = noDispatchDate
      ? null
      : Math.max(0, Math.floor((anchorMs - targetDate.getTime()) / MS_PER_DAY));

    rows.push({
      orderId: order.id,
      obdNumber: order.obdNumber,
      dealerName: dealer?.customerName ?? "(Unmatched)",
      isShipToOverride: order.shipToOverrideCustomerId !== null,
      windowId: order.dispatchWindow?.id ?? null,
      windowTime: order.dispatchWindow?.windowTime ?? null,
      windowSortOrder: order.dispatchWindow?.sortOrder ?? null,
      deliveryType,
      route: dealer?.area?.primaryRoute?.name ?? null,
      area: dealer?.area?.name ?? null,
      priorityLevel: order.priorityLevel,
      isKeyCustomer: dealer?.isKeyCustomer ?? false,
      articleTag: order.querySnapshot?.articleTag ?? null,
      volumeLitres: order.querySnapshot?.totalVolume ?? null,
      weightKg: order.querySnapshot?.totalWeight ?? null,
      isTint: order.orderType === "tint",
      // Floor does not render product families — skip the catalog join; empties
      // are honest "not computed / not applicable" for this board.
      families: [],
      unresolvedLineCount: 0,
      obdDateTime: (order.orderDateTime ?? order.obdEmailDate)?.toISOString() ?? null,
      isAssigned: order.workflowStage === PICK_ASSIGNED,
      isDone: order.workflowStage === PICK_DONE,
      isChecked: order.workflowStage === PICK_CHECKED,
      assignedAt: order.pickAssignment?.assignedAt?.toISOString() ?? null,
      pickedAt: order.pickAssignment?.pickedAt?.toISOString() ?? null,
      checkedAt: order.pickAssignment?.checkedAt?.toISOString() ?? null,
      checkedByName: order.pickAssignment?.checkedBy?.name ?? null,
      pickerId: order.pickAssignment?.pickerId ?? null,
      assignedToName: order.pickAssignment?.picker?.name ?? null,
      assignedByName: order.pickAssignment?.assignedBy?.name ?? null,
      zone,
      noDispatchDate,
      ageDays,
      dispatchTargetDate: targetDate ? targetDate.toISOString().slice(0, 10) : null,
      isEarlyReleased,
      earlyReleasedByName: order.pickEarlyReleasedBy?.name ?? null,
      // Floor-only extras.
      smu: order.smu,
      billToName: billTo.get(order.obdNumber) ?? null,
    });
  }

  // Spine sort (reused, never copied). Cast back — sort returns the same objects.
  rows = sortPickingQueue(rows) as FloorBoardRow[];

  const dueRows = rows.filter((r) => r.zone !== "upcoming");
  const windows = activeWindows.map((w) => ({
    id: w.id,
    windowTime: w.windowTime,
    sortOrder: w.sortOrder,
    count: dueRows.filter((r) => r.windowId === w.id).length,
  }));

  return { mode, date: anchorIso, rows, windows, total: dueRows.length };
}

// ── 3. HOLD ──────────────────────────────────────────────────────────────────

export async function getFloorHold(scope: FloorScope = "All"): Promise<FloorHoldRow[]> {
  const hide = await getHideExclusion();
  const orders = await prisma.orders.findMany({
    where: { AND: [{ dispatchStatus: "hold", isRemoved: false }, hide] },
    include: {
      customer: { select: FLOOR_DEALER_SELECT },
      shipToOverrideCustomer: { select: FLOOR_DEALER_SELECT },
      querySnapshot: { select: { articleTag: true, totalVolume: true } },
    },
  });

  const billTo = await billToByObd(orders.map((o) => o.obdNumber));

  const rows: FloorHoldRow[] = [];
  for (const order of orders) {
    const dealer = order.shipToOverrideCustomer ?? order.customer;
    const deliveryType = dealer?.area?.deliveryType?.name ?? null;
    if (!inScope(deliveryType, scope)) continue;
    rows.push({
      orderId: order.id,
      obdNumber: order.obdNumber,
      dealerName: dealer?.customerName ?? "(Unmatched)",
      billToName: billTo.get(order.obdNumber) ?? null,
      isShipToOverride: order.shipToOverrideCustomerId !== null,
      smu: order.smu,
      route: dealer?.area?.primaryRoute?.name ?? null,
      area: dealer?.area?.name ?? null,
      deliveryType,
      isKeyCustomer: dealer?.isKeyCustomer ?? false,
      priorityLevel: order.priorityLevel,
      isTint: order.orderType === "tint",
      volumeLitres: order.querySnapshot?.totalVolume ?? null,
      articleTag: order.querySnapshot?.articleTag ?? null,
      obdDateTime: (order.orderDateTime ?? order.obdEmailDate)?.toISOString() ?? null,
      heldAt: order.heldAt?.toISOString() ?? null,
    });
  }

  // Recent first by default (design §8). Null heldAt sinks last.
  rows.sort((a, b) => {
    if (a.heldAt === b.heldAt) return 0;
    if (a.heldAt === null) return 1;
    if (b.heldAt === null) return -1;
    return a.heldAt < b.heldAt ? 1 : -1;
  });

  return rows;
}

// ── 4. CANCELLED (today only, design §9) ─────────────────────────────────────

export async function getFloorCancelled(scope: FloorScope = "All"): Promise<FloorCancelledRow[]> {
  const hide = await getHideExclusion();
  const todayIso = istDayOf(new Date());

  const orders = await prisma.orders.findMany({
    where: { AND: [{ workflowStage: "cancelled", isRemoved: false }, hide] },
    include: {
      customer: { select: FLOOR_DEALER_SELECT },
      shipToOverrideCustomer: { select: FLOOR_DEALER_SELECT },
      querySnapshot: { select: { articleTag: true, totalVolume: true } },
    },
  });

  // Cancel time + actor + reason come from the latest toStage="cancelled" log.
  const ids = orders.map((o) => o.id);
  const logs =
    ids.length > 0
      ? await prisma.order_status_logs.findMany({
          where: { orderId: { in: ids }, toStage: "cancelled" },
          orderBy: { createdAt: "desc" },
          select: { orderId: true, createdAt: true, note: true, changedBy: { select: { name: true } } },
        })
      : [];
  const latest = new Map<number, { createdAt: Date; note: string | null; name: string | null }>();
  for (const l of logs) {
    if (!latest.has(l.orderId)) latest.set(l.orderId, { createdAt: l.createdAt, note: l.note, name: l.changedBy?.name ?? null });
  }

  const billTo = await billToByObd(orders.map((o) => o.obdNumber));

  const rows: FloorCancelledRow[] = [];
  for (const order of orders) {
    const dealer = order.shipToOverrideCustomer ?? order.customer;
    const deliveryType = dealer?.area?.deliveryType?.name ?? null;
    if (!inScope(deliveryType, scope)) continue;

    const cancel = latest.get(order.id);
    // Today only — anchored to the cancellation day (design §9). Older ones live
    // in History. A currently-cancelled order with no cancel log is skipped.
    if (!cancel || istDayOf(cancel.createdAt) !== todayIso) continue;

    rows.push({
      orderId: order.id,
      obdNumber: order.obdNumber,
      dealerName: dealer?.customerName ?? "(Unmatched)",
      billToName: billTo.get(order.obdNumber) ?? null,
      isShipToOverride: order.shipToOverrideCustomerId !== null,
      smu: order.smu,
      route: dealer?.area?.primaryRoute?.name ?? null,
      area: dealer?.area?.name ?? null,
      deliveryType,
      isKeyCustomer: dealer?.isKeyCustomer ?? false,
      priorityLevel: order.priorityLevel,
      isTint: order.orderType === "tint",
      volumeLitres: order.querySnapshot?.totalVolume ?? null,
      articleTag: order.querySnapshot?.articleTag ?? null,
      obdDateTime: (order.orderDateTime ?? order.obdEmailDate)?.toISOString() ?? null,
      cancelledAt: cancel.createdAt.toISOString(),
      cancelledByName: cancel.name,
      reason: cancel.note,
    });
  }

  rows.sort((a, b) => (a.cancelledAt === b.cancelledAt ? 0 : (a.cancelledAt ?? "") < (b.cancelledAt ?? "") ? 1 : -1));
  return rows;
}
