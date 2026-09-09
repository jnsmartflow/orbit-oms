import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { allocateTripNumberWithRetry, typeCodeForDeliveryType } from "@/lib/trips/number";
import { getTripsForDate, parseTripDate } from "@/lib/trips/queries";

export const dynamic = "force-dynamic";

/**
 * /api/floor/trips — create a trip, and list a day's trips.
 *
 * 🔴 WHY THIS IS NOT `/api/trips`. That address is TAKEN, and by something live:
 * `app/api/trips/route.ts` is the read-only NTS Trip Report mirror that serves
 * the `/trips` screen (CLAUDE_TRIP_REPORT.md §8). Mounting the Orbit trip module
 * there would have replaced it and broken that screen.
 *
 * The two are deliberately separate for the whole parallel run: `/trips` keeps
 * showing the NTS photocopy while Orbit's own trips live here, and nothing
 * reconciles them (floor-trip-module decision record §5). When NTS stops, the
 * mirror is retired through the archive playbook and this module is unaffected.
 *
 * `/api/floor/*` is also where this belongs on its own merits — Floor Control is
 * the screen that becomes the trip board, and every sibling route under it
 * (release, actions, pick-visible, pick-gate) is gated exactly this way.
 *
 * Gate: `floor` canEdit on BOTH verbs, matching /api/floor/pick-gate. The read
 * is gated the same way as the write deliberately — a trip is an operations
 * plan, not board data, and `floor_supervisor` sees its consequences on his own
 * board without needing the planning surface.
 *
 * Sequential awaits, never prisma.$transaction (CORE §3).
 */

interface CreateBody {
  deliveryTypeId?: number;
  tripDate?: string; // YYYY-MM-DD
  dispatchWindowId?: number | null;
  transporterId?: number | null;
  vehicleId?: number | null;
  adhocVehicleNo?: string | null;
  note?: string | null;
  transporterTripNo?: string | null;
}

/** A supplied optional integer must be a real positive integer or explicitly null. */
function optionalId(value: unknown): { ok: true; value: number | null } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) return { ok: false };
  return { ok: true, value };
}

/** Trim an optional free-text field to null when it carries nothing. */
function optionalText(value: unknown): { ok: true; value: string | null } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false };
  const trimmed = value.trim();
  return { ok: true, value: trimmed === "" ? null : trimmed };
}

export async function GET(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "floor", "canEdit");
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const dateParam = new URL(req.url).searchParams.get("date");
  if (!dateParam) {
    return NextResponse.json({ error: "date is required (YYYY-MM-DD)" }, { status: 400 });
  }

  let tripDate: Date;
  try {
    tripDate = parseTripDate(dateParam);
  } catch (err) {
    // A malformed date is a 400, never a silent fall back to today. Answering a
    // different question than the one asked, while looking successful, is the
    // trap resolveTargetDate (lib/picking/queue.ts) documents.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid date" },
      { status: 400 },
    );
  }

  const trips = await getTripsForDate(tripDate);
  return NextResponse.json({ date: dateParam, trips });
}

/**
 * POST /api/floor/trips — create a trip in `draft`.
 *
 * Body: `{ deliveryTypeId, tripDate, dispatchWindowId?, transporterId?,
 *          vehicleId?, adhocVehicleNo?, note?, transporterTripNo? }`
 *
 * 🔴 VEHICLE AND TRANSPORTER ARE BOTH OPTIONAL AND A TRIP MUST BE CREATABLE
 * WITH NEITHER. The owner's framing: *"assign a vehicle if there or draft
 * vehicle"* — the van is often unknown when the load is planned and is attached
 * when it reaches the depot. Do not add a required-vehicle guard here.
 *
 * ⚠ `chk_trips_vehicle_one_of` forbids `vehicleId` AND `adhocVehicleNo`
 * together. It is checked here first so the caller gets a named 400 instead of
 * a raw constraint-violation string, but the CHECK is the backstop and must
 * stay: this route is not the only thing that will ever insert a trip.
 *
 * ⚠ THE DRIVER IS SNAPSHOTTED, NOT LINKED. When a master vehicle is chosen its
 * `driverName`/`driverPhone` are copied onto the trip row. The master's driver
 * changes when a transporter swaps a man onto a van, and a sheet printed last
 * week must keep saying who actually drove it (trip-schema draft §C1). Never
 * "normalise" this into a read through `vehicleId`.
 *
 * ⚠ A SUPPLIED `transporterId` WINS over the vehicle's own. The trip carries its
 * OWN transporter, defaulted from the vehicle as a convenience and overridable —
 * owner decision 7. Deriving it from the vehicle at read time would make the
 * override impossible to express.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "floor", "canEdit");
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // The real session user, never a body claim. Number("") is 0 and finite, so
  // test for a real positive integer (the release routes' rule).
  const createdById = Number(session.user.id);
  if (!Number.isInteger(createdById) || createdById <= 0) {
    return NextResponse.json({ error: "Invalid session user id" }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as CreateBody;

  // ── Validation, ALL of it before any write ────────────────────────────────
  if (typeof body.deliveryTypeId !== "number" || !Number.isInteger(body.deliveryTypeId) || body.deliveryTypeId <= 0) {
    return NextResponse.json({ error: "deliveryTypeId is required and must be a positive integer" }, { status: 400 });
  }
  if (typeof body.tripDate !== "string") {
    return NextResponse.json({ error: "tripDate is required (YYYY-MM-DD)" }, { status: 400 });
  }
  let tripDate: Date;
  try {
    tripDate = parseTripDate(body.tripDate);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Invalid tripDate" }, { status: 400 });
  }

  const windowId = optionalId(body.dispatchWindowId);
  if (!windowId.ok) return NextResponse.json({ error: "dispatchWindowId must be a positive integer or null" }, { status: 400 });
  const suppliedTransporterId = optionalId(body.transporterId);
  if (!suppliedTransporterId.ok) return NextResponse.json({ error: "transporterId must be a positive integer or null" }, { status: 400 });
  const vehicleId = optionalId(body.vehicleId);
  if (!vehicleId.ok) return NextResponse.json({ error: "vehicleId must be a positive integer or null" }, { status: 400 });

  const adhoc = optionalText(body.adhocVehicleNo);
  if (!adhoc.ok) return NextResponse.json({ error: "adhocVehicleNo must be a string or null" }, { status: 400 });
  const note = optionalText(body.note);
  if (!note.ok) return NextResponse.json({ error: "note must be a string or null" }, { status: 400 });
  const transporterTripNo = optionalText(body.transporterTripNo);
  if (!transporterTripNo.ok) return NextResponse.json({ error: "transporterTripNo must be a string or null" }, { status: 400 });

  // chk_trips_vehicle_one_of, surfaced as a readable 400 rather than a raw
  // constraint-violation string on somebody's screen.
  if (vehicleId.value !== null && adhoc.value !== null) {
    return NextResponse.json(
      { error: "A trip carries EITHER a master vehicle OR an ad-hoc plate, never both." },
      { status: 400 },
    );
  }

  // ── Resolve the delivery type, which decides the number's letter ──────────
  const deliveryType = await prisma.delivery_type_master.findUnique({
    where: { id: body.deliveryTypeId },
    select: { id: true, name: true },
  });
  if (!deliveryType) {
    return NextResponse.json({ error: `No delivery type found for id ${body.deliveryTypeId}` }, { status: 400 });
  }

  // THROWS on an unmapped type rather than guessing a letter — see
  // lib/trips/number.ts. Caught here so an unknown type is a 400 the caller can
  // read, not a 500.
  let typeCode: string;
  try {
    typeCode = typeCodeForDeliveryType(deliveryType.name);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown delivery type" }, { status: 400 });
  }

  // ── Resolve the vehicle, for the driver snapshot + the transporter default ─
  let driverName: string | null = null;
  let driverPhone: string | null = null;
  let transporterId: number | null = suppliedTransporterId.value;

  if (vehicleId.value !== null) {
    const vehicle = await prisma.vehicle_master.findUnique({
      where: { id: vehicleId.value },
      select: { id: true, driverName: true, driverPhone: true, transporterId: true },
    });
    if (!vehicle) {
      return NextResponse.json({ error: `No vehicle found for id ${vehicleId.value}` }, { status: 400 });
    }
    // SNAPSHOT — see the header. Copied at build time, never read back through
    // the FK.
    driverName = vehicle.driverName;
    driverPhone = vehicle.driverPhone;
    // Default from the vehicle, but a supplied value WINS. `??` is exactly the
    // right operator here: optionalId has already turned an absent field into
    // null, so a caller who wants the vehicle's own transporter simply omits it.
    transporterId = suppliedTransporterId.value ?? vehicle.transporterId;
  }

  // ── Allocate + insert, retrying once on the number race ───────────────────
  // The allocator owns the number and nothing else; this callback owns the row.
  // A P2002 on either unique is caught inside and retried once — see
  // lib/trips/number.ts for why one retry and not a loop.
  try {
    const trip = await allocateTripNumberWithRetry(tripDate, typeCode, (identity) =>
      prisma.trips.create({
        data: {
          tripNumber: identity.tripNumber,
          tripDate,
          typeCode: identity.typeCode,
          seq: identity.seq,
          deliveryTypeId: deliveryType.id,
          dispatchWindowId: windowId.value,
          transporterId,
          vehicleId: vehicleId.value,
          adhocVehicleNo: adhoc.value,
          driverName,
          driverPhone,
          transporterTripNo: transporterTripNo.value,
          note: note.value,
          // chk_trips_status admits draft|released|loading|dispatched|cancelled.
          // A trip always starts at the desk.
          status: "draft",
          createdById,
        },
        select: { id: true, tripNumber: true, tripDate: true, typeCode: true, seq: true, status: true },
      }),
    );

    return NextResponse.json(
      {
        trip: {
          id: trip.id,
          tripNumber: trip.tripNumber,
          tripDate: trip.tripDate.toISOString().slice(0, 10),
          typeCode: trip.typeCode,
          seq: trip.seq,
          status: trip.status,
        },
      },
      { status: 201 },
    );
  } catch (err) {
    // A collision that survived the retry, or a CHECK the validation above did
    // not pre-empt (chk_trips_type_code refuses 'C' today — Cross has no letter
    // in the format yet, trip-schema draft §E). Surfaced as a 400 with the real
    // message rather than a 500: every one of these is something the caller can
    // act on.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not create the trip" },
      { status: 400 },
    );
  }
}
