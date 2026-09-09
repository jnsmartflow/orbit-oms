import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/floor/trips/options — the four dropdown lists the Build trip drawer
 * needs: delivery types, dispatch windows, vehicles and transporters.
 *
 * 🔴 WHY THIS ROUTE EXISTS, because it was NOT in the brief. The brief was UI
 * only. The drawer it asks for has a vehicle picker "from vehicle_master" and a
 * transporter picker, and there is no route a Floor operator can call for
 * either:
 *   - `/api/admin/vehicles` gates on `vehicles` canView — held by admin,
 *     operation_manager and tint_manager, NOT by `operations`, which is the role
 *     that holds `floor` (CORE §5).
 *   - `/api/admin/delivery-types` uses `requireRole([ADMIN, DISPATCHER, SUPPORT,
 *     TINT_MANAGER, TINT_OPERATOR, FLOOR_SUPERVISOR])` — `operations` is not in
 *     that array either.
 * So the operator who can build a trip cannot read the lists a trip is built
 * from. Without this the drawer ships with three empty dropdowns.
 *
 * The alternatives were worse. Widening either admin gate would hand a Floor
 * operator a Vehicles or Delivery-types admin screen in his sidebar, because
 * `buildNavItems` reads the same tick — the exact trap CORE §13 records for the
 * three admin GETs that deliberately gate on `customers`/canEdit. Extending
 * `/api/floor/board`'s payload would change a route this step was told not to
 * touch, and would put four static lists on every 15-second board reload.
 *
 * ADDITIVE ONLY: a new read-only route, no new permission key, no schema change,
 * no flag. It gates on `floor` canEdit exactly like every sibling under
 * /api/floor, so it is reachable by precisely the people who can already create
 * a trip and nobody else.
 *
 * Read-only. Four batched findMany calls, no writes anywhere — the live-sync
 * markers key on MAX(orders.updatedAt) and this touches no order at all.
 * Sequential awaits, never prisma.$transaction (CORE §3).
 */
export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "floor", "canEdit");
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const deliveryTypes = await prisma.delivery_type_master.findMany({
    select: { id: true, name: true },
    orderBy: { id: "asc" },
  });

  const windows = await prisma.dispatch_slot_master.findMany({
    where: { isActive: true },
    select: { id: true, windowTime: true },
    orderBy: { sortOrder: "asc" },
  });

  const vehicles = await prisma.vehicle_master.findMany({
    where: { isActive: true },
    select: { id: true, vehicleNo: true, driverName: true, transporterId: true },
    orderBy: { vehicleNo: "asc" },
  });

  // ⚠ `isRealTransporter` FILTERS THIS LIST, and that is what the column is for.
  // `transporter_master` holds 25 rows of which seven are SAP status codes that
  // arrived as names — DELETE, CANCEL, HAND, PORTER, ewaybill, PICK DELETED, CI.
  // They are kept (historical orders point at them; CORE §3 forbids deleting)
  // and they must never appear in a picker.
  //
  // ⚠ THE FLAG DEFAULTS FALSE, so this list is EMPTY until somebody runs the
  // marking UPDATE (trip-schema draft §D7, still commented out). An empty
  // transporter dropdown is the expected state today and is not a bug — the
  // field is optional and a trip is creatable without one.
  const transporters = await prisma.transporter_master.findMany({
    where: { isRealTransporter: true, isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({ deliveryTypes, windows, vehicles, transporters });
}
