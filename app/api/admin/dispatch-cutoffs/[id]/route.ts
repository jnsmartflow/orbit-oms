import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  label: z.string().min(1).optional(),
  cutoffTime: z.string().regex(/^\d{2}:\d{2}$/, "Must be HH:MM format").optional(),
  isActive: z.boolean().optional(),
  isDefaultForType: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN]);
  const id = parseInt(params.id);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0].message }, { status: 400 });
  const existing = await prisma.dispatch_cutoff_master.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Slot not found" }, { status: 404 });
  const updated = await prisma.dispatch_cutoff_master.update({ where: { id }, data: parsed.data, include: { deliveryType: true } });
  return NextResponse.json(updated);
}
