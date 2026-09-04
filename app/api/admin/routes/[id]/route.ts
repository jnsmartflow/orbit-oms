import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { logAdminAction } from "@/lib/audit/log";
import { z } from "zod";

export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
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

  if (parsed.data.name) {
    const conflict = await prisma.route_master.findFirst({
      where: { name: { equals: parsed.data.name, mode: "insensitive" }, NOT: { id } },
    });
    if (conflict) return NextResponse.json({ error: "Route name already exists." }, { status: 409 });
  }

  // ⚠ NEW read. The conflict check above looks at a DIFFERENT row (`NOT: {id}`)
  // and only runs when the name changes, so there was nothing to reuse.
  const before = await prisma.route_master.findUnique({
    where: { id },
    select: { name: true, description: true, isActive: true },
  });

  const route = await prisma.route_master.update({
    where: { id },
    data: parsed.data,
    include: { _count: { select: { areaRoutes: true } } },
  });

  // AFTER the update returns (audit RULE 2) — changed fields only.
  const changed: string[] = [];
  const beforeData: Record<string, unknown> = {};
  const afterData:  Record<string, unknown> = {};
  for (const k of ["name", "description", "isActive"] as const) {
    if (before && before[k] !== route[k]) {
      changed.push(k);
      beforeData[k] = before[k];
      afterData[k]  = route[k];
    }
  }
  if (changed.length > 0) {
    await logAdminAction({
      userId: parseInt(session!.user.id, 10),
      entity: "routes",
      entityId: String(id),
      action: "update",
      summary: `route "${route.name}" — ${changed.join(", ")}`,
      before: beforeData,
      after:  afterData,
    });
  }

  return NextResponse.json({ ...route, areaCount: route._count.areaRoutes, _count: undefined });
}
