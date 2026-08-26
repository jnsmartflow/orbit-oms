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
  // TRUE when the order has ANY order_splits rows at all, counted BEFORE the
  // cancelled filter. Do NOT infer "full OBD" from shadesTotal === 0: an order
  // whose splits were ALL cancelled also reports 0 and would be misread as a
  // full OBD — sending it down the whole-order completion path, where it has no
  // tint_assignments row to anchor to.
  hasSplits: boolean;
  // Whole-order tint completion — tint_assignments.completedAt (latest row when
  // an order has more than one). null means either not finished yet, or a SPLIT
  // order, whose completion lives per-split on order_splits.completedAt with no
  // single whole-order moment (out of v1 scope).
  //
  // ISO string, not Date, for the same reason obdDateTime is: FloorRailCard is
  // the /api/floor/board PAYLOAD type, and JSON serialises a Date to an ISO
  // string in transit — so a Date here would promise the client something it
  // never receives. getFloorRail keeps the real Date internally for the engine
  // call and serialises only on the way onto this object.
  completedAt: string | null; // ISO
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
  // True when obdDateTime (above, on FloorPartyFields) is the EMAIL clock
  // (orders.orderDateTime) rather than SAP's own punch clock
  // (orders.obdEmailDate) — see lib/floor/format.ts resolveFloorDisplayDate().
  isEmailTime: boolean;
  ageDays: number;            // days since arrival (carried-over tag); 0 = today
  // True when two or more live orders carry this bill's soNumber. Same field,
  // same rule and same one-query source as PickingQueueRow.hasDuplicateSo
  // (lib/picking/duplicate-so.ts owns it) — declared here because the rail card
  // does NOT extend the picking row, unlike FloorBoardRow which inherits it.
  // A BOOLEAN ONLY: `soNumber` stays off this payload by design.
  hasDuplicateSo: boolean;
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
  // The ship-to PAIR, mirroring FloorRailCard above: `customerName` is the
  // ORIGINAL ship-to (orders.customer) and `shipToOverrideName` is the redirect
  // target (shipToOverrideCustomer). Both are distinct from
  // PickingQueueRow.dealerName, which is the EFFECTIVE dealer (override ??
  // customer) and therefore loses the original name on a redirect — the table
  // could only print a nameless "→ ship-to changed" caption without these
  // (CLAUDE_FLOOR §8b: "the ship-to original→redirect name pair is missing on
  // the floor table (rail already has it)").
  //
  // ⚠ DECLARED HERE, NOT ON PickingQueueRow. lib/picking/types.ts is owned by
  // CLAUDE_PICKING §3 and Floor is a CALLER only (FLOOR §1 ownership boundary) —
  // widen the Floor type, never the Picking one. Same reason `smu` and
  // `billToName` above live here.
  //
  // Both come free: getFloorBoard's include already selects `customerName` on
  // BOTH relations via FLOOR_DEALER_SELECT, so filling them adds no query and no
  // await (FLOOR §5/§10 — the live marker keys on MAX(orders.updatedAt)).
  //
  // Nullable on purpose: an unmatched bill has no `customer` row at all, and the
  // table falls back to its old caption rather than printing a blank arrow.
  customerName: string | null;
  shipToOverrideName: string | null;
  // True when obdDateTime (on PickingQueueRow) is the EMAIL clock
  // (orders.orderDateTime) rather than SAP's own punch clock
  // (orders.obdEmailDate) — see lib/floor/format.ts resolveFloorDisplayDate().
  isEmailTime: boolean;
  // ⚠ `totalArticle` was added here on 2026-08-11 for the By-picker card and
  // REMOVED the same day, superseded: the card now shows a typed breakdown
  // ("18 D · 14 C") built from `articleTag` via formatArticleBreakdown()
  // (lib/floor/format.ts), which a single integer cannot express. Nothing read
  // the number once the breakdown landed, and a payload field with no reader is
  // the `orders.mailMatched` shape CORE §7.3 flags. Re-add it — one extra key
  // in the querySnapshot select — if a caller ever wants to sort or total by it.
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
  // By-group candidates — one entry per WAITING due-zone row (see below). A
  // SIBLING key, deliberately not a field on FloorBoardRow: only waiting bills
  // can be bundled, so hanging the array off every row would ship an empty
  // array on Assigned/Done/checked rows for no reader — the exact shape the
  // removed `totalArticle` field was (FloorBoardRow above).
  waitingSkus: FloorWaitingSkus[];
  // Rule 2 (oil-paint bundling) candidates — a SIBLING of waitingSkus, same
  // shape, same order, narrowed by scopeBoard the same way. EMPTY ARRAY when
  // RULE2_ENABLED is false (lib/floor/queries.ts): the field always exists so
  // no caller's type changes with the flag, and an empty array yields zero
  // groups from buildOilGroups by construction — nothing qualifies at a 0%
  // oil share. See the notes on FloorOilSkus below.
  oilSkus: FloorOilSkus[];
}

// ── By-group (pick bundling) ─────────────────────────────────────────────────
// Nothing here is stored. The engine (lib/picking/grouping.ts) is recomputed on
// every board load; there is no table and no column behind any of it.

/** One waiting bill's distinct SAP codes, as they ride /api/floor/board.
 *
 *  `skus` is DISTINCT and sorted (locale "en") at the source, so the payload is
 *  byte-stable between loads — grouping.ts is deterministic by contract and
 *  cannot be if its input reshuffles.
 *
 *  ⚠ These are `import_raw_line_items.skuCodeRaw` values — the SAP code, the
 *  stable natural key. NEVER a `skuId` and never anything read out of
 *  `sku_master` (CORE §13 id-space landmine).
 *
 *  An EMPTY array is a real answer (a bill with no `lineStatus='active'` lines),
 *  never an omission — grouping.ts drops those candidates explicitly, and the
 *  comment there says why that guard is load-bearing. */
export interface FloorWaitingSkus {
  orderId: number;
  skus: string[];
}

/** One waiting bill's OIL-PAINT subset — the same codes as its FloorWaitingSkus
 *  entry, filtered to those that resolve to a 10K-warehouse family in
 *  `sku_master_v2` (lib/picking/grouping.ts owns the rule: GLOSS · PROMISE ENAMEL
 *  · SATIN+oil · PRIMER+oil).
 *
 *  ⚠ Resolved on `sku_master_v2.material` === `import_raw_line_items.skuCodeRaw`
 *  — never a `skuId`, never old `sku_master` (CORE §13 id-space landmine).
 *
 *  ⚠ An UNCATALOGUED or blank code is absent from `skus` here, which is the
 *  point: unknown must never count as inside the oil end. A bill can therefore
 *  have a long `FloorWaitingSkus.skus` and an empty one here, and that is a real
 *  answer — it simply will not qualify for Rule 2.
 *
 *  Emitted in the SAME order as waitingSkus (which is the board's own row order)
 *  so the payload is byte-stable between loads — grouping.ts is deterministic by
 *  contract and cannot be if its input reshuffles. */
export interface FloorOilSkus {
  orderId: number;
  skus: string[];
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
//
// ⚠ `"history"` is READ-ONLY and is the ONLY source that is (2026-08-25). It is
// the same bill `"floor"` describes, opened from a PAST day, so every action
// that would write must be absent — not disabled — because a write from a
// history panel edits a day the depot has already closed and invoiced.
//
// The suppression works by DEFAULT rather than by enumeration, which is the
// reason this is a new member of this union instead of a separate `readOnly`
// prop: every gate in detail-panel.tsx is written as `source === "floor"` /
// `=== "rail"` / `=== "hold"` / `=== "cancelled"`, so a NEW member matches none
// of them and each action disappears on its own. Only gates phrased as a
// NEGATION (`source !== "cancelled"`) and controls that are ungated had to be
// touched — see `readOnly` in detail-panel.tsx, which is the one derived
// boolean, mirroring `interactive` in floor-table.tsx. Do not add a third
// read-only concept; extend this union.
export type FloorDetailSource = "rail" | "floor" | "hold" | "cancelled" | "history";

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
