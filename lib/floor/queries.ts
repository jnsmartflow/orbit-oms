// Floor Control — the four read feeds behind /floor. SELECT-only. Sequential
// awaits, never prisma.$transaction (CORE §3). Catalog is never touched here
// (the feeds are order-level aggregates); no sku id resolution, so the §13
// id-space landmine is not in play.
//
// THE SPLIT (design §3 / §6.4, the rule that governs everything):
//   - Left rail  = bills NOT yet released to the floor AND with no dispatch
//                  DECISION made. A bill enrichment successfully slotted is,
//                  by construction, already at pending_picking (enrichment's
//                  auto-done advanced it) with dispatchStatus="dispatch" — so
//                  it can never satisfy the rail predicate. No bill is in both.
//   - Floor      = released bills (dispatchStatus="dispatch") that are not yet
//                  pick_checked, plus today's checked. Floor's OWN carry-over
//                  scope — NOT lib/picking/queue.ts's WHERE.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getHideExclusion } from "@/lib/hide/visibility";
import { inScope } from "./scope";
import { getISTDayRange } from "@/lib/dates";
import { sortPickingQueue } from "@/lib/picking/sort";
import { FLOOR_SPINE } from "@/lib/floor/sort";
import { resolveFloorDisplayDate } from "@/lib/floor/format";
import {
  STAGE_LADDER,
  PICKING_OPEN_STAGES,
  PICKING_ACTIVE_STAGES,
  PICK_ASSIGNED,
  PICK_DONE,
  PICK_CHECKED,
} from "@/lib/workflow-stages";
import { suggestSlot } from "./suggest";
// Rule 2's oil-paint definition lives in the ENGINE, not here and not in the
// database — grouping.ts is pure (no prisma, no clock), so importing it into a
// server module is one-directional and safe.
import { buildOilSkuSet } from "@/lib/picking/grouping";
import { HOLD_LOG_NOTES, type HeldSinceSource } from "./hold-log";
import type {
  FloorScope,
  FloorRailCard,
  FloorBoardRow,
  FloorBoardResult,
  FloorHoldRow,
  FloorCancelledRow,
  FloorPicker,
  FloorWaitingSkus,
  FloorOilSkus,
  TintState,
  TintStage,
  SlotSuggestion,
} from "./types";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// Pre-release stages (rank < 60 = before pending_picking). DERIVED from the
// ladder, never hand-written, so a new pre-picking stage joins automatically.
// order_created (10) is included for safety though import never writes it
// (route.ts:1102 creates orders at pending_support / pending_tint_assignment).
const RAIL_STAGES: string[] = STAGE_LADDER
  .filter((d) => d.rank !== null && d.rank < 60)
  .map((d) => d.stage);

// Step 10 — the render-time slot SUGGESTION is ON. Non-tint bills anchor on
// arrival; a COMPLETED full (non-split) tint OBD anchors on its completion time.
// Split tints and unfinished tints still get nothing — see the suggestion block
// in getFloorRail for the full ladder and why.
//
// The 23-Jul stale-date bug ("Release to Wed 16:00" on a Thursday) that took this
// down is now FIXED AT SOURCE — lib/floor/suggest.ts grew a past-date arm — not
// hidden behind this flag. Turning it on only makes DATA flow: `suggestion` has
// always been on FloorRailCard and has always shipped through /api/floor/board,
// and no component reads it yet (rail-card.tsx still renders the grey picker), so
// there is no visible change and no write path.
//
// The constant stays as the single kill switch: flip to `false` and every card
// goes back to suggestion=null, no other edit needed.
const RAIL_SUGGESTIONS_ENABLED = true;

// Rule 2 — the oil-paint (10K warehouse) bundler, a TRIAL. Same shape and same
// role as RAIL_SUGGESTIONS_ENABLED above: the single kill switch.
//
// FALSE REMOVES RULE 2 COMPLETELY. No catalog fetch happens (the extra await
// below is inside the branch, so the flag costs a query, not just an if), and
// `oilSkus` ships as an EMPTY ARRAY — which yields zero groups from
// buildOilGroups by construction, since no bill can reach a 50% oil share
// against an empty set. The FIELD still exists on FloorBoardResult either way,
// so no caller's type changes with the flag and no branch is needed downstream.
//
// Rule 1 (buildPickGroups) is untouched by this in both directions: it never
// sees the oil data, runs FIRST over the whole waiting pool, and always wins a
// contested bill. Flipping this line cannot change a single Rule 1 group.
//
// ⚠ The reason a kill switch is warranted here and not for Rule 1: Rule 2's
// bundles are deterministic per load but NOT stable across loads — the full
// argument is above buildOilGroups in lib/picking/grouping.ts. Read it before
// deciding this flag's fate.
const RULE2_ENABLED = true;

// Shared dealer projection — route/area/delivery-type/key-customer all come
// from the effective dealer's AREA (design §D3 / matches lib/picking/queue.ts).
const FLOOR_DEALER_SELECT = {
  id: true,
  customerName: true,
  isKeyCustomer: true,
  area: {
    select: {
      name: true,
      primaryRoute: { select: { name: true } },
      deliveryType: { select: { name: true } },
    },
  },
} as const;

// ── Date helpers (IST, UTC-midnight anchored — same basis as picking/queue) ──

function getISTTodayDateOnly(): Date {
  const istNow = new Date(Date.now() + IST_OFFSET_MS);
  return new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate()));
}

const DATE_STR_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Parse "YYYY-MM-DD" to a UTC-midnight Date (the @db.Date shape). Throws on a
 *  malformed or impossible calendar date so the route can surface a 400 rather
 *  than silently answer for the wrong day (mirrors picking's resolveTargetDate). */
export function parseFloorDate(dateStr: string): Date {
  if (!DATE_STR_RE.test(dateStr)) throw new Error(`Invalid date "${dateStr}" — expected YYYY-MM-DD`);
  const [y, m, d] = dateStr.split("-").map(Number);
  const dateOnly = new Date(Date.UTC(y, m - 1, d));
  if (dateOnly.toISOString().slice(0, 10) !== dateStr) throw new Error(`Invalid calendar date "${dateStr}"`);
  return dateOnly;
}

function istDayOf(date: Date | null): string | null {
  return date ? date.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) : null;
}

/** Whole IST days between an arrival timestamp and today, floored at 0. */
function arrivalAgeDays(arrival: Date | null, todayMs: number): number {
  const iso = istDayOf(arrival);
  if (!iso) return 0;
  const [y, m, d] = iso.split("-").map(Number);
  return Math.max(0, Math.floor((todayMs - Date.UTC(y, m - 1, d)) / MS_PER_DAY));
}

// `inScope` MOVED to lib/floor/scope.ts (2026-08-09) — same function, byte for
// byte. It now has a second consumer: the client board re-derives each scope's
// view from one unscoped fetch instead of refetching per chip click, and a
// second copy of this predicate is exactly the drift that would break it. The
// server's use below is unchanged; every route still honours `?scope=`.

// ── Floor LIVE where — shared by the board and the live-sync marker ──────────
// ONE encoding of "what is on the floor right now", so the marker
// (app/api/floor/marker) can never watch a different set than getFloorBoard's
// live branch renders — the exact drift the Picking §10 landmine warns about.
// Delivery-type scope is applied CLIENT-side (getFloorBoard filters in JS), so
// it is deliberately absent here: the marker watches all scopes, a superset of
// any single scope (safe direction — marker ⊇ queue).

/** The status/stage predicate for the live floor board (no hide, no scope).
 *  Two arms:
 *   1. everything still OPEN (pending_picking / pick_assigned / pick_done),
 *      ANY dispatch date — the carry-over arm (design §4.2). Unchanged.
 *   2. everything the floor CHECKED TODAY, whatever day it was due — fenced on
 *      `pick_assignments.checkedAt` within today's IST range, NOT on
 *      `dispatchTargetDate`. Keying the checked arm on the promise day made a
 *      carried-over bill (due earlier, checked today) fail BOTH arms and vanish
 *      at the instant of completion. A bill must never disappear when finished.
 *  `todayRange` is passed in (getISTDayRange, lib/dates) so this stays pure. */
export function floorLiveBaseWhere(todayRange: { start: Date; end: Date }): Prisma.ordersWhereInput {
  return {
    dispatchStatus: "dispatch",
    isRemoved: false,
    OR: [
      { workflowStage: { in: PICKING_OPEN_STAGES } },
      {
        workflowStage: PICK_CHECKED,
        pickAssignment: { checkedAt: { gte: todayRange.start, lt: todayRange.end } },
      },
    ],
  };
}

/** The full live WHERE (base AND the admin hide-exclusion) — what the marker
 *  aggregates over. Uses getISTDayRange() (today), the SAME helper the board
 *  passes, so the two predicates can never drift. Sequential await, never
 *  $transaction (CORE §3). */
export async function getFloorLiveMarkerWhere(): Promise<Prisma.ordersWhereInput> {
  const hide = await getHideExclusion();
  return { AND: [floorLiveBaseWhere(getISTDayRange()), hide] };
}

// ── Shared per-obd lookups ───────────────────────────────────────────────────

/** Bill-to dealer name per OBD, from import_raw_summary (latest row wins). Used
 *  for the "billed to {dealer}" sub-line on site bills (design §7.5 / §6.2). */
async function billToByObd(obdNumbers: string[]): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  if (obdNumbers.length === 0) return map;
  const rows = await prisma.import_raw_summary.findMany({
    where: { obdNumber: { in: obdNumbers } },
    select: { obdNumber: true, billToCustomerName: true },
    orderBy: { createdAt: "desc" },
  });
  for (const r of rows) {
    if (!map.has(r.obdNumber)) map.set(r.obdNumber, r.billToCustomerName);
  }
  return map;
}

/** Distinct ACTIVE `skuCodeRaw` per OBD — the By-group view's raw material.
 *  Same shape as billToByObd above (one `obdNumber: { in: [...] }` read, keyed
 *  back by OBD), for the same reason: there is no FK from `orders` to its line
 *  items, only the plain `obdNumber` string on `import_raw_line_items`.
 *
 *  ⚠ `skuCodeRaw` ONLY — the SAP code, never `skuId`, never a `sku_master`
 *  lookup (CORE §13: the two catalog tables share no id space, so an id-based
 *  comparison would bundle unrelated products with total confidence). No
 *  catalog join happens here at all; the codes are compared to each other, so
 *  an unmastered code is just as usable as a mastered one.
 *
 *  `lineStatus: 'active'` matches app/api/picking/order/[orderId]/route.ts —
 *  removed lines are not on the bill and must not create shared material.
 *  Unlike that route, this deliberately does NOT filter `rowStatus` either: a
 *  parse-rejected row is still a tin the picker will be holding.
 *
 *  Each list is de-duplicated and sorted (locale "en") so the payload is
 *  byte-stable between loads — lib/picking/grouping.ts is deterministic by
 *  contract and cannot be if its input reshuffles. Sequential await, never
 *  $transaction (CORE §3); SELECT-only, no `orders.update` anywhere near it
 *  (FLOOR §10 — the live marker keys on MAX(orders.updatedAt)). */
async function skusByObd(obdNumbers: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (obdNumbers.length === 0) return map;

  const rows = await prisma.import_raw_line_items.findMany({
    where: { obdNumber: { in: obdNumbers }, lineStatus: "active" },
    select: { obdNumber: true, skuCodeRaw: true },
  });

  const sets = new Map<string, Set<string>>();
  for (const r of rows) {
    const set = sets.get(r.obdNumber) ?? new Set<string>();
    set.add(r.skuCodeRaw);
    sets.set(r.obdNumber, set);
  }
  for (const [obd, set] of Array.from(sets.entries())) {
    map.set(obd, Array.from(set).sort((a, b) => a.localeCompare(b, "en")));
  }
  return map;
}

/** Rule 2's raw material — each waiting bill's OIL-PAINT subset.
 *
 *  ONE extra sequential await (never `prisma.$transaction`, CORE §3) against
 *  `sku_master_v2`, keyed on `material IN (the codes skusByObd already
 *  returned)`. SELECT-only; no `orders.update` anywhere near it (FLOOR §10 —
 *  the live marker keys on MAX(orders.updatedAt), so a second write would fire
 *  a false "changed" on every board). It adds no term to `floorLiveBaseWhere`
 *  and nothing to `getFloorLiveMarkerWhere`: like `waitingSkus`, this is a
 *  post-fetch enrichment of rows the board predicate already returned, so the
 *  board and the marker stay on the ONE shared predicate (FLOOR §3/§5).
 *
 *  ⚠ MATCHED ON `material` === `skuCodeRaw` ONLY — never `skuId`, never old
 *  `sku_master` (CORE §13: the two catalog tables assign different ids to the
 *  same code, zero overlap, so an id join would put unrelated products in the
 *  same warehouse area with total confidence).
 *
 *  ⚠ An unmatched code simply never appears in the result set, so it can never
 *  be classified oil — unknown stays OUTSIDE, which is the safe direction and
 *  the same one the zero-SKU guard takes. ~24% of live codes are uncatalogued.
 *
 *  Order mirrors `waiting` exactly (which is the board's row order), keeping the
 *  payload byte-stable between loads — grouping.ts's determinism contract. */
async function oilSkusByOrder(waiting: FloorWaitingSkus[]): Promise<FloorOilSkus[]> {
  const codes = new Set<string>();
  for (const entry of waiting) {
    for (const code of entry.skus) codes.add(code);
  }
  // No waiting bill has a line — nothing to classify, and no reason to ask.
  if (codes.size === 0) return [];

  const rows = await prisma.sku_master_v2.findMany({
    where: { material: { in: Array.from(codes) } },
    select: { material: true, category: true, paintType: true },
  });

  const oil = buildOilSkuSet(rows);
  return waiting.map((entry) => ({
    orderId: entry.orderId,
    skus: entry.skus.filter((code) => oil.has(code)),
  }));
}

// ── 0. PICKERS — active roster + current load, for the assignment bar ────────

/** Active picker-role users with their current "on hand" count (bills at
 *  pick_assigned). Read-only; drives the assign-bar dropdown (design §7.8).
 *  Two sequential reads, never $transaction (CORE §3). */
export async function getFloorPickers(): Promise<FloorPicker[]> {
  const pickers = await prisma.users.findMany({
    where: { role: { name: "picker" }, isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  if (pickers.length === 0) return [];

  const loads = await prisma.pick_assignments.groupBy({
    by: ["pickerId"],
    where: { order: { workflowStage: PICK_ASSIGNED, isRemoved: false } },
    _count: { _all: true },
  });
  const loadById = new Map(loads.map((l) => [l.pickerId, l._count._all]));

  return pickers.map((p) => ({ id: p.id, name: p.name, onHand: loadById.get(p.id) ?? 0 }));
}

// ── 1. RAIL — "needs your decision" ──────────────────────────────────────────

export async function getFloorRail(
  scope: FloorScope = "All",
  // Pre-computed admin hide-exclusion. OPTIONAL — omitted, this reads it itself
  // and behaves exactly as before. /api/floor/board passes it so the rail and
  // the board share ONE read instead of two (they always agreed anyway; sharing
  // the object also removes the millisecond skew a `daysOld` rule's Date.now()
  // cutoff could otherwise have between the two calls).
  hideExclusion?: Prisma.ordersWhereInput,
): Promise<FloorRailCard[]> {
  const hide = hideExclusion ?? (await getHideExclusion());
  const now = new Date();
  const todayMs = getISTTodayDateOnly().getTime();

  const orders = await prisma.orders.findMany({
    where: {
      AND: [
        { workflowStage: { in: RAIL_STAGES }, dispatchStatus: null, isRemoved: false },
        hide,
      ],
    },
    include: {
      customer: { select: FLOOR_DEALER_SELECT },
      shipToOverrideCustomer: { select: FLOOR_DEALER_SELECT },
      dispatchWindow: { select: { windowTime: true } },
      querySnapshot: { select: { articleTag: true, totalVolume: true } },
    },
  });

  const obds = orders.map((o) => o.obdNumber);
  const billTo = await billToByObd(obds);

  // Tint split counts + operator, one bulk read for the tint orders on the rail.
  const tintIds = orders.filter((o) => o.orderType === "tint").map((o) => o.id);
  const splits =
    tintIds.length > 0
      ? await prisma.order_splits.findMany({
          where: { orderId: { in: tintIds } },
          select: { orderId: true, status: true, assignedTo: { select: { name: true } } },
        })
      : [];
  const splitsByOrder = new Map<number, { status: string; op: string | null }[]>();
  for (const s of splits) {
    const arr = splitsByOrder.get(s.orderId) ?? [];
    arr.push({ status: s.status, op: s.assignedTo?.name ?? null });
    splitsByOrder.set(s.orderId, arr);
  }

  // Whole-order tint COMPLETION, one bulk read for the same tint ids. This is
  // what a completed full OBD's suggestion anchors on (see the suggestion block
  // below). Sequential await, never $transaction (CORE §3).
  //
  // splitId: null keeps this to WHOLE-ORDER assignments. A split's completion
  // lives on order_splits.completedAt, per split, and never reaches this table.
  // The live assign route (app/api/tint/manager/assign/route.ts:149) never sets
  // splitId, so today this filter changes nothing — it is here to make
  // "whole-order" true by construction rather than by accident, if a future
  // split-assignment path ever starts writing rows here.
  const tintAssignments =
    tintIds.length > 0
      ? await prisma.tint_assignments.findMany({
          where: { orderId: { in: tintIds }, splitId: null },
          select: { orderId: true, status: true, completedAt: true },
        })
      : [];
  // LATEST completedAt wins — a reassigned order leaves its earlier assignment
  // row behind, and the most recent finish is the one that describes the bill.
  const completedAtByOrder = new Map<number, Date>();
  for (const a of tintAssignments) {
    if (a.status !== "tinting_done" || a.completedAt === null) continue;
    const prev = completedAtByOrder.get(a.orderId);
    if (prev === undefined || a.completedAt.getTime() > prev.getTime()) {
      completedAtByOrder.set(a.orderId, a.completedAt);
    }
  }

  const cards: FloorRailCard[] = [];
  for (const order of orders) {
    const dealer = order.shipToOverrideCustomer ?? order.customer;
    const deliveryType = dealer?.area?.deliveryType?.name ?? null;
    if (!inScope(deliveryType, scope)) continue;

    // The real Date is kept HERE, not on the card: TintState.completedAt is an
    // ISO string for the wire, but the engine needs an actual Date. buildTintState
    // serialises for the payload; the suggestion below uses this value directly.
    const tintCompletedAt = completedAtByOrder.get(order.id) ?? null;

    const tint: TintState | null =
      order.orderType === "tint"
        ? buildTintState(order.workflowStage, splitsByOrder.get(order.id) ?? [], tintCompletedAt)
        : null;

    // ── SLOT SUGGESTION — which clock this bill is judged on ──────────────────
    //
    //   not tint                   → arrival-anchored (order email / OBD punch)
    //   tint + hasSplits           → null. A split order has no single
    //                                whole-order finish: completion is per split
    //                                on order_splits.completedAt, and the parent
    //                                bubble writes no timestamp at all. Deciding
    //                                which of those moments speaks for the bill
    //                                is a real question, deliberately out of v1.
    //   tint + not finished        → null. Nothing to anchor to yet; the arrival
    //                                clock would happily offer today 12:30 to a
    //                                bill still on the mixer.
    //   tint + full + finished     → completion-anchored (tint_assignments.
    //                                completedAt), which is the first moment the
    //                                bill could actually go on a vehicle.
    //
    // The 60-minute grace test inside suggestSlot applies unchanged in every
    // case — a tint finished long ago has a closed batch like anything else.
    let suggestion: SlotSuggestion | null = null;
    if (RAIL_SUGGESTIONS_ENABLED) {
      if (tint === null) {
        suggestion = suggestSlot({
          smu: order.smu,
          deliveryType,
          emailDateTime: order.orderDateTime,
          punchDateTime: order.obdEmailDate,
          now,
        });
      } else if (!tint.hasSplits && tintCompletedAt !== null) {
        suggestion = suggestSlot({
          smu: order.smu,
          deliveryType,
          emailDateTime: null,
          punchDateTime: null,
          // The Date, never the card's ISO string — suggestSlot feeds this
          // straight to the engine, which does epoch arithmetic on it.
          completionDateTime: tintCompletedAt,
          now,
        });
      }
    }

    const displayDate = resolveFloorDisplayDate(order.orderDateTime, order.obdEmailDate);

    cards.push({
      orderId: order.id,
      obdNumber: order.obdNumber,
      workflowStage: order.workflowStage,
      customerName: order.customer?.customerName ?? null,
      shipToOverrideName: order.shipToOverrideCustomer?.customerName ?? null,
      dealerName: dealer?.customerName ?? "(Unmatched)",
      billToName: billTo.get(order.obdNumber) ?? null,
      isShipToOverride: order.shipToOverrideCustomerId !== null,
      smu: order.smu,
      route: dealer?.area?.primaryRoute?.name ?? null,
      area: dealer?.area?.name ?? null,
      deliveryType,
      isKeyCustomer: dealer?.isKeyCustomer ?? false,
      priorityLevel: order.priorityLevel,
      isTint: order.orderType === "tint",
      volumeLitres: order.querySnapshot?.totalVolume ?? null,
      articleTag: order.querySnapshot?.articleTag ?? null,
      obdDateTime: displayDate.obdDateTime?.toISOString() ?? null,
      isEmailTime: displayDate.isEmailTime,
      ageDays: arrivalAgeDays(order.obdEmailDate ?? order.orderDateTime, todayMs),
      tint,
      suggestion,
      presetWindowTime: order.dispatchWindow?.windowTime ?? null,
      presetTargetDate: order.dispatchTargetDate ? order.dispatchTargetDate.toISOString().slice(0, 10) : null,
    });
  }

  // Oldest first, always (design §6.1). Nulls sink last.
  cards.sort((a, b) => {
    if (a.obdDateTime === b.obdDateTime) return a.obdNumber.localeCompare(b.obdNumber, "en");
    if (a.obdDateTime === null) return 1;
    if (b.obdDateTime === null) return -1;
    return a.obdDateTime < b.obdDateTime ? -1 : 1;
  });

  return cards;
}

function buildTintState(
  workflowStage: string,
  splits: { status: string; op: string | null }[],
  completedAt: Date | null,
): TintState {
  const nonCancelled = splits.filter((s) => s.status !== "cancelled");
  const shadesTotal = nonCancelled.length;
  const shadesDone = nonCancelled.filter((s) => s.status === "tinting_done").length;
  const operatorName = nonCancelled.find((s) => s.op)?.op ?? null;

  let stage: TintStage;
  if (workflowStage === "pending_tint_assignment") stage = "waiting";
  else if (workflowStage === "tint_assigned") stage = "assigned";
  else if (workflowStage === "tinting_in_progress") stage = "mixing";
  else stage = "ready"; // pending_support = all splits done, awaiting release

  // hasSplits reads the RAW array — every split row, cancelled included — which
  // is the whole point: shadesTotal has already dropped the cancelled ones, so
  // an all-cancelled split order would report 0 there and pass for a full OBD.
  //
  // completedAt is serialised HERE — TintState rides the /api/floor/board payload,
  // where a Date would become an ISO string anyway; sending one deliberately keeps
  // the type honest about what the client actually receives.
  return {
    stage,
    shadesDone,
    shadesTotal,
    operatorName,
    hasSplits: splits.length > 0,
    completedAt: completedAt?.toISOString() ?? null,
  };
}

// ── 2. FLOOR — the live board (+ history mode) ───────────────────────────────

const FLOOR_BOARD_INCLUDE = {
  customer: { select: FLOOR_DEALER_SELECT },
  shipToOverrideCustomer: { select: FLOOR_DEALER_SELECT },
  dispatchWindow: { select: { id: true, windowTime: true, sortOrder: true } },
  querySnapshot: { select: { articleTag: true, totalVolume: true, totalWeight: true } },
  pickEarlyReleasedBy: { select: { name: true } },
  pickAssignment: {
    select: {
      pickerId: true,
      assignedAt: true,
      pickedAt: true,
      checkedAt: true,
      checkedBy: { select: { name: true } },
      picker: { select: { name: true } },
      assignedBy: { select: { name: true } },
    },
  },
} as const;

export async function getFloorBoard(
  // `hideExclusion` — OPTIONAL pre-computed admin hide-exclusion; omitted, this
  // reads it itself and behaves exactly as before. See getFloorRail above.
  opts: {
    mode?: "live" | "history";
    date?: string;
    scope?: FloorScope;
    hideExclusion?: Prisma.ordersWhereInput;
  } = {},
): Promise<FloorBoardResult> {
  const mode = opts.mode ?? "live";
  const scope = opts.scope ?? "All";
  const hide = opts.hideExclusion ?? (await getHideExclusion());
  const todayDateOnly = getISTTodayDateOnly();

  // History anchors on the viewed day; live anchors on today.
  const anchorDate = mode === "history" && opts.date ? parseFloorDate(opts.date) : todayDateOnly;
  const anchorMs = anchorDate.getTime();
  const anchorIso = anchorDate.toISOString().slice(0, 10);

  // Floor's OWN scope filter — NOT buildPickingWhere().
  const base: Prisma.ordersWhereInput =
    mode === "history"
      ? {
          // What was PROMISED for that day (design §4.4): every released bill
          // dated D, any active stage. Read-only in the UI. Excludes legacy
          // 'closed' (PICKING_ACTIVE_STAGES omits it — workflow-stages.ts).
          dispatchStatus: "dispatch",
          isRemoved: false,
          dispatchTargetDate: anchorDate,
          workflowStage: { in: PICKING_ACTIVE_STAGES },
        }
      : // Live: everything still open, whatever day it was due (carry-over —
        // design §4.2; this was Floor's fix over the picking desktop board's
        // `rolling` scope, which was removed with that board on 2026-07-28,
        // so Floor is now the only surface with a carry-over arm), PLUS everything
        // CHECKED TODAY whatever day it was due (fenced on checkedAt, not the
        // promise day — so a completed carry-over never vanishes). Future-dated
        // not-yet-checked rides along, separated by `zone` = upcoming per row.
        // Shared with the live-sync marker via floorLiveBaseWhere() (both pass
        // getISTDayRange) so the two can never drift.
        floorLiveBaseWhere(getISTDayRange());

  const orders = await prisma.orders.findMany({
    where: { AND: [base, hide] },
    include: FLOOR_BOARD_INCLUDE,
  });

  const activeWindows = await prisma.dispatch_slot_master.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
    select: { id: true, windowTime: true, sortOrder: true },
  });

  const billTo = await billToByObd(orders.map((o) => o.obdNumber));

  let rows: FloorBoardRow[] = [];
  for (const order of orders) {
    const dealer = order.shipToOverrideCustomer ?? order.customer;
    const deliveryType = dealer?.area?.deliveryType?.name ?? null;
    if (!inScope(deliveryType, scope)) continue;

    const targetDate = order.dispatchTargetDate;
    const noDispatchDate = targetDate === null;
    const isEarlyReleased = order.pickEarlyReleasedAt !== null;
    const zone: "due" | "upcoming" =
      !noDispatchDate && targetDate.getTime() > anchorMs && !isEarlyReleased ? "upcoming" : "due";
    const ageDays = noDispatchDate
      ? null
      : Math.max(0, Math.floor((anchorMs - targetDate.getTime()) / MS_PER_DAY));

    const displayDate = resolveFloorDisplayDate(order.orderDateTime, order.obdEmailDate);

    rows.push({
      orderId: order.id,
      obdNumber: order.obdNumber,
      dealerName: dealer?.customerName ?? "(Unmatched)",
      isShipToOverride: order.shipToOverrideCustomerId !== null,
      windowId: order.dispatchWindow?.id ?? null,
      windowTime: order.dispatchWindow?.windowTime ?? null,
      windowSortOrder: order.dispatchWindow?.sortOrder ?? null,
      deliveryType,
      route: dealer?.area?.primaryRoute?.name ?? null,
      area: dealer?.area?.name ?? null,
      priorityLevel: order.priorityLevel,
      isKeyCustomer: dealer?.isKeyCustomer ?? false,
      articleTag: order.querySnapshot?.articleTag ?? null,
      volumeLitres: order.querySnapshot?.totalVolume ?? null,
      weightKg: order.querySnapshot?.totalWeight ?? null,
      isTint: order.orderType === "tint",
      // Floor does not render product families — skip the catalog join; empties
      // are honest "not computed / not applicable" for this board.
      families: [],
      unresolvedLineCount: 0,
      obdDateTime: displayDate.obdDateTime?.toISOString() ?? null,
      isEmailTime: displayDate.isEmailTime,
      isAssigned: order.workflowStage === PICK_ASSIGNED,
      isDone: order.workflowStage === PICK_DONE,
      isChecked: order.workflowStage === PICK_CHECKED,
      assignedAt: order.pickAssignment?.assignedAt?.toISOString() ?? null,
      pickedAt: order.pickAssignment?.pickedAt?.toISOString() ?? null,
      checkedAt: order.pickAssignment?.checkedAt?.toISOString() ?? null,
      checkedByName: order.pickAssignment?.checkedBy?.name ?? null,
      pickerId: order.pickAssignment?.pickerId ?? null,
      assignedToName: order.pickAssignment?.picker?.name ?? null,
      assignedByName: order.pickAssignment?.assignedBy?.name ?? null,
      zone,
      noDispatchDate,
      ageDays,
      dispatchTargetDate: targetDate ? targetDate.toISOString().slice(0, 10) : null,
      isEarlyReleased,
      earlyReleasedByName: order.pickEarlyReleasedBy?.name ?? null,
      // Floor-only extras.
      smu: order.smu,
      billToName: billTo.get(order.obdNumber) ?? null,
    });
  }

  // Spine sort (reused, never copied), MINUS byAssigned via FLOOR_SPINE so
  // Assigned/Done rows hold their place. Cast back — sort returns the same objects.
  rows = sortPickingQueue(rows, FLOOR_SPINE) as FloorBoardRow[];

  const dueRows = rows.filter((r) => r.zone !== "upcoming");
  const windows = activeWindows.map((w) => ({
    id: w.id,
    windowTime: w.windowTime,
    sortOrder: w.sortOrder,
    count: dueRows.filter((r) => r.windowId === w.id).length,
  }));

  // ── By-group candidates — the WAITING bills' distinct SKUs ────────────────
  //
  // A post-fetch enrichment of rows the predicate above ALREADY returned: it
  // adds no term to `floorLiveBaseWhere` and nothing to
  // `getFloorLiveMarkerWhere`, so the board and the live marker stay on the ONE
  // shared predicate (FLOOR §3/§5 — re-declaring the WHERE in either place is
  // the drift the Picking §10 landmine warns about). One extra sequential
  // await, SELECT-only, no `orders.update` (FLOOR §10).
  //
  // WAITING ONLY, and due-zone only. Only a waiting bill can be handed to a
  // picker as part of a bundle; fetching lines for Assigned/Done/checked rows
  // would be a payload with no reader. Measured 2026-08-17: the heaviest day in
  // the preceding fortnight (2026-08-06, 205 bills at every stage) totals 1,044
  // (bill, SKU) pairs ≈ 17 KB of JSON — the waiting slice is a fraction of it.
  //
  // The waiting predicate is INLINED rather than imported from
  // components/floor/status-pill.tsx, which owns `rowStatus()` — that file is
  // "use client" and importing it here would drag React into a server module.
  // The two must stay in step: waiting = at `pending_picking`, i.e. none of the
  // three later stage flags set.
  //
  // Computed in HISTORY mode too, deliberately: a past day has waiting rows
  // (bills that were never picked), the data is equally true for them, and a
  // mode branch here would leave a future caller with a silently empty array
  // instead of an answer.
  const waitingRows = rows.filter(
    (r) => r.zone !== "upcoming" && !r.isAssigned && !r.isDone && !r.isChecked,
  );
  const waitingSkuMap = await skusByObd(waitingRows.map((r) => r.obdNumber));
  // Emitted in `rows` order, which is FLOOR_SPINE-sorted and obdNumber-tie-
  // broken above — so this array is byte-stable across loads, which is what
  // lib/picking/grouping.ts's determinism contract rests on. A bill with no
  // active lines gets an EMPTY array, never a missing entry: grouping.ts drops
  // those candidates explicitly (the empty set is a subset of everything), and
  // it can only do that if it is told they exist.
  const waitingSkus: FloorWaitingSkus[] = waitingRows.map((r) => ({
    orderId: r.orderId,
    skus: waitingSkuMap.get(r.obdNumber) ?? [],
  }));

  // Rule 2's oil-paint subset — one more sequential await, and ONLY when the
  // trial is on. With the flag false this is a bare `[]`: no query is issued at
  // all, and buildOilGroups against an empty set produces no groups, so the
  // feature is gone rather than merely hidden. The field is always present, so
  // no caller's type moves with the flag.
  const oilSkus: FloorOilSkus[] = RULE2_ENABLED ? await oilSkusByOrder(waitingSkus) : [];

  return { mode, date: anchorIso, rows, windows, total: dueRows.length, waitingSkus, oilSkus };
}

// ── 3. HOLD ──────────────────────────────────────────────────────────────────

export async function getFloorHold(
  scope: FloorScope = "All",
  // OPTIONAL pre-computed hide-exclusion — see getFloorRail above. /api/floor/hold
  // is a single-call path today and passes nothing, so it is unchanged; the
  // parameter exists so a future caller that also needs the board cannot
  // accidentally reintroduce a second read.
  hideExclusion?: Prisma.ordersWhereInput,
): Promise<FloorHoldRow[]> {
  const hide = hideExclusion ?? (await getHideExclusion());
  const orders = await prisma.orders.findMany({
    where: { AND: [{ dispatchStatus: "hold", isRemoved: false }, hide] },
    include: {
      customer: { select: FLOOR_DEALER_SELECT },
      shipToOverrideCustomer: { select: FLOOR_DEALER_SELECT },
      querySnapshot: { select: { articleTag: true, totalVolume: true } },
    },
  });

  const billTo = await billToByObd(orders.map((o) => o.obdNumber));

  // "Held since" = the hold EVENT's wall-clock time, not orders.heldAt (which is
  // the arrival date — see lib/floor/hold-log.ts). Identified by NOTE, never by a
  // sentinel toStage. Latest hold log per order wins, so a re-held bill reports
  // its most recent hold rather than a stale first one.
  const heldIds = orders.map((o) => o.id);
  const holdLogs =
    heldIds.length > 0
      ? await prisma.order_status_logs.findMany({
          where: { orderId: { in: heldIds }, note: { in: HOLD_LOG_NOTES } },
          orderBy: { createdAt: "desc" },
          select: { orderId: true, createdAt: true },
        })
      : [];
  const latestHoldLog = new Map<number, Date>();
  for (const log of holdLogs) {
    if (!latestHoldLog.has(log.orderId)) latestHoldLog.set(log.orderId, log.createdAt);
  }

  const rows: FloorHoldRow[] = [];
  for (const order of orders) {
    const dealer = order.shipToOverrideCustomer ?? order.customer;
    const deliveryType = dealer?.area?.deliveryType?.name ?? null;
    if (!inScope(deliveryType, scope)) continue;

    // Fallback ladder. A bill with no hold log at all is almost always an
    // ENRICHMENT hold (app/api/import/obd/route.ts stamps heldAt but writes no
    // order_status_logs row), where the hold is applied at import time — so the
    // arrival date is a genuinely close approximation, not a guess. It is still
    // tagged `approx` and rendered with a "~" so it can never silently read as a
    // recorded "held today". Neither available → `unknown`, its own trailing band.
    const logAt = latestHoldLog.get(order.id) ?? null;
    const heldSinceSource: HeldSinceSource = logAt ? "log" : order.heldAt ? "approx" : "unknown";
    const heldSince = (logAt ?? order.heldAt)?.toISOString() ?? null;

    rows.push({
      orderId: order.id,
      obdNumber: order.obdNumber,
      dealerName: dealer?.customerName ?? "(Unmatched)",
      billToName: billTo.get(order.obdNumber) ?? null,
      isShipToOverride: order.shipToOverrideCustomerId !== null,
      smu: order.smu,
      route: dealer?.area?.primaryRoute?.name ?? null,
      area: dealer?.area?.name ?? null,
      deliveryType,
      isKeyCustomer: dealer?.isKeyCustomer ?? false,
      priorityLevel: order.priorityLevel,
      isTint: order.orderType === "tint",
      volumeLitres: order.querySnapshot?.totalVolume ?? null,
      articleTag: order.querySnapshot?.articleTag ?? null,
      obdDateTime: (order.obdEmailDate ?? order.orderDateTime)?.toISOString() ?? null,
      heldAt: order.heldAt?.toISOString() ?? null,
      heldSince,
      heldSinceSource,
    });
  }

  // Recent first by default (design §8) — on heldSince, the real hold moment.
  // Unknown-held rows sink last (the tab bands them separately anyway).
  rows.sort((a, b) => {
    if (a.heldSince === b.heldSince) return 0;
    if (a.heldSince === null) return 1;
    if (b.heldSince === null) return -1;
    return a.heldSince < b.heldSince ? 1 : -1;
  });

  return rows;
}

// ── 4. CANCELLED (today only, design §9) ─────────────────────────────────────

export async function getFloorCancelled(
  scope: FloorScope = "All",
  // OPTIONAL pre-computed hide-exclusion — see getFloorHold above. Same story:
  // /api/floor/cancelled passes nothing and is unchanged.
  hideExclusion?: Prisma.ordersWhereInput,
): Promise<FloorCancelledRow[]> {
  const hide = hideExclusion ?? (await getHideExclusion());
  const todayIso = istDayOf(new Date());

  const orders = await prisma.orders.findMany({
    where: { AND: [{ workflowStage: "cancelled", isRemoved: false }, hide] },
    include: {
      customer: { select: FLOOR_DEALER_SELECT },
      shipToOverrideCustomer: { select: FLOOR_DEALER_SELECT },
      querySnapshot: { select: { articleTag: true, totalVolume: true } },
    },
  });

  // Cancel time + actor + reason come from the latest toStage="cancelled" log.
  const ids = orders.map((o) => o.id);
  const logs =
    ids.length > 0
      ? await prisma.order_status_logs.findMany({
          where: { orderId: { in: ids }, toStage: "cancelled" },
          orderBy: { createdAt: "desc" },
          select: { orderId: true, createdAt: true, note: true, changedBy: { select: { name: true } } },
        })
      : [];
  const latest = new Map<number, { createdAt: Date; note: string | null; name: string | null }>();
  for (const l of logs) {
    if (!latest.has(l.orderId)) latest.set(l.orderId, { createdAt: l.createdAt, note: l.note, name: l.changedBy?.name ?? null });
  }

  const billTo = await billToByObd(orders.map((o) => o.obdNumber));

  const rows: FloorCancelledRow[] = [];
  for (const order of orders) {
    const dealer = order.shipToOverrideCustomer ?? order.customer;
    const deliveryType = dealer?.area?.deliveryType?.name ?? null;
    if (!inScope(deliveryType, scope)) continue;

    const cancel = latest.get(order.id);
    // Today only — anchored to the cancellation day (design §9). Older ones live
    // in History. A currently-cancelled order with no cancel log is skipped.
    if (!cancel || istDayOf(cancel.createdAt) !== todayIso) continue;

    rows.push({
      orderId: order.id,
      obdNumber: order.obdNumber,
      dealerName: dealer?.customerName ?? "(Unmatched)",
      billToName: billTo.get(order.obdNumber) ?? null,
      isShipToOverride: order.shipToOverrideCustomerId !== null,
      smu: order.smu,
      route: dealer?.area?.primaryRoute?.name ?? null,
      area: dealer?.area?.name ?? null,
      deliveryType,
      isKeyCustomer: dealer?.isKeyCustomer ?? false,
      priorityLevel: order.priorityLevel,
      isTint: order.orderType === "tint",
      volumeLitres: order.querySnapshot?.totalVolume ?? null,
      articleTag: order.querySnapshot?.articleTag ?? null,
      obdDateTime: (order.obdEmailDate ?? order.orderDateTime)?.toISOString() ?? null,
      cancelledAt: cancel.createdAt.toISOString(),
      cancelledByName: cancel.name,
      reason: cancel.note,
    });
  }

  rows.sort((a, b) => (a.cancelledAt === b.cancelledAt ? 0 : (a.cancelledAt ?? "") < (b.cancelledAt ?? "") ? 1 : -1));
  return rows;
}
