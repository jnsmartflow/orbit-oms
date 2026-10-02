// lib/tint/base-feed.ts
//
// ═══════════════════════════════════════════════════════════════════════════
// 🔴 THE TINT MANAGER'S BASE TAB FEED — FLOOR'S BOARD, NARROWED, NEVER COPIED
// ═══════════════════════════════════════════════════════════════════════════
//
// docs/prompts/drafts/code-discovery-2026-10-01-tint-manager-base-tab.md §A, §I.
//
// A bill is on Base EXACTLY while Floor's live board shows it (owner): the rows
// come out of lib/floor/queries.ts getFloorBoard — the same predicate
// (floorBoardWhere), the same hide-exclusion, include, enrichment, sort and row
// shape — with an extraWhere that only NARROWS it:
//
//   1. BASE_BILL_WHERE (lib/tint/manager-bill.ts) — non-tint, SMU 74 / 77;
//   2. the TRIP CUT-OFF (owner decision 8) — a bill on a trip shows ONLY on the
//      IST day it joined that trip. Floor keeps showing it; Base does not.
//
// Rows are FloorBoardRow unchanged: the rowStatus() inputs (isAssigned / isDone
// / isChecked / isDispatched / tintPhase), the slot (windowId / windowTime /
// dispatchTargetDate), the trip number exactly as stored (trips.tripNumber,
// written by lib/trips/number.ts formatTripNumber — letter first, never
// retyped), and the ship-to pair (customerName / shipToOverrideName). The pill
// itself is computed client-side by components/floor/status-pill.tsx rowStatus
// — a "use client" module this server file must not import (the same reason
// lib/floor/queries.ts inlines its waiting test).
//
// READ-ONLY. Sequential awaits (CORE §3).

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getISTDayRange } from "@/lib/dates";
import { getFloorBoard } from "@/lib/floor/queries";
import type { FloorBoardRow } from "@/lib/floor/types";
import { TRIP_BILLS_ADDED } from "@/lib/trips/activity";
import { isTintManagerBaseRow, tintManagerBaseWhere } from "@/lib/tint/base-bills";

/**
 * The TRIP CUT-OFF term (owner decision 8): not on a trip, OR on the trip it
 * joined TODAY (IST).
 *
 * 🔴 WHY NOT trip_drops.createdAt. A drop is a STOP, shared by every bill for
 * that shop on the trip: a bill joining an existing stop today keeps the stop's
 * older createdAt. The per-bill join instant lives in trip_activity: the ONE
 * path that sets orders.tripDropId to a drop (POST /api/floor/trips/[id]/bills,
 * action "add", `route.ts:290`) writes a `bills_added` row whose detail carries
 * the orderIds it attached (lib/trips/activity.ts logTripBills). Removal +
 * re-add writes a fresh `bills_added` row, so the clock resets; a bill removed
 * from trip A and added to trip B is matched on B's tripId, not A's.
 *
 * Fail-closed: a bill on a trip with no `bills_added` row today (attached on an
 * earlier day, or before the activity log existed, or if that log write ever
 * failed after the attach) is hidden — the safe side of "gone from tomorrow".
 *
 * One read (today's `bills_added` rows — bounded by a day's trip presses),
 * one term: OR[ not on a trip, (id ∈ joined-today AND on that same trip) … ].
 */
export async function baseTripCutoffWhere(date?: string): Promise<Prisma.ordersWhereInput> {
  // `date` (2026-10-02, history): the same rule for a PAST IST day — a trip bill
  // counts only if it joined that trip ON that day. Omitted → today, as before.
  const today = getISTDayRange(date);
  const rows = await prisma.trip_activity.findMany({
    where: { action: TRIP_BILLS_ADDED, createdAt: { gte: today.start, lt: today.end } },
    select: { tripId: true, detail: true },
  });
  const idsByTrip = new Map<number, Set<number>>();
  for (const r of rows) {
    const ids = (r.detail as { orderIds?: unknown } | null)?.orderIds;
    if (!Array.isArray(ids)) continue;
    const set = idsByTrip.get(r.tripId) ?? new Set<number>();
    for (const id of ids) if (typeof id === "number" && Number.isInteger(id)) set.add(id);
    idsByTrip.set(r.tripId, set);
  }
  return {
    OR: [
      { tripDropId: null },
      ...Array.from(idsByTrip.entries()).map(([tripId, ids]) => ({
        id: { in: Array.from(ids) },
        tripDrop: { tripId },
      })),
    ],
  };
}

/** The Base tab's rows — Floor's live board ∩ Base bills ∩ the trip cut-off.
 *  With `date` (history, 2026-10-02): Floor's HISTORY board for that IST day
 *  (getFloorBoard mode "history" — promised for D, checked on D, or on D's
 *  trips) ∩ Base bills ∩ the cut-off dated to D. Omitted → exactly as before. */
//
// "Base — No Tint" bills (2026-10-02, owner): a project-division bill closed by
// the placeholder is a base order. The read uses lib/tint/base-bills.ts's
// SUPERSET (non-tint 74/77 OR placeholder-finished 74/77 tint), and the row
// stays only if Picking's colour rule says base (row.colourWork, filled by
// getFloorBoard via resolveColourWork). There is no second rule. Same trip
// cut-off for every row.
export async function getTintBaseRows(date?: string): Promise<FloorBoardRow[]> {
  const cutoff = await baseTripCutoffWhere(date);
  const baseWhere = await tintManagerBaseWhere();
  const board = date
    ? await getFloorBoard({ mode: "history", date, extraWhere: { AND: [baseWhere, cutoff] } })
    : await getFloorBoard({ mode: "live", extraWhere: { AND: [baseWhere, cutoff] } });
  return board.rows.filter(isTintManagerBaseRow);
}
