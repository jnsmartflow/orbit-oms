import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name:      z.string().min(1).max(100).optional(),
  slotTime:  z.string().regex(/^\d{2}:\d{2}$/, "Must be HH:MM format").optional(),
  isNextDay: z.boolean().optional(),
  sortOrder: z.number().int().min(1).optional(),
  isActive:  z.boolean().optional(),
  force:     z.boolean().optional(), // bypass deactivation warning
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

  const existing = await prisma.slot_master.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Slot not found." }, { status: 404 });

  // Deactivation warning: check active slot rule references
  if (parsed.data.isActive === false && existing.isActive && !parsed.data.force) {
    const activeConfigCount = await prisma.delivery_type_slot_config.count({
      where: { slotId: id, isActive: true },
    });
    if (activeConfigCount > 0) {
      return NextResponse.json(
        {
          warning: true,
          configCount: activeConfigCount,
          message: `This slot is referenced by ${activeConfigCount} active slot rule(s). Deactivating it may affect order slot assignment.`,
        },
        { status: 409 }
      );
    }
  }

  // Unique name check
  if (parsed.data.name && parsed.data.name !== existing.name) {
    const nameConflict = await prisma.slot_master.findUnique({ where: { name: parsed.data.name } });
    if (nameConflict) {
      return NextResponse.json({ error: "A slot with this name already exists." }, { status: 409 });
    }
  }

  const { force: _force, ...updateData } = parsed.data;
  const slot = await prisma.slot_master.update({ where: { id }, data: updateData });
  return NextResponse.json(slot);
}
