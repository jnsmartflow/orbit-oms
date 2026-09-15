// WHICH TRIPS A DAY'S DESK IS ABOUT — the ONE definition, extracted 2026-09-13.
//
// 🔴 WHY THIS MODULE EXISTS. Two places used to decide this and they disagreed,
// and the whole of the 2026-09-12/13 trip-desk bug lived in the gap between
// them. `getTripsForDate` (lib/trips/queries.ts) said "trips dated D, plus open
// drafts older than D". The board's trip arm (`floorTripBillsWhere`,
// lib/floor/queries.ts) said "tripDate >= today". So the rail could show a trip
// whose bills the board refused, and every stop on it rendered a fallback line
// instead of its rows.
//
// It was not a small gap. On the morning of 2026-09-13 every trip on the rail
// was a draft carried from 2026-09-12 — 22 trips, 105 bills — and the board arm
// matched NONE of them: 86 of 88 stops came up empty. The same comparison made
// one day earlier could not see the problem at all, because every trip that day
// was dated that day and the two rules happened to agree. That is exactly the
// kind of divergence that hand-syncing does not fix: it looks correct on the
// day you check it and breaks on the day you do not.
//
// So neither caller carries the rule any more. Both derive from here. Changing
// the desk's reach is ONE edit, by construction, and there is no second place to
// remember — and the live-sync marker follows too, through the board's arm.
//
// PURE. No prisma, no clock — the days are passed in. `Prisma` is imported for
// its types only, and lib/workflow-stages.ts is itself pure, so this module can
// be read by a server feed and a predicate builder alike without dragging a
// client anywhere.

import type { Prisma } from "@prisma/client";
import { DISPATCHED, PICK_CHECKED } from "@/lib/workflow-stages";

/**
 * `chk_trips_status` values this module names. Named here rather than retyped
 * at each use, per CORE §3: a status STRING is not an enum, so a wrong literal is
 * never rejected — it silently matches nothing.
 *
 * ⚠ `TRIP_DRAFT` NO LONGER DECIDES ANYTHING HERE (slice 10). It stays exported
 * because the value still exists in the CHECK and a future caller should import
 * it rather than retype it.
 */
export const TRIP_DRAFT = "draft";
export const TRIP_CANCELLED = "cancelled";

/** `cancelled` is a workflowStage value as well; lib/workflow-stages.ts exports
 *  no constant for it, so it is named once here. */
const STAGE_CANCELLED = "cancelled";

/**
 * The stages at which a bill on a trip is DONE for the desk: checked, gone, or
 * called off. A HOLD is done too, and is tested separately because it is a
 * status, not a stage. Owner's rule, slice 10 (2026-09-15): "Done = checked, or
 * on hold". `dispatched` is here because a shipped bill passed through checking;
 * `cancelled` because a cancelled bill will never be checked and must not pin a
 * trip to the desk forever.
 *
 * ⚠ REVISIT WHEN THE LOADING SCREEN SHIPS. Once loading end writes `dispatched`,
 * the owner decides whether "done" becomes dispatched instead of checked. Until
 * then nothing writes `dispatched` (slice 7), and a dispatched-only rule would
 * keep every trip on the desk forever.
 */
const DESK_DONE_STAGES: string[] = [PICK_CHECKED, DISPATCHED, STAGE_CANCELLED];

/**
 * A bill that still needs the floor — what the CARRIED arm tests for.
 * Not removed, not at a done stage, not held. `dispatchStatus` is nullable, so
 * "not held" is written NULL-safe: `NOT { field: value }` on a nullable column
 * drops the NULL rows (CORE §13), and an undecided bill is not a held one.
 */
const BILL_NOT_DONE: Prisma.ordersWhereInput = {
  isRemoved: false,
  workflowStage: { notIn: DESK_DONE_STAGES },
  OR: [{ dispatchStatus: null }, { dispatchStatus: { not: "hold" } }],
};

/**
 * THE DESK RULE — which trips a desk dated `deskDate` is about, when today is
 * `todayDate`. Both UTC-midnight, the `@db.Date` shape `trips.tripDate` has.
 *
 * 🔴 SLICE 10 (2026-09-15) — THE CALENDAR WAS THE BUG, NOT THE MISSING CLOSER.
 * Closing a trip never cleared the desk; trips left by DATE, and an open draft
 * was the only thing carried forward. That dropped work (a released trip with a
 * bill still being picked vanished at midnight) and kept non-work (a
 * vehicle-less trip followed the planner forever). The rule is now about the
 * bills inside, and status plays no part:
 *
 *   LIVE — deskDate is today (or later):
 *     1. the day's own trips — `tripDate = deskDate`, whatever is inside, empty
 *        ones included. Today's desk is today's plan.
 *     2. CARRIED — a trip from an EARLIER day that still holds at least one bill
 *        that is NOT DONE (BILL_NOT_DONE above). A draft whose bills are all
 *        checked leaves; a released trip with a bill still with a picker stays.
 *
 *   HISTORY — deskDate is before today:
 *     trips dated `deskDate` ONLY. The old carried arm ran on past days too, so
 *     a trip still a draft TODAY appeared on every earlier day's history — a
 *     present-day fact leaking into a past day. Owner: a bug, not a feature.
 *
 * Consequences, each an owner decision:
 *   - an EMPTY trip from an earlier day has no bill to keep it, so it leaves at
 *     midnight and stays in History on its own day;
 *   - a trip whose remaining bills are all ON HOLD leaves too — a hold is a
 *     human saying not this one;
 *   - U-260912-05 (released, 2 bills checked, never dispatched) does NOT come
 *     back: both bills are checked, so it is done for the desk. So do
 *     L-260912-08 and U-260914-03, whose 15 bills are all checked.
 *
 * ⚠ CANCELLED IS NOT EXCLUDED HERE, deliberately — see `liveTripsOnDeskWhere`.
 * A cancelled trip from an earlier day holds no bills (cancel detaches them), so
 * the carried arm cannot pick one up.
 *
 * ⚠ SPEED. The carried arm is a trips → trip_drops → orders EXISTS, and it runs
 * in the rail feed, in the board's fourth arm and in the 15-second marker. The
 * EXPLAIN ANALYZE taken against live data before it shipped is recorded in
 * FLOOR-TO-FLOOR-DISCOVERY.md.
 */
export function tripsOnDeskWhere(deskDate: Date, todayDate: Date): Prisma.tripsWhereInput {
  if (deskDate.getTime() < todayDate.getTime()) return { tripDate: deskDate };
  return {
    OR: [
      { tripDate: deskDate },
      { tripDate: { lt: deskDate }, drops: { some: { orders: { some: BILL_NOT_DONE } } } },
    ],
  };
}

/**
 * The LIVE desk with CANCELLED removed — the trips that can legitimately be
 * holding a bill. The board's fourth arm, which always asks about TODAY.
 *
 * 🔴 WHY THIS IS A SECOND FUNCTION AND NOT A SECOND COPY. It is built from
 * `tripsOnDeskWhere` above, so the desk rule still has exactly one definition
 * and this cannot drift from it. What differs is a genuinely different
 * question, and the two callers really do ask different ones:
 *
 *   - the RAIL feed wants every trip of the day INCLUDING cancelled ones, and
 *     drops them at render (`trip-rail.tsx` filters `status !== "cancelled"`
 *     once, for the whole rail). Keeping them in the payload is what lets a
 *     trip the operator just cancelled still resolve in the detail pane instead
 *     of the pane blanking to "no longer on this day's board" under his hand.
 *   - the BOARD arm wants only trips that can hold a bill.
 *
 * ⚠ THE CANCELLED TERM SHOULD NEVER BITE, and is kept anyway. Cancelling a trip
 * DETACHES every bill first (`app/api/floor/trips/[id]/cancel/route.ts` writes
 * `tripDropId: null` for each, deliberately without the usual `isRemoved` filter
 * so no pointer outlives the trip), so a cancelled trip normally holds nothing
 * and this term matches nothing. It earns its place on the partial-failure path:
 * that route cancels the trip when SOME bills detached and some did not, and
 * without this term the stragglers would ride onto the live board tagged to a
 * trip the rail refuses to show.
 */
export function liveTripsOnDeskWhere(todayDate: Date): Prisma.tripsWhereInput {
  return { AND: [tripsOnDeskWhere(todayDate, todayDate), { status: { not: TRIP_CANCELLED } }] };
}
