// lib/tint/customer-missing.ts — the Tint Manager's "missing customer" rule (2026-10-02).
//
// ONE rule, used by the chip count, the tab dots, the "Missing customer" filter,
// the row highlight + "+ Add Ship to" tag, the new-arrival nudge, the header
// search word and GET /api/tint/manager/missing-customers.
//
// A bill is a MISSING-CUSTOMER bill when:
//   - SMU is one of the two project divisions (PROJECT_SMU_NAMES: 74 Decorative
//     Projects, 77 Retail Offtake);
//   - it is open: not removed, not cancelled, not past support;
//   - `orders.customerMissing` is true: its SAP ship-to code is not in
//     delivery_point_master (stamped at import; flipped false by a re-import
//     or by the customer save's backfill, app/api/admin/customers POST).
// The ROUTE applies this (plus the admin hide rules). The page then marks only
// the bills it actually SHOWS today (rail, Base, Hold, and Tint / TI if any),
// via `missingOnBoard`: never CI, Delete or history.
//
// "URGENT TODAY" (the red chip): the bill's dispatch target day
// (`orders.dispatchTargetDate`, the slot's day) is today in IST, OR it is on a
// trip whose `tripDate` is today in IST. Decided in the route, per bill.
//
// PURE apart from Prisma TYPES: no prisma client, no clock, so client
// components import it too.

import type { Prisma } from "@prisma/client";
import { PROJECT_SMU_NAMES } from "@/lib/billing/pick-delete-rule";
import { SUPPORT_DONE_STAGE_NAMES } from "@/lib/workflow-stages";

/** The scope rule — AND it with the hide exclusion. */
export function customerMissingWhere(): Prisma.ordersWhereInput {
  return {
    customerMissing: true,
    smu:             { in: [...PROJECT_SMU_NAMES] },
    workflowStage:   { notIn: ["cancelled", ...SUPPORT_DONE_STAGE_NAMES] },
    isRemoved:       false,
  };
}

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
