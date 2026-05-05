import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Public, unauthenticated endpoint serving customer + SKU data to the
// Sales Officer order form at /order. Whitelisted in middleware via the
// /api/order PUBLIC_PATHS prefix.

export const dynamic = "force-dynamic";

// Canonical pack-size order, smallest to largest. packCode values in
// mo_sku_lookup are bare numeric strings ("1", "4", "10", "20", "0.9"…)
// without unit suffix. Anything outside this list sorts to the end
// alphabetically.
const PACK_ORDER: ReadonlyArray<string> = [
  "0.2", "0.5", "0.9", "0.925", "0.975", "1", "2", "3", "3.6", "3.7",
  "4",   "5",   "9",   "9.25",  "10",    "15", "18", "18.5", "20", "22",
  "25",  "30",  "40",  "100",   "200",   "400", "500",
];
const PACK_INDEX = new Map(PACK_ORDER.map((p, i) => [p, i] as const));

function sortPacks(packs: Set<string>): string[] {
  return Array.from(packs).sort((a, b) => {
    const ai = PACK_INDEX.has(a) ? PACK_INDEX.get(a)! : Number.MAX_SAFE_INTEGER;
    const bi = PACK_INDEX.has(b) ? PACK_INDEX.get(b)! : Number.MAX_SAFE_INTEGER;
    if (ai !== bi) return ai - bi;
    return a.localeCompare(b);
  });
}

export async function GET(): Promise<NextResponse> {
  try {
    // Sequential awaits — no prisma.$transaction (CLAUDE_CORE.md §3).
    const custRows = await prisma.mo_customer_keywords.findMany({
      select:  { customerCode: true, customerName: true },
      orderBy: { customerName: "asc" },
    });

    const skuRows = await prisma.mo_sku_lookup.findMany({
      select:  { product: true, baseColour: true, packCode: true },
      orderBy: [{ product: "asc" }, { baseColour: "asc" }],
    });

    const productKwRows = await prisma.mo_product_keywords.findMany({
      select: { keyword: true, product: true },
    });

    const baseKwRows = await prisma.mo_base_keywords.findMany({
      select: { keyword: true, baseColour: true },
    });

    // ── Customers — dedupe by code (keep first occurrence) ─────────────
    const seenCodes = new Set<string>();
    const customers: { name: string; code: string }[] = [];
    for (const r of custRows) {
      if (!r.customerCode || seenCodes.has(r.customerCode)) continue;
      seenCodes.add(r.customerCode);
      customers.push({ name: r.customerName, code: r.customerCode });
    }

    // ── Keyword maps ───────────────────────────────────────────────────
    const productKwMap = new Map<string, Set<string>>();
    for (const row of productKwRows) {
      if (!row.product || !row.keyword) continue;
      let bucket = productKwMap.get(row.product);
      if (!bucket) {
        bucket = new Set();
        productKwMap.set(row.product, bucket);
      }
      bucket.add(row.keyword.toLowerCase());
    }

    const baseKwMap = new Map<string, Set<string>>();
    for (const row of baseKwRows) {
      if (!row.baseColour || !row.keyword) continue;
      let bucket = baseKwMap.get(row.baseColour);
      if (!bucket) {
        bucket = new Set();
        baseKwMap.set(row.baseColour, bucket);
      }
      bucket.add(row.keyword.toLowerCase());
    }

    // ── Group SKUs by (product, baseColour) ────────────────────────────
    // packCode in mo_sku_lookup is the unit (e.g. "1", "4", "10") —
    // grouping by description was wrong because the description string
    // contains the pack size, splitting one product into many entries.
    type SkuBucket = { product: string; baseColour: string; packs: Set<string> };
    const skuMap = new Map<string, SkuBucket>();

    for (const r of skuRows) {
      if (!r.product || !r.baseColour) continue;
      const key = `${r.product}|||${r.baseColour}`;
      let bucket = skuMap.get(key);
      if (!bucket) {
        bucket = { product: r.product, baseColour: r.baseColour, packs: new Set() };
        skuMap.set(key, bucket);
      }
      if (r.packCode) bucket.packs.add(r.packCode);
    }

    // ── Build output with combined keyword array ───────────────────────
    const skus = Array.from(skuMap.values()).map(({ product, baseColour, packs }) => {
      const productKws = Array.from(productKwMap.get(product)    ?? []);
      const baseKws    = Array.from(baseKwMap.get(baseColour)    ?? []);
      const keywords   = Array.from(new Set([
        ...productKws,
        ...baseKws,
        product.toLowerCase(),
        baseColour.toLowerCase(),
      ]));

      return {
        name:       `${product} — ${baseColour}`,
        product,
        baseColour,
        keywords,
        packs:      sortPacks(packs),
      };
    });

    return NextResponse.json({ customers, skus });
  } catch (err) {
    console.error("[/api/order/data] error", err);
    return NextResponse.json({ customers: [], skus: [] });
  }
}
