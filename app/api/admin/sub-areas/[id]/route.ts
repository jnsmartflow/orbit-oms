import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { logAdminAction } from "@/lib/audit/log";
import { z } from "zod";

export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  areaId: z.number().int().positive().optional(),
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

  // ⚠ NEW read — this route wrote blind, with no pre-existing read to reuse.
  const before = await prisma.sub_area_master.findUnique({
    where: { id },
    select: { name: true, areaId: true, isActive: true },
  });

  const subArea = await prisma.sub_area_master.update({
    where: { id },
    data: parsed.data,
    include: { area: { select: { id: true, name: true } } },
  });

  // AFTER the update returns (audit RULE 2) — changed fields only.
  const changed: string[] = [];
  const beforeData: Record<string, unknown> = {};
  const afterData:  Record<string, unknown> = {};
  for (const k of ["name", "areaId", "isActive"] as const) {
    if (before && before[k] !== subArea[k]) {
      changed.push(k);
      beforeData[k] = before[k];
      afterData[k]  = subArea[k];
    }
  }
  if (changed.length > 0) {
    await logAdminAction({
      userId: parseInt(session!.user.id, 10),
      entity: "sub_areas",
      entityId: String(id),
      action: "update",
      summary: `sub-area "${subArea.name}" (area "${subArea.area.name}") — ${changed.join(", ")}`,
      before: beforeData,
      after:  afterData,
    });
  }

  return NextResponse.json(subArea);
}
