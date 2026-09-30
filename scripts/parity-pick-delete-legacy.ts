// scripts/parity-pick-delete-legacy.ts — FROZEN REFERENCE, used only by scripts/parity-pick-delete.ts.
//
// The Pick delete READ path exactly as it was before the bounded rewrite
// (lib/billing/pick-delete.ts at 48a5e978, lines 24-90 and 156-421, copied
// verbatim; only the imports below were adjusted and the exports renamed
// *Legacy). pickDeleteCheck is imported from the live module — that function
// did not change. Never import this file from app code.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getDuplicateGroups } from "@/lib/picking/duplicate-so";
import { pickDeleteCheck, type PickDeleteCheck } from "@/lib/billing/pick-delete";
import { resolveCatalogByCode, type CatalogEntry } from "@/lib/picking/resolve-lines";
import { groupPickingDetailLines } from "@/lib/picking/group-lines";
import { STAGE_LADDER } from "@/lib/workflow-stages";
import { istMonthRange } from "@/lib/billing/telephonic";
import type {
  PickDeleteBill,
  PickDeleteBillLines,
  PickDeleteDecidedRow,
  PickDeleteGroup,
  PickDeleteHint,
  PickDeleteLine,
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
export async function getOpenGroupsLegacy(): Promise<Map<string, number[]>> {
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
// ── Lines (shared by the list and GET bill/[orderId]) ──────────────────────

/** The import_raw_line_items columns a bill's lines table needs. */
const LINE_SELECT = {
  id: true,
  skuCodeRaw: true,
  skuDescriptionRaw: true,
  unitQty: true,
  volumeLine: true,
  netWeight: true,
  totalWeight: true,
  articleTag: true,
  isTinting: true,
} satisfies Prisma.import_raw_line_itemsSelect;

type RawBillLine = Prisma.import_raw_line_itemsGetPayload<{ select: typeof LINE_SELECT }>;

/**
 * One bill's raw lines (lineId order) → the tab's lines. PURE. SAP per-batch
 * split lines are MERGED per SKU (qty summed) by Picking's own grouping
 * (lib/picking/group-lines.ts) — the tab compares bills SKU by SKU, so it must
 * never see raw batch rows. No findings map: this tab records none, so every
 * same-SKU bucket merges and each SKU is exactly one line.
 */
function mergeBillLines(rawLines: readonly RawBillLine[], catalog: Map<string, CatalogEntry>): PickDeleteLine[] {
  const tintingById = new Map(rawLines.map((l) => [l.id, l.isTinting]));
  return groupPickingDetailLines(rawLines, catalog, new Map()).map((l) => ({
    id: l.id,
    sku: l.sku,
    name: l.name,
    pack: l.pack,
    unitQty: l.qty,
    volumeLine: l.litres,
    // Same across a merged bucket (group-lines.ts: isTinting differed in zero
    // live groups), so the head line's value stands for the row.
    isTinting: tintingById.get(l.id) ?? false,
  }));
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

/**
 * 🔴 THE ONE "WHICH GROUPS SHOW" RULE — the list AND the marker count both call
 * this, so the pill number always equals the groups on the tab (owner,
 * 2026-09-27). A group shows ONLY when at least one of its bills passes
 * pickDeleteCheck() — a group billing cannot act on (every bill on a trip,
 * dispatched, in the tint room, legacy closed or with a live CI) is not work.
 * A shown group keeps ALL its bills: the one that cannot go is still needed to
 * compare against. Replaced "at least one bill before dispatch" the same day.
 *
 * Picking's red Same SO flag is NOT this rule and does not change
 * (lib/picking/duplicate-so.ts) — a hidden group still flags on the boards.
 */
export async function getActionableGroupsLegacy(): Promise<{
  /** SO → sorted live bill ids, shown groups only. */
  groups: Map<string, number[]>;
  /** Every open group's bill ids, shown or not — the marker's clock watches all. */
  openIds: number[];
  billsById: Map<number, BillRow>;
  checks: Map<number, PickDeleteCheck>;
}> {
  const open = await getOpenGroupsLegacy();
  const openIds = Array.from(open.values()).flat();
  const billsById = await readBills(openIds);
  const checks = new Map<number, PickDeleteCheck>();
  const groups = new Map<string, number[]>();
  for (const [soNumber, ids] of Array.from(open.entries())) {
    let any = false;
    for (const id of ids) {
      const r = billsById.get(id);
      if (!r) continue;
      // Sequential awaits (CORE §3). The CI read only runs for a bill that
      // passed the cheap stage/trip checks first.
      const check = await pickDeleteCheck(
        { id: r.id, workflowStage: r.workflowStage, tripDropId: r.tripDropId, tripNumber: r.tripDrop?.trip.tripNumber ?? null },
        ids,
      );
      checks.set(id, check);
      if (check.canDelete) any = true;
    }
    if (any) groups.set(soNumber, ids);
  }
  return { groups, openIds, billsById, checks };
}

export async function listPickDeleteLegacy(month: string): Promise<PickDeleteList> {
  const range = istMonthRange(month);
  if (range === null) throw new Error(`Invalid month "${month}"`);

  // ── Open groups — only those billing can act on (getActionableGroups) ──
  const { groups, billsById, checks } = await getActionableGroupsLegacy();
  const allIds = Array.from(groups.values()).flat();

  // ONE batched line read for EVERY shown bill (hint, line counts AND the cards'
  // lines tables), then ONE catalog resolution for every SKU — lines ship with
  // the list since 2026-09-27; the per-bill fetch was too slow. lineId order is
  // kept per OBD, which groupPickingDetailLines needs.
  const obds = allIds.map((id) => billsById.get(id)?.obdNumber).filter((o): o is string => Boolean(o));
  const lineRows =
    obds.length > 0
      ? await prisma.import_raw_line_items.findMany({
          where: { obdNumber: { in: obds }, lineStatus: "active" },
          select: { obdNumber: true, ...LINE_SELECT },
          orderBy: [{ obdNumber: "asc" }, { lineId: "asc" }],
        })
      : [];
  const linesByObd = new Map<string, RawBillLine[]>();
  for (const l of lineRows) {
    const list = linesByObd.get(l.obdNumber);
    if (list) list.push(l);
    else linesByObd.set(l.obdNumber, [l]);
  }
  // sku_master_v2 by `material` ONLY — never enrichedLineItem.sku (CORE §13).
  const catalog = await resolveCatalogByCode(lineRows.map((l) => l.skuCodeRaw));

  const out: PickDeleteGroup[] = [];
  const groupEntries = Array.from(groups.entries());
  for (const [soNumber, ids] of groupEntries) {
    const rows = ids.map((id) => billsById.get(id)).filter((r): r is BillRow => r !== undefined);
    if (rows.length < 2) continue;

    const bills: PickDeleteBill[] = [];
    for (const r of rows) {
      // THE SAME rule pickDelete() runs before it writes — one function, already
      // run once per bill by getActionableGroups.
      const check = checks.get(r.id) ?? { canDelete: false, label: null, message: null };
      const punched = punchedOf(r);
      bills.push({
        orderId: r.id,
        obdNumber: r.obdNumber,
        stage: r.workflowStage,
        stageLabel: stageLabel(r.workflowStage),
        punchedAt: punched ? punched.toISOString() : null,
        volume: r.querySnapshot?.totalVolume ?? null,
        articleTag: r.querySnapshot?.articleTag ?? null,
        // DISTINCT SKUs, not raw rows — the count of the tab's lines table, whose
        // SAP batch splits are merged per SKU (mergeBillLines).
        lineCount: new Set((linesByObd.get(r.obdNumber) ?? []).map((l) => l.skuCodeRaw)).size,
        lines: mergeBillLines(linesByObd.get(r.obdNumber) ?? [], catalog),
        invoiceNo: r.invoiceNo,
        tripNumber: r.tripDrop?.trip.tripNumber ?? null,
        canDelete: check.canDelete,
        reason: check.label,
        refusal: check.message,
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

export async function getPickDeleteMarkerLegacy(): Promise<PickDeleteMarker> {
  // count = the SHOWN groups (the same function the list uses); the clock
  // watches every open group's bills, so a hidden group becoming actionable
  // (e.g. a bill taken off a trip) still moves `latest`.
  const { groups, openIds: ids } = await getActionableGroupsLegacy();

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
