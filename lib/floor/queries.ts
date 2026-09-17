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
  SUPPORT_DONE_OUTPUT,
  PICK_ASSIGNED,
  PICK_DONE,
  PICK_CHECKED,
  DISPATCHED,
} from "@/lib/workflow-stages";
// Rule 2's oil-paint definition lives in the ENGINE, not here and not in the
// database — grouping.ts is pure (no prisma, no clock), so importing it into a
// server module is one-directional and safe.
import { buildOilSkuSet } from "@/lib/picking/grouping";
// Compile-required only — FloorBoardRow extends PickingQueueRow, which gained
// `releasableToday`. Pure and clock-free (the day is passed in), so importing
// it into this server module is one-directional and safe, exactly like
// grouping.ts above. Floor renders no early-release action; see the field.
import { isReleasableToday } from "@/lib/picking/release-window";
// Same map the picking queue uses, for the same reason: FloorBoardRow extends
// PickingQueueRow, so this board must fill `smuCode` too. One owner for the
// name→code rule (lib/import-upsert/types.ts), two callers.
import { SMU_CODE_BY_NAME } from "@/lib/import-upsert/types";
// Same-SO detection — OWNED BY PICKING (lib/picking/duplicate-so.ts), imported
// here exactly as assign/unassign and the sort rule objects are. One owner per
// behaviour: a second copy of "what counts as a duplicate" is how the phone and
// the desk would come to flag different bills.
import { getDuplicateSoNumbers } from "@/lib/picking/duplicate-so";
// TINT vs BASE — also OWNED BY PICKING, and imported for the same reason. Floor
// renders the word on four of its own surfaces (the board table, Hold,
// Cancelled and the detail panel), and a second copy of "was this colour
// actually mixed" is how the desk and the phone would label one bill two ways.
import { getColourWorkByOrder } from "@/lib/picking/colour-work-query";
// WHICH TRIPS A DAY'S DESK IS ABOUT — owned by lib/trips/live-trips.ts and
// shared with getTripsForDate, the feed behind the rail. The board's trip arm
// below must never spell this rule out for itself: the one day it did, the two
// spellings disagreed and every carried draft's stops rendered empty. Pure, no
// prisma, no clock, so importing it here is one-directional and safe — the same
// argument grouping.ts and release-window.ts carry above.
import { liveTripsOnDeskWhere } from "@/lib/trips/live-trips";
import { HOLD_LOG_NOTES, type HeldSinceSource } from "./hold-log";
import type {
  FloorScope,
  FloorBoardRow,
  FloorBoardResult,
  FloorHoldRow,
  FloorCancelledRow,
  FloorPicker,
  FloorWaitingSkus,
  FloorOilSkus,
} from "./types";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// Pre-release stages (rank < 60 = before pending_picking). DERIVED from the
// ladder, never hand-written, so a new pre-picking stage joins automatically.
// order_created (10) is included for safety though import never writes it
// (route.ts:1102 creates orders at pending_support / pending_tint_assignment).
/**
 * The stages FLOOR HISTORY reads — the live picking set PLUS `dispatched`.
 *
 * 🔴 IT EXISTS SO THE SHARED ARRAY IS NEVER EDITED. `PICKING_ACTIVE_STAGES` is
 * owned by lib/workflow-stages.ts and is read by lib/picking/queue.ts:448 as
 * well as here. Adding `dispatched` to it would put shipped bills back on a
 * LIVE board, which is the one thing this whole change must not do. Spreading it
 * and adding the stage AT THIS CALL SITE keeps the widening where it belongs.
 *
 * 🔴 HISTORY IS A RECORD, NOT A WORKING LIST, and that is the whole distinction.
 * A bill that shipped still HAPPENED on the day it was promised or checked, so a
 * past day that omits it is lying by omission — which it has been doing for
 * 4,137 rows since July, because every reader was taught to look for
 * `pick_checked` alone. The live board (`floorLiveBaseWhere`) is deliberately
 * NOT widened and must never be.
 *
 * ⚠ ORDER IS NOT SIGNIFICANT — it feeds a Prisma `in`, not a sort.
 */
const FLOOR_HISTORY_STAGES: string[] = [...PICKING_ACTIVE_STAGES, DISPATCHED];

const RAIL_STAGES: string[] = STAGE_LADDER
  .filter((d) => d.rank !== null && d.rank < 60)
  .map((d) => d.stage);

/**
 * THE TINT ROOM'S OWN STAGES — a NEW named constant, not an edit to a shared
 * array (2026-09-13).
 *
 * ⚠ WRITTEN OUT, NOT DERIVED FROM RANK. Ranks 20-40 happen to be these three
 * today, and a rank filter would silently absorb any future mid-pipeline stage
 * into "this bill is in the tint room" — a claim about paint that a number
 * cannot make. The same argument `TINT_IN_PROGRESS_STAGES` in lib/floor/
 * release.ts makes for its own three names; a fourth here needs a person.
 *
 * ⚠ NOT ADDED TO RAIL_STAGES, PICKING_OPEN_STAGES OR ANY OTHER SHARED ARRAY.
 * Those feed predicates; this feeds a DISPLAY field and nothing else.
 */
const TINT_PENDING_STAGE = "pending_tint_assignment";
const TINT_ASSIGNED_STAGE = "tint_assigned";
const TINT_MIXING_STAGE = "tinting_in_progress";

/**
 * Where a bill stands with the tint room — `null` for every plain order.
 *
 * The full contract is on `FloorBoardRow.tintPhase` (lib/floor/types.ts); this
 * is its ONE implementation, so a second surface cannot invent a fourth answer.
 * "done" is deliberately the FALL-THROUGH for a tint bill: past the three tint
 * stages means the tint room is finished with it, whatever happened next.
 */
function tintPhaseOf(
  orderType: string,
  workflowStage: string,
): "pending" | "assigned" | "tinting" | "done" | null {
  if (orderType !== "tint") return null;
  if (workflowStage === TINT_PENDING_STAGE) return "pending";
  // ⚠ ASSIGNED AND MIXING ARE SEPARATE ANSWERS (2026-09-14). They shared the
  // "tinting" value until today, which made the board claim work was happening
  // on a bill nobody had touched. One stage, one value, and a stage this
  // function has not been taught about falls to "done" — visibly wrong on a
  // tint bill rather than invisibly folded into a state that looks busy.
  if (workflowStage === TINT_ASSIGNED_STAGE) return "assigned";
  if (workflowStage === TINT_MIXING_STAGE) return "tinting";
  return "done";
}

/**
 * The UN-SLOTTED arm — bills the dispatch engine could not schedule.
 *
 * 🔴 THIS IS getFloorRail's OWN PREDICATE, EXPORTED SO IT IS NEVER RETYPED.
 * As of 2026-09-10 it is used in THREE places and all three must be the same
 * set: the rail feed (which still exists), the board's second arm, and the
 * live-sync marker's second arm. A second copy is how the board and the marker
 * come to watch different sets, which is the drift FLOOR §5 exists to prevent.
 *
 * Pure — no hide-exclusion, no scope, no clock. Callers AND-merge the hide
 * themselves, exactly as they do for `floorLiveBaseWhere`.
 */
export function floorUnslottedWhere(): Prisma.ordersWhereInput {
  return { workflowStage: { in: RAIL_STAGES }, dispatchStatus: null, isRemoved: false };
}

/**
 * The CARRIED-FORWARD POOL — checked, released to the floor, and still on no
 * truck, whatever day it was checked (2026-09-11).
 *
 * 🔴 WHY THE BOARD NEEDED A THIRD ARM. `floorLiveBaseWhere`'s checked branch is
 * fenced on `pick_assignments.checkedAt` within TODAY, which is right for a
 * board that reports a day's work and wrong for a board that plans loads. A bill
 * checked on Tuesday with no truck on Friday is exactly the work the planner has
 * to see, and it was invisible to everyone: 40 bills on the day this shipped,
 * the oldest checked three days earlier. Unfinished work carries forward; only
 * finished work is filed by day.
 *
 * 🔴 `tripDropId: null` IS WHAT BOUNDS THIS ARM, and it is the whole reason the
 * arm is safe. Without it the predicate is "every pick_checked bill ever
 * finished" — 2,604 rows against a board showing 44 on 2026-09-10
 * (code-discovery-2026-09-10-noslot-backlog.md §A). With it, the arm is exactly
 * the not-on-a-truck pile, which is small and self-emptying: a bill leaves the
 * moment it gets a trip sticker.
 *
 * 🔴 `dispatchStatus: 'dispatch'` IS PINNED, NOT LOOSENED. That term is the
 * difference between 44 rows and 2,604 and it stays exactly as the other two
 * arms carry it. A HELD bill is therefore NOT here, deliberately — hold is
 * genuine working state (owner ruling 2026-09-10), a held bill belongs on the
 * Hold tab, and 3 of the 82 in the pile are held.
 *
 * ⚠ A COMPLETE SET OF TERMS, like its two siblings. That is what makes the union
 * in `floorBoardWhere` safe: no arm can be widened by another, because none of
 * them relies on a term the others supply.
 *
 * ⚠ IT OVERLAPS ARM 1 ON PURPOSE, and that costs nothing. A bill checked TODAY
 * with no truck matches both this and `floorLiveBaseWhere`'s checked branch; an
 * `OR` returns it once. Writing this arm to exclude today would be a second
 * date fence to keep in step with the first, for no gain.
 */
export function floorCarriedPoolWhere(): Prisma.ordersWhereInput {
  return {
    dispatchStatus: "dispatch",
    workflowStage: PICK_CHECKED,
    tripDropId: null,
    isRemoved: false,
  };
}

/**
 * BILLS ON A LIVE TRIP — checked whenever, still on a truck that has not gone
 * (2026-09-13).
 *
 * 🔴 WHY A FOURTH ARM WAS NEEDED. A bill checked on an EARLIER day that is now
 * ON a trip matched nothing at all: arm 1's checked branch fences on today, arm
 * 2 wants no dispatch decision at all, and arm 3 requires `tripDropId: null` —
 * which is precisely what a bill on a trip is not. So it was absent from the
 * board's row set, and the trip desk, which looks each stop's bills up IN that
 * row set, found none and printed "N bills finished — off today's live board":
 * a sentence asserting a fact the code had never established. Live case,
 * 2026-09-12: trip L-260912-01 stop 1 (OBD 9109437142, checked 2026-09-11) drew
 * that line while stops 2 and 3, checked that morning, drew their rows.
 *
 * ⚠ THIS GAP IS OLDER THAN THE CARRIED POOL AND 36a39ba7 DID NOT CAUSE IT.
 * Rebuilding the pre-36a39ba7 two-arm board shows the same bill missing. That
 * commit closed the NOT-on-a-trip half of this one class and left this half
 * standing, which is the only reason it reads as a regression.
 *
 * 🔴 `tripDropId: { not: null }` IS REDUNDANT AND LOAD-BEARING. DO NOT DELETE
 * IT. A row whose FK is null has no `tripDrop`, so the relation filter below
 * already implies the term and it changes not one row — measured, both forms
 * return the same 142 rows with zero on either side. What it changes is the
 * PLAN. Every other arm is driven by `workflowStage`, so Postgres covers the
 * whole OR with a bitmap union over `orders_workflowStage_idx`. This arm has no
 * stage term (deliberately — see below), so with no indexed column of its own
 * the planner abandons the union and sequentially scans `orders`:
 *
 *     relation filter alone           Seq Scan on orders, 12,020 rows  23.72 ms
 *     + tripDropId: { not: null }     BitmapOr preserved                2.33 ms
 *
 * The redundant term hands it `orders_tripDropId_idx` and the bitmap union
 * survives. It looks pointless. It is worth 21 ms on every board load and on
 * every 15s marker probe, which share this predicate.
 *
 * ⚠ NO `workflowStage` TERM, ON PURPOSE. Fencing this arm on stage restores the
 * plan just as well (2.33 ms, identical rows today) and was rejected on
 * meaning, not on cost: trip membership is not gated by stage — a trip can
 * legitimately hold a bill at `pending_support` or `dispatched`, as
 * trip-band.tsx's own header says — so a stage list would rebuild the exact
 * class of hole this arm exists to close, and the next bill to fall through it
 * would arrive looking like a brand-new bug.
 *
 * ⚠ A COMPLETE SET OF TERMS, like its three siblings — that is what makes the
 * union in `floorBoardWhere` safe. `dispatchStatus: "dispatch"` is PINNED
 * exactly as arms 1 and 3 carry it and is NOT loosened; dropping that term is
 * the documented way to put every finished bill ever onto a 40-row board. It
 * costs nothing today (every bill on a live trip carries `dispatch` — measured,
 * the unpinned variant returns the identical 142 rows); it is what keeps that
 * true tomorrow.
 *
 * 🔴 WHICH TRIPS COUNT IS NOT DECIDED HERE, AND THAT IS THE POINT.
 * `liveTripsOnDeskWhere` (lib/trips/live-trips.ts) owns it, and
 * `getTripsForDate` — the feed behind the rail — derives from the SAME module.
 * Neither carries a copy.
 *
 * This arm shipped for one day with its own spelling, `tripDate >= today`,
 * while the rail's feed said "dated today OR an open draft of any age". That
 * gap WAS this bug in its second form: on the morning of 2026-09-13 every trip
 * on the rail was a draft carried from 2026-09-12 — 22 trips, 105 bills — so
 * the arm matched NONE of them and 86 of 88 stops came up empty. The same
 * comparison made a day earlier could not see it, because every trip that day
 * was dated that day and the two spellings happened to agree. Hand-syncing two
 * rules is how you get a bug that is invisible on the day you check it.
 *
 * ⚠ A CARRIED DRAFT HAS NO DATE FLOOR, and that is a characteristic rather than
 * a hole. An open draft is on the rail where somebody can see it, and confirming
 * or cancelling it removes it; it is bounded by attention, exactly as the
 * carried pool in `floorCarriedPoolWhere` is. A guard by date would instead hide
 * the bills of a draft the planner can still act on, which is the failure this
 * whole arm exists to stop.
 *
 * `todayDateOnly` is passed in (UTC-midnight, the `@db.Date` shape that
 * `trips.tripDate` is stored in) so this stays pure and clock-free, the same
 * contract `floorLiveBaseWhere` keeps.
 */
/**
 * A PAST DAY'S TRIPS, BY TRIP (slice 10, 2026-09-15) — every bill on a trip
 * dated `dayDateOnly`, whatever day it was checked, promised or picked.
 *
 * 🔴 WHY HISTORY NEEDS IT. History's own arms pick bills by DAY: promised for D,
 * or checked on D. A bill on D's trip that was checked on D-1 matched neither,
 * so it was absent from the history payload, and its stop — which looks its
 * bills up in that payload — printed "not on today's board". The message was
 * wrong because the DATA was wrong (owner): a trip's bills are its bills
 * whatever day they were checked. So the History board unions this in, and
 * every stop on a History trip finds its rows.
 *
 * ⚠ A COMPLETE SET OF TERMS, NO STAGE AND NO dispatchStatus PIN, deliberately —
 * the same reasoning `floorTripBillsWhere` above gives for its own arm: trip
 * membership is not gated by stage, and a HELD bill on a trip is still on that
 * trip. It cannot flood the day: it is bounded by trips dated D, and a cancelled
 * trip holds no bills (cancel detaches them) and is excluded by name anyway.
 *
 * ⚠ HISTORY ONLY. The live board's trip arm is `floorTripBillsWhere`; this one
 * never reaches the marker, which is live-only (FLOOR §5).
 *
 * `tripDropId: { not: null }` is kept for the same query-plan reason as in
 * `floorTripBillsWhere`: it hands Postgres `orders_tripDropId_idx`.
 */
export function floorHistoryTripBillsWhere(dayDateOnly: Date): Prisma.ordersWhereInput {
  return {
    isRemoved: false,
    tripDropId: { not: null },
    tripDrop: { trip: { tripDate: dayDateOnly, status: { not: "cancelled" } } },
  };
}

export function floorTripBillsWhere(todayDateOnly: Date): Prisma.ordersWhereInput {
  return {
    dispatchStatus: "dispatch",
    isRemoved: false,
    // Redundant by meaning, load-bearing by plan. Read the header before touching.
    tripDropId: { not: null },
    // The shared rule, never a local spelling of it.
    tripDrop: { trip: liveTripsOnDeskWhere(todayDateOnly) },
  };
}

// RAIL_SUGGESTIONS_ENABLED WAS HERE AND WENT WITH THE RAIL (2026-09-13). It was
// the kill switch for the render-time slot suggestion on a rail card, and there
// are no rail cards. `lib/floor/suggest.ts` is left in place, unimported and
// unchanged (CORE §3 — nothing is deleted): the slot-suggestion RULE it holds is
// worth keeping if a future surface asks the same question, and it is pure, so
// it costs nothing sitting there. CLAUDE_FLOOR §8 documents the layer as LIVE
// and is now out of date on that point.

// Rule 2 — the oil-paint (10K warehouse) bundler, a TRIAL. The single kill
// switch for its own feature, and the last one of this shape left in the file.
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
      // `bayNumber` rides the relation already being selected (2026-08-21) — no
      // new query, no new join. FloorBoardRow extends PickingQueueRow, which now
      // carries the field, so it has to be fetched here too.
      primaryRoute: { select: { name: true, bayNumber: true } },
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

/**
 * THE BOARD'S FULL PREDICATE (2026-09-10) — the live set OR the un-slotted set.
 *
 * 🔴 A DELIBERATE UNION OF TWO NAMED PREDICATES, NEVER A REMOVED TERM.
 * The obvious way to put un-slotted bills on the board is to drop
 * `dispatchStatus: 'dispatch'` from `floorLiveBaseWhere`. That is WRONG and it
 * was measured: it admits every `pick_checked` bill ever finished, because the
 * only thing keeping those off the board is the second arm's checked-today
 * fence. On 2026-09-10 that was **2,545 finished bills onto a board showing 40**
 * (code-discovery-2026-09-10-noslot-backlog.md §A). Sixty times the real
 * content, all of it work that is done.
 *
 * The union cannot do that: each arm carries its own complete set of terms, so
 * neither can be widened by the other. Arm 1 is byte-identical to what shipped;
 * arm 2 is the rail's own predicate; arm 3 is the carried-forward pool.
 *
 * ── THIRD ARM ADDED 2026-09-11 ────────────────────────────────────────────
 * `floorCarriedPoolWhere` — checked, no truck, any check date. Read its own
 * header for why it is bounded and why `dispatchStatus` is still pinned. It was
 * added the SAME way arm 2 was: a new named function unioned in, never a term
 * taken out of an existing one. That is the standing rule this comment exists to
 * enforce, and following it twice is what keeps it true.
 *
 * ── FOURTH ARM ADDED 2026-09-13 ───────────────────────────────────────────
 * `floorTripBillsWhere` — on a live trip, checked whenever. Arm 3 covers the
 * bills NOT on a truck; this one covers the bills that ARE, which fell between
 * every arm and left the trip desk printing a claim it could not support. Added
 * the same way again: a new named function unioned in, `dispatchStatus` pinned
 * exactly as its siblings pin it, not one term removed from anything. Three for
 * three. Read that function's header before editing it — one of its terms is
 * redundant by meaning and load-bearing by query plan, and deleting it as dead
 * weight turns this whole OR into a sequential scan.
 *
 * 🔴 THE MARKER USES THIS TOO (getFloorLiveMarkerWhere below), and that is why
 * widening happens HERE and nowhere else. Board and marker share one predicate
 * on purpose — let them drift and the board silently stops refreshing when an
 * invisible row changes (FLOOR §5, and the PICKING §10 landmine it comes from).
 * Adding an arm to this function widens both in the same edit, by construction;
 * there is no second place to remember.
 */
export function floorBoardWhere(
  todayRange: { start: Date; end: Date },
  // The same day as `todayRange`, in the UTC-midnight `@db.Date` shape that
  // `trips.tripDate` is stored in. Passed in beside the range rather than
  // derived here so this function stays pure and clock-free, and so both
  // callers below are visibly handing it ONE day.
  todayDateOnly: Date,
): Prisma.ordersWhereInput {
  return {
    OR: [
      floorLiveBaseWhere(todayRange),
      floorUnslottedWhere(),
      floorCarriedPoolWhere(),
      floorTripBillsWhere(todayDateOnly),
    ],
  };
}

/** The full live WHERE (base AND the admin hide-exclusion) — what the marker
 *  aggregates over. Uses getISTDayRange() (today), the SAME helper the board
 *  passes, so the two predicates can never drift. Sequential await, never
 *  $transaction (CORE §3). */
export async function getFloorLiveMarkerWhere(): Promise<Prisma.ordersWhereInput> {
  const hide = await getHideExclusion();
  // 🔴 THE SAME UNION THE BOARD RENDERS. Was floorLiveBaseWhere alone until
  // 2026-09-10; widening the board without widening this would have left the
  // marker blind to every un-slotted bill — a new one would arrive and no
  // screen would refresh, which is exactly the failure FLOOR §5 pairs these
  // two functions to prevent.
  // Both arguments are TODAY, read from the one clock a line apart, exactly as
  // getFloorBoard's live branch reads them. Widening happens inside
  // floorBoardWhere, so the marker gained the fourth arm in the same edit the
  // board did and there is still no second place to remember.
  return { AND: [floorBoardWhere(getISTDayRange(), getISTTodayDateOnly()), hide] };
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

// ── 1. RAIL — REMOVED 2026-09-13 ─────────────────────────────────────────────
//
// `getFloorRail` and its `buildTintState` helper lived here. They built one
// FloorRailCard per undecided bill — dealer, route, litres, age, same-SO flag,
// tint state and a slot suggestion — and nothing had rendered any of it since
// 2026-09-10, when the trip desk replaced the board. `TripDesk` is never passed
// a rail prop, and FloorRail / RailCard / TintStrip were imported by no live
// file. Measured cost of building a payload with no reader: 772 ms and 25 of the
// board call's 84 statements, roughly 28% of a request on a page that is
// latency-bound rather than query-bound.
//
// 🔴 `floorUnslottedWhere` IS STILL HERE AND IS STILL LIVE. It was the rail's
// predicate AND it is arm 2 of `floorBoardWhere`, and only the first use went.
// Those bills are on the board as ROWS and always were — that is exactly what
// the trip desk's own header says happened to them. REMOVING A FETCH IS NOT
// REMOVING AN ARM, and anyone tidying the "unused rail predicate" next would
// drop five live bills off the screen. Row counts were taken either side of this
// change and did not move.
//
// What the tint strip used to say now lives in the three tint PILLS
// (status-pill.tsx) and the rail's In-tinting line (trip-rail.tsx), both built
// from board rows this feed is not needed for. The orphaned components moved to
// archive/2026-09-floor-rail/ with `git mv`, so their history follows them.
//
// Still exported and still used by the board: `floorUnslottedWhere` (above),
// `billToByObd`, `skusByObd`, `getFloorPickers`.

// ── 2. FLOOR — the live board (+ history mode) ───────────────────────────────

const FLOOR_BOARD_INCLUDE = {
  customer: { select: FLOOR_DEALER_SELECT },
  shipToOverrideCustomer: { select: FLOOR_DEALER_SELECT },
  dispatchWindow: { select: { id: true, windowTime: true, sortOrder: true } },
  querySnapshot: { select: { articleTag: true, totalVolume: true, totalWeight: true } },
  pickEarlyReleasedBy: { select: { name: true } },
  // ⚠ THE ONLY TINT READ ON THIS QUERY, AND IT IS ONE COLUMN. Measured before
  // it was added: +1 statement, 0.05 ms server-side, wall-clock delta below the
  // noise floor (interleaved n=8, alternating lead: -46 ms). `splitId: null` +
  // latest-first + take 1 is the WHOLE-ORDER completion, the same boundary the
  // detail panel draws. Operator, start and shade progress stay OFF this query
  // — they are on the panel and on the Tinting tab's own route.
  tintAssignments: {
    where: { splitId: null },
    orderBy: { createdAt: "desc" },
    take: 1,
    select: { completedAt: true },
  },
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
  // The anchor day as an IST [start, end) INSTANT window — history's checked arm
  // below. Same helper, same half-open shape as the live arm's range (:611);
  // `checkedAt` is a timestamp and cannot be compared to a @db.Date value. Pure
  // and cheap, so it is computed for both modes and simply unused by live.
  const anchorRange = getISTDayRange(anchorIso);

  // Floor's OWN scope filter — NOT buildPickingWhere().
  const base: Prisma.ordersWhereInput =
    mode === "history"
      ? {
          // 🔴 SLICE 10 (2026-09-15): THE DAY'S RECORD, OR THE DAY'S TRIPS' BILLS.
          // The first member is History's original day-based predicate, byte
          // for byte. The second pulls every bill on a trip dated D BY TRIP, so a
          // History stop finds all of its bills — see floorHistoryTripBillsWhere.
          // Unioned, never merged: each member keeps its own complete terms.
          OR: [
            {
          // What HAPPENED on that day (design §4.4): read-only in the UI, any
          // active stage. Excludes legacy 'closed' (PICKING_ACTIVE_STAGES omits
          // it — workflow-stages.ts). TWO date anchors under one OR:
          //
          //   (a) PROMISED for D — `dispatchTargetDate = D`. The original and
          //       only arm until 2026-08-25.
          //   (b) CHECKED on D — `pick_checked` whose
          //       `pick_assignments.checkedAt` falls inside D's IST day,
          //       whatever day it was promised for.
          //
          // ⚠ WHY (b) EXISTS. Anchoring history on the promise day alone left a
          // finished bill reachable on NO screen at all. OBD 9109086370 (order
          // 13532) was promised for 2026-08-25 and checked at 18:34 IST on
          // 2026-08-24: the live board dropped it (its checked arm fences on
          // checkedAt within TODAY, and the check was yesterday), 24-Aug history
          // dropped it (promised for the 25th), and 25-Aug history — which would
          // have matched — is unreachable because the stepper clamps at
          // yesterday (components/floor/floor-page.tsx). The floor finished the
          // work and then could not see that it had.
          //
          // This is the SAME promise-vs-completion anchor class as the
          // 2026-08-02 picking fix (lib/picking/queue.ts, commit e37cbe74) and
          // Floor's own live checked arm (floorLiveBaseWhere, above): a bill's
          // COMPLETION belongs to the day it was completed, not to the day it
          // was owed. The rule is now applied to history as well as live.
          //
          // A bill matching both arms appears ONCE (one row, one OR match). A
          // bill finished early appears under its promise day AND its check day
          // — two different days, deliberately: both statements are true, and
          // the day's record must not lie by omission in either direction.
          // OWNER DECISION 2026-08-25, not an accident of the predicate.
          //
          // The range comes from getISTDayRange(anchorIso) — the SAME helper the
          // live arm's range comes from (:611 passes it with no argument for
          // "today"; this passes the viewed day). One owner for "what is an IST
          // day", never a second hand-rolled offset calculation.
          // ⚠ `dispatchStatus: "dispatch"` IS UNTOUCHED. 238 of the dispatched
          // rows carry a NULL status and stay invisible here because of it —
          // deliberately. That term is a known landmine (dropping it admits
          // every finished bill ever, measured at 2,604 against 44) and the
          // rows it excludes are ones nothing ever dispatched properly.
          dispatchStatus: "dispatch",
          isRemoved: false,
          // WIDENED 2026-09-11 — see FLOOR_HISTORY_STAGES above. This top-level
          // gate is the one that actually mattered: arm (b) alone could name
          // `dispatched` all it liked and this clause would still have excluded
          // the row before the OR was reached. It is also the ONLY thing letting
          // arm (a) find a shipped bill by its promise date, which is the larger
          // half of the population (2,935 of 4,137 carry a promise date, against
          // 710 that carry a checkedAt).
          workflowStage: { in: FLOOR_HISTORY_STAGES },
          OR: [
            { dispatchTargetDate: anchorDate },
            {
              // Both terminal stages. A dispatched bill passed through checking
              // on its way out, so its `checkedAt` is as true a record of the
              // day's work as a pick_checked bill's — the stage it ended at does
              // not change the day it was finished on.
              workflowStage: { in: [PICK_CHECKED, DISPATCHED] },
              pickAssignment: {
                checkedAt: { gte: anchorRange.start, lt: anchorRange.end },
              },
            },
          ],
            },
            floorHistoryTripBillsWhere(anchorDate),
          ],
        }
      : // Live: everything still open, whatever day it was due (carry-over —
        // design §4.2; this was Floor's fix over the picking desktop board's
        // `rolling` scope, which was removed with that board on 2026-07-28,
        // so Floor is now the only surface with a carry-over arm), PLUS everything
        // CHECKED TODAY whatever day it was due (fenced on checkedAt, not the
        // promise day — so a completed carry-over never vanishes). Future-dated
        // not-yet-checked rides along, separated by `zone` = upcoming per row.
        // Shared with the live-sync marker via floorBoardWhere() (both pass
        // getISTDayRange) so the two can never drift.
        //
        // 🔴 floorBoardWhere, NOT floorLiveBaseWhere (2026-09-10). It is the
        // UNION of the live set and the un-slotted set — the bills the decision
        // rail used to hold now appear here, marked "no slot", and putting one
        // on a trip is what releases it. Read that function's header before
        // touching this: the union is deliberate and the obvious shortcut
        // (dropping the dispatchStatus term) puts 2,545 finished bills on a
        // board that shows 40.
        //
        // 🔴 FOUR ARMS SINCE 2026-09-13. The fourth is `floorTripBillsWhere` —
        // bills on a live trip, checked whenever — which is why a stop on the
        // trip desk can no longer come up empty and claim its bills are
        // finished. `todayDateOnly` above is the same day `getISTDayRange()`
        // names; both are handed over rather than re-derived inside.
        floorBoardWhere(getISTDayRange(), todayDateOnly);

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

  // Same-SO detection — see getFloorRail above for the full note. One bounded
  // groupBy, sequential await, post-fetch: `base` / floorLiveBaseWhere() and
  // getFloorLiveMarkerWhere() are untouched, so board and marker stay on the
  // ONE shared predicate (FLOOR §3/§5).
  const duplicateSoNumbers = await getDuplicateSoNumbers(orders.map((o) => o.soNumber));

  // TINT vs BASE — same post-fetch contract as the line above: batched once for
  // the page, and NO predicate touched, so board and marker stay on the one
  // shared `floorLiveBaseWhere`. Costs nothing on a board with no
  // project-division tint bill on it (the helper returns before querying).
  const colourWorkByOrder = await getColourWorkByOrder(
    orders.map((o) => ({ orderId: o.id, smu: o.smu, orderType: o.orderType })),
  );

  // ── The bill's TRIP (2026-09-09) ─────────────────────────────────────────
  //
  // TWO batched reads, both keyed on an `id IN (…)` list — drops first, then the
  // trips those drops belong to. NEVER an include chain: lib/picking/queue.ts
  // :537-554 records the measurement that settled this house rule, an include
  // tree issuing EIGHTEEN SQL statements for a 72-row board because Prisma
  // neither dedupes two chains to one table nor skips a chain for the rows whose
  // FK is null. Here MOST rows have a null `tripDropId`, so an include would pay
  // for every one of them.
  //
  // ⚠ A POST-FETCH ENRICHMENT, exactly like `billTo` and `duplicateSoNumbers`
  // above. It adds NO term to `base`, nothing to `floorLiveBaseWhere()` and
  // nothing to `getFloorLiveMarkerWhere()`, so the board and the live marker
  // stay on the ONE shared predicate (FLOOR §3/§5 — re-declaring the WHERE in
  // either place is the drift the PICKING §10 landmine warns about).
  //
  // ⚠ SELECT-ONLY. No `orders.update` anywhere near this: the marker keys on
  // MAX(orders.updatedAt) and a second write fires a false "changed" on every
  // board (FLOOR §10).
  //
  // 🔴 THIS IS THE BOARD'S VIEW OF A TRIP AND IT IS NOT THE TRIP LIST. The
  // By-trip BANDS read GET /api/floor/trips, never these fields — a trip whose
  // bills are all finished has left the board's live predicate, so bands built
  // by filtering board rows would render empty and the progress bar would lie.
  // What these fields are for is the opposite direction: putting a trip TAG on a
  // row that is on screen.
  const tripDropIds = Array.from(
    new Set(orders.map((o) => o.tripDropId).filter((id): id is number => id !== null)),
  );
  const tripDrops =
    tripDropIds.length > 0
      ? await prisma.trip_drops.findMany({
          where: { id: { in: tripDropIds } },
          select: { id: true, tripId: true },
        })
      : [];
  const tripIds = Array.from(new Set(tripDrops.map((d) => d.tripId)));
  const tripRows =
    tripIds.length > 0
      ? await prisma.trips.findMany({
          where: { id: { in: tripIds } },
          // `shownAt` rides the same read (slice 8) — the per-trip visibility flag
          // the row's isAwaitingShow below is derived from. No extra query.
          select: { id: true, tripNumber: true, status: true, shownAt: true },
        })
      : [];
  const tripById = new Map(tripRows.map((t) => [t.id, t]));
  // drop id → the trip it belongs to, resolved once for the whole page.
  const tripByDropId = new Map(
    tripDrops.map((d) => [d.id, tripById.get(d.tripId) ?? null]),
  );

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
    // Hoisted out of the row literal below so the release-window rule is fed
    // the SAME slice the row itself carries — one string, two consumers (the
    // identical hoist lib/picking/queue.ts makes, for the identical reason).
    const dispatchTargetIso = targetDate ? targetDate.toISOString().slice(0, 10) : null;

    const displayDate = resolveFloorDisplayDate(order.orderDateTime, order.obdEmailDate);

    rows.push({
      orderId: order.id,
      obdNumber: order.obdNumber,
      dealerName: dealer?.customerName ?? "(Unmatched)",
      // ⚠ COMPILE-REQUIRED ONLY — NOT a Floor feature (2026-08-31).
      // `FloorBoardRow extends PickingQueueRow`, and Picking added
      // `dealerInMaster` alongside its SAP-name fallback (lib/picking/queue.ts).
      // A required field on the base interface has to be filled here or this
      // file does not build — this is the ONE construction site tsc named.
      // (It briefly also fed a Picking card chip; that chip was removed
      // 2026-09-01 and its sole consumer is now lib/picking/search.ts.)
      //
      // 🔴 NOTHING ON FLOOR READS IT, AND NOTHING ON FLOOR CHANGED. Floor's
      // `dealerName` above still prints the literal, deliberately: Floor already
      // shows a real name through `billToName` (billToByObd), so it never had
      // Picking's blank-card problem. Whether Floor should ALSO fall back to
      // orders.shipToCustomerName is a Floor decision for a Floor session
      // (FLOOR §1 — Floor is a CALLER of Picking, and Picking must not reach in
      // here to change what this board renders).
      //
      // Same expression as Picking's, so the flag cannot mean two things: it is
      // "did the effective dealer FK resolve", never `orders.customerMissing`.
      dealerInMaster: dealer != null,
      isShipToOverride: order.shipToOverrideCustomerId !== null,
      // The ship-to PAIR — the ORIGINAL and the redirect target, kept apart from
      // `dealerName` above (the EFFECTIVE dealer, which IS the override on a
      // redirect and so cannot carry the original). Same two fields the rail has
      // always emitted (getFloorRail, above), so the desk table and the rail card
      // can describe a redirect the same way instead of the table printing a
      // nameless caption (FLOOR §8b).
      //
      // FREE: `customer` and `shipToOverrideCustomer` are ALREADY in
      // FLOOR_BOARD_INCLUDE, both with FLOOR_DEALER_SELECT, which selects
      // `customerName` — `dealer` on the line above is built from exactly these
      // two. No extra findMany, no extra await, and above all no write: the
      // live-sync marker keys on MAX(orders.updatedAt) (FLOOR §5/§10).
      customerName: order.customer?.customerName ?? null,
      shipToOverrideName: order.shipToOverrideCustomer?.customerName ?? null,
      windowId: order.dispatchWindow?.id ?? null,
      windowTime: order.dispatchWindow?.windowTime ?? null,
      windowSortOrder: order.dispatchWindow?.sortOrder ?? null,
      deliveryType,
      route: dealer?.area?.primaryRoute?.name ?? null,
      // Inherited from PickingQueueRow (2026-08-21) — FloorBoardRow extends it,
      // so this board has to FILL the field even though it renders nothing with
      // it today. Same rule and same source as Picking's own: `area.primaryRoute`
      // ONLY, never delivery_point_master.primaryRouteId (stale, never read), so
      // the bay can never describe a different route than `route` above.
      // Same shape as `smuCode` below, for the same reason.
      bayNumber: dealer?.area?.primaryRoute?.bayNumber ?? null,
      area: dealer?.area?.name ?? null,
      priorityLevel: order.priorityLevel,
      isKeyCustomer: dealer?.isKeyCustomer ?? false,
      articleTag: order.querySnapshot?.articleTag ?? null,
      volumeLitres: order.querySnapshot?.totalVolume ?? null,
      weightKg: order.querySnapshot?.totalWeight ?? null,
      isTint: order.orderType === "tint",
      // TINT / BASE / nothing. Map lookup only — the batch ran once above.
      // ⚠ A DIFFERENT QUESTION FROM `tintPhase` BELOW: phase says where the
      // bill is with the tint room, this says whether a colour was ever mixed.
      // A bypassed bill reads phase "done" and colourWork "base".
      colourWork: colourWorkByOrder.get(order.id) ?? null,
      // Which of the three tint pills this row wears, or null for a plain order.
      // Derived HERE and only here — see tintPhaseOf above and the field's own
      // contract on FloorBoardRow. No extra query: `orderType` and
      // `workflowStage` are already on the fetched row.
      tintPhase: tintPhaseOf(order.orderType, order.workflowStage),
      // ISO for the wire, like every other date here. Null when the tint room
      // has not finished — the pill then renders no time rather than a
      // borrowed one (see the field on FloorBoardRow).
      tintCompletedAt: order.tintAssignments[0]?.completedAt?.toISOString() ?? null,
      // Floor does not render product families — skip the catalog join; empties
      // are honest "not computed / not applicable" for this board.
      families: [],
      unresolvedLineCount: 0,
      obdDateTime: displayDate.obdDateTime?.toISOString() ?? null,
      isEmailTime: displayDate.isEmailTime,
      isAssigned: order.workflowStage === PICK_ASSIGNED,
      isDone: order.workflowStage === PICK_DONE,
      // 🔴 TRUE FOR A DISPATCHED BILL TOO. It passed through checking on its way
      // out — a bill cannot ship without being checked — so a history row that
      // reported `isChecked: false` would render a shipped bill as unchecked,
      // which is the opposite of what happened. `isDispatched` below carries the
      // finer fact for the surfaces that want it.
      isChecked: order.workflowStage === PICK_CHECKED || order.workflowStage === DISPATCHED,
      isDispatched: order.workflowStage === DISPATCHED,
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
      dispatchTargetDate: dispatchTargetIso,
      isEarlyReleased,
      // Inherited from PickingQueueRow (2026-09-07) — FloorBoardRow extends it,
      // so this board has to FILL the field. Same shape as `bayNumber` and
      // `smuCode` below: filled honestly rather than stubbed, because a shared
      // field that means two things is worse than one nobody reads.
      //
      // 🔴 FLOOR OFFERS NO EARLY RELEASE AND NOTHING HERE CHANGED. Floor's own
      // Release is the unrelated FLOOR_RELEASABLE_STAGES path (pending_support
      // → pending_picking, FLOOR §4.2); its Upcoming strip is read-only
      // (upcoming-strip.tsx). Nothing on Floor reads this field today.
      //
      // Anchored on `anchorIso` — the SAME resolved day `anchorMs` above feeds
      // `zone`/`ageDays`, so in history mode it answers "was it releasable on
      // day D", exactly as those two already do, and no second clock is read.
      releasableToday: isReleasableToday(dispatchTargetIso, anchorIso),
      earlyReleasedByName: order.pickEarlyReleasedBy?.name ?? null,
      // Inherited from PickingQueueRow (2026-08-19) — derived from `order.smu`
      // in memory, no column and no extra query, exactly as lib/picking/queue.ts
      // does it. Floor renders no SmuBadge today; the field is filled because
      // the shared interface requires it, and because Floor's own site marker
      // already keys on the same SMU set (floor-table.tsx shipMarkers).
      smuCode: order.smu !== null ? (SMU_CODE_BY_NAME[order.smu] ?? null) : null,
      // Inherited from PickingQueueRow — same rule, same shared function, so a
      // bill flagged on the phone is flagged on the desk. Boolean only.
      hasDuplicateSo: order.soNumber !== null && duplicateSoNumbers.has(order.soNumber),
      // Floor-only extras.
      smu: order.smu,
      billToName: billTo.get(order.obdNumber) ?? null,
      // SAP's invoice facts — NOT orders.invoicedAt, which is Billing's own
      // mark-done decision (CORE §7.3). Both ride FLOOR_BOARD_INCLUDE for free:
      // that is an `include`, not a `select`, so every `orders` scalar is
      // already on the fetched row — same "comes free" argument as the ship-to
      // pair above. No extra findMany, no extra await, and no write (FLOOR
      // §5/§10 — the live marker keys on MAX(orders.updatedAt), so a second
      // write would fire a false "changed" on every board).
      invoiceNo: order.invoiceNo ?? null,
      // ISO for the wire, like every other date on this payload. The column is
      // date-only in practice (all values 00:00:00 UTC, verified live
      // 2026-08-31) — formatting is the renderer's job, not this feed's.
      invoiceDate: order.invoiceDate ? order.invoiceDate.toISOString() : null,
      // ⚠ `pickVisibleAt` WAS ON THIS PAYLOAD UNTIL SLICE 8 (2026-09-15). Visibility
      // is decided per TRIP now — see `isAwaitingShow` below — and nothing reads
      // the per-bill column.
      // The bill's trip (2026-09-09) — resolved through the batched maps above,
      // never a relation. All three are null on a bill that is on no trip, which
      // is the normal state for most of the board.
      //
      // `tripDropId` is the pointer the At-desk pool keys on (null = at the
      // desk); `tripNumber` and `tripStatus` are what the row's trip TAG reads.
      // A dangling pointer — a drop deleted between the two reads — yields nulls
      // for the pair rather than throwing, and the row simply shows no tag.
      tripDropId: order.tripDropId,
      tripNumber:
        order.tripDropId !== null ? (tripByDropId.get(order.tripDropId)?.tripNumber ?? null) : null,
      tripStatus:
        order.tripDropId !== null ? (tripByDropId.get(order.tripDropId)?.status ?? null) : null,
      // ── SHOW TO FLOOR, PER TRIP (slice 8, 2026-09-15) ──────────────────────
      // `isAwaitingShow` is THE held-back fact, decided here because only the
      // server has the stage and the dispatch status: a WAITING bill
      // (pending_picking, dispatch — WAITING_FOR_PICKER) on a trip that has NOT
      // been shown. Exactly the bills the supervisor's Assign tab leaves out
      // when desk control is on. A bill on no trip is never awaiting a show.
      // The client pairs it with the switch (status-pill.tsx isHeldBack).
      // A pointer that resolves to no trip reads as NOT awaiting. It cannot
      // persist — orders.tripDropId is ON DELETE SET NULL — so it is only ever a
      // read race between the two batched lookups above, and "at desk" about a
      // trip this read could not find would be a guess.
      isAwaitingShow:
        order.workflowStage === SUPPORT_DONE_OUTPUT &&
        order.dispatchStatus === "dispatch" &&
        order.tripDropId !== null &&
        (() => {
          const trip = tripByDropId.get(order.tripDropId);
          return trip != null && trip.shownAt === null;
        })(),
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

  // TINT vs BASE — the Hold table wears the same word as the board (this feed's
  // rows are their own type, so it fills the field itself). Batched once,
  // predicate untouched, sequential await.
  const colourWorkByOrder = await getColourWorkByOrder(
    orders.map((o) => ({ orderId: o.id, smu: o.smu, orderType: o.orderType })),
  );

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
      colourWork: colourWorkByOrder.get(order.id) ?? null,
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

  // TINT vs BASE — see the Hold feed above. A cancelled bill keeps whatever was
  // true of it: the record should read the same after cancellation as before.
  const colourWorkByOrder = await getColourWorkByOrder(
    orders.map((o) => ({ orderId: o.id, smu: o.smu, orderType: o.orderType })),
  );

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
      colourWork: colourWorkByOrder.get(order.id) ?? null,
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
