import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  enrichLine,
  buildSkuMaps,
  buildProductProfiles,
  buildKeywordRegexes,
  type ProductKeyword,
  type BaseKeyword,
  type SkuEntry,
} from "@/lib/mail-orders/enrich";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const text = req.nextUrl.searchParams.get("text") ?? "";
  const pack = req.nextUrl.searchParams.get("pack") ?? "1";

  if (!text.trim()) {
    return NextResponse.json({ error: "Missing ?text= parameter" }, { status: 400 });
  }

  // Load keyword + SKU data
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
    piecesPerCarton: r.piecesPerCarton ?? null,
  }));

  const { byCombo: skuByCombo, byComboAlt: skuByComboAlt, byMaterial: skuByMaterial } = buildSkuMaps(skuEntries);
  const productProfiles = buildProductProfiles(skuEntries, productKeywords, baseKeywords);
  const { prodRegexMap, baseRegexMap } = buildKeywordRegexes(productKeywords, baseKeywords);

  const result = enrichLine(
    text,
    pack,
    productKeywords,
    baseKeywords,
    skuByCombo,
    skuByMaterial,
    skuByComboAlt,
    productProfiles,
    prodRegexMap,
    baseRegexMap,
  );

  return NextResponse.json({
    input: { text, pack },
    result,
  });
}
