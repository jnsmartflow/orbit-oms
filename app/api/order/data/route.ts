import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Public, unauthenticated endpoint serving customer + product data to the
// Sales Officer order form at /order. Whitelisted in middleware via the
// /api/order PUBLIC_PATHS prefix.
//
// Products come from mo_order_form_index — the curated catalog with
// pre-built searchTokens, family grouping, and tinterType classification.
// Pack sizes are still sourced from mo_sku_lookup. Index rows can be
// either base products (baseColour = null) or colour variants
// (baseColour set, e.g. "GOLDEN BROWN") — pack lookup uses a composite
// (product, baseColour) key for variants and a product-only key for the
// base rows.

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
        baseColour:   true,
        displayName:  true,
        searchTokens: true,
        tinterType:   true,
        productType:  true,
        sortOrder:    true,
      },
      orderBy: [{ family: "asc" }, { sortOrder: "asc" }],
    });

    const skuRows = await prisma.mo_sku_lookup.findMany({
      select: { product: true, baseColour: true, packCode: true },
    });

    // ── Customers — dedupe by code (keep first occurrence) ─────────────
    const seenCodes = new Set<string>();
    const customers: { name: string; code: string }[] = [];
    for (const r of custRows) {
      if (!r.customerCode || seenCodes.has(r.customerCode)) continue;
      seenCodes.add(r.customerCode);
      customers.push({ name: r.customerName, code: r.customerCode });
    }

    // ── Pack map: dual-keyed for base products + colour variants ──────
    // - Key A = product           — used by index rows with baseColour=null
    //                               (collects every pack across all colours)
    // - Key B = product|||colour  — used by index rows with a baseColour
    //                               (specific packs for that colour variant)
    const packMap = new Map<string, Set<string>>();
    const addToPackMap = (key: string, pack: string): void => {
      let bucket = packMap.get(key);
      if (!bucket) {
        bucket = new Set();
        packMap.set(key, bucket);
      }
      bucket.add(pack);
    };
    for (const r of skuRows) {
      if (!r.product || !r.packCode) continue;
      const pack = String(r.packCode);
      addToPackMap(r.product, pack);
      if (r.baseColour) {
        addToPackMap(`${r.product}|||${r.baseColour}`, pack);
      }
    }

    // ── basePacks map: subProduct → { baseColour: sortedPacks[] } ──────
    // Powers the BASE chip flow on the form: when a BASE product is
    // picked, the UI shows a chip per base; tapping a chip reveals only
    // the packs available for that base. Built from mo_sku_lookup rows
    // with a non-null baseColour.
    const basePacksMap = new Map<string, Map<string, Set<string>>>();
    for (const r of skuRows) {
      if (!r.product || !r.packCode || !r.baseColour) continue;
      let inner = basePacksMap.get(r.product);
      if (!inner) {
        inner = new Map();
        basePacksMap.set(r.product, inner);
      }
      let bucket = inner.get(r.baseColour);
      if (!bucket) {
        bucket = new Set();
        inner.set(r.baseColour, bucket);
      }
      bucket.add(String(r.packCode));
    }

    const basePacksFor = (subProduct: string): Record<string, string[]> | null => {
      const inner = basePacksMap.get(subProduct);
      if (!inner) return null;
      const out: Record<string, string[]> = {};
      for (const [base, packs] of Array.from(inner.entries())) {
        out[base] = sortPacks(packs);
      }
      return out;
    };

    // ── Products — one row per index entry. Pack key depends on whether
    //    the row is a base product or a colour variant. BASE rows
    //    (productType='BASE', baseColour=null) also carry a basePacks map.
    const products = indexRows.map((row) => {
      const packKey = row.baseColour
        ? `${row.subProduct}|||${row.baseColour}`
        : row.subProduct;
      const productType = (row.productType ?? "PLAIN") as "BASE" | "COLOUR" | "PLAIN";
      const basePacks   = (productType === "BASE" && !row.baseColour)
        ? basePacksFor(row.subProduct)
        : null;
      return {
        family:       row.family,
        subProduct:   row.subProduct,
        baseColour:   row.baseColour ?? null,
        displayName:  row.displayName,
        searchTokens: row.searchTokens,
        tinterType:   row.tinterType ?? null,
        productType,
        packs:        sortPacks(packMap.get(packKey) ?? new Set()),
        basePacks,
      };
    });

    return NextResponse.json({ customers, products });
  } catch (err) {
    console.error("[/api/order/data] error", err);
    return NextResponse.json({ customers: [], products: [] });
  }
}
