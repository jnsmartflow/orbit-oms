import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const session = await auth();
  requireRole(session, [ROLES.FLOOR_SUPERVISOR, ROLES.ADMIN]);

  const todayStart = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00");
  const todayEnd = new Date(new Date().toISOString().slice(0, 10) + "T23:59:59");

  // Get all users with picker role
  const pickerUsers = await prisma.users.findMany({
    where: {
      role: { name: "picker" },
      isActive: true,
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  // Get today's pick assignments for all pickers
  const assignments = await prisma.pick_assignments.findMany({
    where: {
      pickerId: { in: pickerUsers.map((u) => u.id) },
      assignedAt: { gte: todayStart, lte: todayEnd },
      status: { in: ["assigned", "picked"] },
    },
    select: {
      pickerId: true,
      status: true,
      order: {
        select: {
          querySnapshot: {
            select: { totalWeight: true },
          },
        },
      },
    },
  });

  // Aggregate stats per picker
  const statsMap = new Map<
    number,
    { assigned: number; picked: number; totalKg: number }
  >();

  for (const a of assignments) {
    if (!statsMap.has(a.pickerId)) {
      statsMap.set(a.pickerId, { assigned: 0, picked: 0, totalKg: 0 });
    }
    const s = statsMap.get(a.pickerId)!;
    s.totalKg += a.order.querySnapshot?.totalWeight ?? 0;
    if (a.status === "picked") {
      s.picked++;
    }
    s.assigned++;
  }

  // Build response
  const pickers = pickerUsers.map((u) => {
    const s = statsMap.get(u.id) ?? { assigned: 0, picked: 0, totalKg: 0 };
    const pendingCount = s.assigned - s.picked;
    return {
      id: u.id,
      name: u.name,
      avatarInitial: u.name.charAt(0).toUpperCase(),
      status: (pendingCount > 0 ? "picking" : "available") as "picking" | "available",
      assignedCount: s.assigned,
      pickedCount: s.picked,
      pendingCount,
      totalKg: s.totalKg,
    };
  });

  // Sort: picking first, then available
  pickers.sort((a, b) => {
    if (a.status !== b.status) return a.status === "picking" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return NextResponse.json({ pickers });
}
