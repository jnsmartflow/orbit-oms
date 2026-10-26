// lib/order-invoices/trip-bills.ts — WHICH INVOICE ROWS A TRIP PRESS MOVES
// (Add invoices, Phase 5 commit 2, 2026-10-15). PURE: no Prisma, no clock.
// Tests: lib/order-invoices/trip-bills.test.ts
// (npx tsx --test lib/order-invoices/trip-bills.test.ts).
//
// POST /api/floor/trips/[id]/bills takes whole OBDs, or chosen invoice rows of
// an OBD (`invoiceRowIds`). These two functions decide, per invoice row, what
// the press does to it; the route then writes through lib/order-invoices/
// trip-link.ts setRowsTrip (the only trip writer).
//
//   ADD    a row on no trip → attaches · already on THIS trip at the OBD's stop
//          → nothing to do · on THIS trip at another stop → refused · on ANOTHER
//          trip → refused FOR THAT INVOICE ONLY, the rest still attach. Every
//          attached row of one OBD lands on the OBD's one stop (the customer's
//          dropKey — unchanged), so an OBD never spreads over two stops of a trip.
//   REMOVE only rows on THIS trip come off. A chosen row that is not on this
//          trip is refused for that invoice. Never touches another trip's rows.
//
// 🔴 AN UNSPLIT OBD (one row) KEEPS TODAY'S WORDING, byte for byte —
// "Already on L-… — remove it from that trip first." / "Already attached to a
// different stop on this trip." / "Not on this trip". A SPLIT OBD's refusal
// names the invoice: "I536230713 is already on L-… — remove it from that trip first".
//
// SPLIT LOAD (2026-10-24, v27.76): TWO PARTS OF ONE INVOICE NEVER RIDE ONE TRIP
// — the paper is one, the trucks are several. A row whose group (`loadRootId`)
// already has another row on THIS trip, or a second row of the group in this
// press, is refused for that row only: "I536230716 part 2 of 2 — part 1 of the
// same invoice is already on this trip". Only rows of a load group carry
// loadRootId, so every other row — and every wording above — is unchanged.
// A MOVE onto a trip is a join too (moveRefusals, Phase 4 batch 1, 2026-10-25):
// the same test, the same words.

import { loadGroupsOf, loadPartsOf, loadPartText, withLoadPart, type LoadPart } from "./load-plan";

/** One invoice row of the OBD, with where it sits now. */
export interface TripBillRow {
  id: number;
  seq: number;
  invoiceNo: string | null;
  tripDropId: number | null;
  /** The stop's trip / dropKey / trip number; all null when on no stop. */
  tripId: number | null;
  dropKey: string | null;
  tripNumber: string | null;
  /** 6.3 — the row's own hold (6.1) and its own CI number (any non-voided CI on
   *  THIS row; "" = a draft with no number yet). Read for a SPLIT OBD only:
   *  an unsplit row's isHeld drifted and is never read. Omitted = neither. */
  isHeld?: boolean;
  ciNumber?: string | null;
  /** Split load — the row's group root id (its own id when it is a root with
   *  parts). Absent / null on every row not in a load group. */
  loadRootId?: number | null;
}

export interface RowRefusal {
  rowId: number;
  invoiceNo: string | null;
  error: string;
}

/**
 * How a split OBD's invoice is named in a refusal: its number, else its place.
 * With `part` (a load group's row — rowLabelOf fills it) the part follows:
 * "I536233980 part 2 of 2". Absent → today's words, byte for byte.
 */
export function invoiceLabel(row: Pick<TripBillRow, "seq" | "invoiceNo"> & { part?: LoadPart }, obdNumber: string): string {
  return withLoadPart(row.invoiceNo ?? `Invoice ${row.part?.rootSeq ?? row.seq} of ${obdNumber}`, row.part);
}

/** Each row's load part, from its loadRootId (loadPartsOf) — none for a row outside a group. */
function partsOf(rows: readonly TripBillRow[]): Map<number, LoadPart> {
  return loadPartsOf(
    rows.map((x) => ({ id: x.id, seq: x.seq, loadParentId: x.loadRootId === undefined || x.loadRootId === null || x.loadRootId === x.id ? null : x.loadRootId })),
  );
}

/** invoiceLabel with the row's load part (F11) — the label every refusal here prints. */
export function rowLabelOf(rows: readonly TripBillRow[], row: Pick<TripBillRow, "id" | "seq" | "invoiceNo">, obdNumber: string): string {
  return invoiceLabel({ ...row, part: partsOf(rows).get(row.id) }, obdNumber);
}

/**
 * Split load: "I536230716 part 2 of 2 — part 1 of the same invoice is already
 * on this trip" when ANOTHER row of r's load group is on `tripId` or already
 * attaching in this press, else null. Never fires for a row without loadRootId.
 */
function sameInvoiceOnTrip(
  rows: readonly TripBillRow[],
  r: TripBillRow,
  tripId: number,
  attaching: readonly number[],
  obdNumber: string,
): string | null {
  if (r.loadRootId === undefined || r.loadRootId === null) return null;
  const rootId = r.loadRootId;
  const other = rows.find(
    (x) => x.id !== r.id && x.loadRootId === rootId && ((x.tripDropId !== null && x.tripId === tripId) || attaching.includes(x.id)),
  );
  if (!other) return null;
  const places = loadGroupsOf(rows.map((x) => ({ id: x.id, seq: x.seq, loadParentId: x.loadRootId === undefined || x.loadRootId === null || x.loadRootId === x.id ? null : x.loadRootId })));
  const me = places.get(r.id)!;
  const root = rows.find((x) => x.id === rootId) ?? r;
  return `${invoiceLabel(root, obdNumber)} ${loadPartText(me.k, me.n)} — ${loadPartText(places.get(other.id)!.k)} of the same invoice is already on this trip`;
}

/** The rows a press is about: every row ('all') or the chosen ones. */
function targetsOf(rows: readonly TripBillRow[], chosen: readonly number[] | "all"): TripBillRow[] {
  if (chosen === "all") return rows.slice();
  const ids = new Set(chosen);
  return rows.filter((r) => ids.has(r.id));
}

/** Chosen ids that are not rows of this OBD — the route refuses the OBD. */
export function foreignRowIds(rows: readonly TripBillRow[], chosen: readonly number[] | "all"): number[] {
  if (chosen === "all") return [];
  const own = new Set(rows.map((r) => r.id));
  return Array.from(new Set(chosen)).filter((id) => !own.has(id));
}

export interface AddRowsPlan {
  /** Rows on no trip — attach to the OBD's stop on this trip. */
  attach: number[];
  /** Rows already at the OBD's stop on this trip — nothing to do. */
  here: number[];
  refused: RowRefusal[];
}

/**
 * ADD: what happens to each target row when the OBD is added to `tripId`,
 * whose stop for this OBD's customer is `dropKey`.
 */
export function planAddRows(
  rows: readonly TripBillRow[],
  chosen: readonly number[] | "all",
  tripId: number,
  dropKey: string,
  obdNumber: string,
): AddRowsPlan {
  const split = rows.length >= 2;
  const plan: AddRowsPlan = { attach: [], here: [], refused: [] };
  for (const r of targetsOf(rows, chosen)) {
    // 6.3 (owner, 2026-10-19) — a SPLIT OBD's HELD invoice never joins a trip:
    // release it first. One with its own CI is finished. That invoice only;
    // the rest still attach. An unsplit bill keeps today's rule (a held bill
    // may sit on a trip).
    if (split && r.tripDropId === null && r.isHeld === true) {
      plan.refused.push({ rowId: r.id, invoiceNo: r.invoiceNo, error: `${rowLabelOf(rows, r, obdNumber)} is on hold — release it first` });
    } else if (split && r.tripDropId === null && r.ciNumber !== undefined && r.ciNumber !== null) {
      plan.refused.push({
        rowId: r.id,
        invoiceNo: r.invoiceNo,
        error: `${rowLabelOf(rows, r, obdNumber)} is returned on ${r.ciNumber === "" ? "a CI" : r.ciNumber} — it does not go out`,
      });
    } else if (r.tripDropId === null) {
      // Split load: one part of an invoice per trip (null on every other row).
      const twin = sameInvoiceOnTrip(rows, r, tripId, plan.attach, obdNumber);
      if (twin !== null) plan.refused.push({ rowId: r.id, invoiceNo: r.invoiceNo, error: twin });
      else plan.attach.push(r.id);
    } else if (r.tripId === tripId) {
      if (r.dropKey === dropKey) plan.here.push(r.id);
      else plan.refused.push({ rowId: r.id, invoiceNo: r.invoiceNo, error: "Already attached to a different stop on this trip." });
    } else if (r.tripNumber === null) {
      // A stop with no readable trip (the old route's own fallback wording).
      plan.refused.push({ rowId: r.id, invoiceNo: r.invoiceNo, error: "Already attached to a different stop on this trip." });
    } else {
      plan.refused.push({
        rowId: r.id,
        invoiceNo: r.invoiceNo,
        error: split
          ? `${rowLabelOf(rows, r, obdNumber)} is already on ${r.tripNumber} — remove it from that trip first`
          : `Already on ${r.tripNumber} — remove it from that trip first.`,
      });
    }
  }
  return plan;
}

export interface RemoveRowsPlan {
  /** Rows on this trip — come off. */
  detach: number[];
  /** The stops they are coming off (each checked for empty afterwards). */
  dropIds: number[];
  /** Chosen rows not on this trip (never for a whole-OBD remove). */
  refused: RowRefusal[];
}

/** REMOVE: which target rows come off `tripId`. */
export function planRemoveRows(
  rows: readonly TripBillRow[],
  chosen: readonly number[] | "all",
  tripId: number,
  obdNumber: string,
): RemoveRowsPlan {
  const plan: RemoveRowsPlan = { detach: [], dropIds: [], refused: [] };
  for (const r of targetsOf(rows, chosen)) {
    if (r.tripDropId !== null && r.tripId === tripId) {
      plan.detach.push(r.id);
      if (!plan.dropIds.includes(r.tripDropId)) plan.dropIds.push(r.tripDropId);
    } else if (chosen !== "all") {
      plan.refused.push({ rowId: r.id, invoiceNo: r.invoiceNo, error: `${rowLabelOf(rows, r, obdNumber)} is not on this trip` });
    }
  }
  return plan;
}

export interface MoveRowsPlan {
  /** Rows leaving the source that may land on the target. */
  move: number[];
  /** Rows that would put two parts of one invoice on the target. */
  refused: RowRefusal[];
}

/**
 * MOVE (split load): of the rows leaving the source (`detach`, planRemoveRows),
 * which may land on `tripId`. A row whose load group already has another row on
 * that trip — or a second row of the group in this press — is refused for that
 * row only, with the add branch's words. A row without loadRootId always moves,
 * so every unsplit and Add-invoices move is what it was.
 */
export function moveRefusals(
  rows: readonly TripBillRow[],
  detach: readonly number[],
  tripId: number,
  obdNumber: string,
): MoveRowsPlan {
  const plan: MoveRowsPlan = { move: [], refused: [] };
  for (const id of detach) {
    const r = rows.find((x) => x.id === id);
    if (!r) continue;
    const twin = sameInvoiceOnTrip(rows, r, tripId, plan.move, obdNumber);
    if (twin !== null) plan.refused.push({ rowId: r.id, invoiceNo: r.invoiceNo, error: twin });
    else plan.move.push(r.id);
  }
  return plan;
}
