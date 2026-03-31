import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  const session = await auth();
  requireRole(session, [ROLES.DISPATCHER, ROLES.FLOOR_SUPERVISOR, ROLES.ADMIN]);

  const { searchParams } = new URL(req.url);
  const deliveryType = searchParams.get("deliveryType");

  const where: { isActive: boolean; deliveryTypeAllowed?: string } = {
    isActive: true,
  };
  if (deliveryType) {
    where.deliveryTypeAllowed = deliveryType;
  }

  const vehicles = await prisma.vehicle_master.findMany({
    where,
    select: {
      id: true,
      vehicleNo: true,
      category: true,
      capacityKg: true,
      maxCustomers: true,
      deliveryTypeAllowed: true,
      driverName: true,
      driverPhone: true,
    },
    orderBy: { vehicleNo: "asc" },
  });

  return NextResponse.json({ vehicles });
}
