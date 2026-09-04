import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { logAdminAction } from "@/lib/audit/log";
import { z } from "zod";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  vehicleNo:           z.string().min(1).max(50).optional(),
  category:            z.string().min(1).max(100).optional(),
  capacityKg:          z.number().positive().optional(),
  maxCustomers:        z.number().int().positive().optional().nullable(),
  deliveryTypeAllowed: z.string().min(1).max(100).optional(),
  transporterId:       z.number().int().positive().optional(),
  driverName:          z.string().max(200).optional().nullable(),
  driverPhone:         z.string().max(20).optional().nullable(),
  isActive:            z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN]);

  const id = parseInt(params.id, 10);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id." }, { status: 400 });

  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  if (parsed.data.vehicleNo) {
    const vehicleNo = parsed.data.vehicleNo.trim().toUpperCase();
    const conflict = await prisma.vehicle_master.findFirst({
      where: { vehicleNo, NOT: { id } },
    });
    if (conflict) {
      return NextResponse.json({ error: "Vehicle number already exists." }, { status: 409 });
    }
    parsed.data.vehicleNo = vehicleNo;
  }

  // ⚠ NEW read. The conflict check above looks at a DIFFERENT row (`NOT: {id}`)
  // and only runs when the number changes, so there was nothing to reuse.
  const before = await prisma.vehicle_master.findUnique({
    where: { id },
    select: {
      vehicleNo: true, category: true, capacityKg: true, maxCustomers: true,
      deliveryTypeAllowed: true, transporterId: true, driverName: true,
      driverPhone: true, isActive: true,
    },
  });

  const vehicle = await prisma.vehicle_master.update({
    where: { id },
    data: parsed.data,
    include: { transporter: { select: { id: true, name: true } } },
  });

  // AFTER the update returns (audit RULE 2) — changed fields only.
  const changed: string[] = [];
  const beforeData: Record<string, unknown> = {};
  const afterData:  Record<string, unknown> = {};
  for (const k of [
    "vehicleNo", "category", "capacityKg", "maxCustomers",
    "deliveryTypeAllowed", "transporterId", "driverName", "driverPhone", "isActive",
  ] as const) {
    if (before && before[k] !== vehicle[k]) {
      changed.push(k);
      beforeData[k] = before[k];
      afterData[k]  = vehicle[k];
    }
  }
  if (changed.length > 0) {
    await logAdminAction({
      userId: parseInt(session!.user.id, 10),
      entity: "vehicles",
      entityId: String(id),
      action: "update",
      summary: `vehicle ${vehicle.vehicleNo} — ${changed.join(", ")}`,
      before: beforeData,
      after:  afterData,
    });
  }

  return NextResponse.json(vehicle);
}
