import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN]);

  const body = await req.json() as { rows: Record<string, string>[] };
  const rows = body.rows ?? [];

  if (rows.length === 0) {
    return NextResponse.json({ imported: 0, skipped: 0, failed: 0, errors: [] });
  }

  // Resolve transporter names → IDs
  const transporters = await prisma.transporter_master.findMany({
    select: { id: true, name: true },
  });
  const transporterMap = new Map(
    transporters.map((t) => [t.name.toLowerCase(), t.id])
  );

  const data = [];
  for (const r of rows) {
    const vehicleNo = r.vehicleno?.trim().toUpperCase();
    if (!vehicleNo) continue;

    const transporterName = r.transporter?.trim();
    const transporterId = transporterName
      ? transporterMap.get(transporterName.toLowerCase())
      : undefined;
    if (!transporterId) continue;

    const capacityKg = parseFloat(r.capacitykg ?? "");
    if (isNaN(capacityKg) || capacityKg <= 0) continue;

    const maxCustomersRaw = r.maxcustomers?.trim();
    const maxCustomers = maxCustomersRaw ? parseInt(maxCustomersRaw, 10) : null;

    data.push({
      vehicleNo,
      category:            r.category?.trim() ?? "",
      capacityKg,
      deliveryTypeAllowed: r.deliverytypeallowed?.trim() ?? "",
      transporterId,
      driverName:          r.drivername?.trim()  || null,
      driverPhone:         r.driverphone?.trim() || null,
      maxCustomers:        maxCustomers && !isNaN(maxCustomers) ? maxCustomers : null,
      isActive:            true,
    });
  }

  const result = await prisma.vehicle_master.createMany({
    data,
    skipDuplicates: true,
  });

  const imported = result.count;
  const skipped  = data.length - imported;

  return NextResponse.json({ imported, skipped, failed: 0, errors: [] });
}
