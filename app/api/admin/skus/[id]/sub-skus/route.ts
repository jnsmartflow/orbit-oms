import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const createSchema = z.object({
  subCode: z.string().min(1).max(100),
  description: z.string().max(500).optional().nullable(),
});

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN]);

  const skuId = parseInt(params.id, 10);
  if (isNaN(skuId)) return NextResponse.json({ error: "Invalid id." }, { status: 400 });

  const sku = await prisma.sku_master.findUnique({
    where: { id: skuId },
    select: { id: true, skuCode: true, skuName: true },
  });
  if (!sku) return NextResponse.json({ error: "SKU not found." }, { status: 404 });

  const subSkus = await prisma.sku_sub_master.findMany({
    where: { skuId },
    orderBy: { subCode: "asc" },
  });

  return NextResponse.json({ sku, subSkus });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN]);

  const skuId = parseInt(params.id, 10);
  if (isNaN(skuId)) return NextResponse.json({ error: "Invalid id." }, { status: 400 });

  const sku = await prisma.sku_master.findUnique({ where: { id: skuId } });
  if (!sku) return NextResponse.json({ error: "SKU not found." }, { status: 404 });

  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const subCode = parsed.data.subCode.trim().toUpperCase();

  const existing = await prisma.sku_sub_master.findUnique({ where: { subCode } });
  if (existing) {
    return NextResponse.json({ error: "Sub-code already exists." }, { status: 409 });
  }

  const subSku = await prisma.sku_sub_master.create({
    data: { skuId, subCode, description: parsed.data.description ?? null },
  });

  return NextResponse.json(subSku, { status: 201 });
}
