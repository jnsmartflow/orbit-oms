import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { RawPack } from "@/lib/place-order/pack-buckets";
import { packToMl, formatPack } from "@/lib/place-order/pack";

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

// Sort RawPacks by ML magnitude with KG anchored last (per packToMl
// rule — KG packs return 0, sorting them before everything; this
// comparator flips them to the end explicitly).
function sortRawPacks(packs: RawPack[]): RawPack[] {
  return [...packs].sort((a, b) => {
    const aKg = (a.unit ?? "").toUpperCase() === "KG";
    const bKg = (b.unit ?? "").toUpperCase() === "KG";
    if (aKg !== bKg) return aKg ? 1 : -1;
    return packToMl(a.packCode, a.unit) - packToMl(b.packCode, b.unit);
  });
}

export async function GET(): Promise<NextResponse> {
  try {
    // Sequential awaits — no prisma.$transaction (CLAUDE_CORE.md §3).
    const custRows = await prisma.mo_customer_keywords.findMany({
      // Phase 3.6 (2026-05-13): also select `area` so the customer-
      // search dropdown can render "CODE · AREA" and operators can
      // distinguish similarly-named customers by locality. Dedupe
      // below carries first non-null area per customerCode.
      select:  { customerCode: true, customerName: true, area: true },
      orderBy: { customerName: "asc" },
    });

    const indexRows = await prisma.mo_order_form_index_v2.findMany({
      where:   { isActive: true },
      select: {
        // Phase 3 cart-line identity (2026-05-13). The frontend uses
        // id as the cart dedup key so multiple rows sharing
        // (subProduct, baseColour) but differing in `product` don't
        // collide in setQty/qtyAt.
        id:           true,
        family:       true,
        section:      true,
        subgroup:     true,
        subProduct:   true,
        // Phase 3 taxonomy cutover. product + uiGroup are nullable for
        // unmigrated families — consumers fall back to subProduct via
        // `?? subProduct`.
        product:      true,
        uiGroup:      true,
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
      // Phase 3.5 (2026-05-13): also select `unit` so KG packs reach
      // the frontend and the bucket helper can place them correctly
      // (5 KG → 4L bucket, 25 KG → its own column).
      select: { product: true, baseColour: true, packCode: true, unit: true },
    });

    // ── Customers — dedupe by code (keep first occurrence) ─────────────
    // Phase 3.6 (2026-05-13): also carry the first non-null `area`
    // per customerCode. If the first keyword row had area=null but a
    // later row for the same customer has area set, surface that
    // later value instead of silently dropping it. JS Map preserves
    // insertion order, so the orderBy customerName ASC ordering is
    // preserved in the output array.
    const byCode = new Map<string, { name: string; code: string; area: string | null }>();
    for (const r of custRows) {
      if (!r.customerCode) continue;
      const existing = byCode.get(r.customerCode);
      if (!existing) {
        byCode.set(r.customerCode, {
          name: r.customerName,
          code: r.customerCode,
          area: r.area ?? null,
        });
      } else if (existing.area === null && r.area) {
        existing.area = r.area;
      }
    }
    const customers = Array.from(byCode.values());

    // ── Pack map: dual-keyed for base products + colour variants ──────
    // - Key A = product           — used by index rows with baseColour=null
    //                               (collects every pack across all colours)
    // - Key B = product|||colour  — used by index rows with a baseColour
    //                               (specific packs for that colour variant)
    //
    // Phase 3.5 (2026-05-13): values carry (packCode, unit) so KG vs L
    // distinction survives the join.
    // 2026-06-03: dedup on the RENDERED display size (formatPack) instead of
    // the raw (packCode, unit). A litre pack stored as both "L" and "LT", or a
    // fractional/junk packCode, used to render the same size as two columns;
    // keying on formatPack collapses them while still keeping KG vs L distinct
    // (e.g. "1L" vs "1KG" render differently → both survive).
    const packMap = new Map<string, RawPack[]>();
    const seenComposite = new Set<string>();
    const addToPackMap = (key: string, pack: RawPack): void => {
      const dedup = `${key}|||${formatPack(pack.packCode, pack.unit)}`;
      if (seenComposite.has(dedup)) return;
      seenComposite.add(dedup);
      let bucket = packMap.get(key);
      if (!bucket) {
        bucket = [];
        packMap.set(key, bucket);
      }
      bucket.push(pack);
    };
    for (const r of skuRows) {
      if (!r.product || !r.packCode) continue;
      const pack: RawPack = { packCode: String(r.packCode), unit: r.unit ?? null };
      addToPackMap(r.product, pack);
      if (r.baseColour) {
        addToPackMap(`${r.product}|||${r.baseColour}`, pack);
      }
    }

    // ── Products — one row per index entry. Pack-join key uses
    //    (row.product ?? row.subProduct) so filled families (GLOSS,
    //    PRIMER, AQUATECH, WS, STAINER, SATIN — 2026-05-13 Phase 1)
    //    match against the real product names now stored in
    //    mo_sku_lookup_v2.product. Unmigrated families still match
    //    via subProduct. baseColour composite key unchanged.
    const products = indexRows.map((row) => {
      const joinName = row.product ?? row.subProduct;
      const packKey = row.baseColour
        ? `${joinName}|||${row.baseColour}`
        : joinName;
      return {
        id:           row.id,
        family:       row.family,
        section:      row.section,
        subgroup:     row.subgroup,
        subProduct:   row.subProduct,
        product:      row.product ?? null,
        uiGroup:      row.uiGroup ?? null,
        baseColour:   row.baseColour ?? null,
        displayName:  row.displayName,
        searchTokens: row.searchTokens,
        tinterType:   row.tinterType ?? null,
        productType:  row.productType ?? "PLAIN",
        packs:        sortRawPacks(packMap.get(packKey) ?? []),
      };
    });

    return NextResponse.json({ customers, products });
  } catch (err) {
    console.error("[/api/place-order/data] error", err);
    return NextResponse.json({ customers: [], products: [] });
  }
}
