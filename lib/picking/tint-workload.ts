import { prisma } from "@/lib/prisma";
import { parseArticleTag } from "@/lib/article-tag-parse";
import { SMU_CODE_BY_NAME } from "@/lib/import-upsert/types";
import { computeElapsedMs } from "@/lib/tint/elapsed-time";
import { TINT_ASSIGNMENT_ACTIVE_STATUSES } from "@/lib/tint/assignment-status";
import { billToByObd } from "@/lib/floor/queries";
import { isGiftBill, loadLitres } from "@/lib/orders/gift";

// ── The tint room, as the PICKING supervisor needs to read it ───────────────
//
// A read-only answer to one question: what is in the tint room right now, who
// has it, and how long has it been there. It feeds the Tinting section on
// `/picking`'s Picking tab, which the supervisor cannot act on — a tint bill
// becomes assignable only when the tint room finishes it and a done route moves
// its stage.
//
// 🔴 IT TOUCHES NOTHING THE PICKING BOARD READS. No term is added to
// `buildPickingWhere`, `lib/picking/queue.ts` is not called, and neither picking
// route is involved — so the Assign list, the Assign badge and the held-back
// band cannot move because of anything in here (PICKING §10: the marker and the
// queue share one predicate, and this is not it).
//
// ⚠ ROSTER-SEEDED, NOT BILL-DERIVED. Every active tint operator appears even
// with nothing on him, the same shape `app/api/warehouse/pickers/route.ts` uses
// for pickers — deliberately UNLIKE the picker list directly above this section
// on the same tab, which only lists a picker because a bill put him there. An
// operator with no work is a fact the supervisor needs ("Free"); an absent card
// reads as "no such operator".
//
// ⚠ NO HIDE EXCLUSION, following the surface it feeds. `lib/picking/queue.ts`
// makes zero `getHideExclusion()` calls and that is a standing per-surface
// decision (CORE §13 / PICKING §7): an admin-hidden bill is invisible on Floor
// and visible on Picking. The Tint Manager board DOES apply it, so a hidden tint
// bill will show here and not there. Deliberate, and the reason is recorded here
// rather than left to be discovered as an inconsistency.
//
// ⚠ SEQUENTIAL AWAITS, never prisma.$transaction (CORE §3). SELECT-only: there
// is no `orders.update` anywhere in this module, and there must never be — every
// board in the depot keys its live-sync on MAX(orders.updatedAt).

/** The three stages that mean "the tint room still has it". Past these, the
 *  bill has left the tint room and belongs to Floor or Picking.
 *
 *  ⚠ WRITTEN OUT, NOT DERIVED FROM RANK, for the same reason
 *  `lib/floor/queries.ts` writes its own three out: ranks 20-40 happen to be
 *  these today, and a rank filter would silently absorb any future
 *  mid-pipeline stage into "this bill is in the tint room". */
const TINT_ROOM_STAGES = ["pending_tint_assignment", "tint_assigned", "tinting_in_progress"] as const;

/**
 * What one bill is doing in the tint room. The wording each of these drives is
 * the mockup's (docs/mockups/picking-tint/picking-tint-base-mockup-v8.html):
 * "tinting · 42 min" · "in queue · 2nd" · "paused · 18 min so far" ·
 * "waiting · 4h".
 */
export type TintBillState = "waiting" | "queued" | "tinting" | "paused";

export interface TintWorkloadBill {
  orderId: number;
  obdNumber: string;
  /** ISO. `orderDateTime`, falling back to `obdEmailDate` — the same pair
   *  `PickingQueueRow.obdDateTime` uses, so the two read the same clock. */
  obdDateTime: string | null;
  /** The SITE — the effective ship-to dealer's master name, else SAP's own name. */
  siteName: string;
  /** The ORDERING DEALER (`import_raw_summary.billToCustomerName`). */
  billToName: string | null;
  route: string | null;
  area: string | null;
  /** For the section's Local / UPC filter — the same field the picking card filters on. */
  deliveryType: string | null;
  litres: number | null;
  /** SAP GIFTS (lib/orders/gift.ts): `litres` is shown as stored, but left out of every total below. */
  isGift: boolean;
  /** The article tag's D count. Null when the bill carries no tag at all. */
  drums: number | null;
  smuCode: string | null;
  state: TintBillState;
  /** `tinting` and `paused` only — whole minutes, via lib/tint/elapsed-time.ts. */
  minutes: number | null;
  /** `waiting` only — whole hours since the bill arrived. */
  waitingHours: number | null;
  /** `queued` only — 1-based rank RECOMPUTED per operator (see rankQueues). */
  queueRank: number | null;
  /** How many live splits this bill is broken into, and who holds them. 0 and
   *  empty on an ordinary whole-OBD bill, which is every live bill today. */
  splitCount: number;
  splitOperatorNames: string[];
}

export interface TintWorkloadOperator {
  id: number;
  name: string;
  bills: number;
  drums: number;
  litres: number;
  /** His own headline state: what he is doing RIGHT NOW, or null when free. */
  state: Exclude<TintBillState, "waiting"> | null;
  /** Minutes on the bill named by `state`, when that state carries a number. */
  minutes: number | null;
  /** How many of his bills are `queued` behind the one he is on. */
  queued: number;
  rows: TintWorkloadBill[];
}

export interface TintWorkloadResult {
  /** Every bill in the tint room. `bills` = pool.bills + Σ operators.bills. */
  totals: { bills: number; drums: number; litres: number };
  pool: { bills: number; drums: number; litres: number; oldestWaitHours: number | null; rows: TintWorkloadBill[] };
  operators: TintWorkloadOperator[];
}

/** The D count off one order-level article tag. Null means UNKNOWN, never 0:
 *  ~27% of SAP codes resolve in neither catalog table and leave their bill
 *  untagged (CORE §7.1.c), and a 0 there would read as "no drums on this bill".
 *
 *  ⚠ THROUGH THE SHARED PARSER, never a hand-rolled split. `parseArticleTag`
 *  walks number/word pairs because a tag can hold several groups
 *  ("1 Drum, 2 Carton"), and the inline parsers that took `parts[0]` silently
 *  dropped every multi-group tag — 801 of 14,207 tagged rows (its own note). */
function drumsOf(tag: string | null): number | null {
  if (!tag) return null;
  const groups = parseArticleTag(tag);
  if (groups.length === 0) return null;
  let drums = 0;
  for (const g of groups) if (g.type === "Drum") drums += g.count;
  return drums;
}

/** Sum of a bill list's drums, skipping unknowns. A null tag contributes
 *  NOTHING rather than zero — the same direction lib/floor/format.ts takes, and
 *  for the same reason: one untagged bill must not blank a real total. */
function sumDrums(rows: TintWorkloadBill[]): number {
  let n = 0;
  for (const r of rows) n += r.drums ?? 0;
  return n;
}

function sumLitres(rows: TintWorkloadBill[]): number {
  let n = 0;
  // A GIFT bill adds no litres (lib/orders/gift.ts); it still counts as a bill.
  for (const r of rows) n += loadLitres(r.litres, r.isGift);
  return Math.round(n * 100) / 100;
}

const MS_PER_HOUR = 60 * 60 * 1000;

/**
 * The tint room's live workload, roster-seeded.
 *
 * Sequential awaits throughout. Five reads: the roster, the bills, the live
 * assignment rows, the live splits, and the bill-to names.
 */
export async function getTintWorkload(nowMs: number = Date.now()): Promise<TintWorkloadResult> {
  // ── 1. The roster ─────────────────────────────────────────────────────────
  // Identified EXACTLY as app/api/tint/manager/operators/route.ts does: active,
  // and holding the tint_operator role through the `user_roles` junction rather
  // than `users.roleId`.
  //
  // 🔴 THE "BASE — NO TINT" PLACEHOLDER (users id 54) FAILS BOTH TESTS AND SO
  // NEEDS NO SPECIAL CASE. It is `isActive: false` and carries ZERO `user_roles`
  // rows (SELECT-verified 2026-09-17), which is exactly the double exclusion
  // lib/tint/base-operator.ts documents as the point of that row: usable as an
  // attribution target, invisible everywhere a PERSON is listed. Adding an
  // id-based filter here would hide a real operator the day ids shift.
  const roster = await prisma.users.findMany({
    where: { isActive: true, userRoles: { some: { role: { name: "tint_operator" } } } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  // ── 2. The bills still in the tint room ───────────────────────────────────
  // `orderType: "tint"` is belt-and-braces beside the stage filter: only a tint
  // bill can be at a tint stage, and a manual-entry pull sets both together.
  const orders = await prisma.orders.findMany({
    where: {
      orderType: "tint",
      workflowStage: { in: [...TINT_ROOM_STAGES] },
      isRemoved: false,
    },
    include: {
      customer: {
        select: {
          customerName: true,
          area: {
            select: {
              name: true,
              primaryRoute: { select: { name: true } },
              deliveryType: { select: { name: true } },
            },
          },
        },
      },
      shipToOverrideCustomer: {
        select: {
          customerName: true,
          area: {
            select: {
              name: true,
              primaryRoute: { select: { name: true } },
              deliveryType: { select: { name: true } },
            },
          },
        },
      },
      querySnapshot: { select: { articleTag: true, totalVolume: true } },
    },
  });

  if (orders.length === 0) {
    return {
      totals: { bills: 0, drums: 0, litres: 0 },
      pool: { bills: 0, drums: 0, litres: 0, oldestWaitHours: null, rows: [] },
      operators: roster.map((u) => ({
        id: u.id, name: u.name, bills: 0, drums: 0, litres: 0,
        state: null, minutes: null, queued: 0, rows: [],
      })),
    };
  }

  const orderIds = orders.map((o) => o.id);

  // ── 3. The LIVE assignment rows ───────────────────────────────────────────
  // 🔴 ONLY THE LIVE STATUSES, AND THE BILL'S STAGE IS WHAT DECIDES ANYTHING.
  // Six rows with a live-looking status (4 `assigned`, 1 `paused`, 1 on the bill
  // genuinely in the room) sit on bills that were dispatched or cancelled long
  // ago (SELECT 2026-09-17); the stage filter above has already excluded those
  // bills, so those rows cannot reach this query. Asking "does an assignment row
  // exist" instead of "what stage is the bill at" is the mistake that would have
  // put a dispatched bill back in an operator's queue.
  const assignments = await prisma.tint_assignments.findMany({
    where: {
      orderId: { in: orderIds },
      splitId: null,
      status: { in: [...TINT_ASSIGNMENT_ACTIVE_STATUSES] },
    },
    select: {
      orderId: true,
      assignedToId: true,
      status: true,
      startedAt: true,
      accumulatedMinutes: true,
      createdAt: true,
      order: { select: { sequenceOrder: true, createdAt: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  // Latest live row per bill wins — a re-assigned bill leaves its earlier row
  // behind, exactly as the Floor detail panel and the Tint Manager board read it.
  const liveByOrder = new Map<number, (typeof assignments)[number]>();
  for (const a of assignments) if (!liveByOrder.has(a.orderId)) liveByOrder.set(a.orderId, a);

  // ── 4. Live SPLITS ────────────────────────────────────────────────────────
  // Legacy shape: the Create Split UI was dropped in the 2026-09-05/06 board
  // rebuild and `POST /api/tint/manager/splits/create` has had no caller since
  // (TINT §1.11), so no NEW split can be made. Nine exist all-time and none is
  // live today — this arm is here so a legacy split does not silently vanish
  // from a supervisor's count, not because it is a common path.
  const splits = await prisma.order_splits.findMany({
    where: { orderId: { in: orderIds }, status: { in: ["tint_assigned", "tinting_in_progress"] } },
    select: {
      id: true,
      orderId: true,
      status: true,
      sequenceOrder: true,
      createdAt: true,
      assignedToId: true,
      assignedTo: { select: { id: true, name: true } },
      tintAssignment: {
        select: { status: true, startedAt: true, accumulatedMinutes: true },
      },
    },
  });
  const splitsByOrder = new Map<number, typeof splits>();
  for (const s of splits) {
    const list = splitsByOrder.get(s.orderId) ?? [];
    list.push(s);
    splitsByOrder.set(s.orderId, list);
  }

  // ── 5. Bill-to names ──────────────────────────────────────────────────────
  // Floor's own per-OBD lookup, imported rather than re-written (it reads
  // `import_raw_summary`, latest row per OBD). One owner, two callers.
  const billTo = await billToByObd(orders.map((o) => o.obdNumber));

  const nameById = new Map(roster.map((u) => [u.id, u.name]));

  // ── Shape each bill ───────────────────────────────────────────────────────
  interface Pending { bill: TintWorkloadBill; operatorId: number | null }
  const pending: Pending[] = [];

  for (const order of orders) {
    const dealer = order.shipToOverrideCustomer ?? order.customer;
    const live = liveByOrder.get(order.id);
    const orderSplits = splitsByOrder.get(order.id) ?? [];

    // WHO HOLDS THE BILL, and its state.
    //
    // 🔴 A SPLIT BILL IS COUNTED ONCE AND ATTRIBUTED TO ONE OPERATOR — the one
    // holding its MOST ADVANCED split (in progress before assigned, then lowest
    // sequenceOrder, then earliest createdAt). `splitCount` and
    // `splitOperatorNames` carry the rest of the truth so the UI can say "split
    // across 2" without the bill appearing in two buckets and inflating the
    // totals. Litres and drums are the PARENT's figures, which is why splitting
    // the bill across buckets would double-count them.
    let operatorId: number | null = null;
    let state: TintBillState = "waiting";
    let minutes: number | null = null;

    if (orderSplits.length > 0) {
      const ranked = orderSplits.slice().sort((a, b) => {
        const pa = a.status === "tinting_in_progress" ? 0 : 1;
        const pb = b.status === "tinting_in_progress" ? 0 : 1;
        if (pa !== pb) return pa - pb;
        if ((a.sequenceOrder ?? 0) !== (b.sequenceOrder ?? 0)) return (a.sequenceOrder ?? 0) - (b.sequenceOrder ?? 0);
        return a.createdAt.getTime() - b.createdAt.getTime();
      });
      const lead = ranked[0];
      operatorId = lead.assignedToId ?? null;
      if (lead.status === "tinting_in_progress") {
        state = "tinting";
        const ms = computeElapsedMs({
          status: lead.tintAssignment?.status ?? "tinting_in_progress",
          startedAt: lead.tintAssignment?.startedAt ?? null,
          accumulatedMinutes: lead.tintAssignment?.accumulatedMinutes ?? 0,
          nowMs,
        });
        minutes = ms === null ? null : Math.floor(ms / 60_000);
      } else {
        state = "queued";
      }
    } else if (live && live.assignedToId !== null) {
      operatorId = live.assignedToId;
      if (live.status === "paused") {
        // ⚠ MINUTES SO FAR — TIME SPENT, NOT PROGRESS. `accumulatedMinutes` is
        // the total tinting time banked across runs; how much of the bill is
        // physically done lives in `currentProgress` (a per-SKU JSONB snapshot)
        // and is a DIFFERENT FACT that no screen reads today (TINT §14). It is
        // deliberately not returned: "18 min so far" must never be read as
        // "18% done".
        state = "paused";
        const ms = computeElapsedMs({
          status: "paused",
          startedAt: live.startedAt,
          accumulatedMinutes: live.accumulatedMinutes,
          nowMs,
        });
        minutes = ms === null ? null : Math.floor(ms / 60_000);
      } else if (live.status === "tinting_in_progress") {
        // 🔴 NEVER `startedAt` ALONE. Resume RESETS that column to now
        // (TINT §5), so a job paused for an hour and resumed would read 0 min.
        // The shared helper folds `accumulatedMinutes` back in.
        state = "tinting";
        const ms = computeElapsedMs({
          status: live.status,
          startedAt: live.startedAt,
          accumulatedMinutes: live.accumulatedMinutes,
          nowMs,
        });
        minutes = ms === null ? null : Math.floor(ms / 60_000);
      } else {
        state = "queued";
      }
    }

    // ⚠ A BILL AT AN ASSIGNED STAGE WITH NO LIVE ROW FALLS TO THE POOL. That is
    // a data-inconsistent bill (stage says somebody has it, no assignment row
    // says who) and there are none live; the pool is the honest place for it,
    // because the actionable truth is "this needs an operator". It also keeps
    // the invariant the section's totals rest on: bills = pool + operators.
    const arrivedAt = order.orderDateTime ?? order.obdEmailDate ?? order.createdAt;
    const waitingHours =
      state === "waiting" ? Math.max(0, Math.floor((nowMs - arrivedAt.getTime()) / MS_PER_HOUR)) : null;

    pending.push({
      operatorId: state === "waiting" ? null : operatorId,
      bill: {
        orderId: order.id,
        obdNumber: order.obdNumber,
        obdDateTime: (order.orderDateTime ?? order.obdEmailDate)?.toISOString() ?? null,
        siteName: dealer?.customerName ?? order.shipToCustomerName ?? "(Unmatched)",
        billToName: billTo.get(order.obdNumber) ?? null,
        route: dealer?.area?.primaryRoute?.name ?? null,
        area: dealer?.area?.name ?? null,
        deliveryType: dealer?.area?.deliveryType?.name ?? null,
        litres: order.querySnapshot?.totalVolume ?? null,
        // `include` query — the scalar is already loaded.
        isGift: isGiftBill(order.materialType),
        drums: drumsOf(order.querySnapshot?.articleTag ?? null),
        smuCode: order.smu !== null ? (SMU_CODE_BY_NAME[order.smu] ?? null) : null,
        state,
        minutes,
        waitingHours,
        queueRank: null,
        splitCount: orderSplits.length,
        splitOperatorNames: Array.from(
          new Set(orderSplits.map((s) => s.assignedTo?.name ?? nameById.get(s.assignedToId ?? -1) ?? "—")),
        ),
      },
    });
  }

  // ── Queue ranks — RECOMPUTED PER OPERATOR ─────────────────────────────────
  // 🔴 NEVER `orders.sequenceOrder` ITSELF. That column is a sparse MAX+1 value
  // (assign/route.ts) and is frequently still at its 0 default: it ORDERS
  // correctly but does not COUNT, so printing it would show "queued · 7th" to a
  // man holding two bills. Ranked here the same way components/tint/manager/
  // rows.ts ranks the manager's board — [sequenceOrder asc, createdAt asc] per
  // operator, which is the ORDER BY the reorder route swaps on — so the number
  // the supervisor reads and the number the manager reads cannot disagree.
  const queuedByOperator = new Map<number, Pending[]>();
  for (const p of pending) {
    if (p.bill.state !== "queued" || p.operatorId === null) continue;
    const list = queuedByOperator.get(p.operatorId) ?? [];
    list.push(p);
    queuedByOperator.set(p.operatorId, list);
  }
  const seqOf = new Map<number, { seq: number; created: number }>();
  for (const a of assignments) {
    if (!seqOf.has(a.orderId)) {
      seqOf.set(a.orderId, {
        seq: a.order?.sequenceOrder ?? 0,
        created: (a.order?.createdAt ?? a.createdAt).getTime(),
      });
    }
  }
  for (const queue of Array.from(queuedByOperator.values())) {
    queue.sort((x, y) => {
      const a = seqOf.get(x.bill.orderId) ?? { seq: 0, created: 0 };
      const b = seqOf.get(y.bill.orderId) ?? { seq: 0, created: 0 };
      if (a.seq !== b.seq) return a.seq - b.seq;
      return a.created - b.created;
    });
    queue.forEach((p, i) => { p.bill.queueRank = i + 1; });
  }

  // ── Assemble ──────────────────────────────────────────────────────────────
  const poolRows = pending.filter((p) => p.operatorId === null).map((p) => p.bill);
  const operators: TintWorkloadOperator[] = roster.map((u) => {
    const rows = pending.filter((p) => p.operatorId === u.id).map((p) => p.bill);
    // His headline state — what he is DOING, which is the one thing the card
    // leads with. In progress beats paused beats a queue: a man mixing paint is
    // not "queued" because he also has two bills waiting behind it.
    const onIt = rows.find((r) => r.state === "tinting") ?? rows.find((r) => r.state === "paused") ?? null;
    return {
      id: u.id,
      name: u.name,
      bills: rows.length,
      drums: sumDrums(rows),
      litres: sumLitres(rows),
      state: onIt ? (onIt.state as "tinting" | "paused") : rows.length > 0 ? "queued" : null,
      minutes: onIt?.minutes ?? null,
      queued: rows.filter((r) => r.state === "queued").length,
      rows,
    };
  });

  // ⚠ A BILL HELD BY SOMEBODY OFF THE ROSTER WOULD VANISH FROM THE OPERATOR
  // LISTS, so it gets a card of its own rather than being silently dropped.
  // Reachable only if an operator is deactivated while still holding work: his
  // bills keep his FK, and `isActive: false` takes him off the roster query
  // above. Without this arm, pool + operators would be short of `totals` and
  // the section would quietly under-report the room.
  const rosterIds = new Set(roster.map((u) => u.id));
  const orphanRows = pending
    .filter((p) => p.operatorId !== null && !rosterIds.has(p.operatorId))
    .map((p) => p.bill);
  if (orphanRows.length > 0) {
    operators.push({
      id: -1,
      name: "No longer an operator",
      bills: orphanRows.length,
      drums: sumDrums(orphanRows),
      litres: sumLitres(orphanRows),
      state: null,
      minutes: null,
      queued: orphanRows.filter((r) => r.state === "queued").length,
      rows: orphanRows,
    });
  }

  const allRows = pending.map((p) => p.bill);
  const oldest = poolRows.reduce<number | null>(
    (max, r) => (r.waitingHours === null ? max : max === null ? r.waitingHours : Math.max(max, r.waitingHours)),
    null,
  );

  return {
    // Totals are taken over EVERY bill in the room, so they stay true even in
    // the orphan case above; pool + operators + orphans always equals this.
    totals: { bills: allRows.length, drums: sumDrums(allRows), litres: sumLitres(allRows) },
    pool: {
      bills: poolRows.length,
      drums: sumDrums(poolRows),
      litres: sumLitres(poolRows),
      oldestWaitHours: oldest,
      rows: poolRows,
    },
    operators,
  };
}

/**
 * The change signal for this feed. Two maxima and a count, no joins, no rows.
 *
 * 🔴 IT WATCHES `tint_assignments.updatedAt` AS WELL AS `orders.updatedAt`, AND
 * THAT IS THE WHOLE REASON IT IS NOT `/api/tint/manager/marker`. Pause and
 * resume write ONLY the assignment row — `app/api/tint/operator/pause/route.ts`
 * and `resume/route.ts` contain zero `orders.update` calls — so a marker built on
 * `orders` alone never fires for a pause, which is precisely the state this
 * section exists to show. The Tint Manager marker has that gap today; it was
 * read and deliberately not copied.
 *
 * `count` catches DEPARTURES the way the picking marker's does: a bill finishing
 * tinting leaves the set, so its own `updatedAt` is outside both maxima and only
 * the count moves.
 */
export async function getTintWorkloadMarker(): Promise<{
  count: number;
  latest: string | null;
  latestOrder: string | null;
  latestAssignment: string | null;
}> {
  const orderAgg = await prisma.orders.aggregate({
    where: { orderType: "tint", workflowStage: { in: [...TINT_ROOM_STAGES] }, isRemoved: false },
    _count: true,
    _max: { updatedAt: true },
  });
  // Scoped to the assignment rows of bills still in the room, so a completion
  // elsewhere in history cannot keep nudging this value.
  const assignmentAgg = await prisma.tint_assignments.aggregate({
    where: {
      order: { orderType: "tint", workflowStage: { in: [...TINT_ROOM_STAGES] }, isRemoved: false },
    },
    _max: { updatedAt: true },
  });
  const latestOrder = orderAgg._max.updatedAt?.toISOString() ?? null;
  const latestAssignment = assignmentAgg._max.updatedAt?.toISOString() ?? null;

  return {
    count: orderAgg._count,
    // 🔴 `latest` IS THE LATER OF THE TWO, AND IT HAS TO EXIST UNDER THIS NAME.
    // `lib/hooks/use-picking-marker.ts` compares exactly `count`, `latest`,
    // `heldBack` and `heldBackTrucks` — a field it does not read cannot make it
    // refetch. Shipping the two clocks as `latestOrder`/`latestAssignment`
    // alone (as this function first did, 2026-09-18) left `latest` undefined on
    // every probe, so the two sides of the comparison were equal and a PAUSE —
    // which moves only the assignment clock — fired nothing. The bug the second
    // clock exists to prevent, reintroduced one field name later.
    //
    // ISO-8601 UTC strings sort lexicographically, so `>` is a real comparison
    // here and no Date is constructed.
    latest:
      latestOrder === null || (latestAssignment !== null && latestAssignment > latestOrder)
        ? latestAssignment
        : latestOrder,
    // Echoed for a human reading the response; the hook ignores both.
    latestOrder,
    latestAssignment,
  };
}
