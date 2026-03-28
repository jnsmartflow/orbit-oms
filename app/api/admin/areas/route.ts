import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { checkPermission } from "@/lib/permissions";

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN, ROLES.DISPATCHER, ROLES.SUPPORT, ROLES.TINT_MANAGER, ROLES.TINT_OPERATOR, ROLES.FLOOR_SUPERVISOR]);
  if (
    session!.user.role !== "admin" &&
    session!.user.role !== ROLES.TINT_MANAGER &&
    session!.user.role !== ROLES.SUPPORT
  ) {
    const allowed = await checkPermission(session!.user.role, "routes_areas", "canView");
    if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const areas = await prisma.area_master.findMany({
    orderBy: { name: "asc" },
    include: {
      deliveryType:  { select: { id: true, name: true } },
      primaryRoute:  { select: { id: true, name: true } },
      areaRoutes:    { include: { route: { select: { id: true, name: true } } } },
      _count:        { select: { subAreas: true } },
    },
  });

  return NextResponse.json(
    areas.map((a) => ({
      id:           a.id,
      name:         a.name,
      isActive:     a.isActive,
      createdAt:    a.createdAt,
      deliveryType: a.deliveryType,
      primaryRoute: a.primaryRoute,
      routes:       a.areaRoutes.map((ar) => ar.route),
      subAreaCount: a._count.subAreas,
    }))
  );
}

const createSchema = z.object({
  name:           z.string().min(1).max(100),
  deliveryTypeId: z.number().int().positive(),
  primaryRouteId: z.number().int().positive().optional().nullable(),
  routeIds:       z.array(z.number().int().positive()).min(0),
});

export async function POST(req: Request) {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN, ROLES.DISPATCHER, ROLES.SUPPORT, ROLES.TINT_MANAGER, ROLES.TINT_OPERATOR, ROLES.FLOOR_SUPERVISOR]);
  if (session!.user.role !== "admin") {
    const allowed = await checkPermission(session!.user.role, "routes_areas", "canEdit");
    if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const { name, deliveryTypeId, primaryRouteId, routeIds } = parsed.data;

  if (primaryRouteId) {
    const routeExists = await prisma.route_master.findUnique({ where: { id: primaryRouteId } });
    if (!routeExists) {
      return NextResponse.json({ error: "Primary route not found." }, { status: 400 });
    }
  }

  const area = await prisma.area_master.create({
    data: {
      name,
      deliveryTypeId,
      primaryRouteId: primaryRouteId ?? null,
      areaRoutes: {
        create: routeIds.map((routeId) => ({ routeId })),
      },
    },
    include: {
      deliveryType:  { select: { id: true, name: true } },
      primaryRoute:  { select: { id: true, name: true } },
      areaRoutes:    { include: { route: { select: { id: true, name: true } } } },
      _count:        { select: { subAreas: true } },
    },
  });

  return NextResponse.json(
    {
      id:           area.id,
      name:         area.name,
      isActive:     area.isActive,
      createdAt:    area.createdAt,
      deliveryType: area.deliveryType,
      primaryRoute: area.primaryRoute,
      routes:       area.areaRoutes.map((ar) => ar.route),
      subAreaCount: area._count.subAreas,
    },
    { status: 201 }
  );
}
