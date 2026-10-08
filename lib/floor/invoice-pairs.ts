// lib/floor/invoice-pairs.ts — ONE INVOICE, SEVERAL OBDs (2026-10-08, owner).
//
// SAP sometimes covers two OBDs with one invoice (`orders.invoiceNo` shared —
// 21 live invoices on 2026-10-08, every one of them exactly two OBDs). Floor
// will draw such a pair together; this file is the DATA half: for each bill,
// the other bills on its invoice and WHERE each one is now.
//
// PURE — no Prisma, no clock, no React. getFloorBoard (lib/floor/queries.ts)
// does the one read and hands the rows in here.
//
// ⚠ NO HARDCODED "2". An invoice is a GROUP of any size; "k of n" is derived
// from the group, never assumed.

import { CHALLAN_LINKED, DISPATCHED } from "@/lib/workflow-stages";

/**
 * Where a partner bill is NOW, from its OWN columns only.
 *
 *   removed     soft-removed (`isRemoved`) — on no Floor surface, ever again
 *   cancelled   workflowStage 'cancelled' — the Cancel & CI tab's
 *   challan     workflowStage 'challan_linked' — off every board by design
 *   hold        dispatchStatus 'hold' — the On hold tab's
 *   dispatched  workflowStage 'dispatched' — the goods have left
 *   live        anything else — on the board (Floor or Tinting tab, the pool
 *               or a trip). WHICH tab is the client's question: it holds the
 *               loaded row and asks rowStatus / isTintRoomRow / tripDropId —
 *               the tabs' own split. If the row is not loaded, the client says
 *               "not on today's board".
 *
 * 🔴 "live" DOES NOT SPLIT FLOOR FROM TINTING HERE ON PURPOSE. The tint-room
 * test needs the colour rule (a "Base — No Tint" bill at a tint stage is a
 * FLOOR row — queries.ts tintPhase), which is not on this read. The stage list
 * at app/api/floor/search/route.ts:39 skips that rule; copying it would put
 * the partner on the wrong tab.
 */
export type InvoicePartnerPlace = "removed" | "cancelled" | "challan" | "hold" | "dispatched" | "live";

export interface InvoicePartner {
  orderId: number;
  obdNumber: string;
  workflowStage: string;
  place: InvoicePartnerPlace;
}

/** The columns the partner read selects — the only inputs to a place. */
export interface InvoicePartnerSource {
  id: number;
  obdNumber: string;
  invoiceNo: string | null;
  workflowStage: string;
  dispatchStatus: string | null;
  isRemoved: boolean;
}

// No exported constant names this stage (lib/floor writes the literal, e.g.
// bill-actions.ts); one local name so it is typed once in this file.
const CANCELLED_STAGE = "cancelled";

/**
 * The partner's place. Same precedence as `targetOf` in
 * app/api/floor/search/route.ts (cancel > hold > … > floor), with three steps
 * that route does not need because it never sees such a bill: removed and
 * challan-linked first (find-bill excludes both), dispatched before live.
 *
 * ⚠ A live CI is NOT read here. targetOf files a non-cancelled bill with a live
 * CI under Cancel & CI; this read has no ci_returns join and such a bill is
 * still on the board, so it is "live" — the board row says the rest.
 */
export function derivePartnerPlace(o: Pick<InvoicePartnerSource, "workflowStage" | "dispatchStatus" | "isRemoved">): InvoicePartnerPlace {
  if (o.isRemoved) return "removed";
  if (o.workflowStage === CANCELLED_STAGE) return "cancelled";
  if (o.workflowStage === CHALLAN_LINKED) return "challan";
  if (o.dispatchStatus === "hold") return "hold";
  if (o.workflowStage === DISPATCHED) return "dispatched";
  return "live";
}

/**
 * Every bill on each invoice, keyed by invoiceNo, OBD ascending. Bills with no
 * invoice are skipped. The group INCLUDES the bill asking — callers drop self
 * (`partnersOf`), so one map serves every row.
 */
export function buildPartnerMap(rows: InvoicePartnerSource[]): Map<string, InvoicePartner[]> {
  const map = new Map<string, InvoicePartner[]>();
  for (const r of rows) {
    if (r.invoiceNo === null) continue;
    const list = map.get(r.invoiceNo) ?? [];
    list.push({ orderId: r.id, obdNumber: r.obdNumber, workflowStage: r.workflowStage, place: derivePartnerPlace(r) });
    map.set(r.invoiceNo, list);
  }
  for (const list of Array.from(map.values())) list.sort((a, b) => a.obdNumber.localeCompare(b.obdNumber));
  return map;
}

/** The OTHER bills on this bill's invoice — [] when it has none. */
export function partnersOf(
  map: Map<string, InvoicePartner[]>,
  invoiceNo: string | null,
  orderId: number,
): InvoicePartner[] {
  if (invoiceNo === null) return [];
  return (map.get(invoiceNo) ?? []).filter((p) => p.orderId !== orderId);
}
