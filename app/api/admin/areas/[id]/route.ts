import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const patchSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  deliveryTypeId: z.number().int().positive().optional(),
  routeIds: z.array(z.number().int().positive()).optional(),
  isActive: z.boolean().optional(),
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
        deliveryType: { select: { id: true, name: true } },
        areaRoutes: { include: { route: { select: { id: true, name: true } } } },
        _count: { select: { subAreas: true } },
      },
    });
  });

  return NextResponse.json({
    id: area.id,
    name: area.name,
    isActive: area.isActive,
    createdAt: area.createdAt,
    deliveryType: area.deliveryType,
    routes: area.areaRoutes.map((ar) => ar.route),
    subAreaCount: area._count.subAreas,
  });
}
