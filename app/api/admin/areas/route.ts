import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export async function GET() {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN]);

  const areas = await prisma.area_master.findMany({
    orderBy: { name: "asc" },
    include: {
      deliveryType: { select: { id: true, name: true } },
      areaRoutes: { include: { route: { select: { id: true, name: true } } } },
      _count: { select: { subAreas: true } },
    },
  });

  return NextResponse.json(
    areas.map((a) => ({
      id: a.id,
      name: a.name,
      isActive: a.isActive,
      createdAt: a.createdAt,
      deliveryType: a.deliveryType,
      routes: a.areaRoutes.map((ar) => ar.route),
      subAreaCount: a._count.subAreas,
    }))
  );
}

const createSchema = z.object({
  name: z.string().min(1).max(100),
  deliveryTypeId: z.number().int().positive(),
  routeIds: z.array(z.number().int().positive()).min(0),
});

export async function POST(req: Request) {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN]);

  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const { name, deliveryTypeId, routeIds } = parsed.data;

  const area = await prisma.area_master.create({
    data: {
      name,
      deliveryTypeId,
      areaRoutes: {
        create: routeIds.map((routeId) => ({ routeId })),
      },
    },
    include: {
      deliveryType: { select: { id: true, name: true } },
      areaRoutes: { include: { route: { select: { id: true, name: true } } } },
      _count: { select: { subAreas: true } },
    },
  });

  return NextResponse.json(
    {
      id: area.id,
      name: area.name,
      isActive: area.isActive,
      createdAt: area.createdAt,
      deliveryType: area.deliveryType,
      routes: area.areaRoutes.map((ar) => ar.route),
      subAreaCount: area._count.subAreas,
    },
    { status: 201 }
  );
}
