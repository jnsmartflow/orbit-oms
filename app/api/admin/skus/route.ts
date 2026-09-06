import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { checkAnyPermission } from "@/lib/permissions";

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
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Per-user tick, not a job title (2026-09-06). The role array only narrowed
  // ahead of a flag that already decided, so deleting it changes nobody: on this
  // key every role it named either holds the tick or was refused by the flag.
  // Both superuser arms live inside checkAnyPermission.
  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "skus", "canView");
  if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });

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
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Per-user tick, not a job title (2026-09-06). The role array only narrowed
  // ahead of a flag that already decided, so deleting it changes nobody: on this
  // key every role it named either holds the tick or was refused by the flag.
  // Both superuser arms live inside checkAnyPermission.
  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "skus", "canEdit");
  if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });

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
