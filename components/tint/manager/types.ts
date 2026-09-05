// Tint Manager — wire types for GET /api/tint/manager/orders.
//
// These moved here from tint-manager-content.tsx during the 2026-09-05 board
// rebuild. That file RE-EXPORTS all three, because components/tint/
// tint-table-view.tsx still imports them from there. That component is the
// retired Kanban table: it is no longer rendered (the import was dropped, not
// the file — CORE §3 forbids deleting it), but it is still type-checked, so its
// import must keep resolving.

import type { SkuDisplay } from "@/types/sku-display";

export interface TintAssignmentInfo {
  id:          number;
  status:      string;
  assignedTo:  { id: number; name: string | null };
  startedAt:   string | null;
  completedAt: string | null;
  updatedAt:   string;
  accumulatedMinutes: number;
}

export interface TintOrder {
  id:                 number;
  obdNumber:          string;
  workflowStage:      string;
  dispatchSlot:       string | null;
  dispatchStatus:     string | null;
  priorityLevel:      number;
  sequenceOrder:      number | null;
  createdAt:          string;
  shipToCustomerName: string | null;
  shipToCustomerId:   string | null;
  customerMissing:    boolean;
  manualTintEntry:    boolean;
  smu:                string | null;
  obdEmailDate:       string | null;
  obdEmailTime:       string | null;
  orderDateTime:      string | null;
  slotId:             number | null;
  slotName:           string | null;
  slotTime:           string | null;
  slotIsNextDay:      boolean;
  originalSlotId:     number | null;
  originalSlotName:   string | null;
  deliveryTypeName:   string | null;

  // ── Board columns, added to the payload 2026-09-05 (commit a0f9378b) ───────
  /** orders.soNumber. 920/920 live tint orders carry one. */
  soNumber:           string | null;
  /** The ORDERING DEALER (import_raw_summary.billToCustomerName) — a different
   *  party from the ship-to site below. Differs from ship-to on 873 of 926 live
   *  tint OBDs, so the board shows both. Same source Floor uses for
   *  FloorPartyFields.billToName. */
  billToName:         string | null;
  /** customer.area.primaryRoute.name — the AREA path, matching Floor's
   *  FLOOR_DEALER_SELECT. Never delivery_point_master.primaryRoute (2% cover). */
  route:              string | null;
  /** Order-level typed roll-up of the active line tags, e.g. "2 Drum, 3 Tin".
   *  NULL means UNKNOWN, never zero — only 366/920 live tint OBDs carry any
   *  article tag at all. Render an em dash, never "0". */
  articleTag:         string | null;
  isKeyCustomer:      boolean;

  customer: {
    customerName:       string;
    area:               { name: string };
    salesOfficerGroup:  { salesOfficer: { name: string } } | null;
    salesOfficerLinks?: Array<{
      salesOfficer: { id: number; name: string; phone: string | null };
    }>;
  } | null;
  querySnapshot: {
    totalVolume: number;
    totalLines:  number;
    articleTag:  string | null;
  } | null;
  tintAssignments: TintAssignmentInfo[];
  lineItems: {
    id:                number;
    lineId:            number;
    skuCodeRaw:        string;
    skuDescriptionRaw: string | null;
    unitQty:           number;
    volumeLine:        number | null;
    isTinting:         boolean;
    article:           number | null;
    articleTag:        string | null;
    skuDisplay:        SkuDisplay;
  }[];
  remainingQty?: number;
  existingSplits?: {
    rawLineItemId: number;
    assignedQty:   number;
  }[];
  splits?: {
    id:             number;
    splitNumber:    number;
    totalQty:       number;
    status:         string;
    articleTag:     string | null;
    dispatchStatus: string | null;
    createdAt:      string;
    assignedTo:     { name: string };
    lineItems: {
      rawLineItemId: number;
      assignedQty:   number;
      rawLineItem: {
        skuCodeRaw:        string;
        skuDescriptionRaw: string | null;
        skuDisplay:        SkuDisplay;
      };
    }[];
  }[];
  challan?: { challanNumber: string; isVoided: boolean } | null;
  skipSummary?: {
    count:          number;
    lastSkippedAt:  string;
    lastSkippedBy:  string;
    lastReason:     string;
    lastTinterType: string | null;
    lastColours:    string[];
  } | null;
  pauseSummary?: {
    count:                number;
    currentlyPaused:      boolean;
    lastPausedAt:         string;
    lastPausedBy:         string;
    lastReason:           string;
    lastProgressSnapshot: { items?: Array<{ skuId: number; doneQty: number }> } | null;
  } | null;
}

export interface SplitCard {
  id:             number;
  splitNumber:    number;
  status:         string;
  dispatchStatus: string | null;
  priorityLevel:  number | null;
  sequenceOrder:  number | null;
  totalQty:       number;
  totalVolume:    number | null;
  articleTag:     string | null;
  createdAt:      string;
  startedAt:      string | null;
  completedAt:    string | null;
  smu:              string | null;
  obdEmailDate:     string | null;
  obdEmailTime:     string | null;
  orderDateTime:    string | null;
  slotId:           number | null;
  slotName:         string | null;
  slotTime:         string | null;
  slotIsNextDay:    boolean;
  originalSlotId:   number | null;
  originalSlotName: string | null;
  deliveryTypeName: string | null;
  // Board columns (2026-09-05). `articleTag` above is the SPLIT's own scalar —
  // the split's goods, not the whole bill's — so it is not restated here.
  soNumber:         string | null;
  billToName:       string | null;
  route:            string | null;
  isKeyCustomer:    boolean;
  assignedTo:     { id: number; name: string | null };
  lineItems: {
    rawLineItemId: number;
    assignedQty:   number;
    rawLineItem: {
      skuCodeRaw:        string;
      skuDescriptionRaw: string | null;
      volumeLine:        number | null;
      isTinting:         boolean;
      skuDisplay:        SkuDisplay;
    };
  }[];
  order: {
    id:        number;
    obdNumber: string;
    customer: {
      customerName:       string;
      salesOfficerGroup:  { salesOfficer: { name: string } } | null;
      salesOfficerLinks?: Array<{
        salesOfficer: { id: number; name: string; phone: string | null };
      }>;
    } | null;
  };
}

export interface CompletedAssignment {
  id:               number;
  completedAt:      string | null;
  smu:              string | null;
  obdEmailDate:     string | null;
  obdEmailTime:     string | null;
  orderDateTime:    string | null;
  slotId:           number | null;
  slotName:         string | null;
  slotTime:         string | null;
  slotIsNextDay:    boolean;
  originalSlotId:   number | null;
  originalSlotName: string | null;
  deliveryTypeName: string | null;
  // Board columns (2026-09-05).
  soNumber:         string | null;
  billToName:       string | null;
  route:            string | null;
  articleTag:       string | null;
  isKeyCustomer:    boolean;
  assignedTo:  { id: number; name: string | null };
  order: {
    id:                 number;
    obdNumber:          string;
    shipToCustomerName: string | null;
    customer: {
      customerName:      string;
      area:              { name: string };
      salesOfficerGroup: { salesOfficer: { name: string } } | null;
      salesOfficerLinks?: Array<{
        salesOfficer: { id: number; name: string; phone: string | null };
      }>;
    } | null;
    querySnapshot: {
      totalVolume:  number;
      totalLines:   number;
      articleTag:   string | null;
    } | null;
  };
}

export interface Operator {
  id:   number;
  name: string | null;
}

/** The whole payload of GET /api/tint/manager/orders. */
export interface TintBoardPayload {
  orders:               TintOrder[];
  activeSplits:         SplitCard[];
  completedSplits:      SplitCard[];
  completedAssignments: CompletedAssignment[];
}

// ── Board row model ──────────────────────────────────────────────────────────

/**
 * The four statuses a row on the board can be in.
 *
 * These are the REAL values (lib/tint/assignment-status.ts). `"done"` is not one
 * of them and never was — it is the literal that three API routes filtered on
 * for years while matching every row ever written.
 */
export type BoardRowStatus = "assigned" | "tinting_in_progress" | "paused" | "tinting_done";

/** One row of the flat board table — an order OR a split, same shape. */
export interface BoardRow {
  /** Stable React key AND selection identity: "order-123" / "split-45". A split
   *  and an order can share a numeric id, so the raw id is never the key. */
  key:            string;
  type:           "order" | "split";
  /** orders.id for an order row, order_splits.id for a split row — the id the
   *  reorder API wants alongside `type`. */
  id:             number;
  /** ALWAYS the parent order id, for the detail panel and the modals. */
  orderId:        number;
  obdNumber:      string;
  soNumber:       string | null;
  /** Ordering dealer — its own column on the board, beside the ship-to site. */
  billToName:     string | null;
  /** The ship-to SITE. Rendered as the "Ship To" column. */
  siteName:       string;
  route:          string | null;
  volumeLitres:   number | null;
  articleTag:     string | null;
  splitNumber:    number | null;
  operatorId:     number;
  operatorName:   string;
  status:         BoardRowStatus;
  /** The timestamp the status pill shows (assigned-at / started-at / paused-at /
   *  completed-at). */
  statusAt:       string | null;
  isUrgent:       boolean;
  isKeyCustomer:  boolean;
  customerMissing: boolean;
  pauseCount:     number;
  skipCount:      number;
  /** 1..N position inside this operator's queue FOR THIS ROW TYPE. Non-null only
   *  when status === "assigned". Computed client-side: the stored sequenceOrder
   *  is a sparse MAX+1 value, not a rank. */
  seqRank:        number | null;
  canMoveUp:      boolean;
  canMoveDown:    boolean;
  /** Bulk-selectable. Whole ORDERS still WAITING only — see buildBoardRows. */
  selectable:     boolean;
  order?:         TintOrder;
  split?:         SplitCard;
  completed?:     CompletedAssignment;
}

/** One operator's section of the table. */
export interface BoardGroup {
  operatorId:   number;
  operatorName: string;
  rows:         BoardRow[];
}
