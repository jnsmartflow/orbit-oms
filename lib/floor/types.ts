// Floor Control — data-layer row/card shapes for the four feeds.
// Reuses Picking's PickingQueueRow for the floor board (so lib/picking/sort.ts's
// spine applies unchanged) and its SortRule; the rail/hold/cancelled feeds have
// their own shapes. No component or DB code here — pure types.

import type { PickingQueueRow, SortRule } from "@/lib/picking/types";
import type { ColourWork } from "@/lib/picking/colour-work";
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
  /**
   * TINT / BASE / say nothing — lib/picking/colour-work.ts owns the rule.
   *
   * ⚠ NOT `isTint`. That flag is `orderType === "tint"` and stays true on a bill
   * the Tint Manager closed as "Base — No Tint", so it calls a stock-colour bill
   * tinted. Anything a human READS comes from this field; `isTint` remains the
   * answer to "did it go through the tint rail", which the filters still ask.
   */
  colourWork: ColourWork | null;
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
  /**
   * The bill has LEFT THE DEPOT — workflowStage `dispatched`, rank 100.
   *
   * 🔴 ONLY A HISTORY ROW IS EVER TRUE HERE. The live board predicate
   * (`floorLiveBaseWhere`) does not admit rank 100 and must never be widened to;
   * only `FLOOR_HISTORY_STAGES` does. A true value on a live row would mean the
   * live predicate has been widened and a shipped bill is back on the floor.
   *
   * ⚠ FLOOR’S `isChecked` IS WIDER THAN PICKING’S, AND THIS IS WHY. The inherited
   * field is documented on PickingQueueRow as "True at exactly PICK_CHECKED",
   * and lib/picking/queue.ts still sets it that way. getFloorBoard sets it true
   * for `dispatched` as well, because a shipped bill WAS checked and a history
   * row reporting otherwise would show finished work as untouched. The two
   * payloads therefore answer "isChecked" slightly differently on purpose; this
   * field is what lets a Floor surface tell the two apart when it needs to.
   *
   * ⚠ DECLARED HERE, NOT ON PickingQueueRow — the same boundary `smu`,
   * `billToName`, the ship-to pair and `tripDropId` sit on (FLOOR §1: Floor is a
   * CALLER of Picking; widen the Floor type, never the Picking one).
   */
  isDispatched: boolean;
  /**
   * WHERE THIS BILL IS IN THE TINT ROOM — `null` on every plain order
   * (2026-09-13).
   *
   * 🔴 ONE EXPLICIT PHASE, NOT TWO MORE BOOLEANS, AND THE REASON IS A BUG THAT
   * HAS BITTEN THREE TIMES. `lib/workflow-stages.ts` warns that a new stage is
   * `false` on every existing boolean, so an inline `!isAssigned && !isDone`
   * silently reads it as "still waiting" — which is exactly what happened to
   * `pick_done`, then `pick_checked`, then `dispatched`. A pair of
   * `isTintPending` / `isTinting` flags would rebuild that trap for the fourth
   * time: add a tint stage tomorrow and it reads as a plain waiting bill again.
   * A single named phase cannot do that — an unmapped stage produces an
   * unmapped VALUE, which is visible, rather than a false, which is not.
   *
   * The four values, derived server-side from `orders.workflowStage` in the
   * row builder (lib/floor/queries.ts) and nowhere else:
   *   "pending"  — pending_tint_assignment. Nobody has been given the shades.
   *   "assigned" — tint_assigned. An operator has it and has not started.
   *   "tinting"  — tinting_in_progress. On the mixer. A PAUSED job lives here
   *                too: pause/resume write the assignment row and never the
   *                order's stage (CLAUDE_TINT §5), so the stage cannot tell a
   *                paused job from a running one and this value must not claim
   *                to. See the pill labels for how that is handled honestly.
   *   "done"     — a tint bill past all four tint stages. NOT "it was tinted"
   *                — it is "the tint room has no more claim on it", which is the
   *                question the floor is asking.
   *
   * ⚠ "assigned" SPLIT OUT OF "tinting" ON 2026-09-14. The two were merged, so
   * a bill sitting untouched in an operator's queue rendered the same pill as
   * one actually on the mixer — the board claimed work was happening when it
   * may not have been. Same shape of lie as the grey "Waiting" this whole enum
   * was introduced to fix, one level down.
   *
   * ⚠ IT DOES NOT SAY WHOSE HANDS THE BILL IS IN. A tint bill with a picker is
   * `tintPhase: "done"` AND `isAssigned: true`, and `rowStatus` reads the
   * picking booleans FIRST — so the pill says "With picker", not "Tint done".
   * The phase is the tint room's answer; the booleans are the floor's, and the
   * floor's outranks it once a picker has the bill.
   *
   * ⚠ DECLARED HERE, NOT ON PickingQueueRow — the same boundary `isDispatched`
   * above, `smu`, `billToName` and `tripDropId` sit on. Widening the shared
   * interface would force every Picking construction site to fill a field that
   * screen has no use for (FLOOR §1: Floor is a CALLER of Picking).
   */
  tintPhase: "pending" | "assigned" | "tinting" | "done" | null;
  /**
   * When the tint room finished with it — `tint_assignments.completedAt`, the
   * LATEST whole-order row (2026-09-14). Null on a plain order, and on a tint
   * bill nobody has finished.
   *
   * 🔴 THE ONE TINT FIELD THE BOARD PAYS FOR, and it was measured before it was
   * added. The board query reads `tint_assignments` for this and nothing else:
   * ONE extra statement (20 on the orders fetch, 60 on the whole call), whose
   * own EXPLAIN ANALYZE is 0.05 ms, and whose wall-clock delta is below the
   * measurement floor on this link — interleaved n=8, alternating lead, it came
   * out at -46 ms, i.e. indistinguishable. Prisma emits a separate SELECT for a
   * relation rather than a SQL JOIN, so the board's own query plan is
   * byte-identical either way.
   *
   * ⚠ EVERYTHING ELSE ABOUT THE TINT ROOM STAYS OFF THIS ROW. Operator, start,
   * assignment status and shade progress are on the detail panel, which pays a
   * round trip on click, and the operator name is on the Tinting tab's own
   * tab-scoped route. This field is here only because a pill with no time beside
   * three pills that have one reads as broken.
   *
   * ⚠ NO FALLBACK. When it is null the pill renders no time. `order_status_logs`
   * records the stage change out of `tinting_in_progress` and could stand in,
   * but it is a transition log rather than the completion stamp, and a
   * plausible-looking wrong clock is worse than none. Live check 2026-09-14:
   * 976 of 976 finished whole-order assignments carry the real value, so the
   * null case is rare by construction rather than by hope.
   */
  tintCompletedAt: string | null;
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
  // SAP's own invoice facts (orders.invoiceNo / orders.invoiceDate), distinct
  // from orders.invoicedAt — which is Billing's "I marked this done" decision,
  // not a SAP fact (CORE §7.3). Blank until SAP stamps the bill: verified live
  // 2026-08-31, 65 of the 74 rows on the board carried one and every single one
  // of those was at pick_checked — nothing still open had an invoice yet.
  //
  // ⚠ ALSO FREE, same as the ship-to pair above: getFloorBoard uses `include`,
  // not `select`, so every `orders` scalar is already on the fetched row. No
  // extra query, no extra await, and above all no write (FLOOR §5/§10 — the
  // live marker keys on MAX(orders.updatedAt)).
  //
  // ⚠ DECLARED HERE, NOT ON PickingQueueRow — same boundary as `smu`,
  // `billToName` and the ship-to pair above (FLOOR §1: Floor is a CALLER of
  // Picking; widen the Floor type, never the Picking one).
  invoiceNo: string | null;
  // ISO string, serialised like every other date on this payload (a Date would
  // promise the client something JSON never delivers). DATE-ONLY IN PRACTICE:
  // every non-null value in `orders` is 00:00:00 UTC (verified live 2026-08-31,
  // 6,962 rows, zero exceptions), so an IST render lands on the same calendar
  // day and there is no midnight-rollover class here.
  invoiceDate: string | null;
  // ── Show to floor, PER TRIP (slice 8, 2026-09-15) ─────────────────────────
  // `pickVisibleAt` (the per-bill handover stamp) was here until slice 8 and is
  // gone: the desk shows the supervisor one TRUCK at a time now.
  //
  // TRUE for a WAITING bill (pending_picking, dispatch) on a trip that has NOT
  // been shown — exactly what the supervisor's Assign tab leaves out while desk
  // control is on. Computed server-side (lib/floor/queries.ts), because the row
  // carries neither the stage nor the dispatch status. A bill on no trip is never
  // awaiting a show. `isHeldBack()` in components/floor/status-pill.tsx is the
  // ONE reader; the pill and the header count both ask it.
  //
  // ⚠ DECLARED HERE, NOT ON PickingQueueRow — same boundary as `smu`,
  // `billToName`, the ship-to pair and the invoice pair above (FLOOR §1).
  isAwaitingShow: boolean;
  // ── The bill's TRIP (2026-09-09) ─────────────────────────────────────────
  //
  // `tripDropId` is the ONE pointer on `orders`; the trip itself is reached
  // through `trip_drops.tripId`, and there is deliberately no `tripId` column
  // on the order (trip-schema draft §C4 — two pointers can disagree and nothing
  // would catch it). getFloorBoard resolves the pair with TWO batched findMany
  // calls, never an include chain.
  //
  // NULL on all three = the bill is on no trip. On the board that means it sits
  // in the At-desk pool.
  //
  // ⚠ THESE ARE FOR THE ROW'S TAG, NOT FOR BUILDING THE TRIP BANDS. The By-trip
  // view reads GET /api/floor/trips, because a trip whose bills are all finished
  // is no longer in `floorLiveBaseWhere`'s set — bands filtered off board rows
  // would render empty and their progress bars would lie. Two different
  // questions: "which trip is this row on" (here) and "what trips exist today"
  // (the route).
  //
  // ⚠ DECLARED HERE, NOT ON PickingQueueRow — same boundary as `smu`,
  // `billToName`, the ship-to pair, the invoice pair and `isAwaitingShow` above
  // (FLOOR §1: Floor is a CALLER of Picking; widen the Floor type, never the
  // Picking one).
  tripDropId: number | null;
  tripNumber: string | null;
  /** draft | released | loading | dispatched | cancelled — chk_trips_status. */
  tripStatus: string | null;
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
/**
 * The Tint block on the detail panel — what the archived rail strip used to show,
 * plus the two timestamps the pill has no room for.
 *
 * ⚠ THE WHOLE-ORDER ASSIGNMENT, latest first. An order reassigned to a second
 * operator leaves its earlier row behind, and the most recent one describes the
 * bill. Split-level assignments (`splitId` not null) are excluded — a split
 * order's completion lives per split and has no single whole-order moment, the
 * same v1 boundary the retired rail strip drew.
 */
export interface FloorDetailTint {
  /** tint_assignments.assignedTo.name — null when nobody has it yet. */
  operatorName: string | null;
  /**
   * The ASSIGNMENT's status, not the order's stage: `assigned`,
   * `tinting_in_progress`, `paused`, `tinting_done`, `skipped`, `cancelled`.
   * A plain String column with no CHECK — CORE §3's status-string rule applies,
   * so read it, never retype a literal to compare against it.
   */
  status: string | null;
  /** tint_assignments.createdAt — when the operator was given it. */
  assignedAt: string | null;
  /** tint_assignments.startedAt — when mixing began. Null until Start. */
  startedAt: string | null;
  /** tint_assignments.completedAt — when it finished. Null until done. */
  completedAt: string | null;
  /** Non-cancelled `order_splits` at `tinting_done`, over the non-cancelled total.
   *  Both 0 on a full (non-split) OBD — see `hasSplits`. */
  shadesDone: number;
  shadesTotal: number;
  /** TRUE when the order has ANY split rows, counted BEFORE the cancelled
   *  filter. Do NOT infer "full OBD" from shadesTotal === 0: an order whose
   *  splits were all cancelled also reports 0. The same trap the retired
   *  TintState carried this flag for. */
  hasSplits: boolean;
}

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
  /** TINT / BASE / nothing — the same field, and the same warning, as
   *  FloorPartyFields above. The panel's Details tab reads THIS, not `isTint`. */
  colourWork: ColourWork | null;
  isSite: boolean;             // Retail Offtake / Decorative Projects, not overridden

  /**
   * THE TINT ROOM'S OWN FACTS — null on a plain order, and on a tint order that
   * has never been assigned (2026-09-14).
   *
   * 🔴 THIS IS WHY THE BOARD ROW DOES NOT CARRY THEM. Operator, start and finish
   * all live on `tint_assignments`, which the board query deliberately does not
   * read: the rail feed that used to was deleted on 2026-09-13 for costing
   * 772 ms and 25 statements per call on a payload nothing rendered. Reading it
   * here costs ONE round trip, ON CLICK — not on every board load and not on
   * every 30-second poll. The pill says which state; the panel says who, when
   * and how far.
   *
   * ⚠ `status` IS THE ASSIGNMENT'S, NOT THE ORDER'S, and that is the whole
   * reason it is here. Pause and resume write the assignment row and never the
   * order's stage (CLAUDE_TINT §5), so `workflowStage` cannot tell a paused job
   * from a running one and neither can the pill. This field can, and it is the
   * only place on the floor that can.
   */
  tint: FloorDetailTint | null;

  // Picking status (for the floor-source header pill + Details picker line)
  isAssigned: boolean;
  isDone: boolean;
  isChecked: boolean;
  /**
   * Shipped — workflowStage `dispatched` (2026-09-11).
   *
   * Mirrors FloorBoardRow.isDispatched so the detail panel can label a history
   * row correctly. The route sets `isChecked` true for a dispatched bill as
   * well (it was checked on its way out), so every reader must test THIS first
   * or a shipped bill reads as "Done".
   */
  isDispatched: boolean;
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
