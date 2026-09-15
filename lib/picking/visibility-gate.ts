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
// when it is on NO trip, or on a trip that has been SHOWN. The point, in the
// owner's words: when volume is high the planner buckets orders into trucks
// first, then shows one truck at a time, so the supervisor picks a load to
// completion instead of 45 bills across six trucks and finishing none. A bill on
// no trip is never hidden — the switch is about picking trucks in order, not
// about hiding loose orders.
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
 *   gate ON  → a waiting bill on NO trip, or on a trip that has been SHOWN.
 *
 * ⚠ ONLY THE WAITING BRANCH. The in-progress and checked branches are never
 * gated, in any state of the switch (queue.ts). Do not add this term anywhere
 * else.
 */
export function waitingBranchWhere(gateOn: boolean): Prisma.ordersWhereInput {
  if (!gateOn) return { workflowStage: SUPPORT_DONE_OUTPUT };
  return {
    workflowStage: SUPPORT_DONE_OUTPUT,
    OR: [{ tripDropId: null }, { tripDrop: { trip: { shownAt: { not: null } } } }],
  };
}

export interface HeldBack {
  /** Waiting bills the gate is hiding. */
  bills: number;
  /** The distinct trips — trucks — those bills are on. */
  trucks: number;
}

const NOTHING_HELD: HeldBack = { bills: 0, trucks: 0 };

/**
 * How much WAITING work the gate is hiding from the picking board, in bills and
 * in trucks (slice 8: the supervisor's band reads "2 trucks with the planner ·
 * 17 bills").
 *
 * 🔴 THE ONE OWNER OF THIS COUNT. The Assign-tab band gets it on first paint from
 * the queue payload (`getPickingQueue`) and every 15s from
 * `app/api/picking/marker/route.ts`; both call this, neither writes the terms.
 *
 * Under the per-trip gate every hidden bill is, by construction, on a trip that
 * has not been shown — a bill on no trip is never hidden — so the trucks figure
 * is simply the distinct trips of those bills.
 *
 * ⚠ `boardWhere` MUST BE THE UNGATED PREDICATE — `buildPickingWhere(...)` with
 * `gateOn` omitted or false. A gated where already excludes every row counted
 * here, so passing one returns zero: the SAFE wrong answer (the band does not
 * render), never an overstatement.
 *
 * Gate OFF → zero with NO QUERY. Nothing is held back when the filter is not
 * running, so a poll costs exactly what it cost before the gate existed.
 *
 * ONE query: the hidden bills are few (the ones on trucks not yet shown), so
 * reading their trip ids and counting distinct values in memory is cheaper and
 * simpler than two count() round trips. SELECT only — no `orders.update`
 * anywhere near this, or the marker would see a false "changed" (CORE §3).
 */
export async function countHeldBackWaiting(
  boardWhere: Prisma.ordersWhereInput,
  gateOn: boolean,
): Promise<HeldBack> {
  if (!gateOn) return NOTHING_HELD;
  const rows = await prisma.orders.findMany({
    where: {
      ...boardWhere,
      workflowStage: SUPPORT_DONE_OUTPUT,
      tripDropId: { not: null },
      tripDrop: { trip: { shownAt: null } },
    },
    select: { tripDrop: { select: { tripId: true } } },
  });
  const trucks = new Set(rows.map((r) => r.tripDrop?.tripId).filter((id): id is number => id != null));
  return { bills: rows.length, trucks: trucks.size };
}

// ─────────────────────────────────────────────────────────────────────────────
// ⚠ `stampPickVisibility()` WAS HERE AND WAS RETIRED IN SLICE 8 (2026-09-15),
// with its only caller, POST /api/floor/pick-visible, and the per-bill Show strip
// on /floor. Visibility is decided per TRIP now: lib/trips/show.ts owns showing
// and taking back, and writes `trips` — never an order row, keeping the rule that
// no trip action may change a bill's status or its hold.
// ─────────────────────────────────────────────────────────────────────────────
