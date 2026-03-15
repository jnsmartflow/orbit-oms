import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name:          z.string().min(1).max(150).optional(),
  contactPerson: z.string().max(150).optional().nullable(),
  phone:         z.string().max(20).optional().nullable(),
  email:         z.string().email("Invalid email format.").max(150).optional().nullable().or(z.literal("")),
  isActive:      z.boolean().optional(),
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

  const existing = await prisma.transporter_master.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Transporter not found." }, { status: 404 });

  // Prevent deactivation if active vehicles are assigned
  if (parsed.data.isActive === false && existing.isActive) {
    const activeVehicleCount = await prisma.vehicle_master.count({
      where: { transporterId: id, isActive: true },
    });
    if (activeVehicleCount > 0) {
      return NextResponse.json(
        {
          error: `${activeVehicleCount} active vehicle${activeVehicleCount === 1 ? "" : "s"} assigned. Reassign or deactivate vehicles first.`,
        },
        { status: 422 }
      );
    }
  }

  if (parsed.data.name && parsed.data.name !== existing.name) {
    const duplicate = await prisma.transporter_master.findUnique({
      where: { name: parsed.data.name },
    });
    if (duplicate) {
      return NextResponse.json({ error: "A transporter with this name already exists." }, { status: 409 });
    }
  }

  const row = await prisma.transporter_master.update({
    where:   { id },
    data:    { ...parsed.data, email: parsed.data.email === "" ? null : parsed.data.email },
    include: { _count: { select: { vehicles: true } } },
  });
  return NextResponse.json(row);
}
