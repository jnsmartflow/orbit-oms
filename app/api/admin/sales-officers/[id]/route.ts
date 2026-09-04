import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireSuperuser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { logAdminAction } from "@/lib/audit/log";
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
  requireSuperuser(session);

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

  // ⚠ NEW read. The email conflict check above looks at a DIFFERENT row
  // (`NOT: {id}`) and only runs when the email is sent, so there was nothing
  // here to reuse.
  const before = await prisma.sales_officer_master.findUnique({
    where: { id },
    select: { name: true, email: true, phone: true, isActive: true },
  });

  const officer = await prisma.sales_officer_master.update({
    where: { id },
    data: updateData,
  });

  // AFTER the update returns (audit RULE 2) — changed fields only.
  const changed: string[] = [];
  const beforeData: Record<string, unknown> = {};
  const afterData:  Record<string, unknown> = {};
  for (const k of ["name", "email", "phone", "isActive"] as const) {
    if (before && before[k] !== officer[k]) {
      changed.push(k);
      beforeData[k] = before[k];
      afterData[k]  = officer[k];
    }
  }
  if (changed.length > 0) {
    await logAdminAction({
      userId: parseInt(session!.user.id, 10),
      entity: "sales_officers",
      entityId: String(id),
      action: "update",
      summary: `sales officer "${officer.name}" — ${changed.join(", ")}`,
      before: beforeData,
      after:  afterData,
    });
  }

  return NextResponse.json(officer);
}
