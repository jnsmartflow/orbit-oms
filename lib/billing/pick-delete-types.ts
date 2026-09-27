// lib/billing/pick-delete-types.ts
//
// Wire shapes for the Billing "Pick delete" tab (2026-09-27). PURE — no Prisma,
// no clock — so the tab (build step 7) can import them by value.
// Design: docs/prompts/drafts/web-update-2026-09-27-billing-pick-delete.md

/** pick_delete_decisions.kind — chk_pick_delete_decisions_kind. */
export type PickDeleteKind = "all_ok" | "pick_delete";

/** One bill in an open same-SO group. */
export interface PickDeleteBill {
  orderId: number;
  obdNumber: string;
  /** orders.workflowStage — the raw value. */
  stage: string;
  /** The display label from the stage ladder (lib/workflow-stages.ts). */
  stageLabel: string;
  /** obdEmailDate ?? orderDateTime, ISO. */
  punchedAt: string | null;
  /** import_obd_query_summary.totalVolume (litres). */
  volume: number | null;
  articleTag: string | null;
  /** Distinct SKUs across the active import_raw_line_items rows (batch splits merged). */
  lineCount: number;
  /** The bill's lines, SAP batch splits merged per SKU — shipped WITH the list
   *  (one batched read, 2026-09-27) so the tab never fetches them per bill. */
  lines: PickDeleteLine[];
  invoiceNo: string | null;
  tripNumber: string | null;
  /** May "Pick delete this bill" be pressed? From pickDeleteCheck — the SAME
   *  function the delete route runs (lib/billing/pick-delete.ts). */
  canDelete: boolean;
  /** When refused: the few plain words the disabled button shows ("On a trip",
   *  "Dispatched", "In tint room", "Has a CI", "Old closed bill", …). */
  reason: string | null;
  /** When refused: the full message the route would answer with. */
  refusal: string | null;
}

/** "double_punch" when two bills carry identical active line sets, else "split". */
export type PickDeleteHint = "double_punch" | "split";

export interface PickDeleteGroup {
  soNumber: string;
  customerName: string | null;
  /** The earliest punchedAt in the group, ISO. */
  firstPunchAt: string | null;
  hint: PickDeleteHint;
  /** Every live bill id in the group, sorted ascending — post this back to All OK. */
  orderIds: number[];
  bills: PickDeleteBill[];
}

export interface PickDeleteDecidedRow {
  id: number;
  kind: PickDeleteKind;
  soNumber: string;
  customerName: string | null;
  /** pick_delete: the deleted OBD; all_ok: every OBD in the set. */
  obdNumbers: string[];
  /** pick_delete: the survivors ("Correct pick"). */
  keptObdNumbers: string[];
  decidedByName: string | null;
  decidedAt: string;
  undoneByName: string | null;
  undoneAt: string | null;
  /** pick_delete only: is the bill still cancelled right now? (false = restored, here or on Floor) */
  billStillCancelled: boolean | null;
}

export interface PickDeleteList {
  month: string;
  /** Oldest first. */
  groups: PickDeleteGroup[];
  /** Newest first, decidedAt in the IST month. */
  decided: PickDeleteDecidedRow[];
}

/** The pill's probe — the two fields usePickingMarker reads (CLAUDE_PICKING §10). */
export interface PickDeleteMarker {
  count: number;
  latest: string | null;
}

export interface PickDeleteLine {
  id: number;
  sku: string;
  name: string | null;
  pack: string | null;
  unitQty: number;
  volumeLine: number | null;
  isTinting: boolean;
}

export interface PickDeleteBillLines {
  orderId: number;
  obdNumber: string;
  lines: PickDeleteLine[];
}
