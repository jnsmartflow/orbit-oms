import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { logAdminAction } from "@/lib/audit/log";
import { z } from "zod";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN, ROLES.DISPATCHER, ROLES.SUPPORT]);

  const slots = await prisma.slot_master.findMany({ orderBy: { sortOrder: "asc" } });
  return NextResponse.json(slots);
}

const createSchema = z.object({
  name:      z.string().min(1).max(100),
  slotTime:  z.string().regex(/^\d{2}:\d{2}$/, "Must be HH:MM format"),
  isNextDay: z.boolean().default(false),
  sortOrder: z.number().int().min(1),
  isActive:  z.boolean().default(true),
});

export async function POST(req: Request) {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN]);

  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const existing = await prisma.slot_master.findUnique({ where: { name: parsed.data.name } });
  if (existing) {
    return NextResponse.json({ error: "A slot with this name already exists." }, { status: 409 });
  }

  const slot = await prisma.slot_master.create({ data: parsed.data });

  // AFTER the create returns (audit RULE 2).
  await logAdminAction({
    userId: parseInt(session!.user.id, 10),
    entity: "slots",
    entityId: String(slot.id),
    action: "create",
    summary:
      `slot "${slot.name}" created — ${slot.slotTime}` +
      (slot.isNextDay ? " next day" : "") + `, sort ${slot.sortOrder}`,
    after: {
      name:      slot.name,
      slotTime:  slot.slotTime,
      isNextDay: slot.isNextDay,
      sortOrder: slot.sortOrder,
      isActive:  slot.isActive,
    },
  });

  return NextResponse.json(slot, { status: 201 });
}
