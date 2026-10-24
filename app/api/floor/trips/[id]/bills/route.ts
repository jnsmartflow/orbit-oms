import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { computeDropKey } from "@/lib/trips/drop-key";
import { deleteTripDropIfEmpty, findOrCreateTripDrop } from "@/lib/trips/drop";
import { logTripBills } from "@/lib/trips/activity";
import { CHALLAN_LINKED } from "@/lib/workflow-stages";
import { needsDerivedRepair, setRowsTrip } from "@/lib/order-invoices/trip-link";
import { foreignRowIds, invoiceLabel, planAddRows, planRemoveRows, type TripBillRow } from "@/lib/order-invoices/trip-bills";
import { getTripSummariesByIds } from "@/lib/trips/queries";

export const dynamic = "force-dynamic";

interface Failed {
  orderId: number;
  error: string;
  /** Set when the refusal is about ONE invoice of a split OBD (Phase 5). */
  invoiceRowId?: number;
  invoiceNo?: string | null;
}

/**
 * POST /api/floor/trips/[id]/bills — attach bills to a trip, or detach them.
 *
 * Body: `{ orderIds: number[], action: "add" | "remove",
 *          invoiceRowIds?: { [orderId]: number[] } }`
 * Response: `{ attached|detached: number[], skipped: number[], failed: [...] }`
 * for add / remove; a move answers differently (MOVE, below).
 *
 * 🔴 PER INVOICE (Add invoices, Phase 5 commit 2, 2026-10-15). The invoice ROW
 * is the dispatch unit (Schema v27.66). `invoiceRowIds` names, per OBD, which
 * of its order_invoices rows the press is about; an OBD with no entry means
 * EVERY row — the whole OBD, exactly as before. Per row
 * (lib/order-invoices/trip-bills.ts):
 *   · add — a row on no trip attaches; a row already on ANOTHER trip is
 *     refused for THAT invoice only ("I536230713 is already on L-… — remove it
 *     from that trip first") and the rest still attach. All of an OBD's rows on
 *     one trip sit on its customer's ONE stop (dropKey unchanged).
 *   · remove — strips only rows on THIS trip, never another trip's.
 * An OBD in `attached` / `detached` may ALSO have `failed` entries (one per
 * refused invoice, with `invoiceRowId`). An unsplit OBD's messages are
 * unchanged, word for word. The Floor screen sends `invoiceRowIds` for a
 * partly ticked OBD since P5-3 (2026-10-17; lib/floor/selection.ts billsBodyOf).
 *
 * 🔴 MOVE (2026-10-17): `{ action: "move", fromTripId, orderIds, invoiceRowIds? }`
 * on the TARGET trip's URL takes the ticked rows that sit on `fromTripId` straight
 * onto this trip — per bill ONE setRowsTrip (one order_invoices.updateMany + ONE
 * orders.update), so a bill is never on no trip in between. Response
 * `{ moved, skipped, failed, trips: { source, target }, sourceEmpty }`.
 * 2026-10-17: move between trips added — before this, bills had to be removed to To plan then re-added. Do not split back into remove+add (two orders.update per bill, limbo state).
 *
 * 🔴 TRIP MEMBERSHIP IS NOT GATED BY STAGE. A bill can join a trip at ANY
 * `workflowStage` — waiting, with a picker, picked, checked. That is an owner
 * decision (floor-trip-module §2: *"A bill can be added to a trip while already
 * assigned or picked; it just cannot be HIDDEN again"*), and it is the whole
 * reason membership and VISIBILITY are separate facts on separate columns.
 * Do not add a stage guard here.
 *
 * ⚠ BUT MEMBERSHIP MOVES VISIBILITY (slice 8, 2026-09-15; rule changed
 * 2026-09-21). With desk control on, a WAITING bill is on the supervisor's
 * Assign tab only while it is on a SHOWN trip. So ADDING a waiting bill to a
 * shown trip puts it on his screen at once, adding it to an unshown trip keeps
 * it off, and REMOVING it from a shown trip HIDES it — it returns to To plan,
 * which the floor does not see. This route writes nothing for it: the picking
 * query reads the trip (lib/picking/visibility-gate.ts waitingBranchWhere). A
 * bill already with a picker is never hidden by it.
 *
 * ⚠ EXACTLY ONE `orders.update` PER BILL. The live-sync markers key on
 * `MAX(orders.updatedAt)`, so a second write fires a false "changed" on every
 * board (FLOOR §4/§10, PICKING §10).
 *
 * ⚠ NO `order_status_logs` ROW, for attach OR detach. The trips table carries
 * its own audit stamps and this is a high-frequency action — a planner moves
 * bills between trips repeatedly while building a load. A log row per bill would
 * be noise that buries the events somebody reads back, and it would be the
 * second write the marker landmine warns about.
 *
 * Same 422/partial contract as /api/floor/release.
 * Sequential awaits, never prisma.$transaction (CORE §3).
 */
export async function POST(
  req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "floor", "canEdit");
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // The real session user, for the activity log. Never a body claim, and the
  // same shape every other trip write route uses.
  const actorId = Number(session.user.id);
  if (!Number.isInteger(actorId) || actorId <= 0) {
    return NextResponse.json({ error: "Invalid session user id" }, { status: 500 });
  }

  const tripId = Number(params.id);
  if (!Number.isInteger(tripId) || tripId <= 0) {
    return NextResponse.json({ error: "Invalid trip id" }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    orderIds?: number[];
    action?: string;
    invoiceRowIds?: unknown;
    fromTripId?: unknown;
  };
  const action = body.action;
  if (action !== "add" && action !== "remove" && action !== "move") {
    return NextResponse.json({ error: 'action is required and must be "add", "remove" or "move"' }, { status: 400 });
  }
  // MOVE names the trip the bills come OFF; this URL is the trip they go ON.
  const fromTripId = action === "move" ? Number(body.fromTripId) : null;
  if (action === "move") {
    if (body.fromTripId === undefined || body.fromTripId === null || !Number.isInteger(fromTripId) || fromTripId! <= 0) {
      return NextResponse.json({ error: "fromTripId is required for a move" }, { status: 400 });
    }
    if (fromTripId === tripId) {
      return NextResponse.json({ error: "Those bills are already on this trip." }, { status: 409 });
    }
  }
  const orderIds = body.orderIds;
  // Rejected BEFORE the loop, so a 422 below means "everything was tried and
  // everything failed" rather than "you sent nothing".
  if (
    !Array.isArray(orderIds) ||
    orderIds.length === 0 ||
    !orderIds.every((id) => typeof id === "number" && Number.isInteger(id))
  ) {
    return NextResponse.json(
      { error: "orderIds is required and must be a non-empty array of integers" },
      { status: 400 },
    );
  }
  // Optional, per OBD: which invoice rows. Every key must be one of orderIds
  // and every value a non-empty list of integers — else 400, nothing written.
  const chosenRows = new Map<number, number[]>();
  if (body.invoiceRowIds !== undefined && body.invoiceRowIds !== null) {
    const raw = body.invoiceRowIds;
    const asked = new Set(orderIds);
    const ok =
      typeof raw === "object" &&
      !Array.isArray(raw) &&
      Object.entries(raw as Record<string, unknown>).every(([k, v]) => {
        const id = Number(k);
        if (!Number.isInteger(id) || !asked.has(id)) return false;
        if (!Array.isArray(v) || v.length === 0 || !v.every((x) => typeof x === "number" && Number.isInteger(x))) return false;
        chosenRows.set(id, v as number[]);
        return true;
      });
    if (!ok) {
      return NextResponse.json(
        { error: "invoiceRowIds must map an orderId from orderIds to a non-empty array of invoice row ids" },
        { status: 400 },
      );
    }
  }

  const trip = await prisma.trips.findUnique({
    where: { id: tripId },
    // isHand — the add branch admits only matching bills (2026-09-24).
    select: { id: true, status: true, isHand: true, tripNumber: true },
  });
  if (!trip) return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  // A cancelled or dispatched trip is finished with. Refusing here is the
  // recoverable direction: admitting a stage later is one edit, un-attaching a
  // bill from a load that has already left is not.
  if (trip.status === "cancelled" || trip.status === "dispatched") {
    return NextResponse.json(
      { error: `Cannot change the bills on a ${trip.status} trip.` },
      { status: 409 },
    );
  }
  // MOVE: the source is held to the same rule — remove refuses a finished trip,
  // so a move off one must too.
  const source =
    fromTripId !== null
      ? await prisma.trips.findUnique({ where: { id: fromTripId }, select: { id: true, status: true, tripNumber: true } })
      : null;
  if (fromTripId !== null) {
    if (!source) return NextResponse.json({ error: "The trip the bills come from was not found" }, { status: 404 });
    if (source.status === "cancelled" || source.status === "dispatched") {
      return NextResponse.json(
        { error: `Cannot move bills off a ${source.status} trip (${source.tripNumber}).` },
        { status: 409 },
      );
    }
  }

  const changed: number[] = [];
  // ⚠ FILLED IN LOCKSTEP WITH `changed`, for the activity row. Same order, same
  // length — a bill that was skipped or refused is in neither, because the log
  // records what HAPPENED and not what was asked for.
  const changedObds: string[] = [];
  const skipped: number[] = [];
  const failed: Failed[] = [];

  for (const orderId of orderIds) {
    try {
      const order = await prisma.orders.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          // For the ACTIVITY LOG (lib/trips/activity.ts). An order id means
          // nothing to a planner reading a trip's history months later; the OBD
          // number is what is printed on the paper in his hand.
          obdNumber: true,
          isRemoved: true,
          // The DERIVED stop (lib/order-invoices/trip-link.ts). Read here only
          // to spot a press that died half-way (needsDerivedRepair below); every
          // "is it on a trip" decision reads the invoice rows.
          tripDropId: true,
          tripDrop: { select: { tripId: true } },
          // v27.69 — the derived flag, for the same half-write repair check.
          partlyOnTrip: true,
          customerId: true,
          shipToOverrideCustomerId: true,
          shipToCustomerId: true,
          shipToCustomerName: true,
          // The typed ship-to (v27.73) — computeDropKey's t: branch needs both.
          shipToText: true,
          shipToAreaId: true,
          // The Hand mark — a Hand bill rides only a Hand trip (add branch).
          handAt: true,
          // The challan-link refusal (add branch, 2026-10-06).
          workflowStage: true,
        },
      });
      if (!order || order.isRemoved) {
        failed.push({ orderId, error: "Order not found" });
        continue;
      }

      // The OBD's invoice rows and where each sits — ONE read, keyed on
      // order_invoices_orderId_seq_key. Every per-row decision below reads it.
      const rowRecs = await prisma.order_invoices.findMany({
        where: { orderId },
        orderBy: { seq: "asc" },
        select: {
          id: true,
          seq: true,
          invoiceNo: true,
          tripDropId: true,
          tripDrop: { select: { tripId: true, dropKey: true, trip: { select: { tripNumber: true } } } },
          // 6.3 — a split OBD's held / CI'd invoice never joins a trip (planAddRows).
          isHeld: true,
          ciReturns: { where: { isVoided: false }, orderBy: { id: "desc" }, take: 1, select: { ciNumber: true } },
        },
      });
      const rows: TripBillRow[] = rowRecs.map((r) => ({
        id: r.id,
        seq: r.seq,
        invoiceNo: r.invoiceNo,
        tripDropId: r.tripDropId,
        tripId: r.tripDrop?.tripId ?? null,
        dropKey: r.tripDrop?.dropKey ?? null,
        tripNumber: r.tripDrop?.trip.tripNumber ?? null,
        isHeld: r.isHeld,
        ciNumber: r.ciReturns.length > 0 ? r.ciReturns[0].ciNumber ?? "" : null,
      }));
      const chosen = chosenRows.get(orderId) ?? "all";
      const foreign = foreignRowIds(rows, chosen);
      if (foreign.length > 0) {
        failed.push({ orderId, error: `Invoice row ${foreign.join(", ")} is not an invoice of ${order.obdNumber}` });
        continue;
      }
      const refuseRows = (refused: { rowId: number; invoiceNo: string | null; error: string }[]) => {
        for (const x of refused) failed.push({ orderId, error: x.error, invoiceRowId: x.rowId, invoiceNo: x.invoiceNo });
      };

      if (action === "move" && source !== null) {
        // ── move ─────────────────────────────────────────────────────────────
        // Copied bills move with no warning — owner decision 2026-10-17; trip_bill_copies is not touched here, billing's copy-row workflow gets redesigned later.
        //
        // The challan-link rule binds a move exactly as it binds an add: the
        // bill would be JOINING this truck.
        if (order.workflowStage === CHALLAN_LINKED) {
          failed.push({
            orderId,
            error: `${order.obdNumber} is billed against a challan order — its goods already went out on the challan. It never goes on a trip.`,
          });
          continue;
        }
        // Which of the ticked rows sit on the SOURCE — only those move. A row
        // anywhere else (no trip, a third trip) is never touched.
        const plan = planRemoveRows(rows, chosen, source.id, order.obdNumber);
        for (const x of plan.refused) {
          failed.push({
            orderId,
            error: `${invoiceLabel({ seq: rows.find((r) => r.id === x.rowId)?.seq ?? 0, invoiceNo: x.invoiceNo }, order.obdNumber)} is not on ${source.tripNumber}`,
            invoiceRowId: x.rowId,
            invoiceNo: x.invoiceNo,
          });
        }
        if (plan.detach.length === 0) {
          if (plan.refused.length > 0) continue;
          // Already here (a retry of a move that landed): a skip, with the
          // derived-stop repair if the earlier press died before its orders write.
          const asked = chosen === "all" ? rows : rows.filter((r) => chosen.includes(r.id));
          if (asked.length > 0 && asked.every((r) => r.tripId === tripId)) {
            if (needsDerivedRepair(rows, order)) {
              await setRowsTrip(orderId, [], null);
              changed.push(orderId);
              changedObds.push(order.obdNumber);
            } else {
              skipped.push(orderId);
            }
            continue;
          }
          failed.push({ orderId, error: `Not on ${source.tripNumber}` });
          continue;
        }
        // HAND vs TRUCK — the add branch's rule, word for word, for the whole bill.
        const isHandBill = order.handAt !== null;
        if (isHandBill !== trip.isHand) {
          failed.push({
            orderId,
            error: isHandBill
              ? "The dealer collects this bill (Hand) — put it on a Hand trip, not a truck."
              : "This is a Hand trip (dealer collects) — only Hand bills can join it.",
          });
          continue;
        }
        // One OBD, one stop per trip: rows of this OBD already on the target at
        // ANOTHER stop would split it across two stops — refused, as add does.
        const dropKey = computeDropKey(order);
        if (rows.some((r) => r.tripId === tripId && r.dropKey !== dropKey)) {
          failed.push({ orderId, error: `Already attached to a different stop on ${trip.tripNumber}.` });
          continue;
        }

        // The target stop, then ONE setRowsTrip: the rows go straight from the
        // source stop to the target stop (onlyFromTripId re-checks they are
        // still on the source) and orders gets its ONE update.
        const drop = await findOrCreateTripDrop(tripId, order);
        await setRowsTrip(orderId, plan.detach, drop.id, { onlyFromTripId: source.id });
        changed.push(orderId);
        changedObds.push(order.obdNumber);
        // Source stops left with nothing go, and the source closes up 1..N —
        // the remove path's own helper (lib/trips/drop.ts).
        for (const dropId of plan.dropIds) await deleteTripDropIfEmpty(dropId);
        continue;
      }

      if (action === "remove") {
        // 🔴 ONLY ROWS ON THIS TRIP COME OFF (2026-10-03 — closes FLOOR_TRIPS
        // open item 4 / landmine 8; per row since Phase 5 commit 2). This path
        // used to clear WHATEVER stop a bill was on, whatever trip the URL
        // named; until 2026-10-15 it still cleared ALL of an OBD's invoice rows
        // once one of them was on this trip. Now each row's stop is read: rows
        // on this trip come off (setRowsTrip with onlyFromTripId — the writer
        // re-checks it), a row on another trip is never touched. Nothing on
        // this trip → refused, NO WRITE (a no-op update would still bump
        // updatedAt and fire a false "changed" on every board). Every floor
        // caller already sends only bills on the URL's trip (floor-page.tsx
        // undoAdd and removeSelectionFromTrips), so they never meet this.
        const plan = planRemoveRows(rows, chosen, tripId, order.obdNumber);
        refuseRows(plan.refused);
        if (plan.detach.length === 0) {
          // A press that died between the rows and orders left orders.tripDropId
          // on this trip with no row here: land the derived stop (no row moves).
          if (plan.refused.length === 0 && order.tripDrop?.tripId === tripId && needsDerivedRepair(rows, order)) {
            await setRowsTrip(orderId, [], null, { onlyFromTripId: tripId });
            changed.push(orderId);
            changedObds.push(order.obdNumber);
            continue;
          }
          if (plan.refused.length === 0) failed.push({ orderId, error: "Not on this trip" });
          continue;
        }

        // Those rows, then ONE orders.update (lib/order-invoices/trip-link.ts,
        // the only trip-link writer).
        await setRowsTrip(orderId, plan.detach, null, { onlyFromTripId: tripId });
        changed.push(orderId);
        changedObds.push(order.obdNumber);

        // If a stop they left now holds nothing, delete it. Counted AFTER the
        // update above so these rows are already gone from the tally.
        //
        // ⚠ "Nothing" = no order (removed ones included — a soft-removed bill
        // still carries its pointer), no invoice row AND no re-delivery
        // (2026-10-03, discovery B9: trip_redeliveries.tripDropId is RESTRICT).
        // The rule lives in lib/trips/drop.ts deleteTripDropIfEmpty, shared
        // with the re-delivery remove path.
        for (const dropId of plan.dropIds) await deleteTripDropIfEmpty(dropId);
        continue;
      }

      // ── add ────────────────────────────────────────────────────────────────
      // 🔴 A SAP BILL LINKED TO A CHALLAN ORDER NEVER JOINS A TRUCK (Challan
      // orders slice 2, 2026-10-06, design D9). Its goods already left on the
      // ORB order's own trip; putting the SAP bill on a trip too is the double
      // dispatch this feature exists to stop. NOT a stage guard in the sense of
      // the header (membership stays open at every working stage) — it refuses
      // the one stage that is off every board by design. Checked before the
      // already-on-a-stop branch so the planner is told the real reason. No write.
      if (order.workflowStage === CHALLAN_LINKED) {
        failed.push({
          orderId,
          error: `${order.obdNumber} is billed against a challan order — its goods already went out on the challan. It never goes on a trip.`,
        });
        continue;
      }

      const dropKey = computeDropKey(order);

      // Per invoice row (lib/order-invoices/trip-bills.ts planAddRows). A row
      // already on a stop is never silently moved: the right stop on THIS trip
      // is a no-op, anywhere else is refused for THAT invoice — a bill on two
      // loads is the kind of thing nobody notices until a van is short, and
      // "move" is a different action the caller should ask for. The trip
      // NUMBER is in the refusal (2026-09-18): a planner reads it, and an
      // internal id is nothing he can act on. The rest of the OBD still attaches.
      const plan = planAddRows(rows, chosen, tripId, dropKey, order.obdNumber);
      refuseRows(plan.refused);
      if (plan.attach.length === 0) {
        if (plan.refused.length === 0 && plan.here.length > 0) {
          // Everything asked for is already here. A press that died between the
          // rows and orders left orders.tripDropId stale: land it (no row moves).
          if (needsDerivedRepair(rows, order)) {
            await setRowsTrip(orderId, [], null);
            changed.push(orderId);
            changedObds.push(order.obdNumber);
          } else {
            skipped.push(orderId);
          }
        }
        continue;
      }

      // 🔴 HAND vs TRUCK (2026-09-24, design web-update-2026-09-24-billing-mo-
      // actions.md §4). A bill the dealer collects never joins a truck, and a
      // truck bill never joins a Hand trip. THIS route is the only runtime path
      // that PUTS a bill on a trip (all tripDropId writes go through
      // lib/order-invoices/trip-link.ts setRowsTrip; the trip cancel and a ship-to
      // change on a trip bill also call it, but only take bills off a trip or
      // move them between its stops — was "the only runtime writer" until
      // 2026-10-24), so every add path — the rail, the add band,
      // "+ New trip", load plan "Make trip" — is held to it here, per bill.
      // To move a bill across, clear its Hand mark first.
      const isHandBill = order.handAt !== null;
      if (isHandBill !== trip.isHand) {
        failed.push({
          orderId,
          error: isHandBill
            ? "The dealer collects this bill (Hand) — put it on a Hand trip, not a truck."
            : "This is a Hand trip (dealer collects) — only Hand bills can join it.",
        });
        continue;
      }

      // Find-or-create the stop — lib/trips/drop.ts (extracted 2026-10-03, same
      // lookup, same MAX(dropSeq)+1, same snapshot). A lost race on the
      // (tripId, dropKey) unique throws into this bill's catch below and is
      // reported as this bill's failure, as before.
      const drop = await findOrCreateTripDrop(tripId, order);

      // The rows that attach, then ONE orders.update — still the only write to
      // `orders` on this path (v27.66, lib/order-invoices/trip-link.ts).
      await setRowsTrip(orderId, plan.attach, drop.id);
      changed.push(orderId);
      changedObds.push(order.obdNumber);
    } catch (err) {
      failed.push({ orderId, error: err instanceof Error ? err.message : "Unexpected error" });
    }
  }

  // ── ONE ACTIVITY ROW FOR THE WHOLE PRESS (2026-09-14, slice 2) ───────────
  // Never one per bill: attaching 40 bills is ONE thing a planner did, and 40
  // rows would bury the events somebody reads back — the same reasoning the
  // header gives for writing no `order_status_logs` rows on this path.
  //
  // Written whatever the status below turns out to be, the 422 case INCLUDED: a
  // press that moved some bills and failed on others still moved them.
  // `logTripBills` returns early when nothing actually changed, so a press that
  // achieved nothing writes no row.
  if (action === "move" && source !== null) {
    // A MOVE writes one row on EACH trip: "moved to" on the source, "moved in
    // from" on the target (lib/trips/activity.ts logTripBills `movedWith`).
    await logTripBills({
      tripId: source.id,
      actorId,
      direction: "remove",
      orderIds: changed,
      obdNumbers: changedObds,
      movedWith: { tripId, tripNumber: trip.tripNumber },
    });
    await logTripBills({
      tripId,
      actorId,
      direction: "add",
      orderIds: changed,
      obdNumbers: changedObds,
      movedWith: { tripId: source.id, tripNumber: source.tripNumber },
    });
    // Both trips as they stand now — the client's receipt, read back rather
    // than added up (another planner may be filling either load).
    const after = await getTripSummariesByIds([source.id, tripId]);
    const totals = (id: number) => {
      const t = after.find((x) => x.id === id);
      return t
        ? {
            id: t.id,
            tripNumber: t.tripNumber,
            bills: t.counts.total,
            stops: t.dropCount,
            litres: t.totalLitres,
            redeliveries: t.redeliveryCount ?? 0,
          }
        : null;
    };
    const sourceTotals = totals(source.id);
    const moveStatus = changed.length === 0 && skipped.length === 0 && failed.length > 0 ? 422 : 200;
    return NextResponse.json(
      {
        moved: changed,
        skipped,
        failed,
        trips: { source: sourceTotals, target: totals(tripId) },
        sourceEmpty: sourceTotals !== null && sourceTotals.bills === 0 && sourceTotals.redeliveries === 0,
      },
      { status: moveStatus },
    );
  }
  await logTripBills({
    tripId,
    actorId,
    // Never "move" here — the move branch returned above.
    direction: action === "add" ? "add" : "remove",
    orderIds: changed,
    obdNumbers: changedObds,
  });

  // Nothing achieved at all → 422. A SKIP counts as achieved: the bill is in the
  // state the caller asked for.
  const status = changed.length === 0 && skipped.length === 0 && failed.length > 0 ? 422 : 200;
  const key = action === "add" ? "attached" : "detached";
  return NextResponse.json({ [key]: changed, skipped, failed }, { status });
}
