import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const VALID_CONTAINER_TYPES = new Set(["tin", "drum", "carton", "bag"]);

export async function POST(req: Request) {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN]);

  const body = await req.json() as { rows: Record<string, string>[] };
  const rows = body.rows ?? [];

  if (rows.length === 0) {
    return NextResponse.json({ imported: 0, skipped: 0, failed: 0, errors: [] });
  }

  const [categories, productNames, baseColours] = await Promise.all([
    prisma.product_category.findMany({ select: { id: true, name: true } }),
    prisma.product_name.findMany({ select: { id: true, name: true } }),
    prisma.base_colour.findMany({ select: { id: true, name: true } }),
  ]);
  const catMap    = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));
  const nameMap   = new Map(productNames.map((n) => [n.name.toLowerCase(), n.id]));
  const colourMap = new Map(baseColours.map((b) => [b.name.toLowerCase(), b.id]));

  const errors: { row: number; reason: string }[] = [];
  const data: {
    skuCode:           string;
    skuName:           string;
    productCategoryId: number;
    productNameId:     number;
    baseColourId:      number;
    packSize:          string;
    containerType:     string;
    unitsPerCarton:    number | null;
    isActive:          boolean;
  }[] = [];

  rows.forEach((r, i) => {
    const skuCode       = r.skucode?.trim().toUpperCase() ?? "";
    const skuName       = r.skuname?.trim() ?? "";
    const category      = r.category?.trim() ?? "";
    const productName   = r.productname?.trim() ?? "";
    const baseColour    = r.basecolour?.trim() ?? "";
    const packSize      = r.packsize?.trim() ?? "";
    const containerType = r.containertype?.trim().toLowerCase() ?? "tin";
    const unitsRaw      = r.unitspercarton?.trim() ?? "";

    if (!skuCode)    { errors.push({ row: i + 2, reason: "skuCode is required." }); return; }
    if (!skuName)    { errors.push({ row: i + 2, reason: "skuName is required." }); return; }
    if (!packSize)   { errors.push({ row: i + 2, reason: "packSize is required." }); return; }
    if (containerType && !VALID_CONTAINER_TYPES.has(containerType)) {
      errors.push({ row: i + 2, reason: `Invalid containerType "${containerType}".` }); return;
    }

    const productCategoryId = catMap.get(category.toLowerCase());
    const productNameId     = nameMap.get(productName.toLowerCase());
    const baseColourId      = colourMap.get(baseColour.toLowerCase());

    if (!productCategoryId) { errors.push({ row: i + 2, reason: `Category "${category}" not found.` }); return; }
    if (!productNameId)     { errors.push({ row: i + 2, reason: `Product name "${productName}" not found.` }); return; }
    if (!baseColourId)      { errors.push({ row: i + 2, reason: `Base colour "${baseColour}" not found.` }); return; }

    const unitsPerCarton = unitsRaw ? parseInt(unitsRaw, 10) : null;

    data.push({
      skuCode,
      skuName,
      productCategoryId,
      productNameId,
      baseColourId,
      packSize,
      containerType: containerType || "tin",
      unitsPerCarton,
      isActive: true,
    });
  });

  const result = await prisma.sku_master.createMany({
    data,
    skipDuplicates: true,
  });

  const imported = result.count;
  const skipped  = data.length - imported;

  return NextResponse.json({ imported, skipped, failed: errors.length, errors });
}
