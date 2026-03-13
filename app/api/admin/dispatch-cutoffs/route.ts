import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN]);
  const slots = await prisma.dispatch_cutoff_master.findMany({
    orderBy: [{ deliveryTypeId: "asc" }, { slotNumber: "asc" }],
    include: { deliveryType: true },
  });
  return NextResponse.json(slots);
}

const postSchema = z.object({
  deliveryTypeId: z.number().int().positive(),
  slotNumber: z.number().int().positive(),
  label: z.string().min(1),
  cutoffTime: z.string().regex(/^\d{2}:\d{2}$/, "Must be HH:MM format"),
  isDefaultForType: z.boolean().default(false),
});

export async function POST(req: Request) {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN]);
  const body = await req.json();
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0].message }, { status: 400 });
  }
  const existing = await prisma.dispatch_cutoff_master.findUnique({
    where: { deliveryTypeId_slotNumber: { deliveryTypeId: parsed.data.deliveryTypeId, slotNumber: parsed.data.slotNumber } },
  });
  if (existing) {
    return NextResponse.json({ error: `Slot ${parsed.data.slotNumber} already exists for this delivery type.` }, { status: 409 });
  }
  const slot = await prisma.dispatch_cutoff_master.create({ data: parsed.data, include: { deliveryType: true } });
  return NextResponse.json(slot, { status: 201 });
}
