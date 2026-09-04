import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, requireSuperuser, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { logAdminAction } from "@/lib/audit/log";
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

  const subAreas = await prisma.sub_area_master.findMany({
    orderBy: [{ area: { name: "asc" } }, { name: "asc" }],
    include: { area: { select: { id: true, name: true } } },
  });

  return NextResponse.json(subAreas);
}

const createSchema = z.object({
  name: z.string().min(1).max(100),
  areaId: z.number().int().positive(),
});

export async function POST(req: Request) {
  const session = await auth();
  requireSuperuser(session);
  if (session!.user.role !== "admin") {
    const allowed = await checkPermission(session!.user.role, "routes_areas", "canEdit");
    if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const subArea = await prisma.sub_area_master.create({
    data: parsed.data,
    include: { area: { select: { id: true, name: true } } },
  });

  // AFTER the create returns (audit RULE 2).
  await logAdminAction({
    userId: parseInt(session!.user.id, 10),
    entity: "sub_areas",
    entityId: String(subArea.id),
    action: "create",
    summary: `sub-area "${subArea.name}" created under area "${subArea.area.name}"`,
    after: { name: subArea.name, areaId: subArea.areaId, isActive: subArea.isActive },
  });

  return NextResponse.json(subArea, { status: 201 });
}
