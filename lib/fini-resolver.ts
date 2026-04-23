import { prisma } from "@/lib/prisma";

/**
 * Resolves Fini SKU mapping for a list of Generic codes.
 *
 * Generic code = what SAP sends on OBDs (mo_sku_lookup.refMaterial)
 * Fini code = actual shipping SKU (mo_sku_lookup.material)
 *
 * Used by TM, Operator, and Delivery Challan API routes to support
 * Fini-default display with Generic toggle fallback.
 *
 * Input:  ["5860092", "5860093", ...]   (Generic codes from skuCodeRaw)
 * Output: Map<"5860092", { material: "5853606", description: "DN..." }>
 *
 * Codes with no Fini match are simply absent from the Map.
 * Caller handles fallback (display Generic code + description as-is).
 */
export type FiniPair = { material: string; description: string | null };

export async function resolveFiniMap(
  genericCodes: string[],
): Promise<Map<string, FiniPair>> {
  const deduped = Array.from(new Set(genericCodes)).filter(Boolean);
  if (deduped.length === 0) return new Map();

  // One Generic can theoretically map to multiple Finis (material is UNIQUE,
  // refMaterial is not). Deterministic pick: first by material asc.
  const rows = await prisma.mo_sku_lookup.findMany({
    where:   { refMaterial: { in: deduped } },
    select:  { material: true, description: true, refMaterial: true },
    orderBy: { material: "asc" },
  });

  const map = new Map<string, FiniPair>();
  for (const row of rows) {
    if (row.refMaterial == null) continue;
    if (map.has(row.refMaterial)) continue;
    map.set(row.refMaterial, { material: row.material, description: row.description });
  }
  return map;
}
