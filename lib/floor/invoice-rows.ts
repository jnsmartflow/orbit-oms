// lib/floor/invoice-rows.ts — ONE FLOOR ROW PER INVOICE (Add invoices, Phase 4
// commit 1, 2026-10-13). PURE: no Prisma, no React, no clock — the board builds
// the data on the server (lib/floor/queries.ts getBoardInvoiceRows) and the
// table / detail pager will draw with the same helpers (commits 2 and 3).
// Tests: lib/floor/invoice-rows.test.ts (npx tsx --test lib/floor/invoice-rows.test.ts).
//
// DATA STAYS ONE ROW PER OBD. A split OBD's board row carries `invoiceRows`,
// one entry per order_invoices row (seq order); an unsplit OBD carries []. The
// OBD is still the unit of selection, live-merge, sort and search in Phase 4 —
// only the DRAWING expands (drawRowsOf, below).
//
// KG PER INVOICE — owner rule (2026-10-13), first that applies:
//   1. every line on the invoice has SAP line kg (import_raw_line_items.
//      "totalWeight" > 0) → Σ line kg × tins / line tins. EXACT.
//   2. SAP's kg per tin is known for every line's SKU → Σ tins × kg per tin.
//      EXACT. The source is LEARNED from SAP's own line kg — the median of
//      "totalWeight" / "unitQty" per SKU over every line that carried it
//      (lib/order-invoices/kg-per-unit.ts; measured 2026-10-13: 98.1% of recent
//      auto-imported lines covered, 97.8% of auto-imported OBDs within 2% or
//      < 1 kg of SAP's header kg). ⚠ NOT sku_master."grossWeightPerUnit" (old
//      catalog, not in schema.prisma): it holds pack LITRES, not kg — tins × it
//      lands within 2% of the header kg on 175 of 3,100 OBDs.
//   3. the OBD's header kg shared by litres (lib/order-invoices/entry.ts
//      kgShare) — APPROXIMATE ("~"); null when there is no kg to share.

import { kgShare, lineLitres } from "@/lib/order-invoices/entry";
import { detectStale } from "@/lib/order-invoices/rules";

/** One invoice of a SPLIT OBD, as the board row carries it. */
export interface FloorInvoiceRow {
  /** order_invoices.id — the row identity (draw key `inv:<id>`). */
  id: number;
  seq: number;
  invoiceNo: string | null;
  /** ISO; date-only in practice, like FloorBoardRow.invoiceDate. */
  invoiceDate: string | null;
  tins: number;
  litres: number;
  /** null = no kg can be told (no line kg, no unit kg, no header kg). */
  kg: number | null;
  /** true = rule 1 or 2 (summed); false = rule 3 (shared, show "~"). */
  kgExact: boolean;
  /** The OBD's saved split no longer matches SAP's lines (or is half-written) —
   *  "Lines changed in SAP — re-check invoices". Same on every row of the OBD. */
  stale: boolean;
  /** THIS invoice's own trip stop (order_invoices."tripDropId", Phase 5) — null
   *  = on no trip. Today every row of an OBD shares one; from Phase 5 they can
   *  differ. tripNumber / tripStatus are that stop's trip. */
  tripDropId: number | null;
  tripNumber: string | null;
  tripStatus: string | null;
}

/** One order_invoices row with its lines, as the board's read returns it. */
export interface InvoiceRowSource {
  id: number;
  seq: number;
  invoiceNo: string | null;
  invoiceDate: Date | string | null;
  lines: { rawLineItemId: number; qty: number }[];
  /** The row's own trip stop and that stop's trip (Phase 5). Omitted = none. */
  tripDropId?: number | null;
  tripNumber?: string | null;
  tripStatus?: string | null;
}

/** One ACTIVE raw line of the OBD (import_raw_line_items, lineStatus 'active'). */
export interface InvoiceLineFacts {
  rawLineItemId: number;
  lineId: number;
  skuCodeRaw: string;
  unitQty: number;
  volumeLine: number | null;
  /** SAP's line kg (import_raw_line_items."totalWeight"); null / 0 = unknown. */
  totalWeight: number | null;
}

const iso = (d: Date | string | null): string | null => (d === null ? null : typeof d === "string" ? d : d.toISOString());

/**
 * The invoice rows of ONE OBD. [] when it is not split (fewer than two rows) —
 * an unsplit OBD is drawn exactly as before.
 *
 * `obdKg` = the OBD's header kg (querySnapshot.totalWeight, the board's own
 * `weightKg`). `unitKgBySku` = rule 2's source, SKU code → kg per tin; omit it
 * and rule 2 never applies.
 */
export function buildInvoiceRows(input: {
  rows: InvoiceRowSource[];
  activeLines: InvoiceLineFacts[];
  obdKg: number | null;
  unitKgBySku?: ReadonlyMap<string, number>;
}): FloorInvoiceRow[] {
  const rows = input.rows.slice().sort((a, b) => a.seq - b.seq);
  if (rows.length < 2) return [];

  const activeById = new Map(input.activeLines.map((l) => [l.rawLineItemId, l]));
  // The litres the header kg is shared by — every active line, as the detail
  // panel's Invoices section shares it (components/floor/detail-invoices.tsx).
  const obdLitres = input.activeLines.reduce((s, l) => s + (l.volumeLine ?? 0), 0);
  const savedLines = rows.flatMap((r) => r.lines);
  // Half-written (a row with no lines) counts as stale — lib/order-invoices/split.ts loadSplitView.
  const stale = rows.some((r) => r.lines.length === 0) || detectStale(input.activeLines, savedLines);

  return rows.map((r) => {
    const tins = r.lines.reduce((s, l) => s + l.qty, 0);
    const litres = r.lines.reduce((s, l) => {
      const line = activeById.get(l.rawLineItemId);
      return s + (line ? lineLitres(line.volumeLine, line.unitQty, l.qty) : 0);
    }, 0);
    const { kg, kgExact } = invoiceKg(r.lines, activeById, input.unitKgBySku, input.obdKg, litres, obdLitres);
    return {
      id: r.id,
      seq: r.seq,
      invoiceNo: r.invoiceNo,
      invoiceDate: iso(r.invoiceDate),
      tins,
      litres,
      kg,
      kgExact,
      stale,
      tripDropId: r.tripDropId ?? null,
      tripNumber: r.tripNumber ?? null,
      tripStatus: r.tripStatus ?? null,
    };
  });
}

/** The kg rule above, for one invoice's lines. */
export function invoiceKg(
  lines: { rawLineItemId: number; qty: number }[],
  activeById: ReadonlyMap<number, InvoiceLineFacts>,
  unitKgBySku: ReadonlyMap<string, number> | undefined,
  obdKg: number | null,
  litres: number,
  obdLitres: number,
): { kg: number | null; kgExact: boolean } {
  const facts = lines.map((l) => ({ qty: l.qty, line: activeById.get(l.rawLineItemId) }));
  const allActive = facts.length > 0 && facts.every((f) => f.line !== undefined && f.line.unitQty > 0);

  // 1. SAP line kg on every line.
  if (allActive && facts.every((f) => (f.line!.totalWeight ?? 0) > 0)) {
    return { kg: facts.reduce((s, f) => s + (f.line!.totalWeight! * f.qty) / f.line!.unitQty, 0), kgExact: true };
  }
  // 2. A unit weight for every line's SKU.
  if (allActive && unitKgBySku && facts.every((f) => (unitKgBySku.get(f.line!.skuCodeRaw) ?? 0) > 0)) {
    return { kg: facts.reduce((s, f) => s + f.qty * unitKgBySku.get(f.line!.skuCodeRaw)!, 0), kgExact: true };
  }
  // 3. The header kg shared by litres — approximate.
  return { kg: kgShare(obdKg, litres, obdLitres), kgExact: false };
}

// ── THE LOAD IN ONE PLACE (Phase 5 commit 1, 2026-10-13) ─────────────────────
//
// From Phase 5 one OBD's invoices can sit in different places — some on a trip
// stop, the rest in To plan, or on two trips. A stop, a trip, a Print list, a
// trip sheet or a load plan then carries ONLY the invoices that are in it:
// litres from their lines, kg by the rule above, tins summed.
//
// 🔴 AN OBD WHOLLY IN ONE PLACE KEEPS ITS OWN TOTALS. placeLoad returns null —
// "use the OBD's header litres / kg, exactly as before" — when the OBD is not
// split, or when every one of its invoices is in that place. Only an OBD split
// ACROSS places is summed from its invoice rows. So nothing moves until an
// invoice really moves on its own (Phase 5 commit 2), and a header that differs
// from its lines by a rounding (18648: 1,357 kg header, 1,357.41 by lines) is
// never swapped in silently. Counts stay per OBD (owner, 2026-10-13); `invoices`
// is how many of the OBD's invoices are in the place.

/** What the invoices of one OBD that sit in one place add up to. */
export interface PlaceLoad {
  litres: number;
  /** null = unknown (some invoice in the place has no kg). */
  kg: number | null;
  /** Every invoice in the place had an exact kg (rule 1 or 2). */
  kgExact: boolean;
  tins: number;
  /** How many of the OBD's invoices are in the place. */
  invoices: number;
}

type PlaceRow = Pick<FloorInvoiceRow, "tripDropId" | "litres" | "kg" | "kgExact" | "tins">;

/**
 * The load of the invoices that are in a place — `inPlace(tripDropId)` says
 * whether an invoice on that stop (null = on no trip) is in it. null = use the
 * OBD's own totals (not split, or wholly in the place); see above.
 */
export function placeLoad(invoiceRows: readonly PlaceRow[], inPlace: (tripDropId: number | null) => boolean): PlaceLoad | null {
  if (invoiceRows.length < 2) return null;
  const here = invoiceRows.filter((r) => inPlace(r.tripDropId));
  if (here.length === invoiceRows.length) return null;
  let kg: number | null = 0;
  for (const r of here) kg = kg === null || r.kg === null ? null : kg + r.kg;
  return {
    litres: here.reduce((s, r) => s + r.litres, 0),
    kg,
    kgExact: here.every((r) => r.kgExact),
    tins: here.reduce((s, r) => s + r.tins, 0),
    invoices: here.length,
  };
}

/**
 * A board row NARROWED to one place: only the invoices in it, and the row's
 * litres / kg replaced by theirs (placeLoad). The same row object when the OBD
 * is wholly in the place — so every list of rows that is already right stays
 * byte-identical. Drawn rows keep the OBD's own k/n (drawRowsOf numbers within
 * the narrowed list; Phase 5 commit 3 carries the OBD-wide k).
 */
export function narrowToPlace<T extends { invoiceRows: FloorInvoiceRow[]; volumeLitres: number | null; weightKg: number | null }>(
  row: T,
  inPlace: (tripDropId: number | null) => boolean,
): T {
  const load = placeLoad(row.invoiceRows ?? [], inPlace);
  if (load === null) return row;
  return {
    ...row,
    invoiceRows: row.invoiceRows.filter((r) => inPlace(r.tripDropId)),
    volumeLitres: load.litres,
    weightKg: load.kg,
  };
}

/** The typed invoice numbers (seq 2..n) — what the "+n" chip shows until commit 2. */
export function addedInvoiceNosOf(invoiceRows: FloorInvoiceRow[]): string[] {
  return invoiceRows.filter((r) => r.seq > 1 && r.invoiceNo !== null).map((r) => r.invoiceNo as string);
}

// ── Drawing (commits 2 and 3) ────────────────────────────────────────────────

/** One table row as it will be DRAWN. */
export interface InvoiceDrawRow<T> {
  /** React key: `inv:<order_invoices.id>` on a split row; on any other row the
   *  key the table uses today — the orderId, or `rd:<id>` on a re-delivery. */
  key: string;
  row: T;
  /** The invoice this draw row shows; null on an unsplit / re-delivery row. */
  invoice: FloorInvoiceRow | null;
  /** 1-based position among the OBD's invoices, and their count (1 / 1 unsplit). */
  k: number;
  n: number;
  first: boolean;
  last: boolean;
}

type Drawable = { orderId: number; invoiceRows?: FloorInvoiceRow[]; redelivery?: { id: number } | null };

/**
 * An OBD row → the rows to draw. A split OBD gives one per invoice (seq order);
 * anything else gives itself once. 🔴 A RE-DELIVERY ROW NEVER EXPANDS: its row
 * describes the bill's FIRST trip (lib/floor/selection.ts deskKeyOf), the same
 * reason keepPairsAdjacent skips it.
 */
export function drawRowsOf<T extends Drawable>(row: T): InvoiceDrawRow<T>[] {
  const inv = row.redelivery ? [] : row.invoiceRows ?? [];
  if (inv.length < 2) {
    const key = row.redelivery ? `rd:${row.redelivery.id}` : String(row.orderId);
    return [{ key, row, invoice: null, k: 1, n: 1, first: true, last: true }];
  }
  const n = inv.length;
  return inv.map((invoice, i) => ({
    key: `inv:${invoice.id}`,
    row,
    invoice,
    k: i + 1,
    n,
    first: i === 0,
    last: i === n - 1,
  }));
}

/** Every OBD row of a list, expanded in order — ONE rule for the table and the pager. */
export function drawRows<T extends Drawable>(rows: readonly T[]): InvoiceDrawRow<T>[] {
  return rows.flatMap((r) => drawRowsOf(r));
}
