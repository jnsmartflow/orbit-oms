import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Public, unauthenticated endpoint serving customer + SKU data to the
// Sales Officer order form at /order. Whitelisted in middleware via the
// /api/order PUBLIC_PATHS prefix.

export const dynamic = "force-dynamic";

// Canonical pack-size order, smallest to largest. Anything not listed
// sorts to the end alphabetically.
const PACK_ORDER: ReadonlyArray<string> = [
  "200ML", "500ML", "0.9L", "0.925L", "1L", "3.6L", "3.7L", "4L", "9L", "9.25L",
  "10L",   "15L",   "18L",  "18.5L",  "20L", "22L",  "30L",  "40L",
  "1KG",   "5KG",   "10KG", "20KG",   "25KG", "40KG",
];
const PACK_INDEX = new Map(PACK_ORDER.map((p, i) => [p, i] as const));

export async function GET(): Promise<NextResponse> {
  try {
    const custRows = await prisma.mo_customer_keywords.findMany({
      select:  { customerCode: true, customerName: true },
      orderBy: { customerName: "asc" },
    });

    const skuRows = await prisma.mo_sku_lookup.findMany({
      select:  { description: true, packCode: true },
      orderBy: { description: "asc" },
    });

    // Customers — dedupe by code (keep first occurrence per the alphabetical
    // customerName order so the kept name is alphabetically earliest).
    const seenCodes = new Set<string>();
    const customers: { name: string; code: string }[] = [];
    for (const r of custRows) {
      if (!r.customerCode || seenCodes.has(r.customerCode)) continue;
      seenCodes.add(r.customerCode);
      customers.push({ name: r.customerName, code: r.customerCode });
    }

    // SKUs — group by description, dedupe packs per description.
    const skuMap = new Map<string, Set<string>>();
    for (const r of skuRows) {
      if (!r.description || !r.packCode) continue;
      let bucket = skuMap.get(r.description);
      if (!bucket) {
        bucket = new Set();
        skuMap.set(r.description, bucket);
      }
      bucket.add(r.packCode);
    }

    const skus: { name: string; packs: string[] }[] = [];
    for (const [name, packSet] of Array.from(skuMap.entries())) {
      const packs = Array.from(packSet).sort((a, b) => {
        const ia = PACK_INDEX.has(a) ? PACK_INDEX.get(a)! : Number.MAX_SAFE_INTEGER;
        const ib = PACK_INDEX.has(b) ? PACK_INDEX.get(b)! : Number.MAX_SAFE_INTEGER;
        if (ia !== ib) return ia - ib;
        // Both unknown → alphabetical fallback.
        return a.localeCompare(b);
      });
      skus.push({ name, packs });
    }

    return NextResponse.json({ customers, skus });
  } catch (err) {
    console.error("[/api/order/data] error", err);
    return NextResponse.json({ customers: [], skus: [] });
  }
}
