import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export async function GET() {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN]);

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
  requireRole(session, [ROLES.ADMIN]);

  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const subArea = await prisma.sub_area_master.create({
    data: parsed.data,
    include: { area: { select: { id: true, name: true } } },
  });

  return NextResponse.json(subArea, { status: 201 });
}
