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
  /** THIS invoice's own hold (order_invoices."isHeld", 6.1). A held invoice is
   *  never in To plan (inPool) — it is drawn on the On hold tab. Optional so a
   *  fixture or an older payload without it reads "not held". */
  isHeld?: boolean;
  /** Its WALL-CLOCK hold moment (ISO) and who — the On hold tab's per-invoice
   *  "Held since" / "Held by". heldByName is filled by getFloorHold only. */
  heldAt?: string | null;
  heldById?: number | null;
  heldByName?: string | null;
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
  /** The row's own hold (6.1). Omitted = not held. */
  isHeld?: boolean;
  heldAt?: Date | string | null;
  heldById?: number | null;
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
      isHeld: r.isHeld ?? false,
      heldAt: iso(r.heldAt ?? null),
      heldById: r.heldById ?? null,
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
  return loadWhere(invoiceRows, (r) => inPlace(r.tripDropId));
}

/** placeLoad's rule over any test of the invoice row — null = all of them, or unsplit. */
function loadWhere<R extends PlaceRow>(invoiceRows: readonly R[], keep: (r: R) => boolean): PlaceLoad | null {
  if (invoiceRows.length < 2) return null;
  const here = invoiceRows.filter(keep);
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
 * byte-identical. A narrowed row keeps EVERY invoice in `invoiceRowsAll`, so
 * drawn rows keep the OBD's own k/n (drawRowsOf, P5-3) and the bar can say
 * where the rest are (awayChipOf).
 */
type Narrowable = {
  invoiceRows: FloorInvoiceRow[];
  invoiceRowsAll?: FloorInvoiceRow[];
  volumeLitres: number | null;
  weightKg: number | null;
};

export function narrowToPlace<T extends Narrowable>(row: T, inPlace: (tripDropId: number | null) => boolean): T {
  return narrowWhere(row, (r) => inPlace(r.tripDropId));
}

/**
 * TO PLAN (6.1): an invoice is in the pool when it is on no trip AND not held.
 * A held invoice of a split OBD is drawn on the On hold tab instead.
 */
export function inPool(r: Pick<FloorInvoiceRow, "tripDropId" | "isHeld">): boolean {
  return r.tripDropId === null && r.isHeld !== true;
}

/** A board row narrowed to To plan — its off-trip, NOT-held invoices (6.1). */
export function narrowToPool<T extends Narrowable>(row: T): T {
  return narrowWhere(row, inPool);
}

/** A hold row narrowed to its HELD invoices (the On hold tab, 6.1). */
export function narrowToHeld<T extends Narrowable>(row: T): T {
  return narrowWhere(row, (r) => r.isHeld === true);
}

/**
 * A board row narrowed to the TICKED invoices of a split OBD (P5-3) — the
 * bottom bar's litres / kg and its "2 of 4 invoices". `ids` null = the whole
 * OBD (the same row object back).
 */
export function narrowToInvoiceIds<T extends Narrowable>(row: T, ids: readonly number[] | null): T {
  if (ids === null) return row;
  const set = new Set(ids);
  return narrowWhere(row, (r) => set.has(r.id));
}

function narrowWhere<T extends Narrowable>(row: T, keep: (r: FloorInvoiceRow) => boolean): T {
  const load = loadWhere(row.invoiceRows ?? [], keep);
  if (load === null) return row;
  // ⚠ Narrowing an already-narrowed row keeps the OBD's ORIGINAL full list.
  return {
    ...row,
    invoiceRows: row.invoiceRows.filter(keep),
    invoiceRowsAll: row.invoiceRowsAll ?? row.invoiceRows,
    volumeLitres: load.litres,
    weightKg: load.kg,
  };
}

// ── WHERE THE REST ARE (P5-3, 2026-10-17, owner decision 6) ──────────────────
//
// A split OBD whose invoices sit in DIFFERENT places (To plan, a trip) draws an
// AMBER bar and a chip naming the invoices this list does not show — "2 on
// L-02" in To plan, "2 in To plan" on a trip stop, "1 on L-05" beside it. All
// in one place → null, and the bar stays the `pair` token. A place is To plan
// or ONE trip (an OBD's rows on a trip share one stop — trip-bills.ts).

/** The chip for the invoices of `all` that are not in `drawn`, or null when none are away. */
export function awayChipOf(
  all: readonly Pick<FloorInvoiceRow, "id" | "tripDropId" | "tripNumber" | "isHeld">[],
  drawn: readonly Pick<FloorInvoiceRow, "id">[],
  shortTrip: (tripNumber: string) => string = (t) => t,
): { text: string; title: string } | null {
  const here = new Set(drawn.map((r) => r.id));
  const byPlace = new Map<string, { label: string; long: string; k: number }>();
  for (const r of all) {
    if (here.has(r.id)) continue;
    // 6.1: a held invoice is its own place — "2 on hold" (never on a trip).
    const key = r.isHeld === true ? "hold" : r.tripDropId === null ? "plan" : `t:${r.tripNumber ?? r.tripDropId}`;
    const e =
      byPlace.get(key) ??
      (r.isHeld === true
        ? { label: "on hold", long: "on hold", k: 0 }
        : r.tripDropId === null
        ? { label: "in To plan", long: "in To plan", k: 0 }
        : r.tripNumber === null
          ? { label: "on a trip", long: "on a trip", k: 0 }
          : { label: `on ${shortTrip(r.tripNumber)}`, long: `on ${r.tripNumber}`, k: 0 });
    e.k++;
    byPlace.set(key, e);
  }
  if (byPlace.size === 0) return null;
  const parts = Array.from(byPlace.values());
  return {
    text: parts.map((p) => `${p.k} ${p.label}`).join(" · "),
    title: `${parts.map((p) => `${p.k} of ${all.length} invoices ${p.long}`).join(", ")} — not shown here`,
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

type Drawable = {
  orderId: number;
  invoiceRows?: FloorInvoiceRow[];
  invoiceRowsAll?: FloorInvoiceRow[];
  redelivery?: { id: number } | null;
};

/**
 * An OBD row → the rows to draw. A split OBD gives one per invoice (seq order);
 * anything else gives itself once. 🔴 A RE-DELIVERY ROW NEVER EXPANDS: its row
 * describes the bill's FIRST trip (lib/floor/selection.ts deskKeyOf), the same
 * reason keepPairsAdjacent skips it.
 *
 * A row NARROWED to a place (narrowToPlace) draws only its invoices there, but
 * k / n stay OBD-WIDE (P5-3): 3 and 4 of 4 in To plan, 1 and 2 of 4 on the
 * trip — and a split OBD with ONE invoice left in a place still draws as an
 * invoice row ("2/4"), never as a plain OBD row.
 */
export function drawRowsOf<T extends Drawable>(row: T): InvoiceDrawRow<T>[] {
  const all = row.redelivery ? [] : row.invoiceRowsAll ?? row.invoiceRows ?? [];
  if (all.length < 2) {
    const key = row.redelivery ? `rd:${row.redelivery.id}` : String(row.orderId);
    return [{ key, row, invoice: null, k: 1, n: 1, first: true, last: true }];
  }
  const inv = row.invoiceRows ?? [];
  const n = all.length;
  return inv.map((invoice, i) => ({
    key: `inv:${invoice.id}`,
    row,
    invoice,
    k: all.findIndex((a) => a.id === invoice.id) + 1,
    n,
    first: i === 0,
    last: i === inv.length - 1,
  }));
}

/** Every OBD row of a list, expanded in order — ONE rule for the table and the pager. */
export function drawRows<T extends Drawable>(rows: readonly T[]): InvoiceDrawRow<T>[] {
  return rows.flatMap((r) => drawRowsOf(r));
}
