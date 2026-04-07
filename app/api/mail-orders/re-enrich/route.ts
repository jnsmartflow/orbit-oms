import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  enrichLine,
  buildSkuMaps,
  buildProductProfiles,
  type ProductKeyword,
  type BaseKeyword,
  type SkuEntry,
} from "@/lib/mail-orders/enrich";

export const dynamic = "force-dynamic";

export async function POST(): Promise<NextResponse> {
  // 1. Load keyword + SKU data
  const [productKeywordsRaw, baseKeywordsRaw, skuEntriesRaw] = await Promise.all([
    prisma.mo_product_keywords.findMany(),
    prisma.mo_base_keywords.findMany(),
    prisma.mo_sku_lookup.findMany(),
  ]);

  const productKeywords: ProductKeyword[] = productKeywordsRaw
    .map((r) => ({ keyword: r.keyword, category: r.category, product: r.product }))
    .sort((a, b) => b.keyword.length - a.keyword.length);

  const baseKeywords: BaseKeyword[] = baseKeywordsRaw
    .map((r) => ({ keyword: r.keyword, category: r.category, baseColour: r.baseColour }))
    .sort((a, b) => b.keyword.length - a.keyword.length);

  const skuEntries: SkuEntry[] = skuEntriesRaw.map((r) => ({
    material: r.material,
    description: r.description,
    category: r.category,
    product: r.product,
    baseColour: r.baseColour,
    packCode: r.packCode,
    unit: r.unit,
    refMaterial: r.refMaterial,
    paintType: r.paintType,
    materialType: r.materialType,
  }));

  // 2. Build maps + profiles
  const { byCombo: skuByCombo, byComboAlt: skuByComboAlt, byMaterial: skuByMaterial } = buildSkuMaps(skuEntries);
  const productProfiles = buildProductProfiles(skuEntries, productKeywords, baseKeywords);

  // 3. Fetch lines from last 2 days with their order receivedAt
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

  const lines = await prisma.mo_order_lines.findMany({
    where: {
      moOrder: {
        receivedAt: { gte: twoDaysAgo },
      },
    },
    select: {
      id: true,
      moOrderId: true,
      rawText: true,
      packCode: true,
      productName: true,
      baseColour: true,
      skuCode: true,
      skuDescription: true,
      refSkuCode: true,
      paintType: true,
      materialType: true,
      matchStatus: true,
    },
  });

  // 4. Re-enrich each line
  let updated = 0;
  let unchanged = 0;
  const affectedOrderIds = new Set<number>();

  for (const line of lines) {
    const result = enrichLine(
      line.rawText,
      line.packCode ?? "",
      productKeywords,
      baseKeywords,
      skuByCombo,
      skuByMaterial,
      skuByComboAlt,
      productProfiles,
    );

    // Check if anything changed
    const changed =
      result.productName !== (line.productName ?? "") ||
      result.baseColour !== (line.baseColour ?? "") ||
      result.skuCode !== (line.skuCode ?? "") ||
      result.skuDescription !== (line.skuDescription ?? "") ||
      result.refSkuCode !== (line.refSkuCode ?? "") ||
      result.paintType !== (line.paintType ?? "") ||
      result.materialType !== (line.materialType ?? "") ||
      result.matchStatus !== line.matchStatus ||
      result.packCode !== (line.packCode ?? "");

    if (changed) {
      await prisma.mo_order_lines.update({
        where: { id: line.id },
        data: {
          productName: result.productName || null,
          baseColour: result.baseColour || null,
          skuCode: result.skuCode || null,
          skuDescription: result.skuDescription || null,
          refSkuCode: result.refSkuCode || null,
          paintType: result.paintType || null,
          materialType: result.materialType || null,
          matchStatus: result.matchStatus,
          packCode: result.packCode || line.packCode || null,
        },
      });
      updated++;
      affectedOrderIds.add(line.moOrderId);
    } else {
      unchanged++;
    }
  }

  // 5. Recalculate matchedLines on affected orders
  for (const orderId of Array.from(affectedOrderIds)) {
    const orderLines = await prisma.mo_order_lines.findMany({
      where: { moOrderId: orderId },
      select: { matchStatus: true },
    });
    const matchedLines = orderLines.filter((l) => l.matchStatus === "matched").length;
    await prisma.mo_orders.update({
      where: { id: orderId },
      data: {
        matchedLines,
        totalLines: orderLines.length,
      },
    });
  }

  return NextResponse.json({
    total: lines.length,
    updated,
    unchanged,
    ordersRecalculated: affectedOrderIds.size,
  });
}
