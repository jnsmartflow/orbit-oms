import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { SUPPORT_DONE_OUTPUT } from "@/lib/workflow-stages";

// ─────────────────────────────────────────────────────────────────────────────
// The floor visibility gate ("desk control") — read-only helpers.
//
// One row in `app_settings` decides whether the supervisor's Assign tab shows
// every waiting bill (the board as it has always been) or only the ones the desk
// has let through.
//
// 🔴 PER TRIP SINCE SLICE 8 (2026-09-15). The decision moved from the BILL
// (`orders.pickVisibleAt`, stamped one bill at a time by a Show strip) to the
// TRIP (`trips.shownAt`). With the switch ON, a waiting bill is on the Assign tab
// ONLY when it is on a trip that has been SHOWN. A bill on no trip ("To plan") is
// hidden until the planner puts it on a trip and shows that trip. The point, in
// the owner's words: when volume is high the planner buckets orders into trucks
// first, then shows one truck at a time, so the supervisor picks a load to
// completion instead of 45 bills across six trucks and finishing none.
//
// Until 2026-09-21 a waiting bill on no trip was visible with the gate ON. Owner
// reversed this: only bills on a shown trip are visible. Do not revert.
//
// `orders.pickVisibleAt` / `pickVisibleById` are no longer read or written. The
// columns remain until a later drop; their 51 stale values were cleared by
// sql/2026-09-15-slice8-show-per-trip.sql.
//
// ⚠ DEFAULT-OFF, the OPPOSITE of lib/hide/tag-settings.ts, and the asymmetry is
// deliberate. A tag defaults ON because a missing row must not make a badge
// disappear. This defaults OFF because a missing row must not make the floor's
// WORK disappear. The safe direction is always "show the supervisor his work",
// so every uncertain answer here resolves to false.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The one `app_settings.settingKey` this module owns.
 *
 * Exported so no caller ever retypes the string. A hand-typed key in a `where`
 * matches nothing and fails SILENTLY — the gate would read as permanently off
 * and nobody would see an error (CORE §3, the status-string rule; same class).
 */
export const PICK_VISIBILITY_GATE_KEY = "picking.visibilityGate";

/**
 * Is the floor visibility gate switched ON?
 *
 * FAILS CLOSED TO FALSE, in all four ways it can fail:
 *   - no row for the key      → false (the ship state; nothing has been enabled)
 *   - row with isEnabled false → false
 *   - a null/undefined read    → false (the `=== true` test, not a truthy one)
 *   - the query itself throws  → false (caught below)
 *
 * The throw case matters: this runs on the marker's 15s poll and on every queue
 * fetch. A database blip must degrade to the ungated board the floor already
 * knows, never to an empty screen. Sequential await, no prisma.$transaction
 * (CORE §3).
 */
export async function isPickGateOn(): Promise<boolean> {
  try {
    const row = await prisma.app_settings.findUnique({
      where: { settingKey: PICK_VISIBILITY_GATE_KEY },
      select: { isEnabled: true },
    });
    return row?.isEnabled === true;
  } catch {
    return false;
  }
}

/**
 * A bill WAITING for a picker — the only kind the gate can ever hide.
 *
 * 🔴 THE ONE OWNER OF "WAITING" FOR THE GATE. The supervisor's waiting branch
 * (buildPickingWhere), the held-back count below, the no-cliff showing of trips
 * (lib/trips/show.ts) and the floor row's `isAwaitingShow` (lib/floor/queries.ts)
 * all mean exactly this. An assigned, picked or checked bill is never gated —
 * the locked owner rule in lib/picking/queue.ts — so it is never "waiting" here.
 */
export const WAITING_FOR_PICKER: Prisma.ordersWhereInput = {
  isRemoved: false,
  dispatchStatus: "dispatch",
  workflowStage: SUPPORT_DONE_OUTPUT,
};

/**
 * The Assign tab's WAITING branch, as `buildPickingWhere` ORs it in.
 *
 *   gate OFF → every waiting bill. Byte-identical to the board before the gate.
 *   gate ON  → a waiting bill on a trip that has been SHOWN. Nothing else — a
 *              bill on no trip is hidden (owner, 2026-09-21).
 *
 * `tripDropId: { not: null }` is implied by the relation filter (a null pointer
 * has no trip to test) and is spelled out anyway so the planner can use
 * `orders_tripDropId_idx` — the same reason lib/floor/queries.ts keeps its own
 * redundant copy of the term.
 *
 * ⚠ ONLY THE WAITING BRANCH. The in-progress and checked branches are never
 * gated, in any state of the switch (queue.ts). Do not add this term anywhere
 * else.
 */
export function waitingBranchWhere(gateOn: boolean): Prisma.ordersWhereInput {
  if (!gateOn) return { workflowStage: SUPPORT_DONE_OUTPUT };
  return {
    workflowStage: SUPPORT_DONE_OUTPUT,
    tripDropId: { not: null },
    tripDrop: { trip: { shownAt: { not: null } } },
  };
}

export interface HeldBack {
  /** Waiting bills on a trip the desk has not shown. */
  bills: number;
  /** The distinct trips — trucks — those bills are on. */
  trucks: number;
  /** Waiting bills on NO trip ("To plan") — hidden since 2026-09-21. Not in `bills`. */
  unplanned: number;
}

const NOTHING_HELD: HeldBack = { bills: 0, trucks: 0, unplanned: 0 };

/**
 * How much WAITING work the gate is hiding from the picking board, in two parts:
 * bills on trucks not yet shown (`bills`, `trucks` — "2 trucks with the planner ·
 * 17 bills") and bills on no trip at all (`unplanned` — "40 not planned yet").
 * The two parts are disjoint; together they are everything the gate hides.
 *
 * 🔴 THE ONE OWNER OF THIS COUNT. The Assign-tab band gets it on first paint from
 * the queue payload (`getPickingQueue`) and every 15s from
 * `app/api/picking/marker/route.ts`; both call this, neither writes the terms.
 *
 * ⚠ `boardWhere` MUST BE THE UNGATED PREDICATE — `buildPickingWhere(...)` with
 * `gateOn` omitted or false. A gated where already excludes every row counted
 * here, so passing one returns zero: the SAFE wrong answer (the band does not
 * render), never an overstatement.
 *
 * 🔴 COMBINED WITH `AND: [boardWhere, …]`, NEVER BY SPREAD. `boardWhere` carries
 * buildPickingWhere's top-level three-branch `OR`; spreading a term object that
 * also has an `OR` (or any key it shares) would silently REPLACE it and count the
 * wrong set with no error. The terms here have no `OR` today — the AND is so
 * that adding one tomorrow cannot break this.
 *
 * Gate OFF → zero with NO QUERY. Nothing is held back when the filter is not
 * running, so a poll costs exactly what it cost before the gate existed.
 *
 * TWO queries, sequential (never $transaction, CORE §3): the trip-held bills are
 * few, so their trip ids are read and counted distinct in memory; the unplanned
 * bills can be the whole To plan pool (60 on 2026-09-21), so they are a count()
 * and never fetched. SELECT only — no `orders.update` anywhere near this, or the
 * marker would see a false "changed" (CORE §3).
 */
export async function countHeldBackWaiting(
  boardWhere: Prisma.ordersWhereInput,
  gateOn: boolean,
): Promise<HeldBack> {
  if (!gateOn) return NOTHING_HELD;
  const rows = await prisma.orders.findMany({
    where: {
      AND: [
        boardWhere,
        {
          workflowStage: SUPPORT_DONE_OUTPUT,
          tripDropId: { not: null },
          tripDrop: { trip: { shownAt: null } },
        },
      ],
    },
    select: { tripDrop: { select: { tripId: true } } },
  });
  const unplanned = await prisma.orders.count({
    where: {
      AND: [boardWhere, { workflowStage: SUPPORT_DONE_OUTPUT, tripDropId: null }],
    },
  });
  const trucks = new Set(rows.map((r) => r.tripDrop?.tripId).filter((id): id is number => id != null));
  return { bills: rows.length, trucks: trucks.size, unplanned };
}

// ─────────────────────────────────────────────────────────────────────────────
// ⚠ `stampPickVisibility()` WAS HERE AND WAS RETIRED IN SLICE 8 (2026-09-15),
// with its only caller, POST /api/floor/pick-visible, and the per-bill Show strip
// on /floor. Visibility is decided per TRIP now: lib/trips/show.ts owns showing
// and taking back, and writes `trips` — never an order row, keeping the rule that
// no trip action may change a bill's status or its hold.
// ─────────────────────────────────────────────────────────────────────────────
