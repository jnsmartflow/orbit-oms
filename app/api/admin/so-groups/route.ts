import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const dynamic = "force-dynamic";

const include = {
  salesOfficer: { select: { id: true, name: true, employeeCode: true } },
  _count:       { select: { customers: true } },
} as const;

export async function GET() {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN]);

  const rows = await prisma.sales_officer_group.findMany({
    orderBy: { name: "asc" },
    include,
  });
  return NextResponse.json(rows);
}

const createSchema = z.object({
  name:           z.string().min(1, "Name is required.").max(150),
  salesOfficerId: z.number().int().positive("Sales officer is required."),
  isActive:       z.boolean().default(true),
});

export async function POST(req: Request) {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN]);

  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const duplicate = await prisma.sales_officer_group.findUnique({
    where: { name: parsed.data.name },
  });
  if (duplicate) {
    return NextResponse.json({ error: "A group with this name already exists." }, { status: 409 });
  }

  const row = await prisma.sales_officer_group.create({ data: parsed.data, include });
  return NextResponse.json(row, { status: 201 });
}
