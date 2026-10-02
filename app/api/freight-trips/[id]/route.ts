import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { freightGate, optionalId, optionalText } from "@/lib/freight-trips/gate";
import { getFreightTrip, isCancelled } from "@/lib/freight-trips/queries";
import { logFreightDetailsChanged, logFreightVehicleChanged } from "@/lib/freight-trips/activity";
import { transporterExists, vehicleSnapshot } from "@/lib/freight-trips/vehicle";

export const dynamic = "force-dynamic";

// /api/freight-trips/[id] — one freight trip. Writes freight_trips ONLY.

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** GET — header, active bills grouped into stops, history. */
export async function GET(_req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  const gate = await freightGate("canView");
  if (!gate.ok) return gate.response;
  const id = parseId(params.id);
  if (id === null) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const trip = await getFreightTrip(id);
  if (!trip) return NextResponse.json({ error: "Freight trip not found" }, { status: 404 });
  return NextResponse.json({ trip });
}

interface PatchBody {
  vehicleId?: unknown;
  adhocVehicleNo?: unknown;
  transporterId?: unknown;
  driverName?: unknown;
  driverPhone?: unknown;
  note?: unknown;
}

/**
 * PATCH — vehicle / ad-hoc plate / transporter / driver / note. A key that is
 * ABSENT is untouched; null clears it. Refused on a cancelled trip (409).
 * A vehicle change re-snapshots the driver from the master (null for a plate or
 * no vehicle) UNLESS driver fields are sent in the same request; it also takes
 * the vehicle's transporter unless transporterId is sent.
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  const gate = await freightGate("canEdit");
  if (!gate.ok) return gate.response;
  const userId = gate.userId;
  const id = parseId(params.id);
  if (id === null) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as PatchBody;
  const has = (k: keyof PatchBody) => Object.prototype.hasOwnProperty.call(body, k);

  const trip = await prisma.freight_trips.findUnique({
    where: { id },
    select: {
      status: true,
      vehicleId: true,
      adhocVehicleNo: true,
      transporterId: true,
      driverName: true,
      driverPhone: true,
      note: true,
      vehicle: { select: { vehicleNo: true } },
    },
  });
  if (!trip) return NextResponse.json({ error: "Freight trip not found" }, { status: 404 });
  if (isCancelled(trip.status)) {
    return NextResponse.json({ error: "This freight trip is cancelled — it cannot be edited." }, { status: 409 });
  }

  // ── Validate every sent field ────────────────────────────────────────────
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

  if (has("vehicleId") && has("adhocVehicleNo") && vehicleId.value !== null && adhoc.value !== null) {
    return NextResponse.json({ error: "A freight trip carries EITHER a master vehicle OR an ad-hoc plate, never both." }, { status: 400 });
  }
  if (has("transporterId") && transporterId.value !== null && !(await transporterExists(transporterId.value))) {
    return NextResponse.json({ error: `No transporter found for id ${transporterId.value}` }, { status: 400 });
  }

  // ── The new vehicle pair (setting one clears the other) ──────────────────
  let nextVehicleId = trip.vehicleId;
  let nextAdhoc = trip.adhocVehicleNo;
  if (has("vehicleId") && vehicleId.value !== null) {
    nextVehicleId = vehicleId.value;
    nextAdhoc = null;
  } else if (has("adhocVehicleNo") && adhoc.value !== null) {
    nextAdhoc = adhoc.value;
    nextVehicleId = null;
  } else {
    if (has("vehicleId")) nextVehicleId = null;
    if (has("adhocVehicleNo")) nextAdhoc = null;
  }
  const vehicleChanged = nextVehicleId !== trip.vehicleId || nextAdhoc !== trip.adhocVehicleNo;

  let nextDriverName = trip.driverName;
  let nextDriverPhone = trip.driverPhone;
  let nextTransporterId = trip.transporterId;
  let nextLabel: string | null = nextAdhoc;
  if (vehicleChanged) {
    // Re-snapshot — the driver of the NEW vehicle (none for a plate or no vehicle).
    if (nextVehicleId !== null) {
      const v = await vehicleSnapshot(nextVehicleId);
      if (!v) return NextResponse.json({ error: `No vehicle found for id ${nextVehicleId}` }, { status: 400 });
      nextLabel = v.vehicleNo;
      nextDriverName = v.driverName;
      nextDriverPhone = v.driverPhone;
      nextTransporterId = v.transporterId;
    } else {
      nextDriverName = null;
      nextDriverPhone = null;
    }
  }
  // Sent values win over the re-snapshot.
  if (has("driverName")) nextDriverName = driverName.value;
  if (has("driverPhone")) nextDriverPhone = driverPhone.value;
  if (has("transporterId")) nextTransporterId = transporterId.value;
  const nextNote = has("note") ? note.value : trip.note;

  // `sent` = the user asked for this field; a field that only moved because the
  // vehicle changed is part of vehicle_changed, not details_changed.
  const details: { field: string; from: unknown; to: unknown; sent: boolean }[] = [];
  if (nextTransporterId !== trip.transporterId) details.push({ field: "transporter", from: trip.transporterId, to: nextTransporterId, sent: has("transporterId") });
  if (nextDriverName !== trip.driverName) details.push({ field: "driverName", from: trip.driverName, to: nextDriverName, sent: has("driverName") });
  if (nextDriverPhone !== trip.driverPhone) details.push({ field: "driverPhone", from: trip.driverPhone, to: nextDriverPhone, sent: has("driverPhone") });
  if (nextNote !== trip.note) details.push({ field: "note", from: trip.note, to: nextNote, sent: true });

  if (!vehicleChanged && details.length === 0) {
    return NextResponse.json({ trip: await getFreightTrip(id), changed: false });
  }

  await prisma.freight_trips.update({
    where: { id },
    data: {
      vehicleId: nextVehicleId,
      adhocVehicleNo: nextAdhoc,
      transporterId: nextTransporterId,
      driverName: nextDriverName,
      driverPhone: nextDriverPhone,
      note: nextNote,
    },
  });

  if (vehicleChanged) {
    await logFreightVehicleChanged({
      freightTripId: id,
      actorId: userId,
      from: trip.vehicle?.vehicleNo ?? trip.adhocVehicleNo ?? null,
      to: nextLabel,
      driverName: nextDriverName,
    });
  }
  const ownDetails = details
    .filter((d) => !vehicleChanged || d.sent)
    .map(({ field, from, to }) => ({ field, from, to }));
  await logFreightDetailsChanged({ freightTripId: id, actorId: userId, changes: ownDetails });

  return NextResponse.json({ trip: await getFreightTrip(id), changed: true });
}
