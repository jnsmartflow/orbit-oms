import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTodayIST } from "@/lib/dates";
import { freightGate, idList, optionalId, optionalText } from "@/lib/freight-trips/gate";
import { parseFreightDate } from "@/lib/freight-trips/format";
import { createWithFreightNumber } from "@/lib/freight-trips/number";
import { getFreightTrip, getFreightTripsForDate } from "@/lib/freight-trips/queries";
import { logFreightCreated } from "@/lib/freight-trips/activity";
import { addFreightBills } from "@/lib/freight-trips/bills";
import { transporterExists, vehicleSnapshot } from "@/lib/freight-trips/vehicle";
import { FREIGHT_TRIP_STATUS } from "@/lib/freight-trips/status";

export const dynamic = "force-dynamic";

// /api/freight-trips — Freight Trips (report-only "paper trips" over HELD bills).
// 🔴 Writes freight_trips / freight_trip_bills / freight_trip_activity ONLY.
// Never orders, trips, trip_drops, trip_activity or order_status_logs.
// Gate: page key `freight_trips` (never `floor`). Sequential awaits.

/** GET ?date=YYYY-MM-DD (default today IST) — the day's freight trips, active and cancelled. */
export async function GET(req: Request): Promise<NextResponse> {
  const gate = await freightGate("canView");
  if (!gate.ok) return gate.response;

  const dateParam = new URL(req.url).searchParams.get("date") ?? getTodayIST();
  let tripDate: Date;
  try {
    tripDate = parseFreightDate(dateParam);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Invalid date" }, { status: 400 });
  }
  const trips = await getFreightTripsForDate(tripDate);
  return NextResponse.json({ date: dateParam, trips });
}

interface CreateBody {
  tripDate?: unknown;
  vehicleId?: unknown;
  adhocVehicleNo?: unknown;
  transporterId?: unknown;
  driverName?: unknown;
  driverPhone?: unknown;
  note?: unknown;
  orderIds?: unknown;
}

/**
 * POST — create a freight trip, then (optionally) put bills on it.
 * Body: { tripDate, vehicleId? | adhocVehicleNo?, transporterId?, driverName?,
 *         driverPhone?, note?, orderIds?: number[] }
 * Vehicle, transporter and driver are all optional; an empty trip is valid.
 * Driver: copied from the master vehicle, unless typed (a typed value wins —
 * also for an ad-hoc plate). Transporter: a supplied one wins, else the vehicle's.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const gate = await freightGate("canEdit");
  if (!gate.ok) return gate.response;
  const userId = gate.userId;

  const body = (await req.json().catch(() => ({}))) as CreateBody;

  // ── Validation, all of it before any write ───────────────────────────────
  if (typeof body.tripDate !== "string") {
    return NextResponse.json({ error: "tripDate is required (YYYY-MM-DD)" }, { status: 400 });
  }
  let tripDate: Date;
  try {
    tripDate = parseFreightDate(body.tripDate);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Invalid tripDate" }, { status: 400 });
  }
  const vehicleId = optionalId(body.vehicleId);
  if (!vehicleId.ok) return NextResponse.json({ error: "vehicleId must be a positive integer or null" }, { status: 400 });
  const adhoc = optionalText(body.adhocVehicleNo);
  if (!adhoc.ok) return NextResponse.json({ error: "adhocVehicleNo must be a string or null" }, { status: 400 });
  const transporterId = optionalId(body.transporterId);
  if (!transporterId.ok) return NextResponse.json({ error: "transporterId must be a positive integer or null" }, { status: 400 });
  const driverName = optionalText(body.driverName);
  if (!driverName.ok) return NextResponse.json({ error: "driverName must be a string or null" }, { status: 400 });
  const driverPhone = optionalText(body.driverPhone);
  if (!driverPhone.ok) return NextResponse.json({ error: "driverPhone must be a string or null" }, { status: 400 });
  const note = optionalText(body.note);
  if (!note.ok) return NextResponse.json({ error: "note must be a string or null" }, { status: 400 });
  const orderIds = idList(body.orderIds);
  if (orderIds === null) return NextResponse.json({ error: "orderIds must be an array of positive integers" }, { status: 400 });

  // chk_freight_trips_vehicle_one_of, as a readable 400 (the CHECK stays the backstop).
  if (vehicleId.value !== null && adhoc.value !== null) {
    return NextResponse.json({ error: "A freight trip carries EITHER a master vehicle OR an ad-hoc plate, never both." }, { status: 400 });
  }
  if (transporterId.value !== null && !(await transporterExists(transporterId.value))) {
    return NextResponse.json({ error: `No transporter found for id ${transporterId.value}` }, { status: 400 });
  }

  // ── The snapshot ─────────────────────────────────────────────────────────
  let vehicleLabel: string | null = adhoc.value;
  let snapDriverName: string | null = null;
  let snapDriverPhone: string | null = null;
  let snapTransporterId: number | null = transporterId.value;
  if (vehicleId.value !== null) {
    const v = await vehicleSnapshot(vehicleId.value);
    if (!v) return NextResponse.json({ error: `No vehicle found for id ${vehicleId.value}` }, { status: 400 });
    vehicleLabel = v.vehicleNo;
    snapDriverName = v.driverName;
    snapDriverPhone = v.driverPhone;
    snapTransporterId = transporterId.value ?? v.transporterId;
  }
  // A TYPED driver wins over the copy (owner, 2026-10-02) — "sent" means the key is present.
  const finalDriverName = body.driverName !== undefined ? driverName.value : snapDriverName;
  const finalDriverPhone = body.driverPhone !== undefined ? driverPhone.value : snapDriverPhone;

  // ── Allocate + insert, retry once on the number race ─────────────────────
  const trip = await createWithFreightNumber(tripDate, (identity) =>
    prisma.freight_trips.create({
      data: {
        tripNumber: identity.tripNumber,
        tripDate,
        seq: identity.seq,
        vehicleId: vehicleId.value,
        adhocVehicleNo: adhoc.value,
        transporterId: snapTransporterId,
        driverName: finalDriverName,
        driverPhone: finalDriverPhone,
        note: note.value,
        status: FREIGHT_TRIP_STATUS.active,
        createdById: userId,
      },
      select: { id: true, tripNumber: true },
    }),
  );

  await logFreightCreated({
    freightTripId: trip.id,
    actorId: userId,
    tripNumber: trip.tripNumber,
    tripDate: body.tripDate,
    vehicleLabel,
  });

  // Bills, through the SAME add path as POST /api/freight-trips/[id]/bills.
  const bills = orderIds.length > 0
    ? await addFreightBills({ freightTripId: trip.id, orderIds, actorId: userId })
    : { done: [], skipped: [] };

  const detail = await getFreightTrip(trip.id);
  return NextResponse.json({ trip: detail, added: bills.done, skipped: bills.skipped }, { status: 201 });
}
