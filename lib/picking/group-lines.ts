import type { CatalogEntry } from "@/lib/picking/resolve-lines";
import type { PickingDetailLine, PickingLineFinding } from "@/lib/picking/types";

// ── Split-SKU grouping for the picking detail screen (2026-08-10) ───────────
// SAP routinely emits one line PER BATCH/LOT for a single ordered quantity, so
// the same SKU arrives as several `active` import_raw_line_items rows that are
// identical in every product-identifying field. Live measurement on 2026-08-10:
// 1,225 duplicate groups across 963 OBDs (2,630 of 33,500 active lines);
// `skuDescriptionRaw` and `isTinting` differed in ZERO of them, and 62% did not
// even differ on `batchCode`. Worst case OBD 9108587550 printed the SAME tin
// eight times — IN60000676 "DO Duco Thinner 5L", one line per batch, qty
// 3+4+1+4+4+4+4+8 = 32, which the picker had to add up himself off eight
// identical-looking rows.
//
// ⚠ MERGED ON THE SAP CODE, never on description text — the same natural-key
// rule CombinedSkuRow already follows for its cross-bill merge (types.ts). Pack
// is in the key as belt-and-braces only: it resolves FROM the code
// (sku_master_v2.material is @unique), so it can never split a group on its own.
//
// PURE — no DB access, no I/O, no dates. It lives here rather than inline in
// app/api/picking/order/[orderId]/route.ts (its only caller) for one concrete
// reason: a route handler cannot be exercised without an authenticated session,
// and this repo's dev server points at the production database, so the merge
// could otherwise only be "verified" by re-implementing it in a script — which
// proves nothing about the shipped path. Same seam resolve-lines.ts occupies.
//
// The DISPLAY layer is the only thing merged. Nothing here writes, and every row
// carries its underlying ids in `lineIds`, so the tables that reference raw line
// ids directly — pick_findings, delivery_challan_formulas, tinter_issue_entries
// — are untouched and unaware.

/** The `import_raw_line_items` columns this grouping reads. */
export interface RawPickingLine {
  id: number;
  skuCodeRaw: string;
  skuDescriptionRaw: string | null;
  unitQty: number;
  volumeLine: number | null;
  netWeight: number | null;
  totalWeight: number | null;
  articleTag: string | null;
}

// Float sums land on values like 118.19999999999999 (13.05 + 17.4×6 + 34.8).
// Rounded at the display boundary only — nothing downstream re-derives from
// these, and the underlying columns are never touched. 3dp because live
// `totalWeight` already carries 3 (e.g. 8.454); rounding to 2 would drop a digit
// that is really there in the source.
function roundSum(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Sum a nullable Float column across a group, or null when ANY contributing
 * line is missing it.
 *
 * A partial sum is the dangerous answer: it reads as the whole row's figure
 * while silently omitting the lines that had none. Same rule the blank pack
 * already follows (docs/CLAUDE_PICKING.md §7) — a blank prevents a mis-read, a
 * confidently wrong number does not. On a single-line group this is a
 * pass-through of that line's own value.
 */
function sumOrNull(values: readonly (number | null)[]): number | null {
  let total = 0;
  for (const v of values) {
    if (v === null) return null;
    total += v;
  }
  return roundSum(total);
}

// The key separator. NUL rather than a printable character so a SAP code or a
// pack string containing it could not forge a collision between two groups.
const GROUP_SEP = "\u0000";

/**
 * Group raw lines into detail-screen rows, one per (skuCodeRaw, resolved pack).
 *
 * `rawLines` MUST already be in display order (the route reads them
 * `orderBy lineId asc`). Order is preserved: a Map keeps insertion order, so a
 * merged row sits exactly where its FIRST contributing line sat, and nothing
 * here re-sorts.
 *
 * ⚠ A GROUP CARRYING ANY FINDING IS DELIBERATELY LEFT UNMERGED. pick_findings is
 * UNIQUE on rawLineItemId (schema.prisma) — one finding per raw line — so a
 * merged row has no honest place to show one, and folding a recorded shortage
 * into a summed row would HIDE it. Splitting that group back out renders those
 * lines exactly as they were before this change, findings and all. Both boards
 * block recording a NEW finding on a merged row, so the only way into this
 * branch is a finding recorded before the merge landed, or one written by
 * another surface. Degrading to the previous behaviour is the point.
 */
export function groupPickingDetailLines(
  rawLines: readonly RawPickingLine[],
  catalogByCode: ReadonlyMap<string, CatalogEntry>,
  findingByLineId: ReadonlyMap<number, PickingLineFinding>,
): PickingDetailLine[] {
  const groups = new Map<string, RawPickingLine[]>();
  for (const l of rawLines) {
    const pack = catalogByCode.get(l.skuCodeRaw)?.pack ?? "";
    const key = `${l.skuCodeRaw}${GROUP_SEP}${pack}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(l);
    else groups.set(key, [l]);
  }

  const lines: PickingDetailLine[] = [];
  for (const bucket of Array.from(groups.values())) {
    const merged = bucket.length > 1 && bucket.every((l) => !findingByLineId.has(l.id));
    // Not merged → emit each line on its own, exactly as before this change.
    const emit: RawPickingLine[][] = merged ? [bucket] : bucket.map((l) => [l]);

    for (const rows of emit) {
      const head = rows[0];
      const cat = catalogByCode.get(head.skuCodeRaw);
      lines.push({
        // The FIRST contributing line's id — kept so every existing consumer
        // (React keys, the findings popup, applyFinding's id match) behaves
        // identically on the single-line rows that are still the vast majority.
        // `lineIds` is the authority for anything that must cover the whole row.
        id: head.id,
        // Every raw id this row stands for, in lineId order. Never empty, and
        // `lineIds[0] === id`.
        lineIds: rows.map((l) => l.id),
        // Safe to take from the head: `skuDescriptionRaw` differed in ZERO of
        // the 1,225 live duplicate groups, and a resolved `cat.name` is a pure
        // function of the SAP code the group is keyed on.
        //
        // `pack` is the code ONLY ("1L", "500ML") — no container word; the picker
        // matches pack size against the shelf, not the container type. An
        // unresolved code falls back to the raw SAP text with a BLANK pack,
        // exactly as before (CLAUDE_PICKING.md §7 — a blank is a mis-pick
        // preventer, a guess is not).
        name: cat?.name ?? head.skuDescriptionRaw ?? null,
        sku: head.skuCodeRaw,
        pack: cat?.pack ?? null,
        qty: rows.reduce((sum, l) => sum + l.unitQty, 0),
        litres: sumOrNull(rows.map((l) => l.volumeLine)),
        netWeight: sumOrNull(rows.map((l) => l.netWeight)),
        totalWeight: sumOrNull(rows.map((l) => l.totalWeight)),
        // ⚠ DROPPED on a merged row, never inherited from one contributing line.
        // schema.prisma's own comment on the column says it outright: "When the
        // same SKU appears on multiple lines in one order... this per-line value
        // is not authoritative for duplicate-SKU orders." Live proof on OBD
        // 9107917606, where seven lines of ONE SKU carry "1 Drum", "2 Drum",
        // "3 Drum" and "5 Drum" — any one of them printed against the summed row
        // would be wrong. Only the order-level rollup is authoritative, and the
        // detail header already reads that one off PickingQueueRow.articleTag.
        articleTag: rows.length > 1 ? null : head.articleTag,
        // null — not undefined and not an empty object — when nothing is
        // recorded, so a consumer can test `finding !== null` and be done. A
        // merged row is always null here by construction (see the guard above).
        finding: findingByLineId.get(head.id) ?? null,
      });
    }
  }

  return lines;
}
