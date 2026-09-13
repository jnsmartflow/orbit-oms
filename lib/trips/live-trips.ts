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
// So neither caller carries the rule any more. Both derive from here. Adding a
// day to the desk's reach is now ONE edit, by construction, and there is no
// second place to remember.
//
// PURE. No prisma, no clock — the day is passed in. `Prisma` is imported for its
// types only, so this module can be read by a server feed and a predicate
// builder alike without dragging a client anywhere.

import type { Prisma } from "@prisma/client";

/**
 * `chk_trips_status`'s five values. Named here rather than retyped at each use,
 * per CORE §3: a status STRING is not an enum, so a wrong literal is never
 * rejected — it silently matches nothing, and the filter written on it looks
 * like it works forever.
 *
 * ⚠ ONLY THE TWO THIS MODULE ACTUALLY TESTS are exported as constants. The
 * others (`released`, `loading`, `dispatched`) are still hand-typed at their own
 * call sites; giving the whole vocabulary one owner is a worthwhile job and a
 * separate one, and half-migrating it would leave two sources of truth, which is
 * the failure this file exists to remove.
 */
export const TRIP_DRAFT = "draft";
export const TRIP_CANCELLED = "cancelled";

/**
 * THE DATE RULE — which days' trips a desk dated `deskDate` is about.
 *
 * Two arms:
 *   1. the day's own trips — `tripDate = deskDate`.
 *   2. the CARRIED arm — an open draft from any earlier day. A trip nobody
 *      finished planning does not stop existing at midnight; it is still the
 *      planner's to confirm or cancel, so it follows him forward.
 *
 * ⚠ `draft` BY NAME, never `status NOT IN (...)`. A sixth value added to
 * `chk_trips_status` must be an explicit decision to carry or not to carry,
 * never something this predicate inherits by accident. (This sentence is the
 * original author's, moved here with the rule it guards.)
 *
 * ⚠ CANCELLED IS NOT EXCLUDED HERE, deliberately — see `liveTripsOnDeskWhere`
 * below for the arm that does exclude it, and why the two are different
 * questions rather than one rule written twice.
 *
 * ⚠ HISTORY IS UNAFFECTED. A past day asked for its own date still gets its own
 * trips; arm 2 only ADDS open drafts, and a day in the past has none older than
 * itself and still open unless they are genuinely stale — in which case the
 * planner should see them there too.
 */
export function tripsOnDeskWhere(deskDate: Date): Prisma.tripsWhereInput {
  return {
    OR: [{ tripDate: deskDate }, { status: TRIP_DRAFT, tripDate: { lt: deskDate } }],
  };
}

/**
 * The same set with CANCELLED removed — the trips that can legitimately be
 * holding a bill.
 *
 * 🔴 WHY THIS IS A SECOND FUNCTION AND NOT A SECOND COPY. It is built from
 * `tripsOnDeskWhere` above, so the date rule still has exactly one definition
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
export function liveTripsOnDeskWhere(deskDate: Date): Prisma.tripsWhereInput {
  return { AND: [tripsOnDeskWhere(deskDate), { status: { not: TRIP_CANCELLED } }] };
}
