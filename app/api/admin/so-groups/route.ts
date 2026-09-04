import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { logAdminAction } from "@/lib/audit/log";
import { z } from "zod";

export const dynamic = "force-dynamic";

const include = {
  salesOfficer: { select: { id: true, name: true, employeeCode: true } },
  _count:       { select: { customers: true } },
} as const;

export async function GET() {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN, ROLES.DISPATCHER, ROLES.SUPPORT, ROLES.TINT_MANAGER, ROLES.TINT_OPERATOR, ROLES.FLOOR_SUPERVISOR]);

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

  // AFTER the create returns (audit RULE 2).
  await logAdminAction({
    userId: parseInt(session!.user.id, 10),
    entity: "so_groups",
    entityId: String(row.id),
    action: "create",
    summary: `SO group "${row.name}" created under ${row.salesOfficer.name}`,
    after: { name: row.name, salesOfficerId: row.salesOfficerId, isActive: row.isActive },
  });

  return NextResponse.json(row, { status: 201 });
}
