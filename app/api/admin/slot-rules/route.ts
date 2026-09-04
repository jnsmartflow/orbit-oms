import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireSuperuser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { logAdminAction } from "@/lib/audit/log";
import { z } from "zod";

export const dynamic = "force-dynamic";

const include = {
  deliveryType: { select: { id: true, name: true } },
  slot:         { select: { id: true, name: true, slotTime: true, isNextDay: true } },
} as const;

export async function GET() {
  const session = await auth();
  requireSuperuser(session);

  const rules = await prisma.delivery_type_slot_config.findMany({
    orderBy: [{ deliveryType: { name: "asc" } }, { sortOrder: "asc" }],
    include,
  });
  return NextResponse.json(rules);
}

const createSchema = z.object({
  deliveryTypeId: z.number().int().positive(),
  slotId:         z.number().int().positive(),
  slotRuleType:   z.enum(["time_based", "default"]),
  windowStart:    z.string().regex(/^\d{2}:\d{2}$/, "Must be HH:MM").nullable().optional(),
  windowEnd:      z.string().regex(/^\d{2}:\d{2}$/, "Must be HH:MM").nullable().optional(),
  isDefault:      z.boolean().default(false),
  sortOrder:      z.number().int().min(1),
  isActive:       z.boolean().default(true),
  forceDefault:   z.boolean().optional(), // bypass duplicate-default warning
});

export async function POST(req: Request) {
  const session = await auth();
  requireSuperuser(session);

  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const { forceDefault, ...data } = parsed.data;

  // A forced default silently DEMOTES the rule that held the default before it.
  // That write is invisible in the response, so it is remembered here and named
  // in the audit summary below.
  let demotedDefaultSlot: string | null = null;

  // Enforce windowStart/windowEnd for time_based
  if (data.slotRuleType === "time_based") {
    if (!data.windowStart || !data.windowEnd) {
      return NextResponse.json(
        { error: "windowStart and windowEnd are required for time_based rules." },
        { status: 400 }
      );
    }
  } else {
    data.windowStart = null;
    data.windowEnd   = null;
  }

  // @@unique([deliveryTypeId, slotId]) check
  const duplicate = await prisma.delivery_type_slot_config.findUnique({
    where: { deliveryTypeId_slotId: { deliveryTypeId: data.deliveryTypeId, slotId: data.slotId } },
  });
  if (duplicate) {
    return NextResponse.json(
      { error: "A rule for this delivery type + slot combination already exists." },
      { status: 409 }
    );
  }

  // isDefault uniqueness warning
  if (data.isDefault) {
    const existingDefault = await prisma.delivery_type_slot_config.findFirst({
      where: { deliveryTypeId: data.deliveryTypeId, isDefault: true },
      include: { slot: { select: { name: true } } },
    });
    if (existingDefault && !forceDefault) {
      return NextResponse.json(
        {
          warning:        true,
          warningType:    "duplicate_default",
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
      demotedDefaultSlot = existingDefault.slot.name;
    }
  }

  const rule = await prisma.delivery_type_slot_config.create({ data, include });

  // AFTER the create returns (audit RULE 2). One line for the whole request,
  // including the demotion it may have caused on the way.
  await logAdminAction({
    userId: parseInt(session!.user.id, 10),
    entity: "slot_rules",
    entityId: String(rule.id),
    action: "create",
    summary:
      `slot rule created — ${rule.deliveryType.name} → "${rule.slot.name}" (${rule.slotRuleType}` +
      (rule.windowStart ? ` ${rule.windowStart}-${rule.windowEnd}` : "") + ")" +
      (rule.isDefault ? ", default" : "") +
      (demotedDefaultSlot ? `; replaced default "${demotedDefaultSlot}"` : ""),
    after: {
      deliveryTypeId: rule.deliveryTypeId,
      slotId:         rule.slotId,
      slotRuleType:   rule.slotRuleType,
      windowStart:    rule.windowStart,
      windowEnd:      rule.windowEnd,
      isDefault:      rule.isDefault,
      sortOrder:      rule.sortOrder,
      isActive:       rule.isActive,
      demotedDefaultSlot,
    },
  });

  return NextResponse.json(rule, { status: 201 });
}
