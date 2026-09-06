import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logAdminAction } from "@/lib/audit/log";
import { z } from "zod";
import { checkAnyPermission } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Per-user tick, not a job title (2026-09-06). The role array only narrowed
  // ahead of a flag that already decided, so deleting it changes nobody: on this
  // key every role it named either holds the tick or was refused by the flag.
  // Both superuser arms live inside checkAnyPermission.
  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "vehicles", "canView");
  if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });

  const vehicles = await prisma.vehicle_master.findMany({
    orderBy: { vehicleNo: "asc" },
    include: { transporter: { select: { id: true, name: true } } },
  });

  return NextResponse.json(vehicles);
}

const createSchema = z.object({
  vehicleNo:           z.string().min(1).max(50),
  category:            z.string().min(1).max(100),
  capacityKg:          z.number().positive(),
  maxCustomers:        z.number().int().positive().optional().nullable(),
  deliveryTypeAllowed: z.string().min(1).max(100),
  transporterId:       z.number().int().positive(),
  driverName:          z.string().max(200).optional().nullable(),
  driverPhone:         z.string().max(20).optional().nullable(),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Per-user tick, not a job title (2026-09-06). The role array only narrowed
  // ahead of a flag that already decided, so deleting it changes nobody: on this
  // key every role it named either holds the tick or was refused by the flag.
  // Both superuser arms live inside checkAnyPermission.
  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "vehicles", "canEdit");
  if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });

  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const vehicleNo = parsed.data.vehicleNo.trim().toUpperCase();

  const existing = await prisma.vehicle_master.findUnique({ where: { vehicleNo } });
  if (existing) {
    return NextResponse.json({ error: "Vehicle number already exists." }, { status: 409 });
  }

  const vehicle = await prisma.vehicle_master.create({
    data: { ...parsed.data, vehicleNo },
    include: { transporter: { select: { id: true, name: true } } },
  });

  // AFTER the create returns (audit RULE 2).
  await logAdminAction({
    userId: parseInt(session!.user.id, 10),
    entity: "vehicles",
    entityId: String(vehicle.id),
    action: "create",
    summary: `vehicle ${vehicle.vehicleNo} created — ${vehicle.transporter.name}, ${vehicle.capacityKg}kg`,
    after: {
      vehicleNo:           vehicle.vehicleNo,
      category:            vehicle.category,
      capacityKg:          vehicle.capacityKg,
      maxCustomers:        vehicle.maxCustomers,
      deliveryTypeAllowed: vehicle.deliveryTypeAllowed,
      transporterId:       vehicle.transporterId,
      driverName:          vehicle.driverName,
      driverPhone:         vehicle.driverPhone,
    },
  });

  return NextResponse.json(vehicle, { status: 201 });
}
