import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
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
  return NextResponse.json(slot, { status: 201 });
}
