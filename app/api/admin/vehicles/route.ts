import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN]);

  const vehicles = await prisma.vehicle_master.findMany({
    orderBy: { vehicleNumber: "asc" },
    include: { deliveryType: { select: { id: true, name: true } } },
  });

  return NextResponse.json(vehicles);
}

const createSchema = z.object({
  vehicleNumber: z.string().min(1).max(50),
  vehicleType: z.string().min(1).max(100),
  capacityKg: z.number().positive(),
  capacityCbm: z.number().positive().optional().nullable(),
  deliveryTypeId: z.number().int().positive(),
});

export async function POST(req: Request) {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN]);

  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const vehicleNumber = parsed.data.vehicleNumber.trim().toUpperCase();

  const existing = await prisma.vehicle_master.findUnique({ where: { vehicleNumber } });
  if (existing) {
    return NextResponse.json({ error: "Vehicle number already exists." }, { status: 409 });
  }

  const vehicle = await prisma.vehicle_master.create({
    data: { ...parsed.data, vehicleNumber },
    include: { deliveryType: { select: { id: true, name: true } } },
  });

  return NextResponse.json(vehicle, { status: 201 });
}
