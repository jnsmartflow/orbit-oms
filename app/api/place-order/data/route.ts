import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Endpoint serving customer + product data to the desktop Place Order page
// at /place-order. The live endpoint /api/order/data continues to serve the
// mobile /order page unchanged.
//
// Auth: requires authenticated session (no middleware whitelist needed). The
// only caller is the authenticated /place-order page; middleware passes the
// request through with a valid session cookie. /api/order/data is public
// because /order is public; this endpoint does not need to be.
//
// Data sources (parallel v2 stack):
//   - Catalog rows: mo_order_form_index_v2 — parallel v2 catalog under the
//     May 6 33-family taxonomy redesign. Live mo_order_form_index drives
//     /order (mobile).
//   - Pack/SKU rows: mo_sku_lookup_v2 — parallel v2 SKU table with clean
//     names matching mo_order_form_index_v2.subProduct. Live mo_sku_lookup
//     continues to serve /api/order/data, the parser, and enrichment
//     unchanged.
//
// After /place-order is approved on v2, /order will switch to v2 too and
// the legacy tables can be dropped.
// See: docs/prompts/drafts/session-end-2026-05-10-recovery-and-branch-hygiene.md
//
// Each v2 index row is one searchable entry; numbered-base variants (e.g.
// "WS Max — 92") and colour variants (e.g. "Gloss — Golden Brown") are
// flat rows with their own baseColour and searchTokens. Pack sizes joined
// in from mo_sku_lookup_v2 via a (product, baseColour) composite key (or
// product-only when the row's baseColour is null).
//
// Empty-pack-panel placeholder still fires for any (family, subProduct)
// with no joining SKUs in v2 — handled by the variant grid in
// app/(place-order)/place-order/components/expanded-panel.tsx.

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

    const indexRows = await prisma.mo_order_form_index_v2.findMany({
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

    const skuRows = await prisma.mo_sku_lookup_v2.findMany({
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

    // ── Products — one row per index entry. Pack key uses the composite
    //    (product, baseColour) when baseColour is set, else product alone.
    const products = indexRows.map((row) => {
      const packKey = row.baseColour
        ? `${row.subProduct}|||${row.baseColour}`
        : row.subProduct;
      return {
        family:       row.family,
        subProduct:   row.subProduct,
        baseColour:   row.baseColour ?? null,
        displayName:  row.displayName,
        searchTokens: row.searchTokens,
        tinterType:   row.tinterType ?? null,
        productType:  row.productType ?? "PLAIN",
        packs:        sortPacks(packMap.get(packKey) ?? new Set()),
      };
    });

    return NextResponse.json({ customers, products });
  } catch (err) {
    console.error("[/api/place-order/data] error", err);
    return NextResponse.json({ customers: [], products: [] });
  }
}
