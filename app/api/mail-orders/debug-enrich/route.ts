import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  enrichLine,
  buildSkuMaps,
  buildProductProfiles,
  findAllBases,
  type ProductKeyword,
  type BaseKeyword,
  type SkuEntry,
} from "@/lib/mail-orders/enrich";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const text = req.nextUrl.searchParams.get("text") ?? "";
  const pack = req.nextUrl.searchParams.get("pack") ?? "1";

  if (!text.trim()) {
    return NextResponse.json({ error: "Missing ?text= param" }, { status: 400 });
  }

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

  const { byCombo: skuByCombo, byComboAlt: skuByComboAlt, byMaterial: skuByMaterial } = buildSkuMaps(skuEntries);
  const productProfiles = buildProductProfiles(skuEntries, productKeywords, baseKeywords);

  const result = enrichLine(
    text,
    pack,
    productKeywords,
    baseKeywords,
    skuByCombo,
    skuByMaterial,
    skuByComboAlt,
    productProfiles,
  );

  // Debug info
  const upperText = text.trim().toUpperCase();
  const matchedProductKws = productKeywords
    .filter((pk) => upperText.includes(pk.keyword))
    .map((pk) => ({ keyword: pk.keyword, product: pk.product, len: pk.keyword.length }));

  const detectedBases = findAllBases(upperText, baseKeywords);

  // Build profiles for ALL matched products
  const allProfiles: Record<string, { strategy: string; bases: string[]; packs: string[]; isBaseProduct: boolean }> = {};
  const seenProducts = new Set<string>();
  for (const pk of matchedProductKws) {
    if (seenProducts.has(pk.product)) continue;
    seenProducts.add(pk.product);
    const p = productProfiles.get(pk.product);
    if (p) {
      allProfiles[pk.product] = {
        strategy: p.strategy,
        bases: Array.from(p.bases),
        packs: Array.from(p.packs),
        isBaseProduct: p.isBaseProduct,
      };
    }
  }

  // Simulate candidate key lookups for each product
  let cleanPack = (pack ?? "").toUpperCase().replace(/\s+/g, "").replace(/(ML|LTR|LT|KG|LITT|G|L)$/i, "");
  if (!cleanPack) cleanPack = "1";
  const PACK_ROUND_DBG: Record<string, string> = { "0.925": "1", "0.9": "1", "3.6": "4", "9": "10", "18": "20" };
  if (PACK_ROUND_DBG[cleanPack]) cleanPack = PACK_ROUND_DBG[cleanPack];
  const PACK_EXPAND_DBG: Record<string, string[]> = { "1": ["2", "0.925", "0.9"], "2": ["1"], "4": ["3.6", "3.7"], "10": ["9", "9.25"], "20": ["18", "18.5"] };
  const dbgPacks = [cleanPack];
  const exps = PACK_EXPAND_DBG[cleanPack];
  if (exps) for (const a of exps) { if (!dbgPacks.includes(a)) dbgPacks.push(a); }

  const candidateKeys: { product: string; base: string; pack: string; key: string; found: boolean; material: string | null }[] = [];
  for (const prod of Array.from(seenProducts)) {
    const p = productProfiles.get(prod);
    if (!p) continue;
    for (const base of Array.from(p.bases)) {
      for (const pk of dbgPacks) {
        const key = `${prod}|${base}|${pk}`;
        const sku = skuByCombo.get(key);
        candidateKeys.push({ product: prod, base, pack: pk, key, found: !!sku, material: sku?.material ?? null });
      }
    }
  }

  return NextResponse.json({
    input: { text, pack, cleanPack, packsToTry: dbgPacks },
    result,
    debug: {
      matchedProductKeywords: matchedProductKws,
      detectedBases,
      allProductProfiles: allProfiles,
      candidateKeysChecked: candidateKeys.filter(c => c.found),
      candidateKeysMissed: candidateKeys.filter(c => !c.found).length,
      skuByComboSize: skuByCombo.size,
      skuByComboAltSize: skuByComboAlt.size,
      productProfilesCount: productProfiles.size,
    },
  });
}
