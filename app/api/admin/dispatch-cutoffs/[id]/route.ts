import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  isActive:  z.boolean().optional(),
  isDefault: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN]);

  const id = parseInt(params.id);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });

  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0].message }, { status: 400 });
  }

  const existing = await prisma.delivery_type_slot_config.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Config not found" }, { status: 404 });

  // If setting as default, clear existing default for same delivery type first
  if (parsed.data.isDefault === true) {
    await prisma.delivery_type_slot_config.updateMany({
      where: { deliveryTypeId: existing.deliveryTypeId, isDefault: true },
      data: { isDefault: false },
    });
  }

  const updated = await prisma.delivery_type_slot_config.update({
    where: { id },
    data: parsed.data,
    include: {
      deliveryType: { select: { id: true, name: true } },
      slot: { select: { id: true, name: true, slotTime: true, isNextDay: true } },
    },
  });

  return NextResponse.json(updated);
}
