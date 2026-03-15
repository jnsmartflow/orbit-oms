import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN]);

  const rows = await prisma.transporter_master.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { vehicles: true } } },
  });
  return NextResponse.json(rows);
}

const createSchema = z.object({
  name:          z.string().min(1, "Name is required.").max(150),
  contactPerson: z.string().max(150).optional().nullable(),
  phone:         z.string().max(20).optional().nullable(),
  email:         z.string().email("Invalid email format.").max(150).optional().nullable().or(z.literal("")),
  isActive:      z.boolean().default(true),
});

export async function POST(req: Request) {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN]);

  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const duplicate = await prisma.transporter_master.findUnique({
    where: { name: parsed.data.name },
  });
  if (duplicate) {
    return NextResponse.json({ error: "A transporter with this name already exists." }, { status: 409 });
  }

  const row = await prisma.transporter_master.create({
    data:    { ...parsed.data, email: parsed.data.email || null },
    include: { _count: { select: { vehicles: true } } },
  });
  return NextResponse.json(row, { status: 201 });
}
