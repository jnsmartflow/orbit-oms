// lib/floor/invoice-rows.ts — ONE FLOOR ROW PER INVOICE (Add invoices, Phase 4
// commit 1, 2026-10-13). PURE: no Prisma, no React, no clock — the board builds
// the data on the server (lib/floor/queries.ts getBoardInvoiceRows) and the
// table / detail pager will draw with the same helpers (commits 2 and 3).
// Tests: lib/floor/invoice-rows.test.ts (npx tsx --test lib/floor/invoice-rows.test.ts).
//
// DATA STAYS ONE ROW PER OBD. A split OBD's board row carries `invoiceRows`,
// one entry per order_invoices row (seq order); an unsplit OBD carries []. The
// OBD stays the unit of live-merge and sort; SELECTION is per invoice since P5-3
// (`inv:<id>` keys, lib/floor/selection.ts) and search matches any invoice's
// number. The DRAWING expands (drawRowsOf, below). (Said "the OBD is still the
// unit of selection … in Phase 4" until 2026-10-24.)
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
import { loadGroupsOf, loadPartsOf, loadPartText, type LoadPart } from "@/lib/order-invoices/load-plan";
import { parseArticleTag } from "@/lib/article-tag-parse";
import { ARTICLE_WORD_ABBR } from "@/lib/floor/format";

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
  /** THIS invoice's own trip stop (order_invoices."tripDropId") — null = on no
   *  trip. Rows of one OBD can sit on different stops since Phase 5.
   *  tripNumber / tripStatus are that stop's trip. */
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
  /** 6.3 — THIS invoice's own CI (ci_returns."orderInvoiceId" = the row, not
   *  voided, draft included): the invoice is finished — never in To plan / On
   *  hold, drawn on the Cancel & CI tab. null / absent = none. */
  ci?: { ciNumber: string | null; status: string } | null;
  /** 6.4 — THIS invoice has shipped (order_invoices."isDispatched"). Never in
   *  To plan. Absent = not dispatched. */
  isDispatched?: boolean;
  /** SPLIT LOAD (v27.76, phase 3) — the row's LOAD GROUP root: a truck part's
   *  parent, or a root's own id when it has parts. ABSENT on every row not in a
   *  load group, so an unsplit or Add-invoices payload is byte-identical. */
  loadRootId?: number;
  /** Split load — a row of this load-split OBD has no lines (a press died
   *  half-way → Repair, commit 3). ABSENT unless true. */
  halfWritten?: true;
  /** Split load (Phase 4 batch 2) — THIS row's share of SAP's articles
   *  (loadRowArticles; shown via articleShareText) and of SAP's article tag,
   *  ready to draw ("35 D", "~18 D · 17 C"; loadRowArticleTags). Set on every
   *  row of an OBD with a load group, by lib/order-invoices/invoice-load.ts;
   *  ABSENT on every other row, so those payloads are byte-identical. The
   *  Floor tables draw these instead of the OBD's tag and the picker's typed
   *  count (owner answer 2: a part ignores the typed whole-bill count). */
  articles?: number;
  articleTagText?: string;
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
  /** The row's own CI (6.3). Omitted = none. */
  ci?: { ciNumber: string | null; status: string } | null;
  /** The row has shipped (6.4). Omitted = no. */
  isDispatched?: boolean;
  /** Split load (v27.76) — set on a truck part only. Omitted = none. */
  loadParentId?: number | null;
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
  // panel's Invoices section did (components/floor/detail-invoices.tsx — kept on
  // disk, not mounted since Phase 4, 2026-10-13).
  const obdLitres = input.activeLines.reduce((s, l) => s + (l.volumeLine ?? 0), 0);
  const savedLines = rows.flatMap((r) => r.lines);
  // Half-written (a row with no lines) counts as stale — lib/order-invoices/split.ts loadSplitView.
  const stale = rows.some((r) => r.lines.length === 0) || detectStale(input.activeLines, savedLines);
  // Split load: the roots that have parts, and "a press died half-way" — set
  // ONLY on a load-split OBD (Add invoices' own half-writes stay plain stale).
  const parents = new Set(rows.map((r) => r.loadParentId).filter((p): p is number => p !== null && p !== undefined));
  const halfWritten = parents.size > 0 && rows.some((r) => r.lines.length === 0);

  return rows.map((r) => {
    const loadRootId = r.loadParentId ?? (parents.has(r.id) ? r.id : undefined);
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
      ci: r.ci ?? null,
      isDispatched: r.isDispatched ?? false,
      // Only when present — every other payload keeps its exact keys.
      ...(loadRootId !== undefined ? { loadRootId } : {}),
      ...(halfWritten ? { halfWritten: true as const } : {}),
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
// Since Phase 5 one OBD's invoices can sit in different places — some on a trip
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

/**
 * The load of the NAMED invoices of an OBD — a re-delivery carries only the
 * invoices it names (P5-5, lib/order-invoices/redelivery-plan.ts). null = all
 * of them, or unsplit: use the OBD's own totals (placeLoad's rule).
 */
export function invoicesLoad(invoiceRows: readonly (PlaceRow & { id: number })[], ids: readonly number[]): PlaceLoad | null {
  const set = new Set(ids);
  return loadWhere(invoiceRows, (r) => set.has(r.id));
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

// ── SPLIT LOAD: SAP'S ARTICLES PER TRUCK PART (Phase 4 batch 1, 2026-10-25) ──
//
// Owner, 2026-10-25: an article is a PACKAGE (a drum, a carton, a loose tin),
// not a tin, so a truck part carries its SHARE of SAP's article count
// (import_obd_query_summary."totalArticle" — what an unsplit bill prints),
// worked LINE BY LINE:
//   weight(row) = Σ over its lines of line.article × qty ÷ line.unitQty
// (import_raw_line_items.article, the per-line count the import writes; read
// 2026-10-25: present on every active line of 97.7% of OBDs). When any active
// line has no article, the weight is the row's tins. Each row's share is
// totalArticle × weight ÷ Σ weights, kept to ONE decimal; the LAST row (highest
// seq) takes the remainder, so the parts always add up to the bill. Shared over
// totalArticle, not Σ line articles: the import groups duplicate-SKU lines
// before cartons are counted (lib/article-tag.ts rollupArticleTagsBySku), so on
// ~3% of OBDs the line counts do not add up to SAP's own total.
// The picker's typed count is for the WHOLE bill and is never shared (owner
// answer 2). Shown with "~" when not whole (articleShareText). Only callers that
// found a load group ask for these — every other bill keeps its own count.

/** One active raw line's article facts (import_raw_line_items). */
export interface ArticleLine {
  rawLineItemId: number;
  unitQty: number;
  /** SAP's per-line article count; null = the import could not tell. */
  article: number | null;
}

const round1 = (x: number): number => Math.round(x * 10) / 10;

/**
 * Each row's share of the bill's `totalArticle` (row id → articles, one
 * decimal, Σ = totalArticle). Empty when there is no total or nothing to share by.
 */
export function loadRowArticles(input: {
  rows: ReadonlyArray<{ id: number; seq: number; lines: ReadonlyArray<{ rawLineItemId: number; qty: number }> }>;
  activeLines: readonly ArticleLine[];
  totalArticle: number | null;
}): Map<number, number> {
  const out = new Map<number, number>();
  const total = input.totalArticle;
  if (total === null) return out;
  const rows = input.rows.slice().sort((a, b) => a.seq - b.seq);
  const byId = new Map(input.activeLines.map((l) => [l.rawLineItemId, l]));
  const perLine = input.activeLines.length > 0 && input.activeLines.every((l) => l.article !== null && l.unitQty > 0);
  const tinsOf = (r: (typeof rows)[number]) => r.lines.reduce((s, l) => s + l.qty, 0);
  let weights = rows.map((r) =>
    perLine
      ? r.lines.reduce((s, l) => {
          const line = byId.get(l.rawLineItemId);
          return s + (line ? ((line.article as number) * l.qty) / line.unitQty : 0);
        }, 0)
      : tinsOf(r),
  );
  if (weights.reduce((s, w) => s + w, 0) <= 0) weights = rows.map(tinsOf);
  const sum = weights.reduce((s, w) => s + w, 0);
  if (sum <= 0) return out;
  let given = 0;
  rows.forEach((r, i) => {
    const share = i === rows.length - 1 ? round1(total - given) : round1((total * weights[i]) / sum);
    given += share;
    out.set(r.id, share);
  });
  return out;
}

/** The articles of the named rows (one decimal) — null when the bill has no shares. */
export function loadPlaceArticles(rowArticles: ReadonlyMap<number, number>, rowIds: readonly number[]): number | null {
  if (rowArticles.size === 0) return null;
  return round1(rowIds.reduce((s, id) => s + (rowArticles.get(id) ?? 0), 0));
}

/** THE way a part's article share is shown: whole → "35"; not whole → "~18". */
export function articleShareText(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  const r = Math.round(n);
  return `${Math.abs(n - r) < 1e-9 ? "" : "~"}${r.toLocaleString("en-IN")}`;
}

/** One active raw line's article TAG (import_raw_line_items."articleTag", e.g. "70 Drum"). */
export interface ArticleTagLine {
  rawLineItemId: number;
  unitQty: number;
  /** null / "" = the import could not tell. */
  articleTag: string | null;
}

/**
 * Each row's share of the bill's article TAG, ready to draw (row id → "35 D",
 * "~18 D · 17 C", "—" when the row carries none of it). THE SAME RULE as
 * loadRowArticles, once per pack type: the type's count in SAP's order tag
 * (querySnapshot.articleTag) is shared by each line's count of that type (its
 * line tag) × tins ÷ line tins — tins when a line has no tag — with the
 * remainder to the last row. Empty when the bill has no tag.
 */
export function loadRowArticleTags(input: {
  rows: ReadonlyArray<{ id: number; seq: number; lines: ReadonlyArray<{ rawLineItemId: number; qty: number }> }>;
  activeLines: readonly ArticleTagLine[];
  obdTag: string | null;
}): Map<number, string> {
  const out = new Map<number, string>();
  if (!input.obdTag) return out;
  const types = new Map<string, number>();
  for (const g of parseArticleTag(input.obdTag)) types.set(g.type, (types.get(g.type) ?? 0) + g.count);
  if (types.size === 0) return out;
  const groupsByLine = new Map(input.activeLines.map((l) => [l.rawLineItemId, l.articleTag ? parseArticleTag(l.articleTag) : null]));
  const words = new Map<number, string[]>(input.rows.map((r) => [r.id, []]));
  types.forEach((count, type) => {
    const shares = loadRowArticles({
      rows: input.rows,
      activeLines: input.activeLines.map((l) => {
        const g = groupsByLine.get(l.rawLineItemId) ?? null;
        return {
          rawLineItemId: l.rawLineItemId,
          unitQty: l.unitQty,
          article: g === null ? null : g.filter((x) => x.type === type).reduce((s, x) => s + x.count, 0),
        };
      }),
      totalArticle: count,
    });
    shares.forEach((n, id) => {
      if (n > 0) words.get(id)?.push(`${articleShareText(n)} ${ARTICLE_WORD_ABBR[type] ?? type}`);
    });
  });
  words.forEach((w, id) => out.set(id, w.length > 0 ? w.join(" · ") : "—"));
  return out;
}

/**
 * The TRIPS a load-split bill's rows ride, in seq order of their first row:
 * one entry per trip, with that trip's stop and the rows on it. `tripOfDrop`
 * names a stop's trip (null / undefined = not a trip the caller reports).
 * An OBD's rows on one trip share one stop (trip-bills.ts), so dropId is it.
 */
export function loadTripsOf(
  rows: ReadonlyArray<Pick<FloorInvoiceRow, "id" | "seq" | "tripDropId">>,
  tripOfDrop: (dropId: number) => number | null | undefined,
): Array<{ tripId: number; dropId: number; rowIds: number[] }> {
  const out: Array<{ tripId: number; dropId: number; rowIds: number[] }> = [];
  for (const r of rows.slice().sort((a, b) => a.seq - b.seq)) {
    if (r.tripDropId === null) continue;
    const tripId = tripOfDrop(r.tripDropId);
    if (tripId === null || tripId === undefined) continue;
    const e = out.find((x) => x.tripId === tripId);
    if (e) e.rowIds.push(r.id);
    else out.push({ tripId, dropId: r.tripDropId, rowIds: [r.id] });
  }
  return out;
}

/** The OBD's rows carry a load group (only those carry loadRootId). */
export function hasLoadGroup(rows: ReadonlyArray<Pick<FloorInvoiceRow, "loadRootId">> | undefined): boolean {
  return rows !== undefined && rows.some((r) => r.loadRootId !== undefined);
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
export function inPool(r: Pick<FloorInvoiceRow, "tripDropId" | "isHeld" | "ci" | "isDispatched">): boolean {
  // 6.3: …and has no CI of its own (it is on the Cancel & CI tab). 6.4: …and
  // has not shipped.
  return r.tripDropId === null && r.isHeld !== true && !r.ci && r.isDispatched !== true;
}

/** A board row narrowed to To plan — its off-trip, NOT-held invoices (6.1). */
export function narrowToPool<T extends Narrowable>(row: T): T {
  return narrowWhere(row, inPool);
}

/** A hold row narrowed to its HELD invoices (the On hold tab, 6.1). */
export function narrowToHeld<T extends Narrowable>(row: T): T {
  // 6.3: a held invoice with its own CI is on the Cancel & CI tab instead.
  return narrowWhere(row, (r) => r.isHeld === true && !r.ci);
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
  all: readonly Pick<FloorInvoiceRow, "id" | "tripDropId" | "tripNumber" | "isHeld" | "ci" | "loadRootId">[],
  drawn: readonly Pick<FloorInvoiceRow, "id">[],
  shortTrip: (tripNumber: string) => string = (t) => t,
): { text: string; title: string } | null {
  const here = new Set(drawn.map((r) => r.id));
  const byPlace = new Map<string, { label: string; long: string; k: number }>();
  for (const r of all) {
    if (here.has(r.id)) continue;
    // 6.1: a held invoice is its own place — "2 on hold" (never on a trip).
    // 6.3: an invoice with its own CI is its own place — "1 with CI".
    const key = r.ci ? "ci" : r.isHeld === true ? "hold" : r.tripDropId === null ? "plan" : `t:${r.tripNumber ?? r.tripDropId}`;
    const e =
      byPlace.get(key) ??
      (r.ci
        ? { label: "with CI", long: "returned on a CI", k: 0 }
        : r.isHeld === true
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
  // Split load: every row is one invoice's truck parts → say "parts".
  const noun = isOneLoadGroup(all) ? "parts" : "invoices";
  return {
    text: parts.map((p) => `${p.k} ${p.label}`).join(" · "),
    title: `${parts.map((p) => `${p.k} of ${all.length} ${noun} ${p.long}`).join(", ")} — not shown here`,
  };
}

/** The typed invoice numbers (seq 2..n) — what the "+n" chip shows until commit 2.
 *  A Split load PART is not a typed paper (it repeats its root's number): skipped. */
export function addedInvoiceNosOf(invoiceRows: FloorInvoiceRow[]): string[] {
  return invoiceRows.filter((r) => r.seq > 1 && r.invoiceNo !== null && !isLoadPart(r)).map((r) => r.invoiceNo as string);
}

// ── SPLIT LOAD on the board (phase 3 commit 1, 2026-10-24) ──────────────────
//
// A truck PART is a row, but not a paper. Three things follow, all decided
// here with load-plan.ts loadGroupsOf (the ONE home of "which group, which
// part") and loadPartText (the ONE formatter) — never in a component:
//   · the Add-invoices "k/n" counts PAPERS (a group once), so a pure split load
//     has no "1/1" chip and its parts read "part 1 of 2" instead;
//   · the OBD cell's "n invoices" counts papers (paperCountOf);
//   · a group's parts are drawn directly under their paper (owner, 2026-10-24).
// 🔴 On a bill with NO load row every answer is exactly what it was before.

type GroupKey = Pick<FloorInvoiceRow, "id" | "seq" | "loadRootId">;

/** A truck part (not the group's root). */
function isLoadPart(r: Pick<FloorInvoiceRow, "id" | "loadRootId">): boolean {
  return r.loadRootId !== undefined && r.loadRootId !== r.id;
}

/** The loadGroupsOf input for a board row. */
function groupRow(r: GroupKey): { id: number; seq: number; loadParentId: number | null } {
  return { id: r.id, seq: r.seq, loadParentId: isLoadPart(r) ? (r.loadRootId as number) : null };
}

/** id → its load part (loadPartsOf) for a board row's invoice rows; a row in
 *  no load group is absent (F11). */
export function rowPartsOf(rows: readonly GroupKey[]): Map<number, LoadPart> {
  return loadPartsOf(rows.map(groupRow));
}

/** Every row is one load group (a pure split load of one paper). */
function isOneLoadGroup(rows: ReadonlyArray<Pick<FloorInvoiceRow, "loadRootId">>): boolean {
  return rows.length > 0 && rows[0].loadRootId !== undefined && rows.every((r) => r.loadRootId === rows[0].loadRootId);
}

/** How many SAP PAPERS these rows are — a load group counts once. Equals
 *  rows.length on every bill without a load row. */
export function paperCountOf(rows: ReadonlyArray<Pick<FloorInvoiceRow, "id" | "loadRootId">>): number {
  return new Set(rows.map((r) => r.loadRootId ?? r.id)).size;
}

/** Rows in DRAW order: papers by seq, each followed by its parts. The SAME
 *  array back when no row is in a load group (seq order, as before). The
 *  table (drawRowsOf) and the detail panel's Prev / Next (detail-scope.ts
 *  detailWalk) both walk it, so they cannot disagree. */
export function drawOrderOf<R extends GroupKey>(rows: readonly R[]): readonly R[] {
  if (!rows.some((r) => r.loadRootId !== undefined)) return rows;
  const bySeq = rows.slice().sort((a, b) => a.seq - b.seq);
  const out: R[] = [];
  for (const r of bySeq) {
    // A part is drawn under its root (a part whose root is missing stays by seq).
    if (isLoadPart(r) && bySeq.some((x) => x.id === r.loadRootId)) continue;
    out.push(r);
    if (r.loadRootId === r.id) out.push(...bySeq.filter((x) => isLoadPart(x) && x.loadRootId === r.id));
  }
  return out;
}

/**
 * "part 1 gone" — on a WAITING part whose group already has a dispatched part
 * (owner, 2026-10-24; amber, PairPlaceChip warn). null otherwise, and always
 * null on a row not in a load group.
 */
export function goneChipOf(
  all: ReadonlyArray<Pick<FloorInvoiceRow, "id" | "seq" | "invoiceNo" | "tripNumber" | "isDispatched" | "loadRootId">>,
  row: Pick<FloorInvoiceRow, "id" | "tripDropId" | "isDispatched" | "loadRootId">,
): { text: string; title: string } | null {
  if (row.loadRootId === undefined || row.isDispatched === true || row.tripDropId !== null) return null;
  const group = all.filter((r) => r.loadRootId === row.loadRootId);
  const gone = group.filter((r) => r.id !== row.id && r.isDispatched === true);
  if (gone.length === 0) return null;
  const places = loadGroupsOf(group.map(groupRow));
  const paper = group.find((r) => r.id === row.loadRootId)?.invoiceNo ?? "this invoice";
  return {
    text: `${gone.map((g) => loadPartText(places.get(g.id)!.k)).join(", ")} gone`,
    title: gone
      .map((g) => `${loadPartText(places.get(g.id)!.k)} of ${paper} left${g.tripNumber ? ` on ${g.tripNumber}` : ""}`)
      .join("; "),
  };
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
  /** 1-based position among the OBD's invoice ROWS (draw order), and their
   *  count (1 / 1 unsplit). n > 1 ⇔ the row is drawn as an invoice row. */
  k: number;
  n: number;
  first: boolean;
  last: boolean;
  /** The Add-invoices "k/n" chip to draw: the PAPER's place, a load group
   *  counted once; null when the OBD is ONE paper (a pure split load) or the
   *  row is not an invoice row. Equals { k, n } on every bill without a load row. */
  chip: { k: number; n: number } | null;
  /** Split load: this row's place in its load group ("part k of n"); null when
   *  the row is not in one. */
  load: { k: number; n: number } | null;
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
    return [{ key, row, invoice: null, k: 1, n: 1, first: true, last: true, chip: null, load: null }];
  }
  // Split load: papers by seq, each followed by its parts. With no load row
  // drawOrderOf hands back the SAME array, and every value is as before.
  const order = drawOrderOf(all);
  const shown = row.invoiceRows ?? [];
  const inv = order === all ? shown : order.filter((a) => shown.some((s) => s.id === a.id));
  const n = all.length;
  const groups = order === all ? null : loadGroupsOf(order.map(groupRow));
  const papers = groups === null ? null : order.filter((r) => !isLoadPart(r)).map((r) => r.id);
  return inv.map((invoice, i) => {
    const k = order.findIndex((a) => a.id === invoice.id) + 1;
    const place = groups?.get(invoice.id);
    const paperK = papers === null ? k : papers.indexOf(place?.rootId ?? invoice.id) + 1;
    const paperN = papers === null ? n : papers.length;
    return {
      key: `inv:${invoice.id}`,
      row,
      invoice,
      k,
      n,
      first: i === 0,
      last: i === inv.length - 1,
      chip: paperN > 1 ? { k: paperK, n: paperN } : null,
      load: place !== undefined && place.n > 1 ? { k: place.k, n: place.n } : null,
    };
  });
}

/** Every OBD row of a list, expanded in order — ONE rule for the table and the pager. */
export function drawRows<T extends Drawable>(rows: readonly T[]): InvoiceDrawRow<T>[] {
  return rows.flatMap((r) => drawRowsOf(r));
}
