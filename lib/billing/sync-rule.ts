// lib/billing/sync-rule.ts — PURE rules of POST /api/billing/sync (live feed billing 2b-i, 2026-09-30).
// No Prisma, no clock. Tested in sync-rule.test.ts. Server side: lib/billing/sync.ts.
//
// "Touched" answers ONE question per Billing arm: could this batch of changed ids have moved what
// that arm shows (its pill count, or the rows of its tab if open)? It is deliberately a SUPERSET —
// a false "yes" costs one recount; a false "no" would leave a stale pill until the next change. The
// client's `shown` ids cover a row LEAVING an open tab; the rules below cover everything the
// current state of the changed rows can tell.

export const SYNC_MAX_IDS = 1000;
export const SYNC_MAX_SHOWN = 2000;

export interface SyncBody {
  orderIds: number[];
  tripIds: number[];
  soTagChanged: boolean;
  mailOrderIds: number[];
  shown: {
    pickingIds: number[];
    printTripIds: number[];
    telephonicOrderIds: number[];
    pickDeleteIds: number[];
  };
}

const isId = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;

function ids(v: unknown, max: number, name: string): number[] | string {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) return `${name} must be an array of positive integers`;
  if (v.length > max) return `${name} may hold at most ${max} ids`;
  if (!v.every(isId)) return `${name} must be an array of positive integers`;
  return Array.from(new Set(v as number[]));
}

/** Validate the request body → the body, or the 400 message. Every field optional (absent = empty). */
export function parseSyncBody(raw: unknown): SyncBody | string {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const s = (b.shown && typeof b.shown === "object" ? b.shown : {}) as Record<string, unknown>;
  const orderIds = ids(b.orderIds, SYNC_MAX_IDS, "orderIds");
  const tripIds = ids(b.tripIds, SYNC_MAX_IDS, "tripIds");
  const mailOrderIds = ids(b.mailOrderIds, SYNC_MAX_IDS, "mailOrderIds");
  const pickingIds = ids(s.pickingIds, SYNC_MAX_SHOWN, "shown.pickingIds");
  const printTripIds = ids(s.printTripIds, SYNC_MAX_SHOWN, "shown.printTripIds");
  const telephonicOrderIds = ids(s.telephonicOrderIds, SYNC_MAX_SHOWN, "shown.telephonicOrderIds");
  const pickDeleteIds = ids(s.pickDeleteIds, SYNC_MAX_SHOWN, "shown.pickDeleteIds");
  for (const r of [orderIds, tripIds, mailOrderIds, pickingIds, printTripIds, telephonicOrderIds, pickDeleteIds]) {
    if (typeof r === "string") return r;
  }
  if (b.soTagChanged !== undefined && typeof b.soTagChanged !== "boolean") return "soTagChanged must be a boolean";
  return {
    orderIds: orderIds as number[],
    tripIds: tripIds as number[],
    soTagChanged: b.soTagChanged === true,
    mailOrderIds: mailOrderIds as number[],
    shown: {
      pickingIds: pickingIds as number[],
      printTripIds: printTripIds as number[],
      telephonicOrderIds: telephonicOrderIds as number[],
      pickDeleteIds: pickDeleteIds as number[],
    },
  };
}

/** What the server read about the changed orders (one row per changed order id that still exists). */
export interface OrderFact {
  id: number;
  soNumber: string | null;
  workflowStage: string;
  invoicedAt: Date | null;
}

/**
 * The Picking arm's stages. A bill ENTERS or LEAVES the pending / info / done sets
 * (lib/billing/picking-where.ts) only by one of: reaching pick_checked (approve), leaving it for
 * dispatched or cancelled, a field change while still pick_checked (invoiceNo, invoicedAt,
 * dispatchStatus, isRemoved, isHidden — the stage is unchanged, so still pick_checked), or
 * invoicedAt moving on the day (mark done / undo). So after ANY such change the bill's CURRENT
 * stage is one of these three, or its invoicedAt is today.
 */
export const PICKING_TOUCH_STAGES: readonly string[] = ["pick_checked", "dispatched", "cancelled"];

export function pickingTouched(
  facts: readonly OrderFact[],
  shownPickingIds: readonly number[],
  changedOrderIds: readonly number[],
  istDay: { start: Date; end: Date },
): boolean {
  if (overlaps(changedOrderIds, shownPickingIds)) return true;
  return facts.some(
    (f) =>
      PICKING_TOUCH_STAGES.includes(f.workflowStage) ||
      (f.invoicedAt !== null && f.invoicedAt >= istDay.start && f.invoicedAt < istDay.end),
  );
}

/**
 * Pick delete: a same-SO group can only change when an order carrying an SO that at least TWO
 * orders carry changes — counted over EVERY order row with that SO (removed and cancelled
 * included), so a group LOSING a bill (pick delete cancels it; an import removes it) still counts.
 * A decision row (All OK, pick delete, undo) arrives as order ids of that SO.
 */
export function pickDeleteTouched(
  soRowCounts: ReadonlyMap<string, number>,
  facts: readonly OrderFact[],
  shownPickDeleteIds: readonly number[],
  changedOrderIds: readonly number[],
): boolean {
  if (overlaps(changedOrderIds, shownPickDeleteIds)) return true;
  return facts.some((f) => f.soNumber !== null && (soRowCounts.get(f.soNumber) ?? 0) >= 2);
}

export function telephonicTouched(
  soTagChanged: boolean,
  matchedOrderIds: readonly number[],
  shownTelephonicOrderIds: readonly number[],
  changedOrderIds: readonly number[],
): boolean {
  return soTagChanged || matchedOrderIds.length > 0 || overlaps(changedOrderIds, shownTelephonicOrderIds);
}

export function printTouched(
  printRelevantTripIds: readonly number[],
  shownPrintTripIds: readonly number[],
  changedTripIds: readonly number[],
): boolean {
  return printRelevantTripIds.length > 0 || overlaps(changedTripIds, shownPrintTripIds);
}

export function overlaps(a: readonly number[], b: readonly number[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const set = new Set(b);
  return a.some((x) => set.has(x));
}
