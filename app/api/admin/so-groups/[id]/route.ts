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

const patchSchema = z.object({
  name:           z.string().min(1).max(150).optional(),
  salesOfficerId: z.number().int().positive().optional(),
  isActive:       z.boolean().optional(),
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

  const existing = await prisma.sales_officer_group.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Group not found." }, { status: 404 });

  // Prevent deactivation if active customers are assigned
  if (parsed.data.isActive === false && existing.isActive) {
    const activeCustomerCount = await prisma.delivery_point_master.count({
      where: { salesOfficerGroupId: id, isActive: true },
    });
    if (activeCustomerCount > 0) {
      return NextResponse.json(
        {
          error: `${activeCustomerCount} active customer${activeCustomerCount === 1 ? "" : "s"} assigned to this group. Reassign or deactivate customers first.`,
        },
        { status: 422 }
      );
    }
  }

  if (parsed.data.name && parsed.data.name !== existing.name) {
    const duplicate = await prisma.sales_officer_group.findUnique({
      where: { name: parsed.data.name },
    });
    if (duplicate) {
      return NextResponse.json({ error: "A group with this name already exists." }, { status: 409 });
    }
  }

  const row = await prisma.sales_officer_group.update({
    where:   { id },
    data:    parsed.data,
    include,
  });
  return NextResponse.json(row);
}
