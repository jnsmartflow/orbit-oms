import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const dynamic = "force-dynamic";

const CONTAINER_TYPES = ["tin", "drum", "carton", "bag"] as const;

const createSchema = z.object({
  skuCode:           z.string().min(1).max(50),
  skuName:           z.string().min(1).max(200),
  packSize:          z.string().max(20).default(""),
  containerType:     z.enum(CONTAINER_TYPES),
  unitsPerCarton:    z.number().int().positive().optional().nullable(),
  productCategoryId: z.number().int().positive(),
  productNameId:     z.number().int().positive(),
  baseColourId:      z.number().int().positive(),
  isActive:          z.boolean().default(true),
});

const include = {
  productCategory: { select: { name: true } },
  productName:     { select: { name: true } },
  baseColour:      { select: { name: true } },
} as const;

export async function GET(req: Request) {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN]);

  const { searchParams } = new URL(req.url);
  const page    = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const limit   = 25;
  const search  = searchParams.get("search")?.trim() ?? "";
  const containerType  = searchParams.get("containerType")?.trim() ?? "";
  const categoryIdParam = searchParams.get("categoryId");
  const categoryId = categoryIdParam ? parseInt(categoryIdParam, 10) : undefined;
  const isActiveParam = searchParams.get("isActive");
  const isActive =
    isActiveParam === "true" ? true : isActiveParam === "false" ? false : undefined;

  const where = {
    ...(search && {
      OR: [
        { skuCode: { contains: search, mode: "insensitive" as const } },
        { skuName: { contains: search, mode: "insensitive" as const } },
      ],
    }),
    ...(containerType && { containerType }),
    ...(categoryId  && { productCategoryId: categoryId }),
    ...(isActive !== undefined && { isActive }),
  };

  const [skus, total] = await prisma.$transaction([
    prisma.sku_master.findMany({
      where,
      skip:    (page - 1) * limit,
      take:    limit,
      orderBy: { skuCode: "asc" },
      include,
    }),
    prisma.sku_master.count({ where }),
  ]);

  return NextResponse.json({ data: skus, total, page, totalPages: Math.ceil(total / limit) });
}

export async function POST(req: Request) {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN]);

  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const skuCode = parsed.data.skuCode.trim().toUpperCase();

  const existing = await prisma.sku_master.findUnique({ where: { skuCode } });
  if (existing) {
    return NextResponse.json({ error: "SKU code already exists." }, { status: 409 });
  }

  const sku = await prisma.sku_master.create({
    data: { ...parsed.data, skuCode },
    include,
  });
  return NextResponse.json(sku, { status: 201 });
}
