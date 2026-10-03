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
// SELECT-only. Sequential awaits, never prisma.$transaction (CORE §3).

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getHideExclusion } from "@/lib/hide/visibility";

/** A typed term, normalised: the upper-cased whole number, plus the invoice forms to try. */
export interface BillLookupTerm {
  q: string;
  invoiceTerms: string[];
}

/**
 * Normalise what was typed, or null when it is not ONE full number — the same
 * test the client's lookupTermOf applies (OBD / SO 9-12 digits, or `I` + 9).
 */
export function parseBillLookupTerm(raw: string): BillLookupTerm | null {
  const q = raw.trim().toUpperCase();
  if (!/^\d{9,12}$/.test(q) && !/^I\d{9}$/.test(q)) return null;

  const invoiceTerms: string[] = [];
  if (/^I\d{9}$/.test(q)) invoiceTerms.push(q);
  else if (/^\d{9}$/.test(q)) invoiceTerms.push(`I${q}`);
  else if (/^1\d{9}$/.test(q)) invoiceTerms.push(`I${q.slice(1)}`);

  return { q, invoiceTerms };
}

/**
 * The WHERE for a term: not removed, hide rules applied, whole-number match on
 * OBD / SO / invoice. `onTripOnly` adds `tripDropId IS NOT NULL` (the trip
 * lookup); leave it off to find bills on no trip as well.
 */
export async function billLookupWhere(
  term: BillLookupTerm,
  opts: { onTripOnly?: boolean } = {},
): Promise<Prisma.ordersWhereInput> {
  const hide = await getHideExclusion();
  return {
    AND: [
      {
        isRemoved: false,
        ...(opts.onTripOnly ? { tripDropId: { not: null } } : {}),
        OR: [
          { obdNumber: term.q },
          { soNumber: term.q },
          ...term.invoiceTerms.map((t) => ({ invoiceNo: t })),
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
  opts: { onTripOnly?: boolean } = {},
): Promise<Prisma.ordersGetPayload<{ select: S }>[]> {
  const where = await billLookupWhere(term, opts);
  return (await prisma.orders.findMany({
    where,
    select,
    orderBy: { obdNumber: "asc" },
    take: BILL_LOOKUP_MAX,
  })) as Prisma.ordersGetPayload<{ select: S }>[];
}
