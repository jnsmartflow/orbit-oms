// Floor Control — data-layer row/card shapes for the four feeds.
// Reuses Picking's PickingQueueRow for the floor board (so lib/picking/sort.ts's
// spine applies unchanged) and its SortRule; the rail/hold/cancelled feeds have
// their own shapes. No component or DB code here — pure types.

import type { PickingQueueRow, SortRule } from "@/lib/picking/types";

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
  heldAt: string | null; // ISO
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
