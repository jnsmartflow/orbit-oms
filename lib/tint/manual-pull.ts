// lib/tint/manual-pull.ts
//
// "+ Add to Tint" — THE SERVER HALF (2026-10-24, Add to Tint server build). The
// reads behind the lookup and the writes behind the pull. The rules are pure,
// in ./manual-pull-rules.ts; the two routes are thin:
//   GET  /api/tint/manager/manual-entry/lookup  → lookupManualPull
//   POST /api/tint/manager/manual-entry         → applyManualPull
//
// 🔴 THE LOOKUP DOES NOT USE billLookupWhere (lib/trips/find-bill.ts). That
// WHERE hides removed, admin-hidden and challan-linked bills, so a bill that
// exists would come back "not found" — the wrong answer. The term parse and
// the invoice-row read ARE shared (parseBillLookupTerm, invoiceRowMatches);
// every bill found is then JUDGED (judgePull) and reported with its reason.
//
// 🔴 THE PULL'S WRITE ORDER (design 2026-10-24), sequential, never
// prisma.$transaction (CORE §3):
//   0. READS: every check again, the picker (BEFORE his row is deleted), the
//      bill's trips, and the operator plan — a refused operator stops the pull
//      before anything is written
//   1. line flags (import_raw_line_items.isTinting) + summary hasTinting
//   2. tint_assignments, when an operator is chosen (lib/tint/assign.ts)
//   3. ONE orders.update (buildPullData) — through setRowsTrip when the bill is
//      on a trip, so the trip detach is the same write
//   4. pick_assignments delete (takeBillOffPicker: write first, delete second)
//      2b. tint_logs for the operator, right after the stage write — the order
//          the assign route uses (assignment row → stage → tint_logs)
//   5. emptied stops deleted; ONE trip_activity row per trip left
//   6. ONE order_status_logs row naming everything that happened
//   7. manual_tint_entries (action pulled_in)
//   8. the delivery challan, CHALLAN_ELIGIBLE_SMU only, non-fatal
//   9. the push, only if a picker held the bill — awaited, fully swallowed, and
//      NO orders write (the markers key on MAX(orders.updatedAt))

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { CHALLAN_ELIGIBLE_SMU } from "@/lib/import-upsert/types";
import { INVOICE_SOURCE } from "@/lib/order-invoices/source";
import { setRowsTrip } from "@/lib/order-invoices/trip-link";
import { findLiveCi, liveCiRefusal } from "@/lib/ci/live-ci";
import { takeBillOffPicker } from "@/lib/picking/unassign";
import { getPickingSupervisorUserIds } from "@/lib/push/recipients";
import { sendToUser } from "@/lib/push/send";
import { invoiceRowMatches, parseBillLookupTerm, type BillLookupTerm } from "@/lib/trips/find-bill";
import { deleteTripDropIfEmpty } from "@/lib/trips/drop";
import { logTripBills } from "@/lib/trips/activity";
import {
  nextTintSequenceOrder,
  planTintAssign,
  tintAssignLogNote,
  writeTintAssignLog,
  writeTintAssignmentRow,
} from "@/lib/tint/assign";
import {
  buildPullData,
  invoiceOfObdNote,
  judgePull,
  pullLookupWhere,
  pullPushRecipients,
  pullStatusNote,
  type PullFacts,
  type PullRefusalCode,
} from "./manual-pull-rules";

// ── The reads ────────────────────────────────────────────────────────────────

const PULL_ORDER_SELECT = {
  id: true,
  obdNumber: true,
  isRemoved: true,
  isActive: true,
  isChallanOrder: true,
  workflowStage: true,
  orderType: true,
  smu: true,
  orderDateTime: true,
  dispatchSlotSource: true,
  customerMissing: true,
  sampleAt: true,
  tripDropId: true,
  shipToCustomerName: true,
  customer: { select: { customerName: true } },
  shipToOverrideCustomer: { select: { customerName: true } },
  pickAssignment: { select: { pickerId: true, picker: { select: { name: true } } } },
  // orders."tripDropId" alone, for an OBD with no invoice rows (trip-link.ts noRows).
  tripDrop: { select: { id: true, tripId: true, trip: { select: { tripNumber: true, sentToBillingAt: true } } } },
  invoices: {
    orderBy: { seq: "asc" },
    select: {
      id: true,
      seq: true,
      invoiceNo: true,
      source: true,
      isDispatched: true,
      tripDropId: true,
      tripDrop: { select: { id: true, tripId: true, trip: { select: { tripNumber: true, sentToBillingAt: true } } } },
    },
  },
} satisfies Prisma.ordersSelect;

type PullOrder = Prisma.ordersGetPayload<{ select: typeof PULL_ORDER_SELECT }>;

/** One trip the bill is on (some invoice row, or orders."tripDropId"). */
export interface PullTrip {
  tripId: number;
  tripNumber: string;
  /** Floor already sent the trip to billing — the modal warns. */
  sentToBilling: boolean;
  /** The bill's stops on that trip (one per trip for an unsplit bill). */
  dropIds: number[];
}

function tripsOf(order: PullOrder): PullTrip[] {
  const byTrip = new Map<number, PullTrip>();
  const add = (d: { id: number; tripId: number; trip: { tripNumber: string; sentToBillingAt: Date | null } } | null) => {
    if (d === null) return;
    const t = byTrip.get(d.tripId) ?? {
      tripId: d.tripId,
      tripNumber: d.trip.tripNumber,
      sentToBilling: d.trip.sentToBillingAt !== null,
      dropIds: [],
    };
    if (!t.dropIds.includes(d.id)) t.dropIds.push(d.id);
    byTrip.set(d.tripId, t);
  };
  for (const r of order.invoices) add(r.tripDrop);
  add(order.tripDrop);
  return Array.from(byTrip.values()).sort((a, b) => a.tripNumber.localeCompare(b.tripNumber));
}

interface LineCounts {
  active: number;
  removed: number;
  errored: number;
}

/** Active / removed / errored line counts per OBD — ONE groupBy. */
async function lineCountsByObd(obdNumbers: string[]): Promise<Map<string, LineCounts>> {
  const map = new Map<string, LineCounts>();
  if (obdNumbers.length === 0) return map;
  const groups = await prisma.import_raw_line_items.groupBy({
    by: ["obdNumber", "rowStatus", "lineStatus"],
    where: { obdNumber: { in: obdNumbers } },
    _count: { _all: true },
  });
  for (const g of groups) {
    const c = map.get(g.obdNumber) ?? { active: 0, removed: 0, errored: 0 };
    if (g.rowStatus !== "valid") c.errored += g._count._all;
    else if (g.lineStatus !== "active") c.removed += g._count._all;
    else c.active += g._count._all;
    map.set(g.obdNumber, c);
  }
  return map;
}

/** The facts judgePull reads, for one loaded bill. Reads the live CI. */
async function factsOf(order: PullOrder, lines: LineCounts): Promise<PullFacts> {
  const dispatched = order.invoices.find((r) => r.isDispatched) ?? null;
  const ci = await findLiveCi(order.id);
  return {
    obdNumber: order.obdNumber,
    isRemoved: order.isRemoved,
    isActive: order.isActive,
    isChallanOrder: order.isChallanOrder,
    workflowStage: order.workflowStage,
    orderType: order.orderType,
    pickerName: order.pickAssignment?.picker.name ?? null,
    dispatchedInvoice: dispatched === null ? null : (dispatched.invoiceNo ?? `Invoice ${dispatched.seq}`),
    liveCiRefusal: ci === null ? null : liveCiRefusal(ci, "pulled into tinting"),
    activeLines: lines.active,
    removedLines: lines.removed,
    erroredLines: lines.errored,
  };
}

// ── The lookup ───────────────────────────────────────────────────────────────

/** One line the modal can tick. */
export interface PullLine {
  id: number;
  lineId: number;
  skuCodeRaw: string;
  skuDescriptionRaw: string | null;
  unitQty: number;
  volumeLine: number | null;
  isTinting: boolean;
}

/** One bill the term found, with its own verdict. */
export interface PullMatch {
  orderId: number;
  obdNumber: string;
  customerName: string | null;
  smu: string | null;
  orderDateTime: string | null;
  workflowStage: string;
  orderType: string;
  verdict: "ok" | "confirm" | "refused";
  refusalCode: PullRefusalCode | null;
  /** The sentence: why refused, or what the confirm will cancel. null for ok. */
  reason: string | null;
  /** "Invoice 2 of 3 on OBD …; the whole OBD moves to tint", or null. */
  invoiceNote: string | null;
  /** The invoice the term named, when it was an invoice. */
  matchedInvoice: string | null;
  /** Who holds the pick — the push goes to them. */
  pickerName: string | null;
  trips: { tripNumber: string; sentToBilling: boolean }[];
  /** A delivery challan will be ensured (CHALLAN_ELIGIBLE_SMU). */
  challanEligible: boolean;
  isSample: boolean;
  /** An operator cannot be chosen until the customer is added (the assign rule). */
  customerMissing: boolean;
  lineCounts: LineCounts;
  /** Pullable lines (rowStatus valid + lineStatus active). Empty for a refused bill. */
  lines: PullLine[];
}

export type PullLookupResult =
  | { ok: true; term: string; matches: PullMatch[] }
  | { ok: false; errorCode: "BAD_REQUEST" | "NOT_FOUND"; message: string };

/** One SO-sized handful at most; an invoice is on one or two OBDs. */
const PULL_LOOKUP_MAX = 20;

/**
 * Every bill the typed OBD or invoice names, each judged. A term that is not
 * one full number (lib/trips/find-bill.ts parseBillLookupTerm) is still tried
 * as an exact OBD number, as the old lookup did.
 */
export async function lookupManualPull(raw: string): Promise<PullLookupResult> {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: false, errorCode: "BAD_REQUEST", message: "Type an OBD or invoice number" };
  const term: BillLookupTerm = parseBillLookupTerm(trimmed) ?? { q: trimmed, invoiceTerms: [] };

  const invoiceMatches = await invoiceRowMatches(term);
  const matchedIds = Array.from(invoiceMatches.keys());

  // NO isRemoved / hide / challan filter — see the file header. Removed and
  // challan bills are found and then refused with their reason.
  const orders = await prisma.orders.findMany({
    where: pullLookupWhere(term, matchedIds),
    select: PULL_ORDER_SELECT,
    orderBy: { obdNumber: "asc" },
    take: PULL_LOOKUP_MAX,
  });
  if (orders.length === 0) {
    return { ok: false, errorCode: "NOT_FOUND", message: `No bill found for ${trimmed}` };
  }

  const counts = await lineCountsByObd(orders.map((o) => o.obdNumber));
  const matches: PullMatch[] = [];
  for (const order of orders) {
    const lineCounts = counts.get(order.obdNumber) ?? { active: 0, removed: 0, errored: 0 };
    const verdict = judgePull(await factsOf(order, lineCounts));

    // Which invoice the term named, and where it sits among the OBD's invoices
    // (split-load parts are not invoices — the Floor count's rule, getInvoiceCounts).
    const invoiceRows = order.invoices.filter((r) => r.source !== INVOICE_SOURCE.LOAD);
    const hit = invoiceMatches.get(order.id) ?? null;
    const viaInvoice = order.obdNumber !== term.q;
    const matchedInvoice = viaInvoice ? (hit?.invoiceNo ?? term.invoiceTerms[0] ?? null) : null;
    const position =
      viaInvoice && matchedInvoice !== null
        ? invoiceRows.findIndex((r) => r.invoiceNo === matchedInvoice) + 1 || null
        : null;

    const lines =
      verdict.verdict === "refused"
        ? []
        : await prisma.import_raw_line_items.findMany({
            where: { obdNumber: order.obdNumber, rowStatus: "valid", lineStatus: "active" },
            orderBy: { lineId: "asc" },
            select: {
              id: true,
              lineId: true,
              skuCodeRaw: true,
              skuDescriptionRaw: true,
              unitQty: true,
              volumeLine: true,
              isTinting: true,
            },
          });

    matches.push({
      orderId: order.id,
      obdNumber: order.obdNumber,
      customerName: order.customer?.customerName ?? order.shipToCustomerName ?? null,
      smu: order.smu,
      orderDateTime: order.orderDateTime?.toISOString() ?? null,
      workflowStage: order.workflowStage,
      orderType: order.orderType,
      verdict: verdict.verdict,
      refusalCode: verdict.verdict === "refused" ? verdict.code : null,
      reason: verdict.reason,
      invoiceNote: invoiceOfObdNote(position, invoiceRows.length, order.obdNumber),
      matchedInvoice,
      pickerName: order.pickAssignment?.picker.name ?? null,
      trips: tripsOf(order).map((t) => ({ tripNumber: t.tripNumber, sentToBilling: t.sentToBilling })),
      challanEligible: order.smu !== null && CHALLAN_ELIGIBLE_SMU.includes(order.smu),
      isSample: order.sampleAt !== null,
      customerMissing: order.customerMissing,
      lineCounts,
      lines,
    });
  }
  return { ok: true, term: trimmed, matches };
}

// ── The pull ─────────────────────────────────────────────────────────────────

export const PULL_REASON_CODES = ["sample", "custom_shade", "late_addition", "classification_miss", "other"] as const;
export type PullReasonCode = (typeof PULL_REASON_CODES)[number];

export interface ManualPullInput {
  orderId: number;
  lineIds: number[];
  reasonCode: PullReasonCode;
  reasonNotes: string | null;
  confirmCancelPick: boolean;
  operatorId: number | null;
  markSample: boolean;
  actorId: number;
}

export type ManualPullErrorCode =
  | PullRefusalCode
  | "NOT_FOUND"
  | "PICK_CONFIRM_REQUIRED"
  | "INVALID_LINES"
  | "OPERATOR_REFUSED"
  | "OPERATOR_NOT_FOUND"
  | "INTERNAL_ERROR";

export type ManualPullResult =
  | {
      ok: true;
      order: { id: number; obdNumber: string; workflowStage: string };
      /** Who lost the pick (pushed), or null. */
      cancelledPickerName: string | null;
      tripsLeft: string[];
      operatorName: string | null;
      markedSample: boolean;
      challanEnsured: boolean;
    }
  | { ok: false; errorCode: ManualPullErrorCode; message: string; status: number };

function fail(errorCode: ManualPullErrorCode, message: string, status: number): ManualPullResult {
  return { ok: false, errorCode, message, status };
}

/** Pull one bill into tinting. Every check of the lookup is run again first. */
export async function applyManualPull(input: ManualPullInput): Promise<ManualPullResult> {
  const { orderId, actorId } = input;

  // ── 0. Reads ──────────────────────────────────────────────────────────────
  const order = await prisma.orders.findUnique({ where: { id: orderId }, select: PULL_ORDER_SELECT });
  if (!order) return fail("NOT_FOUND", `No order found with id ${orderId}`, 404);

  const lineCounts = (await lineCountsByObd([order.obdNumber])).get(order.obdNumber) ?? {
    active: 0,
    removed: 0,
    errored: 0,
  };
  const verdict = judgePull(await factsOf(order, lineCounts));
  if (verdict.verdict === "refused") return fail(verdict.code, verdict.reason, 400);
  // The stale-modal guard: a picker took the bill after the modal looked it up,
  // or a client that never showed the warning.
  if (verdict.verdict === "confirm" && !input.confirmCancelPick) {
    return fail("PICK_CONFIRM_REQUIRED", verdict.reason, 409);
  }
  const pickCancelled = verdict.verdict === "confirm";

  // The chosen lines must be this OBD's pullable lines.
  const matchingLines = await prisma.import_raw_line_items.count({
    where: { id: { in: input.lineIds }, obdNumber: order.obdNumber, rowStatus: "valid", lineStatus: "active" },
  });
  if (matchingLines !== input.lineIds.length) {
    return fail("INVALID_LINES", "One or more lineIds do not belong to this OBD or are not valid rows", 400);
  }

  // The operator, planned BEFORE any write: the bill as it will be after the
  // pull (tint, waiting for an operator). A refusal stops the pull here, with
  // the assign route's own sentence; the modal can send it again without one.
  let operator: { id: number; name: string; existingAssignmentId: number | null } | null = null;
  if (input.operatorId !== null) {
    const plan = await planTintAssign(
      {
        id: order.id,
        orderType: "tint",
        workflowStage: "pending_tint_assignment",
        obdNumber: order.obdNumber,
        customerMissing: order.customerMissing,
      },
      input.operatorId,
    );
    if (!plan.ok) {
      return fail(plan.status === 404 ? "OPERATOR_NOT_FOUND" : "OPERATOR_REFUSED", plan.error, plan.status);
    }
    operator = { id: input.operatorId, name: plan.operatorName, existingAssignmentId: plan.existingAssignmentId };
  }

  // Read BEFORE the writes — after (4) there is no way back to who held it, and
  // after (3) the bill is on no trip.
  const heldBy = order.pickAssignment;
  const trips = tripsOf(order);
  const now = new Date();
  const markedSample = input.markSample && order.sampleAt === null;

  try {
    // ── 1. Line flags + summary ─────────────────────────────────────────────
    await prisma.import_raw_line_items.updateMany({
      where: { id: { in: input.lineIds } },
      data: { isTinting: true },
    });
    // Defensive: the summary row may be missing.
    try {
      await prisma.import_obd_query_summary.update({
        where: { orderId: order.id },
        data: { hasTinting: true },
      });
    } catch (qsErr) {
      console.warn(
        `[manual-pull] No import_obd_query_summary for orderId=${order.id} — skipping hasTinting update`,
        qsErr,
      );
    }

    // ── 2. The operator's assignment row + the queue tail ───────────────────
    let sequenceOrder: number | null = null;
    if (operator !== null) {
      await writeTintAssignmentRow({
        orderId: order.id,
        assignedToId: operator.id,
        managerId: actorId,
        existingAssignmentId: operator.existingAssignmentId,
      });
      sequenceOrder = await nextTintSequenceOrder(operator.id);
    }

    // ── 3 + 4. ONE orders.update, then the picker's row ─────────────────────
    const pullData = buildPullData({
      dispatchSlotSource: order.dispatchSlotSource,
      operatorSequenceOrder: sequenceOrder,
      markSample: input.markSample,
      alreadySample: order.sampleAt !== null,
      actorId,
      now,
    });
    const write = async (): Promise<void> => {
      if (trips.length > 0) {
        // Off EVERY trip, in the same write (lib/order-invoices/trip-link.ts).
        await setRowsTrip(order.id, "all", null, {}, pullData);
      } else {
        await prisma.orders.update({ where: { id: order.id }, data: pullData });
      }
    };
    if (heldBy !== null) {
      await takeBillOffPicker(order.id, write, "tint/manual-pull");
    } else {
      await write();
    }
    const toStage = pullData.workflowStage as string;

    // 2b. tint_logs — after the stage write, as the assign route orders it.
    if (operator !== null) {
      await writeTintAssignLog({
        orderId: order.id,
        managerId: actorId,
        isReassign: operator.existingAssignmentId !== null,
        note: tintAssignLogNote(operator.existingAssignmentId !== null, operator.name),
      });
    }

    // ── 5. Emptied stops, and each trip's story ─────────────────────────────
    for (const t of trips) {
      for (const dropId of t.dropIds) await deleteTripDropIfEmpty(dropId);
      await logTripBills({
        tripId: t.tripId,
        actorId,
        direction: "remove",
        orderIds: [order.id],
        obdNumbers: [order.obdNumber],
        reason: "pulled_into_tint",
      });
    }

    // ── 6. ONE status-log row ───────────────────────────────────────────────
    await prisma.order_status_logs.create({
      data: {
        orderId: order.id,
        // The bill's REAL prior stage (2026-09-11) — never a hardcoded one.
        fromStage: order.workflowStage,
        toStage,
        changedById: actorId,
        note: pullStatusNote({
          reasonCode: input.reasonCode,
          reasonNotes: input.reasonNotes,
          cancelledPickerName: heldBy?.picker.name ?? null,
          pickCancelled,
          tripNumbers: trips.map((t) => t.tripNumber),
          operatorName: operator?.name ?? null,
          markedSample,
        }),
      },
    });

    // ── 7. The manual-entry audit row ───────────────────────────────────────
    await prisma.manual_tint_entries.create({
      data: {
        orderId: order.id,
        action: "pulled_in",
        reasonCode: input.reasonCode,
        reasonNotes: input.reasonNotes,
        lineIds: input.lineIds,
        performedById: actorId,
      },
    });

    // ── 8. The delivery challan — eligible divisions only, non-fatal ────────
    const challanEnsured = order.smu !== null && CHALLAN_ELIGIBLE_SMU.includes(order.smu);
    if (challanEnsured) await ensureChallan(order.id);

    // ── 9. The push ─────────────────────────────────────────────────────────
    if (heldBy !== null) await pushPickCancelled(order, heldBy, actorId);

    return {
      ok: true,
      order: { id: order.id, obdNumber: order.obdNumber, workflowStage: toStage },
      cancelledPickerName: heldBy?.picker.name ?? null,
      tripsLeft: trips.map((t) => t.tripNumber),
      operatorName: operator?.name ?? null,
      markedSample,
      challanEnsured,
    };
  } catch (e) {
    console.error("[manual-pull] Failed to apply manual tint pull:", {
      orderId: order.id,
      lineIds: input.lineIds,
      reasonCode: input.reasonCode,
      error: e,
    });
    return fail("INTERNAL_ERROR", "Failed to apply manual tint pull", 500);
  }
}

/**
 * Ensure a live delivery challan exists — moved verbatim from the manual-entry
 * route's Step F. Wrapped: a failure here does NOT undo the pull (the pull is
 * already written; a missing challan can be created later).
 */
async function ensureChallan(orderId: number): Promise<void> {
  try {
    // isVoided: false — a voided challan shouldn't block recreation. Manual
    // entry flow may legitimately re-issue a challan after a void.
    const existingChallan = await prisma.delivery_challans.findFirst({
      where: { orderId, isVoided: false },
      select: { id: true },
    });
    if (existingChallan) return;

    // Sequence allocation INCLUDES voided rows (CORE §13) — no isVoided filter.
    const lastChallan = await prisma.delivery_challans.findFirst({
      orderBy: { id: "desc" },
      select: { challanNumber: true },
    });
    let nextSeq = 1;
    if (lastChallan?.challanNumber) {
      const parts = lastChallan.challanNumber.split("-");
      const lastNum = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(lastNum)) nextSeq = lastNum + 1;
    }
    const year = new Date().getFullYear();
    const challanNumber = `CHN-${year}-${String(nextSeq).padStart(5, "0")}`;
    await prisma.delivery_challans.create({ data: { orderId, challanNumber } });
  } catch (challanErr) {
    console.warn(
      `[manual-pull] challan ensure failed for orderId=${orderId} — non-fatal, manual pull already committed`,
      challanErr,
    );
  }
}

/**
 * Tell the picker to stop, and the supervisors why his pick vanished.
 * CLAUDE_NOTIFICATIONS §2's rules: awaited (Vercel freezes the function after
 * the response), FULLY swallowed (the pull already happened), and NO orders
 * write — only push_subscriptions, inside sendToUser. The tag is the cancel
 * tag, so the picker's open board re-reads the bill (public/sw.js).
 */
async function pushPickCancelled(
  order: PullOrder,
  heldBy: { pickerId: number; picker: { name: string } },
  actorId: number,
): Promise<void> {
  try {
    const supervisorIds = await getPickingSupervisorUserIds();
    const to = pullPushRecipients({ pickerId: heldBy.pickerId, supervisorIds, actorId });
    // The effective dealer, the fallback every push body uses (CORE §7.3).
    const dealerName =
      order.shipToOverrideCustomer?.customerName ??
      order.customer?.customerName ??
      order.shipToCustomerName ??
      "(Unmatched)";
    const tag = `pick-cancelled-${order.id}`;
    if (to.picker !== null) {
      await sendToUser(to.picker, {
        title: "Bill moved to tinting",
        body: `${dealerName} · ${order.obdNumber} — stop picking this bill`,
        tag,
        url: "/picking",
      });
    }
    for (const id of to.supervisors) {
      await sendToUser(id, {
        title: "Pick cancelled for tint",
        body: `${heldBy.picker.name}'s pick of ${dealerName} · ${order.obdNumber}`,
        tag,
        url: "/picking",
      });
    }
  } catch (err) {
    console.error("[manual-pull] push notify failed (non-fatal):", err);
  }
}
