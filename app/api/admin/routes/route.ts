import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN]);

  const routes = await prisma.route_master.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { areaRoutes: true } } },
  });

  return NextResponse.json(
    routes.map((r) => ({ ...r, areaCount: r._count.areaRoutes, _count: undefined }))
  );
}

const createSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional().nullable(),
});

export async function POST(req: Request) {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN]);

  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const existing = await prisma.route_master.findFirst({
    where: { name: { equals: parsed.data.name, mode: "insensitive" } },
  });
  if (existing) {
    return NextResponse.json({ error: "Route name already exists." }, { status: 409 });
  }

  const route = await prisma.route_master.create({
    data: { name: parsed.data.name, description: parsed.data.description ?? null },
    include: { _count: { select: { areaRoutes: true } } },
  });

  return NextResponse.json({ ...route, areaCount: route._count.areaRoutes, _count: undefined }, { status: 201 });
}
