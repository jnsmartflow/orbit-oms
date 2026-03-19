import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { checkPermission } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN, ROLES.DISPATCHER, ROLES.SUPPORT, ROLES.TINT_MANAGER, ROLES.TINT_OPERATOR, ROLES.FLOOR_SUPERVISOR]);
  if (session!.user.role !== "admin") {
    const allowed = await checkPermission(session!.user.role, "vehicles", "canView");
    if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

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
  requireRole(session, [ROLES.ADMIN, ROLES.DISPATCHER, ROLES.SUPPORT, ROLES.TINT_MANAGER, ROLES.TINT_OPERATOR, ROLES.FLOOR_SUPERVISOR]);
  if (session!.user.role !== "admin") {
    const allowed = await checkPermission(session!.user.role, "vehicles", "canEdit");
    if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

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

  return NextResponse.json(vehicle, { status: 201 });
}
