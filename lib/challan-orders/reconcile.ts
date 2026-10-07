// lib/challan-orders/reconcile.ts
//
// THE IMPORT CATCH + THE LATE-PASTE SAFETY NET (Challan orders slice 6, 2026-10-07 —
// plan code-plan-2026-10-07-challan-slice6.md §1, §2, §5, §6; owner S6-1, S6-2, S6-6;
// design D9, D10, D11, M6).
//
// ONE rule, three callers:
//   catchChallanObds  ← app/api/import/obd/route.ts — all four create paths, BEFORE the
//                       first release (mail-order enrichment, Telephonic holds, the
//                       no-mail fallback, CHN).
//   reconcileSo       ← lib/challan-orders/links.ts pasteSo (a late paste), and
//                       POST /api/challan-orders/links/[id]/retry (Retry / Link anyway).
//
// For a SO with a LIVE link ('waiting', or 'linked' for a further OBD — M6), every live
// SAP OBD on that SO is, in this order:
//   already challan_linked to this ORB → no-op (a stale 'waiting' link is flipped);
//   TOUCHED (picker / tint operator / trip / Hand / live CI / dispatched) → no write —
//     the link stays and the screens show "DOUBLE DISPATCH RISK" (alerts.ts, S6-2);
//   SAP bill-to ≠ the challan's bill-to → HELD, not linked, not released (S6-1);
//   otherwise → CAUGHT: workflowStage 'challan_linked' + challanOrderId, status null.
//
// 🔴 A BILL WHOSE SO HAS NO LIVE LINK IS NEVER WRITTEN HERE. catchChallanObds reads the
// link table once; no link → it returns empty sets and the import runs exactly as before.
//
// Write order for a caught OBD (sequential awaits, NEVER $transaction — CORE §3):
//   1. orders.updateMany, compare-and-swap on the stage just read → unreleasable FIRST;
//   2. one order_status_logs row;
//   3. the link 'waiting' → 'linked' (first OBD only, CAS on status).
// A failure at 1 leaves the OBD where it was (pending_support, status null) — the caller
// keeps it out of every release, and alerts.ts shows "challan catch failed — Retry" on
// Floor and the Challan screen (S6-6). A failure at 3 is repaired by the next reconcile.

import { prisma } from "@/lib/prisma";
import { CHALLAN_LINKED } from "@/lib/workflow-stages";
import { CHALLAN_DEALER_HOLD_NOTE } from "@/lib/floor/hold-log";
import { TINT_ASSIGNMENT_ACTIVE_STATUSES } from "@/lib/tint/assignment-status";

const CANCELLED = "cancelled";
const LIVE_LINK = ["waiting", "linked"];

/** Stages where nobody has put a hand on the bill yet (plan §6 table). */
const UNTOUCHED_STAGES = ["pending_support", "pending_tint_assignment", "pending_picking"];

export type ReconcileSource = "import" | "paste" | "retry";

/** The order columns the rule reads. */
const OBD_SELECT = {
  id: true,
  obdNumber: true,
  soNumber: true,
  workflowStage: true,
  dispatchStatus: true,
  tripDropId: true,
  handAt: true,
  challanOrderId: true,
  obdEmailDate: true,
  pickAssignment: { select: { id: true } },
} as const;

type ObdRow = {
  id: number;
  obdNumber: string;
  soNumber: string | null;
  workflowStage: string;
  dispatchStatus: string | null;
  tripDropId: number | null;
  handAt: Date | null;
  challanOrderId: number | null;
  obdEmailDate: Date | null;
  pickAssignment: { id: number } | null;
};

/**
 * Is this OBD already being worked? null = untouched (pull back / catch); else the
 * reason, in words for the red warning. Plan §6's table, read from code:
 * offFloorRefusal's trip / tint-room / dispatched rules, a picker's assignment, Hand,
 * an active tint job, a live CI.
 */
export async function touchedReason(o: ObdRow): Promise<string | null> {
  if (o.workflowStage === "dispatched") return "it has already left the depot";
  if (o.tripDropId !== null) return "it is on a truck plan";
  if (o.handAt !== null) return "the dealer is collecting it (Hand)";
  if (!UNTOUCHED_STAGES.includes(o.workflowStage)) {
    if (o.workflowStage === "tint_assigned" || o.workflowStage === "tinting_in_progress") {
      return "a tint operator has it";
    }
    if (o.workflowStage === "pick_assigned") return "a picker has it";
    if (o.workflowStage === "pick_done" || o.workflowStage === "pick_checked") return "it has been picked";
    return `it is at ${o.workflowStage}`;
  }
  if (o.pickAssignment !== null) return "a picker has it";
  if (o.workflowStage === "pending_tint_assignment") {
    const job = await prisma.tint_assignments.findFirst({
      where: { orderId: o.id, status: { in: [...TINT_ASSIGNMENT_ACTIVE_STATUSES] } },
      select: { id: true },
    });
    if (job) return "a tint operator has it";
  }
  const ci = await prisma.ci_returns.findFirst({
    where: { orderId: o.id, isVoided: false, status: { not: "draft" } },
    select: { ciNumber: true },
  });
  if (ci) return `its return ${ci.ciNumber ?? ""} is with billing`.trim();
  return null;
}

/** The SAP bill-to code of an OBD — its newest raw summary (present on every OBD, plan §0). */
export async function sapBillToOf(obdNumber: string): Promise<string | null> {
  const s = await prisma.import_raw_summary.findFirst({
    where: { obdNumber },
    orderBy: { id: "desc" },
    select: { billToCustomerId: true },
  });
  const code = s?.billToCustomerId?.trim();
  return code ? code : null;
}

export interface ReconcileResult {
  soNumber: string;
  /** No live link on this SO — nothing was read beyond the link table, nothing written. */
  noLink: boolean;
  orbNumber: string | null;
  caught: string[];
  held: string[];
  touched: { obdNumber: string; reason: string }[];
  failed: { obdNumber: string; error: string }[];
}

function noteFor(source: ReconcileSource, orbNumber: string, soNumber: string): string {
  return source === "import"
    ? `Linked to challan ${orbNumber} (SO ${soNumber}) — not released`
    : `Pulled back to challan ${orbNumber} (SO ${soNumber} pasted after the OBD arrived)`;
}

/**
 * Apply the rule to every live OBD on one SO. Idempotent: a second run over the same
 * state writes nothing. `ignoreDealer` = billing pressed "Link anyway" on a dealer
 * mismatch (S6-1: billing decides).
 */
export async function reconcileSo(
  soNumber: string,
  actorId: number,
  opts: { source: ReconcileSource; ignoreDealer?: boolean; onlyObds?: Set<string> },
): Promise<ReconcileResult> {
  const result: ReconcileResult = { soNumber, noLink: true, orbNumber: null, caught: [], held: [], touched: [], failed: [] };

  const link = await prisma.challan_order_so_links.findFirst({
    where: { soNumber, status: { in: LIVE_LINK } },
    select: { id: true, status: true, orbOrderId: true },
  });
  if (link === null) return result;
  result.noLink = false;

  const orb = await prisma.orders.findUnique({
    where: { id: link.orbOrderId },
    select: { id: true, obdNumber: true, workflowStage: true, isRemoved: true, customer: { select: { customerCode: true } } },
  });
  // A cancelled ORB order unlinks its SOs (S5-3); a link that survived one is not acted on.
  if (!orb || orb.isRemoved || orb.workflowStage === CANCELLED) return result;
  result.orbNumber = orb.obdNumber;
  const orbBillTo = orb.customer?.customerCode ?? null;

  const obds = (await prisma.orders.findMany({
    where: { soNumber, isRemoved: false, isChallanOrder: false, workflowStage: { not: CANCELLED } },
    orderBy: { id: "asc" },
    select: OBD_SELECT,
  })) as ObdRow[];

  // The link flips once — for the first OBD caught while it is 'waiting'.
  let linkWaiting = link.status === "waiting";

  for (const o of obds) {
    if (opts.onlyObds && !opts.onlyObds.has(o.obdNumber) && o.workflowStage !== CHALLAN_LINKED) continue;
    try {
      // Already caught for THIS challan — repair a stale 'waiting' link, nothing else.
      if (o.workflowStage === CHALLAN_LINKED) {
        if (o.challanOrderId === orb.id && linkWaiting) {
          const flipped = await prisma.challan_order_so_links.updateMany({
            where: { id: link.id, status: "waiting" },
            data: { status: "linked", linkedOrderId: o.id, obdLinkedAt: new Date() },
          });
          if (flipped.count > 0) linkWaiting = false;
        }
        continue;
      }

      const touched = await touchedReason(o);
      if (touched !== null) {
        // S6-2: nothing is written — the live link is the stored fact; alerts.ts shows it.
        result.touched.push({ obdNumber: o.obdNumber, reason: touched });
        continue;
      }

      // S6-1 — the authoritative dealer check: SAP bill-to vs the challan's bill-to.
      if (!opts.ignoreDealer && orbBillTo !== null) {
        const billTo = await sapBillToOf(o.obdNumber);
        if (billTo !== null && billTo !== orbBillTo) {
          if (o.dispatchStatus !== "hold") {
            const held = await prisma.orders.updateMany({
              where: { id: o.id, workflowStage: o.workflowStage, dispatchStatus: o.dispatchStatus, tripDropId: null },
              data: { dispatchStatus: "hold", heldAt: o.obdEmailDate ?? new Date() },
            });
            if (held.count === 0) {
              result.failed.push({ obdNumber: o.obdNumber, error: "changed while being held — Retry" });
              continue;
            }
            await prisma.order_status_logs.create({
              data: {
                orderId: o.id,
                fromStage: o.workflowStage,
                toStage: o.workflowStage,
                changedById: actorId,
                note: CHALLAN_DEALER_HOLD_NOTE,
              },
            });
          }
          result.held.push(o.obdNumber);
          continue;
        }
      }

      // CATCH — 1. the stage (CAS), 2. the log, 3. the link.
      const caught = await prisma.orders.updateMany({
        where: {
          id: o.id,
          workflowStage: o.workflowStage,
          isRemoved: false,
          tripDropId: null,
          handAt: null,
        },
        data: { workflowStage: CHALLAN_LINKED, challanOrderId: orb.id, dispatchStatus: null },
      });
      if (caught.count === 0) {
        result.failed.push({ obdNumber: o.obdNumber, error: "changed while being linked — Retry" });
        continue;
      }
      result.caught.push(o.obdNumber);
      try {
        await prisma.order_status_logs.create({
          data: {
            orderId: o.id,
            fromStage: o.workflowStage,
            toStage: CHALLAN_LINKED,
            changedById: actorId,
            note: noteFor(opts.source, orb.obdNumber, soNumber),
          },
        });
      } catch (err) {
        console.error(`[challan-catch] ${o.obdNumber} linked but its log failed`, err);
      }
      if (linkWaiting) {
        try {
          const flipped = await prisma.challan_order_so_links.updateMany({
            where: { id: link.id, status: "waiting" },
            data: { status: "linked", linkedOrderId: o.id, obdLinkedAt: new Date() },
          });
          if (flipped.count > 0) linkWaiting = false;
        } catch (err) {
          // The OBD is safe (challan_linked); the next reconcile flips the link.
          console.error(`[challan-catch] ${o.obdNumber} linked but the link row did not flip`, err);
        }
      }
    } catch (err) {
      console.error(`[challan-catch] ${o.obdNumber} on SO ${soNumber} failed`, err);
      result.failed.push({ obdNumber: o.obdNumber, error: err instanceof Error ? err.message : "failed" });
    }
  }
  return result;
}

export interface CatchResult {
  /** SOs with a live link — kept out of the mail-order release (R1). */
  excludeSos: Set<string>;
  /** OBDs on those SOs — kept out of the Telephonic holds, the no-mail fallback and CHN. */
  excludeObds: Set<string>;
  /** The link table could not be read — the caller keeps EVERY OBD of the batch out of
   *  every release (fail closed); they wait on Floor's undecided list for a person. */
  excludeAll: boolean;
  results: ReconcileResult[];
}

/**
 * The import catch (plan §1). Called by each create path with the OBD numbers it just
 * created (or upserted), BEFORE any release. One read of the link table decides whether
 * anything else happens at all.
 */
export async function catchChallanObds(obdNumbers: string[], actorId: number): Promise<CatchResult> {
  const out: CatchResult = { excludeSos: new Set(), excludeObds: new Set(), excludeAll: false, results: [] };
  const unique = Array.from(new Set(obdNumbers.filter(Boolean)));
  if (unique.length === 0) return out;

  let soByObd: Map<string, string>;
  let linkedSos: Set<string>;
  try {
    const rows = await prisma.orders.findMany({
      where: { obdNumber: { in: unique }, soNumber: { not: null } },
      select: { obdNumber: true, soNumber: true },
    });
    soByObd = new Map(rows.filter((r) => r.soNumber).map((r) => [r.obdNumber, r.soNumber as string]));
    const sos = Array.from(new Set(Array.from(soByObd.values())));
    const links = sos.length
      ? await prisma.challan_order_so_links.findMany({
          where: { soNumber: { in: sos }, status: { in: LIVE_LINK } },
          select: { soNumber: true },
        })
      : [];
    linkedSos = new Set(links.map((l) => l.soNumber));
  } catch (err) {
    console.error("[challan-catch] could not read the link table — this batch is NOT released", err);
    out.excludeAll = true;
    return out;
  }
  if (linkedSos.size === 0) return out; // the common case: nothing here concerns a challan

  for (const [obd, so] of Array.from(soByObd.entries())) {
    if (linkedSos.has(so)) out.excludeObds.add(obd);
  }
  out.excludeSos = linkedSos;
  const onlyObds = new Set(unique);
  for (const so of Array.from(linkedSos)) {
    try {
      out.results.push(await reconcileSo(so, actorId, { source: "import", onlyObds }));
    } catch (err) {
      console.error(`[challan-catch] SO ${so} failed`, err);
    }
  }
  return out;
}
