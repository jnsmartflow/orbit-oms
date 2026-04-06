import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

interface ResolveRequest {
  skuCode: string;
  keyword?: {
    type: "product" | "base";
    keyword: string;
    category: string;
    mapsTo: string;
  };
}

export async function POST(
  req: Request,
  { params }: { params: { lineId: string } },
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const lineId = parseInt(params.lineId, 10);
  if (isNaN(lineId)) {
    return NextResponse.json({ error: "Invalid lineId" }, { status: 400 });
  }

  let body: ResolveRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.skuCode) {
    return NextResponse.json({ error: "skuCode is required" }, { status: 400 });
  }

  // Find the line with parent order
  const line = await prisma.mo_order_lines.findUnique({
    where: { id: lineId },
    include: { moOrder: true },
  });
  if (!line) {
    return NextResponse.json({ error: "Line not found" }, { status: 404 });
  }

  // Look up SKU
  const sku = await prisma.mo_sku_lookup.findUnique({
    where: { material: body.skuCode },
  });
  if (!sku) {
    return NextResponse.json({ error: "SKU not found" }, { status: 400 });
  }

  // Update the line
  await prisma.mo_order_lines.update({
    where: { id: lineId },
    data: {
      productName: sku.product,
      baseColour: sku.baseColour,
      skuCode: sku.material,
      skuDescription: sku.description,
      refSkuCode: sku.refMaterial || null,
      paintType: sku.paintType || null,
      materialType: sku.materialType || null,
      matchStatus: "matched",
    },
  });

  // Propagate to sibling lines with same rawText + packCode
  const siblings = await prisma.mo_order_lines.findMany({
    where: {
      moOrderId: line.moOrderId,
      id: { not: lineId },
      matchStatus: "unmatched",
      rawText: { equals: line.rawText, mode: "insensitive" },
      packCode: line.packCode,
    },
  });

  let propagated = 0;
  if (siblings.length > 0) {
    const siblingIds = siblings.map(s => s.id);
    await prisma.mo_order_lines.updateMany({
      where: { id: { in: siblingIds } },
      data: {
        skuCode: sku.material,
        skuDescription: sku.description,
        productName: sku.product,
        baseColour: sku.baseColour,
        refSkuCode: sku.refMaterial ?? null,
        paintType: sku.paintType ?? null,
        materialType: sku.materialType ?? null,
        matchStatus: "matched",
      },
    });
    propagated = siblings.length;
  }

  // Save keyword if provided
  if (body.keyword) {
    if (body.keyword.type === "product") {
      await prisma.mo_product_keywords.create({
        data: {
          keyword: body.keyword.keyword.toUpperCase(),
          category: body.keyword.category.toUpperCase(),
          product: body.keyword.mapsTo.toUpperCase(),
        },
      });
    } else {
      await prisma.mo_base_keywords.create({
        data: {
          keyword: body.keyword.keyword.toUpperCase(),
          category: body.keyword.category.toUpperCase(),
          baseColour: body.keyword.mapsTo.toUpperCase(),
        },
      });
    }
  }

  // Recount matched lines on parent order
  const matchedCount = await prisma.mo_order_lines.count({
    where: { moOrderId: line.moOrderId, matchStatus: "matched" },
  });
  const totalCount = await prisma.mo_order_lines.count({
    where: { moOrderId: line.moOrderId },
  });
  await prisma.mo_orders.update({
    where: { id: line.moOrderId },
    data: { matchedLines: matchedCount },
  });

  return NextResponse.json({
    success: true,
    propagated,
    matchedLines: matchedCount,
    totalLines: totalCount,
  });
}
