import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getTripDetail } from "@/lib/trips/queries";

export const dynamic = "force-dynamic";

/**
 * GET /api/floor/trips/[id] — one trip, with its drops in `dropSeq` order.
 *
 * Per-trip bill counts by state (waiting / withPicker / picked / checked, plus
 * an `other` remainder), total litres, and `isReady` — which is DERIVED from
 * the bills, never read from a column. See lib/trips/queries.ts.
 *
 * Gate: `floor` canEdit, matching every sibling under /api/floor. Read-only:
 * no writes anywhere in this path, so the live-sync markers cannot see it.
 *
 * ⚠ NOT `/api/trips/[tripNo]` — that address belongs to the NTS Trip Report
 * mirror (`app/api/trips/[tripNo]/route.ts`) and is keyed on the NTS trip
 * NUMBER, not on an Orbit id. The two modules stay apart for the whole parallel
 * run (floor-trip-module decision record §5).
 */
export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "floor", "canView");
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const tripId = Number(params.id);
  if (!Number.isInteger(tripId) || tripId <= 0) {
    return NextResponse.json({ error: "Invalid trip id" }, { status: 400 });
  }

  const trip = await getTripDetail(tripId);
  if (!trip) return NextResponse.json({ error: "Trip not found" }, { status: 404 });

  return NextResponse.json({ trip });
}

interface PatchBody {
  vehicleId?: number | null;
  adhocVehicleNo?: string | null;
  transporterId?: number | null;
  dispatchWindowId?: number | null;
  note?: string | null;
  transporterTripNo?: string | null;
  /** Accepted ONLY so it can be refused with a clear message — see below. */
  deliveryTypeId?: number;
}

/** Present in the body at all? `undefined` means "leave alone", `null` means "clear". */
function has(body: PatchBody, key: keyof PatchBody): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
}

/** A supplied optional integer must be a real positive integer or explicitly null. */
function optionalId(value: unknown): { ok: true; value: number | null } | { ok: false } {
  if (value === null) return { ok: true, value: null };
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) return { ok: false };
  return { ok: true, value };
}

/** Trim an optional free-text field to null when it carries nothing. */
function optionalText(value: unknown): { ok: true; value: string | null } | { ok: false } {
  if (value === null) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false };
  const trimmed = value.trim();
  return { ok: true, value: trimmed === "" ? null : trimmed };
}

/**
 * PATCH /api/floor/trips/[id] — change a trip's vehicle, transporter, slot,
 * note or the carrier's own docket number.
 *
 * Body carries only what is being changed. An ABSENT key is left alone; an
 * explicit `null` clears the column. That distinction is the whole reason this
 * route reads `hasOwnProperty` rather than testing for undefined — a PATCH that
 * treated absent and null alike could never clear a field, and one that treated
 * them as "clear everything" would wipe columns the caller never mentioned.
 *
 * 🔴 DELIVERY TYPE IS NOT CHANGEABLE, and the refusal is deliberate rather than
 * an omission. `chk_trips_number_shape` proves
 *   tripNumber = typeCode || '-' || to_char(tripDate,'YYMMDD') || '-' || lpad(seq,2,'0')
 * so a new delivery type means a new `typeCode`, which means a new `tripNumber`,
 * which means a new `seq` allocated against a different (date, type) pair. That
 * is a RE-NUMBER, not an edit — and the old number may already be on a printed
 * sheet in a driver's hand. Refused here with a message that says what to do
 * instead, so the CHECK never surfaces as a raw 500.
 *
 * ⚠ `chk_trips_vehicle_one_of` forbids a master vehicle AND an ad-hoc plate
 * together. Checked here against the RESULTING state — not just the body —
 * because a PATCH that sets `vehicleId` while an `adhocVehicleNo` is already
 * stored would otherwise pass validation and die on the constraint.
 *
 * ⚠ A CANCELLED TRIP REFUSES EVERY EDIT with 409. It is a record of what was
 * planned; editing it would rewrite history nobody can see changing.
 *
 * ONE `trips.update`. No `orders` write at all on this path, so the live-sync
 * markers (which key on MAX(orders.updatedAt)) cannot see it. Sequential
 * awaits, never prisma.$transaction (CORE §3).
 */
export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "floor", "canEdit");
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const tripId = Number(params.id);
  if (!Number.isInteger(tripId) || tripId <= 0) {
    return NextResponse.json({ error: "Invalid trip id" }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as PatchBody;

  // Refused BEFORE anything is read or written, so the message is the same
  // whatever else the body carries.
  if (has(body, "deliveryTypeId")) {
    return NextResponse.json(
      {
        error:
          "A trip's delivery type cannot be changed — the trip number is built from it " +
          "(chk_trips_number_shape). Cancel this trip and build a new one of the right type.",
      },
      { status: 400 },
    );
  }

  const trip = await prisma.trips.findUnique({
    where: { id: tripId },
    select: { id: true, status: true, vehicleId: true, adhocVehicleNo: true, transporterId: true },
  });
  if (!trip) return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  if (trip.status === "cancelled") {
    return NextResponse.json({ error: "This trip is cancelled and cannot be edited." }, { status: 409 });
  }

  // ── Validate every supplied field before touching anything ────────────────
  const data: {
    vehicleId?: number | null;
    adhocVehicleNo?: string | null;
    transporterId?: number | null;
    dispatchWindowId?: number | null;
    note?: string | null;
    transporterTripNo?: string | null;
    driverName?: string | null;
    driverPhone?: string | null;
  } = {};

  if (has(body, "vehicleId")) {
    const v = optionalId(body.vehicleId);
    if (!v.ok) return NextResponse.json({ error: "vehicleId must be a positive integer or null" }, { status: 400 });
    data.vehicleId = v.value;
  }
  if (has(body, "adhocVehicleNo")) {
    const v = optionalText(body.adhocVehicleNo);
    if (!v.ok) return NextResponse.json({ error: "adhocVehicleNo must be a string or null" }, { status: 400 });
    data.adhocVehicleNo = v.value;
  }
  if (has(body, "transporterId")) {
    const v = optionalId(body.transporterId);
    if (!v.ok) return NextResponse.json({ error: "transporterId must be a positive integer or null" }, { status: 400 });
    data.transporterId = v.value;
  }
  if (has(body, "dispatchWindowId")) {
    const v = optionalId(body.dispatchWindowId);
    if (!v.ok) return NextResponse.json({ error: "dispatchWindowId must be a positive integer or null" }, { status: 400 });
    data.dispatchWindowId = v.value;
  }
  if (has(body, "note")) {
    const v = optionalText(body.note);
    if (!v.ok) return NextResponse.json({ error: "note must be a string or null" }, { status: 400 });
    data.note = v.value;
  }
  if (has(body, "transporterTripNo")) {
    const v = optionalText(body.transporterTripNo);
    if (!v.ok) return NextResponse.json({ error: "transporterTripNo must be a string or null" }, { status: 400 });
    data.transporterTripNo = v.value;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
  }

  // chk_trips_vehicle_one_of, tested against the RESULTING row rather than the
  // body — an unmentioned column keeps its stored value and can still collide.
  const nextVehicleId = has(body, "vehicleId") ? (data.vehicleId ?? null) : trip.vehicleId;
  const nextAdhoc = has(body, "adhocVehicleNo") ? (data.adhocVehicleNo ?? null) : trip.adhocVehicleNo;
  if (nextVehicleId !== null && nextAdhoc !== null) {
    return NextResponse.json(
      { error: "A trip carries EITHER a master vehicle OR an ad-hoc plate, never both." },
      { status: 400 },
    );
  }

  // ── Choosing a master vehicle RE-SNAPSHOTS the driver ─────────────────────
  //
  // Same rule as create: driverName/driverPhone are copied onto the trip, never
  // read back through `vehicleId`. Re-snapshotting on a vehicle CHANGE is the
  // point — swapping the van must swap the driver on the sheet, or the trip
  // would keep naming whoever drove the previous one.
  if (has(body, "vehicleId") && data.vehicleId !== null && data.vehicleId !== undefined) {
    const vehicle = await prisma.vehicle_master.findUnique({
      where: { id: data.vehicleId },
      select: { id: true, driverName: true, driverPhone: true, transporterId: true },
    });
    if (!vehicle) {
      return NextResponse.json({ error: `No vehicle found for id ${data.vehicleId}` }, { status: 400 });
    }
    data.driverName = vehicle.driverName;
    data.driverPhone = vehicle.driverPhone;
    // Default from the vehicle, but a transporterId SUPPLIED IN THIS REQUEST
    // wins — the trip carries its own transporter precisely so the default is
    // overridable (owner decision 7). `has()` rather than a null test, so an
    // explicit `transporterId: null` in the same body still means "clear it".
    if (!has(body, "transporterId")) data.transporterId = vehicle.transporterId;
  }

  // Clearing the vehicle clears the driver with it. A trip with no van still
  // naming a driver reads as a fact, and it is not one.
  if (has(body, "vehicleId") && data.vehicleId === null) {
    data.driverName = null;
    data.driverPhone = null;
  }

  try {
    const updated = await prisma.trips.update({
      where: { id: tripId },
      data,
      select: { id: true, tripNumber: true, status: true },
    });
    return NextResponse.json({ trip: updated });
  } catch (err) {
    // A CHECK or FK the validation above did not pre-empt. Surfaced as a 400
    // with the real message rather than a 500: each one is actionable.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not update the trip" },
      { status: 400 },
    );
  }
}
