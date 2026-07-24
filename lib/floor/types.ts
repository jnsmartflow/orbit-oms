// Floor Control — data-layer row/card shapes for the four feeds.
// Reuses Picking's PickingQueueRow for the floor board (so lib/picking/sort.ts's
// spine applies unchanged) and its SortRule; the rail/hold/cancelled feeds have
// their own shapes. No component or DB code here — pure types.

import type { PickingQueueRow, SortRule } from "@/lib/picking/types";
import type { HeldSinceSource } from "./hold-log";

export type { SortRule };

// Delivery-type scope (design §5.1). "All" means no filter.
export type FloorScope = "All" | "Local" | "Upcountry" | "IGT";

// Render-time slot suggestion — what the left-rail Release button offers.
// Null (elsewhere) means the UI shows grey "Set slot".
export interface SlotSuggestion {
  windowTime: string; // "10:30" | "12:30" | "16:00" | "18:00"
  targetDate: string; // ISO date-only, e.g. "2026-07-27"
  ruleId: string;     // engine rule id (audit/debug)
}

// Tint state for a rail card's strip (design §6.3). null on non-tint bills.
export type TintStage = "waiting" | "assigned" | "mixing" | "ready";
export interface TintState {
  stage: TintStage;
  shadesDone: number;         // non-cancelled splits at tinting_done
  shadesTotal: number;        // non-cancelled splits
  operatorName: string | null;
}

// Party + flags block shared by the rail / hold / cancelled rows.
export interface FloorPartyFields {
  dealerName: string;         // effective ship-to (shipToOverrideCustomer ?? customer)
  billToName: string | null;  // bill-to dealer (import_raw_summary.billToCustomerName)
  isShipToOverride: boolean;
  smu: string | null;         // for the site-vs-shop rule (design §7.5)
  route: string | null;
  area: string | null;
  deliveryType: string | null;
  isKeyCustomer: boolean;
  priorityLevel: number;
  isTint: boolean;
  volumeLitres: number | null;
  articleTag: string | null;
  obdDateTime: string | null; // ISO
}

// Left rail card — "needs your decision".
export interface FloorRailCard extends FloorPartyFields {
  orderId: number;
  obdNumber: string;
  workflowStage: string;
  // The card headline is the ORIGINAL ship-to (orders.customer), and the
  // ship line is the override target (shipToOverrideCustomer) — distinct from
  // FloorPartyFields.dealerName, which is the EFFECTIVE dealer (override ??
  // customer) and would lose the original name on a redirect (04-card-spec §4).
  customerName: string | null;
  shipToOverrideName: string | null;
  ageDays: number;            // days since arrival (carried-over tag); 0 = today
  tint: TintState | null;
  suggestion: SlotSuggestion | null;
  // A human pre-set slot on a still-un-released bill (design §4.16 / §6.3 tint
  // pre-set) — displayed on the Slot button. null when none.
  presetWindowTime: string | null;
  presetTargetDate: string | null;
}

// Floor board row — extends the picking row so the spine sort applies as-is.
// Floor-only extras added on top (smu + bill-to for the §7.5 marker).
export interface FloorBoardRow extends PickingQueueRow {
  smu: string | null;
  billToName: string | null;
}

export interface FloorWindowCount {
  id: number;
  windowTime: string;
  sortOrder: number;
  count: number; // due-zone rows in this window
}

// Active picker + current load, for the assignment bar's dropdown (design §7.8:
// "Ramesh - 3 on hand, Dinesh - free"). `onHand` = bills the picker is actively
// picking now (workflowStage === pick_assigned).
export interface FloorPicker {
  id: number;
  name: string;
  onHand: number;
}

export interface FloorBoardResult {
  mode: "live" | "history";
  date: string; // anchor day (today for live; the viewed day for history)
  rows: FloorBoardRow[];
  windows: FloorWindowCount[];
  total: number; // due-zone rows (excludes upcoming)
}

// Hold tab row (design §8).
export interface FloorHoldRow extends FloorPartyFields {
  orderId: number;
  obdNumber: string;
  // `heldAt` is the raw column — the bill's ARRIVAL date, not the moment it was
  // held (CLAUDE_SUPPORT §4.9). Kept on the row for reference; the Hold tab's
  // age banding reads `heldSince` instead.
  heldAt: string | null; // ISO
  // Wall-clock "on hold since", derived on the read side from the hold event's
  // order_status_logs.createdAt — see lib/floor/hold-log.ts for why.
  heldSince: string | null; // ISO
  heldSinceSource: HeldSinceSource;
}

// Cancelled tab row (design §9) — cancel time + actor come from the
// order_status_logs cancel event, not a dedicated column.
export interface FloorCancelledRow extends FloorPartyFields {
  orderId: number;
  obdNumber: string;
  cancelledAt: string | null;   // ISO — latest cancel-log createdAt
  cancelledByName: string | null;
  reason: string | null;        // cancel-log note
}

// ── Detail panel (design §10) ────────────────────────────────────────────────
// Which surface the panel was opened FROM — drives the context-primary action
// and which list Prev/Next walks (design §10.3 / §10.5).
export type FloorDetailSource = "rail" | "floor" | "hold" | "cancelled";

// One line item on the Items tab. Pack resolves via sku_master_v2 on
// material === skuCodeRaw (CORE §13); raw-text fallback preserved. Gift lines
// are OUT OF SCOPE — no gift tag, no gift-excluded totals.
export interface FloorDetailLine {
  id: number;
  sku: string;
  name: string | null;   // sku_master_v2.description ?? raw SAP description
  pack: string | null;   // formatPack(...) ?? null (blank stays blank)
  qty: number;
  litres: number;        // import_raw_line_items.volumeLine, 0 when null
  isTint: boolean;
}

// One Activity-tab entry. Real rows come from order_status_logs; the single
// synthetic entry (auto-slot) is flagged so the component labels it as coming
// from enrichment (design §10.4 — the engine writes no log).
export interface FloorActivityEntry {
  at: string | null;     // ISO; null on the synthetic enrichment line (no log ts)
  note: string | null;
  fromStage: string | null;
  toStage: string | null;
  actorName: string | null;
  synthetic?: boolean;   // true = derived (auto-slot), not a real log row
}

// The whole detail payload for one order — header + Details groups + Items +
// Activity, in ONE GET (app/api/floor/order/[orderId]).
export interface FloorDetail {
  orderId: number;
  obdNumber: string;
  obdDateTime: string | null;
  orderType: string;
  workflowStage: string;
  dispatchStatus: string | null;

  // Header / effective ship-to
  shipToName: string;          // effective dealer (override ?? customer)
  shipToCode: string | null;
  isShipToOverride: boolean;
  isKeyCustomer: boolean;
  priorityLevel: number;
  isTint: boolean;
  isSite: boolean;             // Retail Offtake / Decorative Projects, not overridden

  // Picking status (for the floor-source header pill + Details picker line)
  isAssigned: boolean;
  isDone: boolean;
  isChecked: boolean;
  pickerName: string | null;
  checkedByName: string | null;

  // Details — Parties
  billToName: string | null;
  billToCode: string | null;
  overrideName: string | null; // shipToOverrideCustomer.customerName (when set)
  overrideCode: string | null;
  customerName: string | null; // the resolved ship-to customer (pre-override)
  customerCode: string | null;

  // Details — Reference
  soNumber: string | null;
  invoiceNo: string | null;
  invoiceDate: string | null;

  // Details — Classification
  deliveryType: string | null;
  smu: string | null;
  route: string | null;
  area: string | null;

  // Details — Planning
  dispatchTargetDate: string | null; // YYYY-MM-DD
  dispatchWindowTime: string | null;
  dispatchWindowId: number | null;
  materialType: string | null;

  // Auto-slot provenance (the Activity synthetic line, design §10.4)
  dispatchSlotSource: string | null;
  dispatchSlotRuleId: string | null;

  lines: FloorDetailLine[];
  totalLitres: number;
  activity: FloorActivityEntry[];
}
