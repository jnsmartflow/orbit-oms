// ─────────────────────────────────────────────────────────
// Table C context — the exact (v2 dict + V2 resolver) the ingest fast-path uses
// ─────────────────────────────────────────────────────────
// Single source for building the enrichment Table C fast-path inputs from the
// live v2 catalog. The /api/mail-orders/ingest route calls this once per
// request; the offline test calls the SAME helper so it validates the identical
// dictionary the route runs against (no duplicated fetch/build logic, no drift).
//
// Reads only: mo_order_form_index_v2 (isActive) for names, mo_sku_lookup_v2
// (isPrimary) for packs + materials. buildTableC omits the 15 collision keys.

import type { PrismaClient } from "@prisma/client";
import { buildTableC, type TableCMenuRow, type TableCStockRow } from "./table-c";
import type { SkuEntry } from "./enrich";

export interface TableCContext {
  /** Exact (emitted-name|cleanPack) → primary V2 material. Collision keys absent. */
  tableC: Map<string, string>;
  /** V2 material → SkuEntry, so a Table C hit always resolves (engine map is legacy). */
  tableCResolver: Map<string, SkuEntry>;
  /** The 15 excluded collision keys (for diagnostics / tests). */
  collisionKeys: Set<string>;
}

/**
 * Build the Table C fast-path context from the live v2 catalog. Sequential-safe
 * (one Promise.all of two reads, no transaction). Pure data — no mutation.
 */
export async function buildTableCContext(prisma: PrismaClient): Promise<TableCContext> {
  const [v2MenuRaw, v2StockRaw] = await Promise.all([
    prisma.mo_order_form_index_v2.findMany({
      where: { isActive: true },
      select: { product: true, subProduct: true, baseColour: true },
    }),
    prisma.mo_sku_lookup_v2.findMany({
      where: { isPrimary: true },
      select: {
        material: true, description: true, category: true, product: true,
        baseColour: true, packCode: true, unit: true, refMaterial: true,
        paintType: true, materialType: true, piecesPerCarton: true, isPrimary: true,
      },
    }),
  ]);

  const tableCResult = buildTableC(
    v2MenuRaw as TableCMenuRow[],
    v2StockRaw as TableCStockRow[],
  );

  const tableCResolver = new Map<string, SkuEntry>(
    v2StockRaw.map((s) => [s.material, {
      material: s.material,
      description: s.description,
      category: s.category,
      product: s.product,
      baseColour: s.baseColour,
      packCode: s.packCode,
      unit: s.unit,
      refMaterial: s.refMaterial,
      paintType: s.paintType,
      materialType: s.materialType,
      piecesPerCarton: s.piecesPerCarton ?? null,
    } satisfies SkuEntry]),
  );

  return {
    tableC: tableCResult.table,
    tableCResolver,
    collisionKeys: tableCResult.collisionKeys,
  };
}
