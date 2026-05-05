import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Public, unauthenticated endpoint serving customer + product data to the
// Sales Officer order form at /order. Whitelisted in middleware via the
// /api/order PUBLIC_PATHS prefix.
//
// Products come from mo_order_form_index — the curated catalog with
// pre-built searchTokens, family grouping, and tinterType classification.
// Pack sizes are still sourced from mo_sku_lookup, joined by subProduct
// = product.

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

    const indexRows = await prisma.mo_order_form_index.findMany({
      where:   { isActive: true },
      select: {
        family:       true,
        subProduct:   true,
        displayName:  true,
        searchTokens: true,
        tinterType:   true,
        sortOrder:    true,
      },
      orderBy: [{ family: "asc" }, { sortOrder: "asc" }],
    });

    const skuRows = await prisma.mo_sku_lookup.findMany({
      select: { product: true, packCode: true },
    });

    // ── Customers — dedupe by code (keep first occurrence) ─────────────
    const seenCodes = new Set<string>();
    const customers: { name: string; code: string }[] = [];
    for (const r of custRows) {
      if (!r.customerCode || seenCodes.has(r.customerCode)) continue;
      seenCodes.add(r.customerCode);
      customers.push({ name: r.customerName, code: r.customerCode });
    }

    // ── Pack map: subProduct → set of packCodes ────────────────────────
    // mo_sku_lookup.product matches mo_order_form_index.subProduct.
    const packMap = new Map<string, Set<string>>();
    for (const r of skuRows) {
      if (!r.product || !r.packCode) continue;
      let bucket = packMap.get(r.product);
      if (!bucket) {
        bucket = new Set();
        packMap.set(r.product, bucket);
      }
      bucket.add(String(r.packCode));
    }

    // ── Products — one row per index entry, packs joined in by subProduct
    const products = indexRows.map((row) => ({
      family:       row.family,
      subProduct:   row.subProduct,
      displayName:  row.displayName,
      searchTokens: row.searchTokens,
      tinterType:   row.tinterType ?? null,
      packs:        sortPacks(packMap.get(row.subProduct) ?? new Set()),
    }));

    return NextResponse.json({ customers, products });
  } catch (err) {
    console.error("[/api/order/data] error", err);
    return NextResponse.json({ customers: [], products: [] });
  }
}
