// Tint Manager — wire types for GET /api/tint/manager/orders.
//
// These moved here from tint-manager-content.tsx during the 2026-09-05 board
// rebuild. That file RE-EXPORTS all three, because components/tint/
// tint-table-view.tsx still imports them from there. That component is the
// retired Kanban table: it is no longer rendered (the import was dropped, not
// the file — CORE §3 forbids deleting it), but it is still type-checked, so its
// import must keep resolving.

import type { SkuDisplay } from "@/types/sku-display";
import type { FloorHoldRow } from "@/lib/floor/types";
import type { FormulaLine, JobTrack } from "@/lib/tint/job-track";

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
  /** Short ERP SMU code — 74 Decorative Projects, 77 Retail Offtake,
   *  70 Deco Retail. 926/926 live coverage. */
  smuCode:            string | null;
  obdEmailDate:       string | null;
  obdEmailTime:       string | null;
  orderDateTime:      string | null;
  // The OBD date line + Invoice column (2026-10-02) — Floor's facts, set by
  // app/api/tint/manager/orders billRefFields (resolveFloorDisplayDate + SAP's
  // invoiceNo / invoiceDate). Rendered with components/floor/bill-ref-cells.tsx.
  // Optional only so the retired tint-table-view.tsx literal still type-checks.
  obdDateTime?:     string | null;
  isEmailTime?:     boolean;
  invoiceNo?:       string | null;
  invoiceDate?:     string | null;
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
  /** The bill-to dealer's SAP code (import_raw_summary.billToCustomerId) — the
   *  header search matches it (2026-10-02). Optional: older payload literals. */
  billToCode?:        string | null;
  /** customer.area.primaryRoute.name — the AREA path, matching Floor's
   *  FLOOR_DEALER_SELECT. Never delivery_point_master.primaryRoute (2% cover). */
  route:              string | null;
  /** Order-level typed roll-up of the active line tags, e.g. "2 Drum, 3 Tin".
   *  NULL means UNKNOWN, never zero — only 366/920 live tint OBDs carry any
   *  article tag at all. Render an em dash, never "0". */
  articleTag:         string | null;
  isKeyCustomer:      boolean;

  // ── Ship-to override + dispatch window (2026-10-01, tabs build step 5) ─────
  /** delivery_point_master.customerName of orders.shipToOverrideCustomerId —
   *  the REDIRECTED site, set by Floor / Tint Manager ship-to. Null when the
   *  bill goes to its own site. Shown first wherever the board names a site. */
  shipToOverrideName: string | null;
  /** orders.dispatchTargetDate as YYYY-MM-DD (IST calendar day), or null. */
  dispatchTargetDate: string | null;
  /** orders.dispatchWindowId, or null. */
  dispatchWindowId:   number | null;
  /** dispatch_slot_master.windowTime of that window, e.g. "16:00". */
  dispatchWindowTime: string | null;
  /** orders.handAt (ISO) — the dealer collects. Spread onto the payload by the
   *  route's `...o`; null/absent = not Hand. Read by the bar's Hand toggle. */
  handAt?:            string | null;

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
  /** Tint lines only (lib/tint/tint-lines.ts) — the Tint tab's figures. Null =
   *  no tint line on file (fall back to the whole bill). Added 2026-10-02. */
  tintVolume?:     number | null;
  tintArticleTag?: string | null;
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
  /** The current job's work / pause segments (running or paused only) and the
   *  bill's TI formula lines — lib/tint/job-track.ts, added 2026-10-03. */
  jobTrack?:     JobTrack | null;
  formulaLines?: FormulaLine[];
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
  smuCode:          string | null;
  obdEmailDate:     string | null;
  obdEmailTime:     string | null;
  orderDateTime:    string | null;
  // The OBD date line + Invoice column (2026-10-02) — Floor's facts, set by
  // app/api/tint/manager/orders billRefFields (resolveFloorDisplayDate + SAP's
  // invoiceNo / invoiceDate). Rendered with components/floor/bill-ref-cells.tsx.
  // Optional only so the retired tint-table-view.tsx literal still type-checks.
  obdDateTime?:     string | null;
  isEmailTime?:     boolean;
  invoiceNo?:       string | null;
  invoiceDate?:     string | null;
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
  /** The parent bill's redirected site (orders.shipToOverrideCustomerId), or null. */
  shipToOverrideName: string | null;
  /** The split's own TI formula lines (lib/tint/job-track.ts), added 2026-10-03. */
  formulaLines?:  FormulaLine[];
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
  /** tint_assignments.startedAt — already on the payload (the route spreads the
   *  row's scalars); declared 2026-10-02 for the operator board's day lanes. */
  startedAt?:       string | null;
  completedAt:      string | null;
  smu:              string | null;
  smuCode:          string | null;
  obdEmailDate:     string | null;
  obdEmailTime:     string | null;
  orderDateTime:    string | null;
  // The OBD date line + Invoice column (2026-10-02) — Floor's facts, set by
  // app/api/tint/manager/orders billRefFields (resolveFloorDisplayDate + SAP's
  // invoiceNo / invoiceDate). Rendered with components/floor/bill-ref-cells.tsx.
  // Optional only so the retired tint-table-view.tsx literal still type-checks.
  obdDateTime?:     string | null;
  isEmailTime?:     boolean;
  invoiceNo?:       string | null;
  invoiceDate?:     string | null;
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
  /** The bill's redirected site (orders.shipToOverrideCustomerId), or null. */
  shipToOverrideName: string | null;
  /** Tint lines only (lib/tint/tint-lines.ts), added 2026-10-02. */
  tintVolume?:     number | null;
  tintArticleTag?: string | null;
  /** tint_assignments.accumulatedMinutes — the finished job's total tinting
   *  minutes (spread by the route's `...a`); declared 2026-10-03. */
  accumulatedMinutes?: number;
  /** Work / pause segments + TI formula lines (lib/tint/job-track.ts), 2026-10-03. */
  jobTrack?:     JobTrack | null;
  formulaLines?: FormulaLine[];
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
  /** Floor's OBD date line + Invoice column facts (2026-10-02) — from the parent bill. */
  obdDateTime:    string | null;
  isEmailTime:    boolean;
  invoiceNo:      string | null;
  invoiceDate:    string | null;
  soNumber:       string | null;
  /** import_raw_summary.smu — already on the payload, three live values:
   *  "Decorative Projects", "Retail Offtake", "Deco Retail". */
  smu:            string | null;
  /** The short ERP code for the same value — what the table actually shows. */
  smuCode:        string | null;
  /** Ordering dealer — its own column on the board, beside the ship-to site. */
  billToName:     string | null;
  /** The ship-to SITE. Rendered as the "Ship To" column. OVERRIDE-FIRST
   *  (2026-10-01): the redirected site when the bill has one. */
  siteName:       string;
  /** The bill's OWN site when siteName is a redirect, else null — the left
   *  half of Floor's ORIGINAL → REDIRECT pair (CLAUDE_FLOOR §4.9). */
  originalSiteName: string | null;
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
  /** Click-selectable (2026-10-01, tabs build step 6): whole ORDERS whose
   *  tinting is not finished — assigned, tinting or paused. Splits and today's
   *  finished rows are not: every bar action acts on a whole bill. */
  selectable:     boolean;
  /** The Floor dispatch window — orders only; null on split / finished rows. */
  slotDate:       string | null;
  slotWindowId:   number | null;
  slotWindowTime: string | null;
  /** dispatchStatus === "hold" (orders only). */
  isHeld:         boolean;
  /** The job's clock for the Tint tab's operator board (2026-10-02). startedAt =
   *  tint_assignments / order_splits .startedAt — ⚠ RESET to the resume time on a
   *  resume (CLAUDE_TINT §3.8), so after a pause it is the last resume, not the
   *  first start. completedAt = when it finished today (done rows only).
   *  pausedAt = the latest pause's time while the job is paused (orders only —
   *  pauseSummary.lastPausedAt); null otherwise. */
  startedAt:      string | null;
  completedAt:    string | null;
  pausedAt:       string | null;
  /** orders.handAt set (orders only). */
  isHand:         boolean;
  /** The job's work / pause segments (2026-10-03, lib/tint/job-track.ts) —
   *  whole-OBD running, paused and done jobs; null for assigned rows and splits
   *  (a split never pauses: the board draws startedAt → completedAt / now). */
  track:          JobTrack | null;
  /** tint_assignments.accumulatedMinutes (whole-OBD rows), else null. */
  accumulatedMinutes: number | null;
  /** The bill's TI formula lines, first line first; [] when no TI is saved. */
  formula:        FormulaLine[];
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

// ── Base — No Tint · Tinter Issue pending ────────────────────────────────────
// Wire shapes for GET /api/tint/manager/base-pending. Mirror that route's
// PendingLine / PendingOrder exactly; if either side gains a field, both move.

export interface BasePendingLine {
  rawLineItemId:     number;
  skuCodeRaw:        string;
  skuDescriptionRaw: string | null;
  unitQty:           number;
  volumeLine:        number | null;
  /** Human label ("20 L"), NOT the PackCode enum. The TI panel derives the
   *  enum itself from volumeLine/unitQty — do not send this to the API. */
  packCode:          string | null;
  /** A TI row exists against THIS assignment for this line. */
  hasTiEntry:        boolean;
}

export interface BasePendingOrder {
  orderId:           number;
  obdNumber:         string;
  /** Board cells (2026-10-02) — the TI tab uses the Tint / Base table's columns. */
  obdDateTime:       string | null;
  isEmailTime:       boolean;
  invoiceNo:         string | null;
  invoiceDate:       string | null;
  smu:               string | null;
  smuCode:           string | null;
  route:             string | null;
  articleTag:        string | null;
  /** History only (base-pending?date=, 2026-10-02): who wrote the TI that day,
   *  when (the latest), the sampling numbers, and the line count that day. */
  tiWrittenBy?:      string | null;
  tiWrittenAt?:      string;
  tiSamplingNos?:    string[];
  tiLinesOnDay?:     number;
  /** LIVE only (2026-10-02): every line has a TI, the last written TODAY (IST) —
   *  when. Such a row stays on the TI tab for the rest of the day as a read-only
   *  "TI done" row, listed after the pending ones, and is not counted. */
  tiDoneAt?:         string;
  /** Header search (2026-10-02) — SAP's ship-to and bill-to customer codes. */
  shipToCode:        string | null;
  billToCode:        string | null;
  /** Header filters (2026-10-02). */
  deliveryTypeName:  string | null;
  priorityLevel:     number;
  siteName:          string;
  /** orders.customerId — the numeric site FK the suggest endpoint needs. */
  siteId:            number | null;
  /** Display only (step 7): the redirected site, else siteName. TI stays on siteName/siteId. */
  shipToName:        string;
  /** siteName when a redirect is in force, else null. */
  originalSiteName:  string | null;
  /** The bill's volume (import_obd_query_summary.totalVolume). */
  totalVolume:       number | null;
  billToName:        string | null;
  tintAssignmentId:  number;
  bypassedAt:        string | null;
  totalTintingLines: number;
  coveredLines:      number;
  lines:             BasePendingLine[];
}

// ── Hold tab (2026-10-01, tabs build step 7) ─────────────────────────────────
// GET /api/tint/manager/hold — Floor's Hold row (lib/floor/queries.ts
// getFloorHold, extraWhere { orderType: "tint" }) plus the tint facts the tab adds.

export interface TintHoldRow extends FloorHoldRow {
  workflowStage: string;
  /** The bill's OWN site when a ship-to redirect is in force (left half of the pair), else null. */
  originalSiteName: string | null;
  dispatchTargetDate: string | null;
  dispatchWindowId: number | null;
  dispatchWindowTime: string | null;
  /** The latest whole-OBD assignment's operator, or null (waiting / no row). */
  operatorName: string | null;
  /** That assignment's status (assigned / tinting_in_progress / paused / tinting_done / …). */
  assignmentStatus: string | null;
}
