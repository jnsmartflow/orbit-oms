// lib/floor/load-plan-snapshot.ts — SERVER ONLY (2026-09-21).
//
// Keeps what the Upcountry load plan SUGGESTED (load_plan_snapshot,
// sql/2026-09-21-load-plan-snapshot.sql), for the admin "Load plan check".
//   - 'auto'   — the 15:00 IST cron (app/api/cron/load-plan-snapshot), one a day
//   - 'replan' — every press of Replan on the Load plan tab
//
// 🔴 NO RATES: a snapshot holds bill ids, kg, stops, places — the engine's
// output, which carries no rupee value.
//
// 🔴 A SAVE NEVER BREAKS THE CALLER. The table may not exist yet (the SQL not
// run); the plan is still returned and the save is logged and skipped.
//
// Sequential awaits; never prisma.$transaction (CORE §3).

import { prisma } from "@/lib/prisma";
import { getFloorBoard } from "@/lib/floor/queries";
import { snapshotCards } from "@/lib/trips/load-plan-check";
import type { V2Plan } from "@/lib/trips/load-plan-v2";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Today in IST as a UTC-midnight Date (the @db.Date shape) and as "YYYY-MM-DD". */
export function istToday(): { date: Date; iso: string } {
  const ist = new Date(Date.now() + IST_OFFSET_MS);
  const date = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()));
  return { date, iso: date.toISOString().slice(0, 10) };
}

export type SnapshotSource = "auto" | "replan";

/** Saves the plan as today's snapshot. Returns the new id, or null when it could not be saved. */
export async function saveLoadPlanSnapshot(plan: V2Plan, source: SnapshotSource): Promise<number | null> {
  try {
    const row = await prisma.load_plan_snapshot.create({
      data: { date: istToday().date, source, cards: snapshotCards(plan) as unknown as object },
      select: { id: true },
    });
    return row.id;
  } catch (err) {
    console.warn(`[load-plan-snapshot] ${source} snapshot not saved:`, err instanceof Error ? err.message.split("\n")[0] : err);
    return null;
  }
}

/** Is there an 'auto' snapshot for today already? (false when the table is missing). */
export async function hasAutoSnapshotToday(): Promise<boolean> {
  try {
    const n = await prisma.load_plan_snapshot.count({ where: { date: istToday().date, source: "auto" } });
    return n > 0;
  } catch {
    return false;
  }
}

/**
 * The Upcountry DUE pool's bill ids, as the Load plan tab shows them: on no
 * trip, due (not upcoming), and not in the tint room.
 *
 * ⚠ THE TINT-ROOM TEST MIRRORS `isPoolRow` (components/floor/trip-desk.tsx →
 * `isTintRoomRow` in status-pill.tsx: rowStatus is tintPending | tintAssigned).
 * Those live in client component files a server route cannot call, so the
 * same condition is restated here. Change both or neither.
 */
export async function upcountryPoolIds(): Promise<number[]> {
  const board = await getFloorBoard({ mode: "live", scope: "Upcountry" });
  const inTintRoom = (r: (typeof board.rows)[number]) =>
    !r.isDispatched && !r.isChecked && !r.isDone && !r.isAssigned && (r.tintPhase === "pending" || r.tintPhase === "assigned");
  return board.rows.filter((r) => r.tripDropId === null && r.zone !== "upcoming" && !inTintRoom(r)).map((r) => r.orderId);
}
