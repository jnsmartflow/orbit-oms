// lib/ci/resolve-lines.ts
//
// Batch-resolves the SAP codes on a bill's lines to a product name and pack.
//
// ⚠️ MATCHES ON `sku_master_v2.material` AND NOTHING ELSE. Never a catalog row
// id, never an `sku` relation hung off some other table's FK. The OLD
// `sku_master` and `sku_master_v2` assign COMPLETELY DIFFERENT ids to the same
// material code — zero overlap, verified against production, not reasoned
// (CORE §13, the id-space landmine). Following an id would render a confidently
// WRONG product name on a goods-return document that replaces a signed paper
// form, which is worse than a blank: a blank reads as "unknown" and stops the
// operator, a wrong name reads as fact and gets signed.
//
// This warning travels WITH the code. It is the reason this file exists in this
// shape — the same shape and the same warning lib/mrn/resolve-lines.ts and
// lib/picking/resolve-lines.ts both carry. Do not delete it when editing.
//
// ⚠ NO `isPrimary` FILTER — a duplicate twin is still a real SAP code that can
// physically be in the return.
//
// ⚠ AND THE PACK IS FOR DISPLAY ONLY. Never compute litres from it: SAP's
// volumeLine ÷ unitQty is the only litres source, and the catalog disagrees with
// it on 109 measured lines, every one a catalog error. lib/ci/derive.ts carries
// that argument in full.

import { prisma } from "@/lib/prisma";
import { formatPack } from "@/lib/place-order/pack";

export interface CiCatalogEntry {
  /** `sku_master_v2.description` — the product name under the SKU code. */
  description: string;
  /** `formatPack(packCode, unit)` — the pack CODE only ("4L", "500ML"), never a
   *  container word. The supervisor matches pack size against what is in front
   *  of him. */
  pack: string;
}

/**
 * Resolve a set of raw SAP codes against `sku_master_v2`, keyed by `material`.
 *
 * De-duplicates and drops blanks itself, so callers hand over
 * `lines.map(l => l.skuCodeRaw)` with no pre-work.
 *
 * ⚠ A code MISSING from the returned Map is a NORMAL, EXPECTED state — not an
 * error and not a reason to reject the line. Measured 2026-08-31: 38,168 of
 * 40,548 active lines resolve, so ~5.9% of LINES do not, and the mockups render
 * exactly that — the bare code, with the line still fully returnable.
 *
 * ⚠ 5.9% is LINE-weighted. CORE §7.1.c's "~73%" is DISTINCT-CODE coverage and
 * answers a different question; the unmastered codes are long-tail. Quote the
 * right one: for "how many rows show a bare code", 5.9% is the number.
 *
 * ONE query for the whole set, never per line. Sequential await, never
 * prisma.$transaction (CORE §3).
 */
export async function resolveCiSkus(
  rawCodes: readonly (string | null)[],
): Promise<Map<string, CiCatalogEntry>> {
  const codes = Array.from(new Set(rawCodes.filter((c): c is string => Boolean(c))));
  if (codes.length === 0) return new Map();

  const rows = await prisma.sku_master_v2.findMany({
    // 🔴 `material` — THE natural key, and the only safe join. Identical across
    // both catalog tables, never null or blank on an active raw line (measured:
    // 0 of 40,548). See this file's header before changing one character.
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
export interface CiResolvedSku {
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
export function applyCiCatalog(
  skuCode: string,
  catalog: Map<string, CiCatalogEntry>,
): CiResolvedSku {
  const hit = catalog.get(skuCode);
  if (!hit) return { description: null, pack: null, isCatalogued: false };
  return { description: hit.description, pack: hit.pack, isCatalogued: true };
}
