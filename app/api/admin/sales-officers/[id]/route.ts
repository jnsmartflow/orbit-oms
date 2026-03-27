import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  name:     z.string().min(1).max(100).optional(),
  email:    z.string().email().max(200).optional().nullable(),
  phone:    z.string().max(30).optional().nullable(),
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

  const updateData: Record<string, unknown> = {};

  if (parsed.data.name !== undefined) updateData.name = parsed.data.name.trim();
  if (parsed.data.phone !== undefined) updateData.phone = parsed.data.phone?.trim() || null;
  if (parsed.data.isActive !== undefined) updateData.isActive = parsed.data.isActive;

  if (parsed.data.email !== undefined) {
    const email = parsed.data.email ? parsed.data.email.trim().toLowerCase() : null;
    if (email) {
      const conflict = await prisma.sales_officer_master.findFirst({
        where: { email, NOT: { id } },
      });
      if (conflict) return NextResponse.json({ error: "Email already exists." }, { status: 409 });
    }
    updateData.email = email;
  }

  const officer = await prisma.sales_officer_master.update({
    where: { id },
    data: updateData,
  });

  return NextResponse.json(officer);
}
