// lib/challan-orders/alerts.ts
//
// THE RED ALERTS of Challan orders slice 6 (2026-10-07; owner S6-1, S6-2, S6-6). READ-ONLY.
// Computed LIVE from the data — nothing is stored, so an alert can only go away when the
// situation it describes is gone, which is always a person's action:
//
//   DOUBLE_DISPATCH  (S6-2) a live link whose SO has a TOUCHED SAP OBD — a picker, tint
//                    operator, trip, Hand, CI or dispatch already has it. Clears when a
//                    person CANCELS that OBD (Floor / Picking / Tint) or UNLINKS the SO.
//   DEALER_MISMATCH  (S6-1) the SO's OBD is billed by SAP to a different dealer than the
//                    challan — it was HELD, not linked. Clears when billing presses
//                    "Link anyway" (pulls it back) or UNLINKS the SO (Floor then releases
//                    the hold as for any held bill).
//   CATCH_FAILED     (S6-6) an untouched OBD on a linked SO that is still NOT linked — the
//                    catch's first write failed (or a paste's safety net did). It sits on
//                    Floor's undecided list. Clears when a person presses RETRY (or cancels
//                    the OBD / unlinks the SO).
//
// Callers: GET /api/challan-orders/alerts — the Challan orders screen (every mount) and
// the Floor page strip.

import { prisma } from "@/lib/prisma";
import { CHALLAN_LINKED } from "@/lib/workflow-stages";
import { sapBillToOf, touchedReason } from "./reconcile";

export type ChallanAlertKind = "DOUBLE_DISPATCH" | "DEALER_MISMATCH" | "CATCH_FAILED";

export interface ChallanAlert {
  kind: ChallanAlertKind;
  linkId: number;
  soNumber: string;
  orbNumber: string;
  orderId: number;
  obdNumber: string;
  workflowStage: string;
  /** Plain words for the banner. */
  message: string;
}

export async function loadChallanAlerts(): Promise<ChallanAlert[]> {
  const links = await prisma.challan_order_so_links.findMany({
    where: { status: { in: ["waiting", "linked"] } },
    select: {
      id: true,
      soNumber: true,
      orbOrder: {
        select: { id: true, obdNumber: true, workflowStage: true, isRemoved: true, customer: { select: { customerCode: true, customerName: true } } },
      },
    },
  });
  const live = links.filter((l) => !l.orbOrder.isRemoved && l.orbOrder.workflowStage !== "cancelled");
  if (live.length === 0) return [];

  const obds = await prisma.orders.findMany({
    where: {
      soNumber: { in: live.map((l) => l.soNumber) },
      isRemoved: false,
      isChallanOrder: false,
      workflowStage: { notIn: ["cancelled", CHALLAN_LINKED] },
    },
    select: {
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
    },
    orderBy: { id: "asc" },
  });

  const alerts: ChallanAlert[] = [];
  for (const o of obds) {
    const link = live.find((l) => l.soNumber === o.soNumber);
    if (!link) continue;
    const orb = link.orbOrder;
    const base = { linkId: link.id, soNumber: link.soNumber, orbNumber: orb.obdNumber, orderId: o.id, obdNumber: o.obdNumber, workflowStage: o.workflowStage };
    const touched = await touchedReason(o);
    if (touched !== null) {
      alerts.push({
        ...base,
        kind: "DOUBLE_DISPATCH",
        message:
          `OBD ${o.obdNumber} — ${touched}. DOUBLE DISPATCH RISK: SO ${link.soNumber} is billed against challan ` +
          `${orb.obdNumber}, whose goods already went out. Cancel this OBD on Floor, or unlink the SO.`,
      });
      continue;
    }
    const billTo = await sapBillToOf(o.obdNumber);
    const orbBillTo = orb.customer?.customerCode ?? null;
    if (billTo !== null && orbBillTo !== null && billTo !== orbBillTo) {
      alerts.push({
        ...base,
        kind: "DEALER_MISMATCH",
        message:
          `OBD ${o.obdNumber} (SO ${link.soNumber}) is billed to ${billTo}, but challan ${orb.obdNumber} is for ` +
          `${orb.customer?.customerName ?? orbBillTo} (${orbBillTo}). It is ${o.dispatchStatus === "hold" ? "held" : "NOT yet held"} — billing decides: Link anyway, or Unlink the SO.`,
      });
      continue;
    }
    alerts.push({
      ...base,
      kind: "CATCH_FAILED",
      message:
        `Challan catch failed — OBD ${o.obdNumber} (SO ${link.soNumber}) belongs to challan ${orb.obdNumber} but was ` +
        `not linked. Do not release it. Retry.`,
    });
  }
  return alerts;
}
