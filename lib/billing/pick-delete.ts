// lib/billing/pick-delete.ts
//
// ═══════════════════════════════════════════════════════════════════════════
// 🔴 BILLING "PICK DELETE" — the same-SO decision (2026-09-27, build step 5)
// ═══════════════════════════════════════════════════════════════════════════
//
// Design:  docs/prompts/drafts/web-update-2026-09-27-billing-pick-delete.md
// Plan:    docs/prompts/drafts/code-discovery-2026-09-27-pick-delete-build-plan.md §3
//
// OWNERSHIP. The duplicate-SO RULE is Picking's (lib/picking/duplicate-so.ts):
// every group read here goes through getTwinIdsBySo / getDuplicateGroups. The
// DECISION is Billing's: only this module writes pick_delete_decisions.
//
// REUSED, NOT COPIED: offFloorRefusal (lib/floor/off-floor.ts) · findLiveCi +
// liveCiRefusal (lib/ci/live-ci.ts) · buildCancelNote("duplicate_bill")
// (lib/picking/cancel-reasons.ts) · resolveCatalogByCode
// (lib/picking/resolve-lines.ts) · sendToUser (lib/push/send.ts). Floor's and
// Picking's ROUTES are never called — billing staff hold neither tick.
//
// Server-only (Prisma). Sequential awaits, never prisma.$transaction (CORE §3).
// orderIds / keptOrderIds are ALWAYS written sorted ascending — the partial
// unique index pick_delete_decisions_all_ok_live_key depends on it.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getDuplicateGroups, getTwinIdsBySo } from "@/lib/picking/duplicate-so";
import { offFloorRefusal } from "@/lib/floor/off-floor";
import { findLiveCi, liveCiRefusal } from "@/lib/ci/live-ci";
import { buildCancelNote } from "@/lib/picking/cancel-reasons";
import { resolveCatalogByCode } from "@/lib/picking/resolve-lines";
import { sendToUser } from "@/lib/push/send";
import { STAGE_LADDER, SUPPORT_DONE_OUTPUT } from "@/lib/workflow-stages";
import { istMonthRange } from "@/lib/billing/telephonic";
import type {
  PickDeleteBill,
  PickDeleteBillLines,
  PickDeleteDecidedRow,
  PickDeleteGroup,
  PickDeleteHint,
  PickDeleteList,
  PickDeleteMarker,
} from "@/lib/billing/pick-delete-types";

// ── Scope ──────────────────────────────────────────────────────────────────

/** A group shows only while at least one bill is still BEFORE dispatch. */
const AFTER_DISPATCH_STAGES = ["dispatched", "closed"];

/** Waiting for tint — the one tint stage Pick delete can cancel (offFloorRefusal
 *  refuses tint_assigned / tinting_in_progress). Its Undo goes back to the tint
 *  queue, every other bill to pending_picking (owner ruling 2026-09-27). */
const WAITING_FOR_TINT = "pending_tint_assignment";

function sortAsc(ids: readonly number[]): number[] {
  return [...ids].sort((a, b) => a - b);
}

function sameSet(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  const sa = sortAsc(a);
  const sb = sortAsc(b);
  return sa.every((v, i) => v === sb[i]);
}

function stageLabel(stage: string): string {
  return STAGE_LADDER.find((s) => s.stage === stage)?.label ?? stage;
}

/**
 * The open groups: SO → sorted live bill ids. Two bounded steps, never a scan
 * of the whole orders table:
 *   1. the distinct SO numbers of bills still before dispatch (not removed,
 *      not cancelled, not dispatched, not legacy closed);
 *   2. Picking's getDuplicateGroups over those SOs (≥ 2 live twins, minus
 *      groups covered by an active All OK), on idx_orders_sonumber.
 */
export async function getOpenGroups(): Promise<Map<string, number[]>> {
  const openRows = await prisma.orders.findMany({
    where: {
      isRemoved: false,
      workflowStage: { notIn: ["cancelled", ...AFTER_DISPATCH_STAGES] },
      soNumber: { not: null },
    },
    select: { soNumber: true },
    distinct: ["soNumber"],
  });
  return getDuplicateGroups(openRows.map((r) => r.soNumber));
}

// ── Refusal (Pick delete) ──────────────────────────────────────────────────

interface RefusalBill {
  id: number;
  workflowStage: string;
  tripDropId: number | null;
  tripNumber: string | null;
}

/**
 * Why this bill may NOT be pick deleted, or null. Floor cancel's refusals
 * (offFloorRefusal: cancelled, dispatched, on a trip, tint room) PLUS the
 * legacy `closed` stage and a live CI (owner rulings 2026-09-27; findLiveCi is
 * the rule Picking cancel uses). `twinIds` = the SO's current live bill ids.
 */
export async function pickDeleteRefusal(bill: RefusalBill, twinIds: readonly number[]): Promise<string | null> {
  const floor = offFloorRefusal({
    workflowStage: bill.workflowStage,
    tripDropId: bill.tripDropId,
    tripNumber: bill.tripNumber,
  });
  if (floor !== null) return floor;
  if (bill.workflowStage === "closed") return "Old closed bill — it cannot be pick deleted";
  if (twinIds.length < 2 || !twinIds.includes(bill.id)) return "No other live bill on this SO";
  const ci = await findLiveCi(bill.id);
  if (ci !== null) return liveCiRefusal(ci, "cancelled");
  return null;
}

// ── List ───────────────────────────────────────────────────────────────────

const BILL_SELECT = {
  id: true,
  obdNumber: true,
  soNumber: true,
  workflowStage: true,
  obdEmailDate: true,
  orderDateTime: true,
  invoiceNo: true,
  tripDropId: true,
  shipToCustomerName: true,
  updatedAt: true,
  tripDrop: { select: { trip: { select: { tripNumber: true } } } },
  customer: { select: { customerName: true } },
  shipToOverrideCustomer: { select: { customerName: true } },
  querySnapshot: { select: { totalVolume: true, articleTag: true } },
} satisfies Prisma.ordersSelect;

type BillRow = Prisma.ordersGetPayload<{ select: typeof BILL_SELECT }>;

function dealerOf(o: BillRow): string | null {
  // The board's chain: ship-to override, customer, SAP's own name.
  return o.shipToOverrideCustomer?.customerName ?? o.customer?.customerName ?? o.shipToCustomerName ?? null;
}

function punchedOf(o: BillRow): Date | null {
  return o.obdEmailDate ?? o.orderDateTime ?? null;
}

/** "sku|qty" keys, sorted — two bills with the same multiset read identical. */
function lineSignature(lines: { skuCodeRaw: string; unitQty: number }[]): string {
  return lines
    .map((l) => `${l.skuCodeRaw.trim()}|${l.unitQty}`)
    .sort()
    .join(",");
}

async function readBills(ids: number[]): Promise<Map<number, BillRow>> {
  if (ids.length === 0) return new Map();
  const rows = await prisma.orders.findMany({ where: { id: { in: ids } }, select: BILL_SELECT });
  return new Map(rows.map((r) => [r.id, r]));
}

export async function listPickDelete(month: string): Promise<PickDeleteList> {
  const range = istMonthRange(month);
  if (range === null) throw new Error(`Invalid month "${month}"`);

  // ── Open groups ──
  const groups = await getOpenGroups();
  const allIds = Array.from(groups.values()).flat();
  const billsById = await readBills(allIds);

  // ONE batched line read for the hint and the line counts.
  const obds = allIds.map((id) => billsById.get(id)?.obdNumber).filter((o): o is string => Boolean(o));
  const lineRows =
    obds.length > 0
      ? await prisma.import_raw_line_items.findMany({
          where: { obdNumber: { in: obds }, lineStatus: "active" },
          select: { obdNumber: true, skuCodeRaw: true, unitQty: true },
        })
      : [];
  const linesByObd = new Map<string, { skuCodeRaw: string; unitQty: number }[]>();
  for (const l of lineRows) {
    const list = linesByObd.get(l.obdNumber);
    if (list) list.push(l);
    else linesByObd.set(l.obdNumber, [l]);
  }

  const out: PickDeleteGroup[] = [];
  const groupEntries = Array.from(groups.entries());
  for (const [soNumber, ids] of groupEntries) {
    const rows = ids.map((id) => billsById.get(id)).filter((r): r is BillRow => r !== undefined);
    if (rows.length < 2) continue;

    const bills: PickDeleteBill[] = [];
    for (const r of rows) {
      const refusal = await pickDeleteRefusal(
        { id: r.id, workflowStage: r.workflowStage, tripDropId: r.tripDropId, tripNumber: r.tripDrop?.trip.tripNumber ?? null },
        ids,
      );
      const punched = punchedOf(r);
      bills.push({
        orderId: r.id,
        obdNumber: r.obdNumber,
        stage: r.workflowStage,
        stageLabel: stageLabel(r.workflowStage),
        punchedAt: punched ? punched.toISOString() : null,
        volume: r.querySnapshot?.totalVolume ?? null,
        articleTag: r.querySnapshot?.articleTag ?? null,
        lineCount: linesByObd.get(r.obdNumber)?.length ?? 0,
        invoiceNo: r.invoiceNo,
        tripNumber: r.tripDrop?.trip.tripNumber ?? null,
        refusal,
      });
    }

    const sigs = rows
      .map((r) => linesByObd.get(r.obdNumber) ?? [])
      .filter((ls) => ls.length > 0)
      .map(lineSignature);
    const hint: PickDeleteHint = new Set(sigs).size < sigs.length ? "double_punch" : "split";

    const punches = rows.map(punchedOf).filter((d): d is Date => d !== null).map((d) => d.getTime());
    out.push({
      soNumber,
      customerName: dealerOf(rows[0]),
      firstPunchAt: punches.length > 0 ? new Date(Math.min(...punches)).toISOString() : null,
      hint,
      orderIds: sortAsc(ids),
      bills,
    });
  }
  // Oldest group first; an unknown punch sorts last.
  out.sort((a, b) => (a.firstPunchAt ?? "9999").localeCompare(b.firstPunchAt ?? "9999"));

  // ── Decided list, the IST month, newest first ──
  const decisions = await prisma.pick_delete_decisions.findMany({
    where: { decidedAt: { gte: range.start, lt: range.end } },
    orderBy: [{ decidedAt: "desc" }, { id: "desc" }],
    select: {
      id: true, kind: true, soNumber: true, orderIds: true, deletedOrderId: true, keptOrderIds: true,
      decidedAt: true, undoneAt: true,
      decidedBy: { select: { name: true } },
      undoneBy: { select: { name: true } },
    },
  });
  const decidedIds = Array.from(new Set(decisions.flatMap((d) => d.orderIds)));
  const decidedBills = await readBills(decidedIds);
  const obdOf = (id: number) => decidedBills.get(id)?.obdNumber ?? `#${id}`;

  const decided: PickDeleteDecidedRow[] = decisions.map((d) => {
    const first = decidedBills.get(d.orderIds[0]);
    const deleted = d.deletedOrderId !== null ? decidedBills.get(d.deletedOrderId) : undefined;
    return {
      id: d.id,
      kind: d.kind === "pick_delete" ? "pick_delete" : "all_ok",
      soNumber: d.soNumber,
      customerName: first ? dealerOf(first) : null,
      obdNumbers: d.kind === "pick_delete" && d.deletedOrderId !== null ? [obdOf(d.deletedOrderId)] : d.orderIds.map(obdOf),
      keptObdNumbers: d.keptOrderIds.map(obdOf),
      decidedByName: d.decidedBy?.name ?? null,
      decidedAt: d.decidedAt.toISOString(),
      undoneByName: d.undoneBy?.name ?? null,
      undoneAt: d.undoneAt ? d.undoneAt.toISOString() : null,
      billStillCancelled: d.kind === "pick_delete" ? deleted?.workflowStage === "cancelled" : null,
    };
  });

  return { month, groups: out, decided };
}

// ── Marker ─────────────────────────────────────────────────────────────────

export async function getPickDeleteMarker(): Promise<PickDeleteMarker> {
  const groups = await getOpenGroups();
  const ids = Array.from(groups.values()).flat();

  const dec = await prisma.pick_delete_decisions.aggregate({ _max: { updatedAt: true } });
  const ord =
    ids.length > 0
      ? await prisma.orders.aggregate({ where: { id: { in: ids } }, _max: { updatedAt: true } })
      : null;

  const times = [dec._max.updatedAt, ord?._max.updatedAt ?? null]
    .filter((d): d is Date => d !== null)
    .map((d) => d.getTime());
  return {
    count: groups.size,
    latest: times.length > 0 ? new Date(Math.max(...times)).toISOString() : null,
  };
}

// ── Lines for one bill ─────────────────────────────────────────────────────

/** The billing Picking order route's line read, under this tab's own gate. */
export async function getPickDeleteBillLines(orderId: number): Promise<PickDeleteBillLines | null> {
  const order = await prisma.orders.findFirst({
    where: { id: orderId, isRemoved: false },
    select: { id: true, obdNumber: true },
  });
  if (!order) return null;

  const rawLines = await prisma.import_raw_line_items.findMany({
    where: { obdNumber: order.obdNumber, lineStatus: "active" },
    select: { id: true, skuCodeRaw: true, skuDescriptionRaw: true, unitQty: true, volumeLine: true, isTinting: true },
    orderBy: { lineId: "asc" },
  });
  // sku_master_v2 by `material` ONLY — never enrichedLineItem.sku (CORE §13).
  const catalog = await resolveCatalogByCode(rawLines.map((l) => l.skuCodeRaw));

  return {
    orderId: order.id,
    obdNumber: order.obdNumber,
    lines: rawLines.map((l) => {
      const cat = catalog.get(l.skuCodeRaw);
      return {
        id: l.id,
        sku: l.skuCodeRaw,
        name: cat?.name ?? l.skuDescriptionRaw ?? null,
        pack: cat?.pack ?? null,
        unitQty: l.unitQty,
        volumeLine: l.volumeLine,
        isTinting: l.isTinting,
      };
    }),
  };
}

// ── Writes ─────────────────────────────────────────────────────────────────

export type WriteResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

function isP2002(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/** All OK — saved against the SO's current live set, which must equal `orderIds`. */
export async function markAllOk(args: {
  soNumber: string;
  orderIds: number[];
  userId: number;
}): Promise<WriteResult<{ decisionId: number }>> {
  const twins = (await getTwinIdsBySo([args.soNumber])).get(args.soNumber) ?? [];
  if (twins.length < 2 || !sameSet(twins, args.orderIds)) {
    return { ok: false, status: 409, error: "Group changed — refresh" };
  }
  try {
    const row = await prisma.pick_delete_decisions.create({
      data: {
        soNumber: args.soNumber,
        kind: "all_ok",
        orderIds: sortAsc(twins),
        decidedById: args.userId,
      },
      select: { id: true },
    });
    return { ok: true, data: { decisionId: row.id } };
  } catch (err) {
    if (isP2002(err)) return { ok: false, status: 409, error: "Already marked All OK" };
    throw err;
  }
}

/**
 * Pick delete — cancel ONE bill of a same-SO group as a duplicate.
 *
 * 🔴 WRITE ORDER: CLAIM → CANCEL → CLEAN-UP → PUSH (the lib/ci/auto.ts shape:
 * take the unique thing first, then write; a P2002 means someone else did).
 *
 *   1. CLAIM — insert the decision row. The partial unique index
 *      pick_delete_decisions_deleted_live_key ("deletedOrderId" WHERE
 *      kind='pick_delete' AND "undoneAt" IS NULL) makes it the lock: a double
 *      press or a second billing user gets P2002 → 409, and writes nothing.
 *      Because the claim precedes the cancel, there can never be a cancelled
 *      bill with no decision row.
 *   2. CANCEL — ONE orders.updateMany guarded on the stage we read
 *      ({ id, workflowStage: fromStage, isRemoved: false }). Zero rows (the
 *      bill moved under us) or a throw → the claim is REMOVED (it never took
 *      effect, so it is not history) and the answer is 409 / the error. That is
 *      the only path that deletes a decision row. If that delete itself fails,
 *      the orphan claim is logged loudly — and /undo heals it (a decision whose
 *      bill is not cancelled is only stamped undone).
 *   3. CLEAN-UP — pick_assignments.deleteMany (AFTER the stage write, the floor
 *      cancel's orphan fix), then ONE order_status_logs row. The bill is
 *      already cancelled and recorded; a failure here is logged and swallowed.
 *   4. PUSH — to the picker who held it (read BEFORE the assignment delete),
 *      unless that picker pressed it. Awaited, swallowed.
 */
export async function pickDelete(args: {
  orderId: number;
  userId: number;
}): Promise<WriteResult<{ decisionId: number; obdNumber: string; keptObdNumbers: string[]; warning?: string }>> {
  // ── Read (picker FIRST — the assignment row is deleted in step 3) ──
  const order = await prisma.orders.findUnique({
    where: { id: args.orderId },
    select: {
      id: true,
      obdNumber: true,
      soNumber: true,
      workflowStage: true,
      isRemoved: true,
      tripDropId: true,
      tripDrop: { select: { trip: { select: { tripNumber: true } } } },
      pickAssignment: { select: { pickerId: true } },
    },
  });
  if (!order || order.isRemoved) return { ok: false, status: 404, error: "Bill not found" };
  const soNumber = order.soNumber;
  if (soNumber === null || soNumber.trim() === "") {
    return { ok: false, status: 409, error: "This bill has no SO number" };
  }

  const twins = (await getTwinIdsBySo([soNumber])).get(soNumber) ?? [];
  const refusal = await pickDeleteRefusal(
    {
      id: order.id,
      workflowStage: order.workflowStage,
      tripDropId: order.tripDropId,
      tripNumber: order.tripDrop?.trip.tripNumber ?? null,
    },
    twins,
  );
  if (refusal !== null) return { ok: false, status: 409, error: refusal };

  const orderIds = sortAsc(twins);
  const keptOrderIds = orderIds.filter((id) => id !== order.id);
  const fromStage = order.workflowStage;
  const pickerId = order.pickAssignment?.pickerId ?? null;

  // ── 1. CLAIM ──
  let decisionId: number;
  try {
    const row = await prisma.pick_delete_decisions.create({
      data: {
        soNumber,
        kind: "pick_delete",
        orderIds,
        deletedOrderId: order.id,
        deletedFromStage: fromStage,
        deletedPickerId: pickerId,
        keptOrderIds,
        decidedById: args.userId,
      },
      select: { id: true },
    });
    decisionId = row.id;
  } catch (err) {
    if (isP2002(err)) return { ok: false, status: 409, error: "This bill is already pick deleted" };
    throw err;
  }

  // ── 2. CANCEL — one orders write, guarded on the stage read above ──
  const releaseClaim = async () => {
    try {
      await prisma.pick_delete_decisions.delete({ where: { id: decisionId } });
    } catch (err) {
      console.error(
        `[pick-delete] OBD ${order.obdNumber}: cancel did not land AND the claim #${decisionId} could not be removed — undo it from the Decided list:`,
        err,
      );
    }
  };
  let cancelled: number;
  try {
    const res = await prisma.orders.updateMany({
      where: { id: order.id, workflowStage: fromStage, isRemoved: false },
      data: { workflowStage: "cancelled", dispatchStatus: null },
    });
    cancelled = res.count;
  } catch (err) {
    await releaseClaim();
    throw err;
  }
  if (cancelled === 0) {
    await releaseClaim();
    return { ok: false, status: 409, error: "The bill changed — refresh" };
  }

  // ── 3. CLEAN-UP — the bill is cancelled and recorded from here on ──
  let warning: string | undefined;
  try {
    await prisma.pick_assignments.deleteMany({ where: { orderId: order.id } });
    await prisma.order_status_logs.create({
      data: {
        orderId: order.id,
        fromStage,
        toStage: "cancelled",
        changedById: args.userId,
        note: buildCancelNote("duplicate_bill"),
      },
    });
  } catch (err) {
    console.error(`[pick-delete] OBD ${order.obdNumber}: cancelled, but the assignment delete or log failed:`, err);
    warning = "The bill was cancelled, but its picker assignment or log line could not be written.";
  }

  // "Correct pick" OBDs — the survivors, read live.
  let keptObdNumbers: string[] = [];
  try {
    const kept = await prisma.orders.findMany({
      where: { id: { in: keptOrderIds } },
      select: { obdNumber: true },
      orderBy: { id: "asc" },
    });
    keptObdNumbers = kept.map((k) => k.obdNumber);
  } catch (err) {
    console.error(`[pick-delete] OBD ${order.obdNumber}: could not read the kept OBDs:`, err);
  }

  // ── 4. PUSH — never fails the action ──
  if (pickerId !== null && pickerId !== args.userId) {
    try {
      await sendToUser(pickerId, {
        title: "Bill pick deleted",
        body: `Bill ${order.obdNumber} pick deleted. Correct pick ${keptObdNumbers.join(", ")}`,
        tag: `pick-deleted-${order.id}`,
        url: "/picking",
      });
    } catch (err) {
      console.error(`[pick-delete] OBD ${order.obdNumber}: push failed (non-fatal):`, err);
    }
  }

  return { ok: true, data: { decisionId, obdNumber: order.obdNumber, keptObdNumbers, ...(warning ? { warning } : {}) } };
}

/**
 * Undo either kind.
 *   all_ok       → stamp undone; the flag returns on the next rule read.
 *   pick_delete  → if the bill is still cancelled: refuse on a live CI, else
 *                  restore it (pending_tint_assignment + null status for a bill
 *                  deleted while waiting for tint; pending_picking + 'dispatch'
 *                  for every other bill — owner rulings 2026-09-27), ONE log,
 *                  then stamp undone. If the bill was already restored elsewhere,
 *                  only stamp undone.
 * Bill first, decision second: if the stamp fails after the restore, a retry
 * finds the bill live and only stamps — it heals itself.
 */
export async function undoDecision(args: {
  decisionId: number;
  userId: number;
}): Promise<WriteResult<{ restored: boolean }>> {
  const d = await prisma.pick_delete_decisions.findUnique({
    where: { id: args.decisionId },
    select: { id: true, kind: true, undoneAt: true, deletedOrderId: true, deletedFromStage: true },
  });
  if (!d) return { ok: false, status: 404, error: "Decision not found" };
  if (d.undoneAt !== null) return { ok: false, status: 409, error: "Already undone" };

  const stamp = async (): Promise<boolean> => {
    const res = await prisma.pick_delete_decisions.updateMany({
      where: { id: d.id, undoneAt: null },
      data: { undoneAt: new Date(), undoneById: args.userId },
    });
    return res.count > 0;
  };

  if (d.kind === "all_ok" || d.deletedOrderId === null) {
    return (await stamp()) ? { ok: true, data: { restored: false } } : { ok: false, status: 409, error: "Already undone" };
  }

  const order = await prisma.orders.findUnique({
    where: { id: d.deletedOrderId },
    select: { id: true, obdNumber: true, workflowStage: true, isRemoved: true },
  });

  let restored = false;
  if (order && !order.isRemoved && order.workflowStage === "cancelled") {
    const ci = await findLiveCi(order.id);
    if (ci !== null) return { ok: false, status: 409, error: liveCiRefusal(ci, "released") };

    const toTint = d.deletedFromStage === WAITING_FOR_TINT;
    const toStage = toTint ? WAITING_FOR_TINT : SUPPORT_DONE_OUTPUT;
    const res = await prisma.orders.updateMany({
      where: { id: order.id, workflowStage: "cancelled", isRemoved: false },
      data: { workflowStage: toStage, dispatchStatus: toTint ? null : "dispatch" },
    });
    if (res.count > 0) {
      restored = true;
      try {
        await prisma.order_status_logs.create({
          data: {
            orderId: order.id,
            fromStage: "cancelled",
            toStage,
            changedById: args.userId,
            note: "Restored — pick delete undone",
          },
        });
      } catch (err) {
        console.error(`[pick-delete] OBD ${order.obdNumber}: restored, but the log line failed:`, err);
      }
    }
  }

  return (await stamp()) ? { ok: true, data: { restored } } : { ok: false, status: 409, error: "Already undone" };
}
