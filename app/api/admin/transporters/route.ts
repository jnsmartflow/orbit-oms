import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireSuperuser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { logAdminAction } from "@/lib/audit/log";
import { z } from "zod";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  requireSuperuser(session);

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
  requireSuperuser(session);

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
  // AFTER the create returns (audit RULE 2).
  await logAdminAction({
    userId: parseInt(session!.user.id, 10),
    entity: "transporters",
    entityId: String(row.id),
    action: "create",
    summary: `transporter "${row.name}" created`,
    after: {
      name:          row.name,
      contactPerson: row.contactPerson,
      phone:         row.phone,
      email:         row.email,
      isActive:      row.isActive,
    },
  });

  return NextResponse.json(row, { status: 201 });
}
