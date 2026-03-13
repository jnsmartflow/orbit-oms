import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
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

  const subArea = await prisma.sub_area_master.update({
    where: { id },
    data: parsed.data,
    include: { area: { select: { id: true, name: true } } },
  });

  return NextResponse.json(subArea);
}
