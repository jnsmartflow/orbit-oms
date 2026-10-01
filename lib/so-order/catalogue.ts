import { prisma } from "@/lib/prisma";
import type { RawPack } from "@/lib/place-order/pack-buckets";
import { packToMl, formatPack } from "@/lib/place-order/pack";

// The /so-lab catalogue payload (C.2a, 2026-10-01) — { customers, products },
// the SAME shape /api/order/data returns, so the forked board reads it unchanged.
//
// ⚠ A THIRD COPY of the payload builder. /api/order/data and
// /api/place-order/data are already duplicates (CLAUDE_PLACE_ORDER.md §16);
// /api/order/data may not be touched by this build, so its query and mapping
// are reproduced here, not imported. Consolidate when /po retires.
//
// 🔴 TWO DIFFERENCES FROM /api/order/data, ON PURPOSE:
//   • it THROWS on any error and on an empty catalogue — never 200-with-empty —
//     so the route answers 503 and the cache never stores an empty payload
//     (the CLAUDE_PO2.md §13.6 landmine);
//   • it is only ever called behind requireSoApi() and unstable_cache.
// Sequential awaits — never prisma.$transaction (CORE §3).

export type SoCatalogue = {
  customers: { name: string; code: string; area: string | null }[];
  products: unknown[];
};

// Same comparator as /api/order/data (KG last, then ML ascending).
function sortRawPacks(packs: RawPack[]): RawPack[] {
  return [...packs].sort((a, b) => {
    const aKg = (a.unit ?? "").toUpperCase() === "KG";
    const bKg = (b.unit ?? "").toUpperCase() === "KG";
    if (aKg !== bKg) return aKg ? 1 : -1;
    return packToMl(a.packCode, a.unit) - packToMl(b.packCode, b.unit);
  });
}

export async function buildSoCatalogue(): Promise<SoCatalogue> {
    // Sequential awaits — no prisma.$transaction (CORE §3).
    const custRows = await prisma.mo_customer_keywords.findMany({
      select:  { customerCode: true, customerName: true, area: true },
      orderBy: { customerName: "asc" },
    });

    const indexRows = await prisma.mo_order_form_index_v2.findMany({
      where:   { isActive: true },
      select: {
        id:           true,
        family:       true,
        section:      true,
        subgroup:     true,
        subProduct:   true,
        product:      true,
        uiGroup:      true,
        baseColour:   true,
        displayName:  true,
        searchTokens: true,
        tinterType:   true,
        productType:  true,
        sortOrder:    true,
        region:       true,
      },
      orderBy: [{ family: "asc" }, { sortOrder: "asc" }],
    });

    const skuRows = await prisma.mo_sku_lookup_v2.findMany({
      where:  { isPrimary: true },
      select: { product: true, baseColour: true, packCode: true, unit: true, material: true },
    });

    // ── Customers — dedupe by code, carry first non-null area ──────────
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
    //   Key A = product            (index rows with baseColour=null)
    //   Key B = product|||colour   (index rows with a baseColour)
    // 2026-06-03: dedup on the RENDERED display size (formatPack) so a litre
    // pack stored as both "L" and "LT", or a fractional/junk packCode, can't
    // double a column. KG vs L stay distinct ("1L" vs "1KG" render differently).
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
      const pack: RawPack = { packCode: String(r.packCode), unit: r.unit ?? null, material: r.material };
      addToPackMap(r.product, pack);
      if (r.baseColour) {
        addToPackMap(`${r.product}|||${r.baseColour}`, pack);
      }
    }

    // ── Products — one row per index entry. Join key uses
    //    (row.product ?? row.subProduct) so filled families match
    //    mo_sku_lookup_v2.product. Unmigrated families still resolve
    //    via subProduct.
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
        sortOrder:    row.sortOrder,
        region:       row.region ?? null,
        packs:        sortRawPacks(packMap.get(packKey) ?? []),
      };
    });


  if (products.length === 0) throw new Error("so-lab catalogue: no active products");
  return { customers, products };
}
