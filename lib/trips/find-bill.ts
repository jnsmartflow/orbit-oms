// lib/trips/find-bill.ts
//
// FIND A BILL BY ONE FULL NUMBER — OBD, SO or invoice. Extracted 2026-10-03 from
// app/api/floor/trips/lookup/route.ts, unchanged in behaviour, so the trip
// lookup and the coming re-delivery search share ONE matching rule.
//
// Matches `orders` (isRemoved = false, admin hide rules applied as the board
// applies them) where the WHOLE number equals the OBD, the SO or the invoice.
// No suffix matching: tails are the client's job, over loaded rows only
// (lib/floor/search.ts).
//
// INVOICES are stored `I` + 9 digits (every live row — lib/ci/queries.ts). So
// `I536229654`, the bare `536229654`, and the misread `1536229654` (the `I` typed
// as a `1`) all look up `I536229654` — the same three forms lib/floor/search.ts
// accepts on the client.
//
// ⚠ ALWAYS A LIST. An invoice can cover two OBDs (a split bill) and an SO fans
// out to several; never findFirst.
//
// Indexes (pg_indexes, read 2026-09-29): orders_obdNumber_key,
// orders_invoiceNo_idx and idx_orders_sonumber — all three columns are indexed.
//
// ANY INVOICE OF THE OBD (Add invoices Phase 4 commit 1, 2026-10-13). A split
// OBD's typed invoices (order_invoices seq 2..n) find it too: the invoice forms
// are looked up in order_invoices FIRST (order_invoices_invoiceNo_idx), and the
// matching order ids join the match as `id IN (…)` — never an
// `invoices: { some }` term, which would sit a semi-join inside the OR and
// cost the index plan the three equality arms share. The matches per OBD come
// in seq order; the first (the lowest seq) is what a caller hands on as "open
// invoice k". A SPLIT LOAD's truck parts share their invoice number, so that
// number matches every part (Split load phase 4 batch 4): the Floor search and
// the re-delivery search use them all.
//
// SELECT-only. Sequential awaits, never prisma.$transaction (CORE §3).

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getHideExclusion } from "@/lib/hide/visibility";
import { NOT_CHALLAN_LINKED } from "@/lib/workflow-stages";
import { isOrbNumber } from "@/lib/challan-orders/orb-number";
import { ON_ANY_TRIP_WHERE } from "@/lib/order-invoices/trip-read";

/** A typed term, normalised: the upper-cased whole number, plus the invoice forms to try. */
export interface BillLookupTerm {
  q: string;
  invoiceTerms: string[];
}

/**
 * Normalise what was typed, or null when it is not ONE full number — the same
 * test the client's lookupTermOf applies (OBD / SO 9-12 digits, `I` + 9, or a
 * challan order's ORB number).
 *
 * ORB-YYYY-NNNNN (Challan orders slice 2, 2026-10-06) — a challan order's own
 * number, held in obdNumber (lib/challan-orders/orb-number.ts). It is never an
 * invoice, so no invoice forms are tried; it matches the obdNumber arm.
 */
export function parseBillLookupTerm(raw: string): BillLookupTerm | null {
  const q = raw.trim().toUpperCase();
  if (isOrbNumber(q)) return { q, invoiceTerms: [] };
  if (!/^\d{9,12}$/.test(q) && !/^I\d{9}$/.test(q)) return null;

  const invoiceTerms: string[] = [];
  if (/^I\d{9}$/.test(q)) invoiceTerms.push(q);
  else if (/^\d{9}$/.test(q)) invoiceTerms.push(`I${q}`);
  else if (/^1\d{9}$/.test(q)) invoiceTerms.push(`I${q.slice(1)}`);

  return { q, invoiceTerms };
}

/** One invoice row of an OBD that a term named. */
export interface InvoiceRowMatch {
  /** order_invoices.id */
  id: number;
  seq: number;
  invoiceNo: string;
  /** Split load — set on a truck part (its group root). */
  loadParentId: number | null;
}

/**
 * orderId → EVERY row a set of matched order_invoices rows names, seq order
 * (PURE — tested). A number is unique within an OBD for Add invoices and an
 * unsplit bill (validateSplit), so their list has length 1 and `[0]` is the
 * row the lookup named before Split load phase 4 batch 4. Only a SPLIT LOAD
 * (its parts copy the root's number) gives two or more.
 */
export function groupInvoiceMatches(
  rows: ReadonlyArray<{ orderId: number; id: number; seq: number; invoiceNo: string | null; loadParentId: number | null }>,
): Map<number, InvoiceRowMatch[]> {
  const map = new Map<number, InvoiceRowMatch[]>();
  const sorted = rows.slice().sort((a, b) => a.orderId - b.orderId || a.seq - b.seq);
  for (const r of sorted) {
    if (r.invoiceNo === null) continue;
    const list = map.get(r.orderId) ?? [];
    list.push({ id: r.id, seq: r.seq, invoiceNo: r.invoiceNo, loadParentId: r.loadParentId });
    map.set(r.orderId, list);
  }
  return map;
}

/**
 * orderId → the invoice rows the term's invoice forms name (any seq, seq
 * order — groupInvoiceMatches). ONE read on order_invoices_invoiceNo_idx; none
 * when the term has no invoice form (an OBD / SO / ORB number). Seq 1 mirrors
 * orders.invoiceNo, so a SAP number answers seq 1 here as well. Callers that
 * want "the invoice the number named" take `[0]` — the lowest seq, as before.
 */
export async function invoiceRowMatches(term: BillLookupTerm): Promise<Map<number, InvoiceRowMatch[]>> {
  if (term.invoiceTerms.length === 0) return new Map();
  const rows = await prisma.order_invoices.findMany({
    where: { invoiceNo: { in: term.invoiceTerms } },
    orderBy: [{ orderId: "asc" }, { seq: "asc" }],
    select: { orderId: true, id: true, seq: true, invoiceNo: true, loadParentId: true },
  });
  return groupInvoiceMatches(rows);
}

/**
 * The WHERE for a term: not removed, hide rules applied, whole-number match on
 * OBD / SO / invoice. `onTripOnly` adds "an invoice row is on a stop" (the
 * trip lookup; through order_invoices since v27.66, lib/order-invoices/
 * trip-read.ts); leave it off to find bills on no trip as well.
 *
 * `invoiceMatches` — invoiceRowMatches(term), when the caller already read it
 * (to report the matched invoice); read here otherwise.
 */
export async function billLookupWhere(
  term: BillLookupTerm,
  opts: { onTripOnly?: boolean; invoiceMatches?: Map<number, InvoiceRowMatch[]> } = {},
): Promise<Prisma.ordersWhereInput> {
  const hide = await getHideExclusion();
  const matched = Array.from((opts.invoiceMatches ?? (await invoiceRowMatches(term))).keys());
  return {
    AND: [
      {
        isRemoved: false,
        // 🔴 A SAP bill linked to a challan order is FOUND BY NOTHING here
        // (Challan orders slice 2, 2026-10-06, design D9): not by the Floor
        // search box, the trip lookup or the re-delivery search — typing its SO
        // would otherwise surface a bill that is on no board. NOT NULL column.
        ...NOT_CHALLAN_LINKED,
        ...(opts.onTripOnly ? ON_ANY_TRIP_WHERE : {}),
        OR: [
          { obdNumber: term.q },
          { soNumber: term.q },
          ...term.invoiceTerms.map((t) => ({ invoiceNo: t })),
          // Any invoice of the OBD, typed ones included (looked up above).
          ...(matched.length > 0 ? [{ id: { in: matched } }] : []),
        ],
      },
      hide,
    ],
  };
}

/** One SO can fan out to several OBDs; far more than a handful is not a lookup any more. */
export const BILL_LOOKUP_MAX = 50;

/**
 * The matching bills, OBD ascending, at most BILL_LOOKUP_MAX, with the caller's
 * own `select`.
 */
export async function findBillsByNumber<S extends Prisma.ordersSelect>(
  term: BillLookupTerm,
  select: S,
  opts: { onTripOnly?: boolean; invoiceMatches?: Map<number, InvoiceRowMatch[]> } = {},
): Promise<Prisma.ordersGetPayload<{ select: S }>[]> {
  const where = await billLookupWhere(term, opts);
  return (await prisma.orders.findMany({
    where,
    select,
    orderBy: { obdNumber: "asc" },
    take: BILL_LOOKUP_MAX,
  })) as Prisma.ordersGetPayload<{ select: S }>[];
}
