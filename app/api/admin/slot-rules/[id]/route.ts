import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const dynamic = "force-dynamic";

const include = {
  deliveryType: { select: { id: true, name: true } },
  slot:         { select: { id: true, name: true, slotTime: true, isNextDay: true } },
} as const;

const patchSchema = z.object({
  slotRuleType: z.enum(["time_based", "default"]).optional(),
  windowStart:  z.string().regex(/^\d{2}:\d{2}$/, "Must be HH:MM").nullable().optional(),
  windowEnd:    z.string().regex(/^\d{2}:\d{2}$/, "Must be HH:MM").nullable().optional(),
  isDefault:    z.boolean().optional(),
  sortOrder:    z.number().int().min(1).optional(),
  isActive:     z.boolean().optional(),
  forceDefault: z.boolean().optional(),
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

  const existing = await prisma.delivery_type_slot_config.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Rule not found." }, { status: 404 });

  const { forceDefault, ...updateData } = parsed.data;

  // Resolve effective ruleType (updated or existing)
  const effectiveRuleType = updateData.slotRuleType ?? existing.slotRuleType;

  if (effectiveRuleType === "time_based") {
    const effectiveStart = "windowStart" in updateData ? updateData.windowStart : existing.windowStart;
    const effectiveEnd   = "windowEnd"   in updateData ? updateData.windowEnd   : existing.windowEnd;
    if (!effectiveStart || !effectiveEnd) {
      return NextResponse.json(
        { error: "windowStart and windowEnd are required for time_based rules." },
        { status: 400 }
      );
    }
  } else if (effectiveRuleType === "default") {
    updateData.windowStart = null;
    updateData.windowEnd   = null;
  }

  // isDefault uniqueness warning
  if (updateData.isDefault === true && !existing.isDefault) {
    const existingDefault = await prisma.delivery_type_slot_config.findFirst({
      where: {
        deliveryTypeId: existing.deliveryTypeId,
        isDefault:      true,
        NOT:            { id },
      },
      include: { slot: { select: { name: true } } },
    });
    if (existingDefault && !forceDefault) {
      return NextResponse.json(
        {
          warning:          true,
          warningType:      "duplicate_default",
          existingSlotName: existingDefault.slot.name,
          message: `"${existingDefault.slot.name}" is already the default for this delivery type. Replace it?`,
        },
        { status: 409 }
      );
    }
    if (existingDefault && forceDefault) {
      await prisma.delivery_type_slot_config.update({
        where: { id: existingDefault.id },
        data:  { isDefault: false },
      });
    }
  }

  const rule = await prisma.delivery_type_slot_config.update({ where: { id }, data: updateData, include });
  return NextResponse.json(rule);
}
