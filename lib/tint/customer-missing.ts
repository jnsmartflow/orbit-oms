// lib/tint/customer-missing.ts — the Tint Manager's "missing customer" rule (2026-10-02).
//
// ONE rule, used by the chip count, the tab dots, the "Missing customer" filter,
// the row highlight + "+ Add Ship to" tag, the new-arrival nudge, the header
// search word and GET /api/tint/manager/missing-customers.
//
// A bill is a MISSING-CUSTOMER bill when:
//   - SMU is one of the two project divisions (PROJECT_SMU_NAMES: 74 Decorative
//     Projects, 77 Retail Offtake);
//   - it is OPEN: not removed, not cancelled, not dispatched. ANY other stage
//     counts — picking, picked and checked included (2026-10-02 fix: the first
//     version fenced out every stage ranked >= 60, copied from the old badge,
//     so no Base bill past the support desk could ever qualify);
//   - its EFFECTIVE ship-to is not in the customer master: no ship-to override
//     customer is set (an override always points at a real master row — it is
//     a foreign key — so an overridden bill is NOT missing) AND either the SAP
//     ship-to code has no delivery_point_master row OR `orders.customerMissing`
//     is still true. The flag alone is not trusted (it is stamped at import and
//     only cleared by a re-import or the customer save's backfill), and the
//     master alone is not trusted either (a flag still set means nobody linked
//     the bill).
// The ROUTE applies this as ONE SQL statement (CUSTOMER_MISSING_IDS_SQL, a
// plain string so this file stays client-safe), then the admin hide rules. The page then marks only
// the bills it actually SHOWS today (rail, Base, Hold, and Tint / TI if any),
// via `missingOnBoard`: never CI, Delete or history.
//
// "URGENT TODAY" (the red chip): the bill's dispatch target day
// (`orders.dispatchTargetDate`, the slot's day) is today in IST, OR it is on a
// trip whose `tripDate` is today in IST. Decided in the route, per bill.
//
// PURE apart from Prisma TYPES: no prisma client, no clock, so client
// components import it too.

import { PROJECT_SMU_NAMES } from "@/lib/billing/pick-delete-rule";

/** The SMU names the rule covers — the SQL's $1. */
export const CUSTOMER_MISSING_SMUS: string[] = [...PROJECT_SMU_NAMES];

/**
 * THE RULE, as one read-only statement returning order ids. One LEFT JOIN on
 * the unique customerCode — no per-bill lookup. Run with
 * prisma.$queryRawUnsafe(CUSTOMER_MISSING_IDS_SQL, CUSTOMER_MISSING_SMUS).
 */
export const CUSTOMER_MISSING_IDS_SQL = `
  SELECT o.id
  FROM orders o
  LEFT JOIN delivery_point_master d ON d."customerCode" = o."shipToCustomerId"
  WHERE o.smu = ANY($1::text[])
    AND o."isRemoved" = false
    AND o."workflowStage" NOT IN ('cancelled', 'dispatched')
    AND o."shipToOverrideCustomerId" IS NULL
    AND (d.id IS NULL OR o."customerMissing" = true)
`;

/** One missing-customer bill, as the route returns it. */
export interface MissingCustomerBill {
  orderId:            number;
  obdNumber:          string;
  /** SAP ship-to code — the code the customer save creates. */
  shipToCustomerId:   string | null;
  shipToCustomerName: string | null;
  billToName:         string | null;
  smu:                string | null;
  orderType:          string;
  obdEmailDate:       string | null;
  /** Dispatch target day or trip day is today (IST) — see the header. */
  urgentToday:        boolean;
  /** orders.createdAt (import time), ISO — the missing-customer card's FIFO order. */
  createdAt:          string;
}

/** The Tint Manager places a bill can show today (ids). */
export interface BoardPresence {
  rail:    readonly number[];
  tinting: readonly number[];
  base:    readonly number[];
  ti:      readonly number[];
  hold:    readonly number[];
}
export type MissingPlace = keyof BoardPresence;

export interface MissingOnBoard {
  /** orderId → the bill, for every missing bill SHOWN on the board. */
  byOrder: Map<number, MissingCustomerBill>;
  /** How many shown missing bills each place holds (tab dots). */
  byPlace: Record<MissingPlace, number>;
  /** Where each shown bill is (first place found, rail first). */
  placeOf: Map<number, MissingPlace>;
  /** Shown missing bills that are urgent today. */
  urgent:  number;
}

const PLACES: MissingPlace[] = ["rail", "tinting", "base", "ti", "hold"];

/** Narrow the route's list to the bills the board actually shows. */
export function missingOnBoard(all: readonly MissingCustomerBill[], present: BoardPresence): MissingOnBoard {
  const want = new Map<number, MissingCustomerBill>();
  for (const b of all) want.set(b.orderId, b);
  const byOrder = new Map<number, MissingCustomerBill>();
  const placeOf = new Map<number, MissingPlace>();
  const byPlace: Record<MissingPlace, number> = { rail: 0, tinting: 0, base: 0, ti: 0, hold: 0 };
  for (const place of PLACES) {
    const seen = new Set<number>();
    for (const id of present[place]) {
      const b = want.get(id);
      if (!b || seen.has(id)) continue;
      seen.add(id);
      byPlace[place] += 1;
      byOrder.set(id, b);
      if (!placeOf.has(id)) placeOf.set(id, place);
    }
  }
  let urgent = 0;
  byOrder.forEach((b) => { if (b.urgentToday) urgent += 1; });
  return { byOrder, byPlace, placeOf, urgent };
}

/** The word the header search matches these bills on ("missing"). */
export const MISSING_CUSTOMER_SEARCH_TEXT = "missing customer";
