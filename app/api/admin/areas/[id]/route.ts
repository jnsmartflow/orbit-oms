import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { logAdminAction } from "@/lib/audit/log";
import { z } from "zod";

export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  name:           z.string().min(1).max(100).optional(),
  deliveryTypeId: z.number().int().positive().optional(),
  primaryRouteId: z.number().int().positive().optional().nullable(),
  routeIds:       z.array(z.number().int().positive()).optional(),
  isActive:       z.boolean().optional(),
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

  const { routeIds, ...scalarData } = parsed.data;

  // ⚠ NEW read, and deliberately OUTSIDE the $transaction below — a read added
  // inside it would change that transaction's shape (CORE §3). The route map is
  // included because a remap is the half of this PATCH that a rename hides.
  const before = await prisma.area_master.findUnique({
    where: { id },
    select: {
      name: true, deliveryTypeId: true, primaryRouteId: true, isActive: true,
      areaRoutes: { select: { routeId: true } },
    },
  });

  const area = await prisma.$transaction(async (tx) => {
    if (routeIds !== undefined) {
      await tx.area_route_map.deleteMany({ where: { areaId: id } });
      if (routeIds.length > 0) {
        await tx.area_route_map.createMany({
          data: routeIds.map((routeId) => ({ areaId: id, routeId })),
        });
      }
    }

    return tx.area_master.update({
      where: { id },
      data: scalarData,
      include: {
        deliveryType:  { select: { id: true, name: true } },
        primaryRoute:  { select: { id: true, name: true } },
        areaRoutes:    { include: { route: { select: { id: true, name: true } } } },
        _count:        { select: { subAreas: true } },
      },
    });
  });

  // AFTER the write returns (audit RULE 2) — changed fields only.
  const changed: string[] = [];
  const beforeData: Record<string, unknown> = {};
  const afterData:  Record<string, unknown> = {};
  if (before) {
    for (const k of ["name", "deliveryTypeId", "primaryRouteId", "isActive"] as const) {
      if (before[k] !== area[k]) {
        changed.push(k);
        beforeData[k] = before[k];
        afterData[k]  = area[k];
      }
    }
    // The route map is a set, not a scalar: sort both sides before comparing so
    // a reordered POST of the same routes does not read as a remap.
    const fromRoutes = before.areaRoutes.map((ar) => ar.routeId).sort((a, b) => a - b).join("|");
    const toRoutes   = area.areaRoutes.map((ar) => ar.routeId).sort((a, b) => a - b).join("|");
    if (routeIds !== undefined && fromRoutes !== toRoutes) {
      changed.push("routes");
      beforeData.routeIds = fromRoutes;
      afterData.routeIds  = toRoutes;
    }
  }
  if (changed.length > 0) {
    await logAdminAction({
      userId: parseInt(session!.user.id, 10),
      entity: "areas",
      entityId: String(id),
      action: "update",
      summary: `area "${area.name}" — ${changed.join(", ")}`,
      before: beforeData,
      after:  afterData,
    });
  }

  return NextResponse.json({
    id:           area.id,
    name:         area.name,
    isActive:     area.isActive,
    createdAt:    area.createdAt,
    deliveryType: area.deliveryType,
    primaryRoute: area.primaryRoute,
    routes:       area.areaRoutes.map((ar) => ar.route),
    subAreaCount: area._count.subAreas,
  });
}
