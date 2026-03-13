import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const dynamic = 'force-dynamic';

const CONTAINER_TYPES = ["tin", "drum", "carton", "bag"] as const;

const patchSchema = z.object({
  skuCode: z.string().min(1).max(50).optional(),
  skuName: z.string().min(1).max(200).optional(),
  packSize: z.string().max(20).optional(),
  containerType: z.enum(CONTAINER_TYPES).optional(),
  unitsPerCarton: z.number().int().positive().optional().nullable(),
  grossWeightPerUnit: z.number().positive().optional(),
  isActive: z.boolean().optional(),
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

  const { skuCode, ...rest } = parsed.data;

  if (skuCode) {
    const upperCode = skuCode.trim().toUpperCase();
    const conflict = await prisma.sku_master.findFirst({
      where: { skuCode: upperCode, NOT: { id } },
    });
    if (conflict) return NextResponse.json({ error: "SKU code already exists." }, { status: 409 });
  }

  const sku = await prisma.sku_master.update({
    where: { id },
    data: {
      ...(skuCode && { skuCode: skuCode.trim().toUpperCase() }),
      ...rest,
    },
  });

  return NextResponse.json(sku);
}
