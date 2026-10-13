// lib/order-invoices/kg-per-unit.ts — SAP's kg PER TIN, LEARNED (Add invoices
// Phase 4, 2026-10-13). Read-only, server-only.
//
// SAP's line export carries "Total Weight" (GROSS kg) per line. A pasted / SAP-
// file import stores it in import_raw_line_items."totalWeight"; AUTO-IMPORT lines
// do not carry it (live 2026-10-13: 151 of 38,806 auto lines have it; paste and
// SAP-file lines nearly all do). So kg per tin is LEARNED per SKU from every
// line that has it: the MEDIAN of "totalWeight" / "unitQty".
//
// Measured live 2026-10-13 before building (read-only):
//   · 1,164 SKUs learned from 21,789 lines; 26 observations (0.1%) sit > 3% off
//     their SKU's median; 14 SKUs have a min–max spread > 3% (mostly a doubled
//     or a pack-litres value on a few lines) — the median ignores them.
//   · Coverage: 98.1% of the last 30 days' auto-imported lines (9,575 / 9,762);
//     every line covered on 96.0% of those OBDs (2,954 / 3,078).
//   · Accuracy: Σ tins × median vs SAP's header kg — 98.3% within 2% on OBDs
//     that carry line kg (7,006 / 7,126); on auto-imported OBDs 97.8% within 2%
//     or < 1 kg (2,887 / 2,952 — auto-import's header kg is a WHOLE number, cut
//     down, so a 2.7 kg bill reads 2).
//   · NOT sku_master."grossWeightPerUnit": it holds pack LITRES (lib/floor/invoice-rows.ts).
//
// ONE raw read for the asked SKUs only. No index serves "skuCodeRaw" on
// import_raw_line_items, so it scans the lines with a weight (~60k rows,
// ~20 ms) — the board calls it only when a SPLIT OBD is on it.

import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";

/** SKU code → median SAP kg per tin, for the SKUs that have ever carried line kg. */
export async function learnedKgPerUnit(skus: string[]): Promise<Map<string, number>> {
  const wanted = Array.from(new Set(skus.filter((s) => s !== "")));
  const map = new Map<string, number>();
  if (wanted.length === 0) return map;
  const rows = await prisma.$queryRaw<{ sku: string; kg: number }[]>`
    SELECT "skuCodeRaw" AS sku,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY "totalWeight" / "unitQty") AS kg
      FROM import_raw_line_items
     WHERE "totalWeight" > 0
       AND "unitQty" > 0
       AND "skuCodeRaw" IN (${Prisma.join(wanted)})
     GROUP BY "skuCodeRaw"`;
  for (const r of rows) {
    const kg = Number(r.kg);
    if (Number.isFinite(kg) && kg > 0) map.set(r.sku, kg);
  }
  return map;
}
