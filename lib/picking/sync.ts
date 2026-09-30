// lib/picking/sync.ts — POST /api/picking/sync, the server half (live feed picking 4a, 2026-09-30).
//
// Plan: docs/prompts/drafts/code-plan-2026-09-30-picking-live-feed.md §C, §D.1 (owner approved all
// 11 decisions). Route: app/api/picking/sync/route.ts. Parity: scripts/parity-picking-rows.ts.
//
// The supervisor board's ONE call per feed glance that carried changes. It re-reads ONLY the changed
// bills, through the SAME builder as the full queue — getPickingQueue({ scope: "openPending",
// onlyIds }) → buildPickingWhere with the same `gateOn` it reads once — so a patched row can never
// differ from a full load (PICKING §10: never re-declare the predicate).
//
//   1. trip ids → the bills on those trips (trip_drops). "Show to floor" / take back write `trips`
//      only, but they move the gate's waiting set (waitingBranchWhere) — the feed carries a TRIP id;
//   2. classify first — ONE facts statement. Only ids the client shows, or whose stage is a board stage
//      (waiting / assigned / picked, or checked TODAY), go to the heavy read; a floor or billing change that
//      is not the board's reads nothing more;
//   3. rows for those ids: present = on the board; absent = left (patch row null);
//      + their bundling siblings (waitingSkus / oilSkus) and the WHOLE board's held-back triple
//      (countHeldBackWaiting inside getPickingQueue, same gateOn);
//   4. pickDeleted — getPickDeletedToday, only when a changed id is a bill of one of today's
//      pick-delete decisions;
//   5. tintTouched — a changed order is a tint bill at a tint-room stage, or one the Tinting section
//      shows (tintShownIds): the client refetches /api/picking/tint-workload.
// Read-only; sequential awaits (CORE §3).

import { prisma } from "@/lib/prisma";
import { getISTDayRange } from "@/lib/dates";
import { buildPickingWhere, getPickingQueue, type PickingBillSkus } from "@/lib/picking/queue";
import { getPickDeletedToday } from "@/lib/picking/pick-deleted";
import type { PickDeletedCard, PickingQueueRow } from "@/lib/picking/types";
import { PICKING_OPEN_STAGES, PICK_CHECKED } from "@/lib/workflow-stages";

/** Every stage a row of the openPending board can carry (the builder's three OR branches). */
const BOARD_STAGES: readonly string[] = [...PICKING_OPEN_STAGES, PICK_CHECKED];
/** The Tinting section's stages (lib/picking/tint-workload.ts TINT_ROOM_STAGES). */
const TINT_ROOM_STAGES: readonly string[] = ["pending_tint_assignment", "tint_assigned", "tinting_in_progress"];
/** Stages a bill can have when it joins or leaves today's pick-deleted cards (deleted → cancelled; undo → restored). */
const PICK_DELETE_EDGE_STAGES: readonly string[] = ["cancelled", "pending_picking", "pending_tint_assignment"];

export const PICKING_SYNC_MAX_IDS = 1000;
export const PICKING_SYNC_MAX_SHOWN = 2000;

export interface PickingSyncBody {
  orderIds: number[];
  tripIds: number[];
  /** The board rows the client holds — so a bill LEAVING the board is re-read. */
  shownIds: number[];
  /** The bills the Tinting section shows. */
  tintShownIds: number[];
}

export interface PickingPatch {
  id: number;
  /** The row as the full queue would build it, or null = not on the board. */
  row: PickingQueueRow | null;
}

export interface PickingSyncResult {
  date: string;
  patches: PickingPatch[];
  /** Bundling siblings for the patched rows only (replace by orderId). */
  waitingSkus: PickingBillSkus[];
  oilSkus: PickingBillSkus[];
  /** The WHOLE board's held-back triple — present only when rows were re-read (else unchanged). */
  heldBack?: number;
  heldBackTrucks?: number;
  heldBackUnplanned?: number;
  /** Today's pick-deleted cards — present only when one of them may have changed. */
  pickDeleted?: PickDeletedCard[];
  tintTouched: boolean;
}

const isId = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;

/** Validate the request body → the body, or the 400 message. Every field optional. */
export function parsePickingSyncBody(raw: unknown): PickingSyncBody | string {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const read = (v: unknown, max: number, name: string): number[] | string => {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v) || !v.every(isId)) return `${name} must be an array of positive integers`;
    if (v.length > max) return `${name} may hold at most ${max} ids`;
    return Array.from(new Set(v as number[]));
  };
  const orderIds = read(b.orderIds, PICKING_SYNC_MAX_IDS, "orderIds");
  const tripIds = read(b.tripIds, PICKING_SYNC_MAX_IDS, "tripIds");
  const shownIds = read(b.shownIds, PICKING_SYNC_MAX_SHOWN, "shownIds");
  const tintShownIds = read(b.tintShownIds, PICKING_SYNC_MAX_SHOWN, "tintShownIds");
  for (const r of [orderIds, tripIds, shownIds, tintShownIds]) if (typeof r === "string") return r;
  return {
    orderIds: orderIds as number[],
    tripIds: tripIds as number[],
    shownIds: shownIds as number[],
    tintShownIds: tintShownIds as number[],
  };
}

export async function syncPicking(body: PickingSyncBody): Promise<PickingSyncResult> {
  // 1. Trips → their bills (trip_drops, via orders."tripDropId").
  const tripBills =
    body.tripIds.length > 0
      ? (
          await prisma.orders.findMany({
            where: { tripDrop: { tripId: { in: body.tripIds } } },
            select: { id: true },
          })
        ).map((o) => o.id)
      : [];
  const all = Array.from(new Set([...body.orderIds, ...tripBills]));
  const date = buildPickingWhere({ scope: "openPending" }).isoDate;
  if (all.length === 0) return { date, patches: [], waitingSkus: [], oilSkus: [], tintTouched: false };

  // 2. Classify — ONE statement (PK + the assignment's check time). A checked bill is on the board
  //    only on the day it was checked (the builder's checked arm), so an old pick_checked bill —
  //    most of them never leave that stage — is not worth the heavy read.
  const facts = await prisma.$queryRaw<{ id: number; workflowStage: string; orderType: string | null; checkedAt: Date | null }[]>`
    SELECT o.id, o."workflowStage", o."orderType", pa.checked_at AS "checkedAt"
      FROM orders o
      LEFT JOIN pick_assignments pa ON pa.order_id = o.id
     WHERE o.id = ANY (${all}::int[])`;
  const { start: dayStart, end: dayEnd } = getISTDayRange();
  const onBoardStage = new Set(
    facts
      .filter((f) =>
        f.workflowStage === PICK_CHECKED
          ? f.checkedAt !== null && f.checkedAt >= dayStart && f.checkedAt < dayEnd
          : BOARD_STAGES.includes(f.workflowStage),
      )
      .map((f) => f.id),
  );
  const shown = new Set(body.shownIds);
  // In the caller's order (deterministic; the client re-sorts anyway).
  const relevant = all.filter((id) => shown.has(id) || onBoardStage.has(id));

  // 5. Tinting section.
  const tintShown = new Set(body.tintShownIds);
  const tintTouched =
    all.some((id) => tintShown.has(id)) ||
    facts.some((f) => f.orderType === "tint" && TINT_ROOM_STAGES.includes(f.workflowStage));

  // 4. Today's pick-deleted cards — only when a changed bill is one of today's pick-delete decisions.
  let pickDeleted: PickDeletedCard[] | undefined;
  const edge = facts.filter((f) => PICK_DELETE_EDGE_STAGES.includes(f.workflowStage)).map((f) => f.id);
  if (edge.length > 0) {
    const hit = await prisma.pick_delete_decisions.count({
      where: { kind: "pick_delete", deletedOrderId: { in: edge }, decidedAt: { gte: dayStart, lt: dayEnd } },
    });
    if (hit > 0) pickDeleted = await getPickDeletedToday();
  }

  if (relevant.length === 0) {
    return { date, patches: [], waitingSkus: [], oilSkus: [], tintTouched, ...(pickDeleted ? { pickDeleted } : {}) };
  }

  // 3. The rows, through the full queue's own builder.
  const q = await getPickingQueue({ scope: "openPending", onlyIds: relevant });
  const byId = new Map(q.rows.map((r) => [r.orderId, r]));
  return {
    date: q.date,
    patches: relevant.map((id) => ({ id, row: byId.get(id) ?? null })),
    waitingSkus: q.waitingSkus,
    oilSkus: q.oilSkus,
    heldBack: q.heldBack,
    heldBackTrucks: q.heldBackTrucks,
    heldBackUnplanned: q.heldBackUnplanned,
    ...(pickDeleted ? { pickDeleted } : {}),
    tintTouched,
  };
}
