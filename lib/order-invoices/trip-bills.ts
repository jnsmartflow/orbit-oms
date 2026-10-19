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
}

export interface RowRefusal {
  rowId: number;
  invoiceNo: string | null;
  error: string;
}

/** How a split OBD's invoice is named in a refusal: its number, else its place. */
export function invoiceLabel(row: Pick<TripBillRow, "seq" | "invoiceNo">, obdNumber: string): string {
  return row.invoiceNo ?? `Invoice ${row.seq} of ${obdNumber}`;
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
      plan.refused.push({ rowId: r.id, invoiceNo: r.invoiceNo, error: `${invoiceLabel(r, obdNumber)} is on hold — release it first` });
    } else if (split && r.tripDropId === null && r.ciNumber !== undefined && r.ciNumber !== null) {
      plan.refused.push({
        rowId: r.id,
        invoiceNo: r.invoiceNo,
        error: `${invoiceLabel(r, obdNumber)} is returned on ${r.ciNumber === "" ? "a CI" : r.ciNumber} — it does not go out`,
      });
    } else if (r.tripDropId === null) {
      plan.attach.push(r.id);
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
          ? `${invoiceLabel(r, obdNumber)} is already on ${r.tripNumber} — remove it from that trip first`
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
      plan.refused.push({ rowId: r.id, invoiceNo: r.invoiceNo, error: `${invoiceLabel(r, obdNumber)} is not on this trip` });
    }
  }
  return plan;
}
