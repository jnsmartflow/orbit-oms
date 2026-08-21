// lib/mrn/resolve-lines.ts
//
// Batch-resolves the SAP codes on an MRN's lines to a product name and pack.
//
// ⚠️ MATCHES ON `sku_master_v2.material` AND NOTHING ELSE. Never a catalog row
// id, never an `sku` relation hung off some other table's FK. The OLD
// `sku_master` and `sku_master_v2` assign COMPLETELY DIFFERENT ids to the same
// material code — zero overlap, verified against production, not reasoned
// (CORE §13, the id-space landmine). Following an id would render a
// confidently WRONG product name on a live goods-receipt sheet, which is worse
// than a blank: a blank reads as "unknown" and stops the operator, a wrong name
// reads as fact and gets signed.
//
// This warning travels WITH the code. It is the reason this file exists in this
// shape — the same shape and the same warning lib/picking/resolve-lines.ts
// carries. Do not delete it when editing.
//
// No `isPrimary` filter — a duplicate twin is still a real SAP code that could
// physically be on the truck.

import { prisma } from "@/lib/prisma";
import { formatPack } from "@/lib/place-order/pack";

export interface MrnCatalogEntry {
  /** `sku_master_v2.description` — the product name under the SKU code. */
  description: string;
  /**
   * `formatPack(packCode, unit)` — the pack CODE only ("4L", "500ML"), never a
   * container word. The supervisor matches pack size against what is coming off
   * the truck, not container type.
   */
  pack: string;
}

/**
 * Resolve a set of raw SAP codes against `sku_master_v2`, keyed by `material`.
 *
 * De-duplicates and drops blanks itself, so callers hand over
 * `lines.map(l => l.skuCode)` with no pre-work.
 *
 * ⚠ A code MISSING from the returned Map is a NORMAL, EXPECTED state — not an
 * error and not a reason to reject the line. Roughly 27% of distinct active SAP
 * import codes resolve in neither catalog table (CORE §7.1.c), and the mockups
 * render exactly that: "Not in catalog / UNKNOWN SKU" against the bare code,
 * with the line still fully checkable. The missing master data is a separate
 * catalog-cleanup backlog item, not this module's problem to solve or to block
 * on.
 *
 * ONE query for the whole set, never per line. Sequential await, never
 * prisma.$transaction (CORE §3).
 */
export async function resolveMrnSkus(
  rawCodes: readonly (string | null)[],
): Promise<Map<string, MrnCatalogEntry>> {
  const codes = Array.from(new Set(rawCodes.filter((c): c is string => Boolean(c))));
  if (codes.length === 0) return new Map();

  const rows = await prisma.sku_master_v2.findMany({
    // 🔴 `material` — THE natural key, and the only safe join. Identical across
    // both catalog tables, never null. See this file's header before changing
    // one character of this where clause.
    where: { material: { in: codes } },
    select: { material: true, description: true, packCode: true, unit: true },
  });

  return new Map(
    rows.map((r) => [
      r.material,
      { description: r.description, pack: formatPack(r.packCode, r.unit) },
    ]),
  );
}

/** What a resolved line carries once the catalog has been consulted. */
export interface MrnResolvedSku {
  description: string | null;
  pack: string | null;
  isCatalogued: boolean;
}

/**
 * Apply a resolved catalog to one code.
 *
 * Exists so the "is this code mastered?" rule has ONE owner: without it every
 * render site would re-derive it as `description !== null`, and the first one to
 * write `description !== undefined` instead would silently flip an unmastered
 * line into looking mastered.
 */
export function applyCatalog(
  skuCode: string,
  catalog: Map<string, MrnCatalogEntry>,
): MrnResolvedSku {
  const hit = catalog.get(skuCode);
  if (!hit) return { description: null, pack: null, isCatalogued: false };
  return { description: hit.description, pack: hit.pack, isCatalogued: true };
}
