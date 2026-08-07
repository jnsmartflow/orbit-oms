import { prisma } from "@/lib/prisma";
import { formatPack } from "@/lib/place-order/pack";

// ── Catalog resolution for picking line items ───────────────────────────────
// Extracted 2026-08-07 from app/api/picking/order/[orderId]/route.ts, which had
// been the only implementation. Pulled out rather than copied a third time when
// the picker's Combined view needed the SAME resolution across MANY bills at
// once (app/api/picking/combined/route.ts). The single-bill route now calls
// this, so the two surfaces can never resolve a SKU differently.
//
// Nothing here is bill-scoped: the lookup was already a batch `material IN
// (...)` query keyed by the SAP code, so widening it from one bill's codes to
// several bills' codes needed no change at all — only the caller's `where`
// differs.
//
// ⚠️ DO NOT resolve the catalog via `enrichedLineItem.sku`. That relation rides
// `skuId`, which still points at the OLD `sku_master` and shares NO id space
// with `sku_master_v2` — following it renders a confidently WRONG product name
// and pack on a live picking bill. `skuCodeRaw` is the stable natural key,
// never null, identical across both tables. Full reasoning and the id-space
// evidence: the SKU-catalog section of docs/CLAUDE_CORE.md (§7.1.c / §13).
// This warning travels WITH the code — it is the reason this file exists in
// this shape. Do not delete it when editing.
//
// No `isPrimary` filter — a duplicate twin is still a real SAP code the picker
// may be holding (docs/CLAUDE_PICKING.md §5.3).

export interface CatalogEntry {
  /** `sku_master_v2.description` — the product name shown under the SKU code. */
  name: string;
  /**
   * `formatPack(packCode, unit)` — the pack CODE only ("1L", "500ML"), never a
   * container word. The picker matches pack size against the shelf, not the
   * container type.
   */
  pack: string;
}

/**
 * Batch-resolve raw SAP codes against `sku_master_v2`, keyed by `material`.
 *
 * Accepts the raw `skuCodeRaw` values straight off `import_raw_line_items`
 * (nullable/blank-tolerant) and de-duplicates them itself, so callers hand over
 * `lines.map(l => l.skuCodeRaw)` with no pre-work. Returns a Map keyed by the
 * SAP code; a code MISSING from the map is an unmastered code and the caller
 * must fall back to the raw SAP text with a BLANK pack — a blank pack prevents
 * a mis-pick, a guessed one does not (docs/CLAUDE_PICKING.md §7).
 *
 * Sequential await, single query, never prisma.$transaction (CORE §3).
 */
export async function resolveCatalogByCode(
  rawCodes: readonly (string | null)[],
): Promise<Map<string, CatalogEntry>> {
  const codes = Array.from(
    new Set(rawCodes.filter((c): c is string => Boolean(c))),
  );
  if (codes.length === 0) return new Map();

  const rows = await prisma.sku_master_v2.findMany({
    where: { material: { in: codes } },
    select: { material: true, description: true, packCode: true, unit: true },
  });

  return new Map(
    rows.map((r) => [r.material, { name: r.description, pack: formatPack(r.packCode, r.unit) }]),
  );
}
