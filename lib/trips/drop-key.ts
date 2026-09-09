// lib/trips/drop-key.ts
//
// THE drop identity. A drop is a CUSTOMER, not a bill — two bills for one shop
// are one stop (CLAUDE_TRIP_REPORT.md §4: "Drops = unique customers, not bill
// rows"). This module answers "which stop does this bill belong to", and it is
// the only place that question is answered.
//
// PURE. No Prisma, no clock, no I/O — so a route handler and a future client
// preview can both import it, and so it is testable without a database.
//
// 🔴 chk_trip_drops_key ENFORCES THIS IN THE DATABASE:
//   CHECK ("dropKey" = CASE WHEN "customerId" IS NOT NULL
//                           THEN 'c:' || "customerId"::text
//                           ELSE 's:' || "shipToCode" END)
// There is NO default on the column. Compute it wrong — or forget it — and the
// INSERT is rejected, not silently corrected. That is the design: the key is
// load-bearing enough that a drifted value must never reach a row.
//
// 🔴 THE 'c:' / 's:' PREFIXES ARE NOT DECORATION. `customerId` 1856 and a SAP
// `shipToCustomerId` of "1856" are different things in different id spaces. The
// prefixes are what stop a resolved customer and an unmatched bill's SAP code
// colliding onto one stop. Same class of mistake CORE §13's id-space landmine
// records — never compare ids across spaces, and never let two spaces share a
// key without a discriminator.

/** The prefix for a resolved `delivery_point_master` row. */
const CUSTOMER_PREFIX = "c:";
/** The prefix for an unmatched bill, keyed on SAP's own ship-to code. */
const SHIP_TO_PREFIX = "s:";

/**
 * The fields of an order this module needs. A structural subset, declared here
 * rather than importing the Prisma `orders` type, so a caller can pass a
 * narrowed `select` result without casting.
 */
export interface DropKeyInput {
  /** orders.customerId — the resolved ship-to, null on an unmatched bill. */
  customerId: number | null;
  /** orders.shipToOverrideCustomerId — the redirect target, when one resolved. */
  shipToOverrideCustomerId: number | null;
  /** orders.shipToCustomerId — SAP's own ship-to code. String, NOT NULL live. */
  shipToCustomerId: string;
}

/**
 * The EFFECTIVE delivery customer: the override when one resolved, otherwise
 * the plain customer.
 *
 * 🔴 THIS IS THE SEVENTH SITE OF ONE EXPRESSION, NOT A NEW RULE. The identical
 * fallback is written in lib/floor/queries.ts four times (rail :422, board :685,
 * hold :938, cancelled :1025), in app/api/floor/order/[orderId]/route.ts :129,
 * and in lib/picking/queue.ts :737-743 in its id form. Those six say
 * `shipToOverrideCustomer ?? customer` on hydrated relations; this says the same
 * thing on raw ids, which is what a drop key needs.
 *
 * ⚠ Do not "simplify" it to `shipToOverrideCustomerId ?? customerId` at a call
 * site instead of calling this. The point of the function is that there is one
 * place to change if the rule ever moves, and one place to read to find out
 * what the rule is.
 */
export function effectiveCustomerId(order: DropKeyInput): number | null {
  return order.shipToOverrideCustomerId ?? order.customerId;
}

/**
 * The drop key for a bill.
 *
 * `c:<customerId>` when the effective customer FK resolves, `s:<shipToCode>`
 * otherwise. Total — it always returns a string, which is what makes it usable
 * as a NOT NULL column and as the second half of UNIQUE (tripId, dropKey).
 *
 * ⚠ WHY THE FALLBACK EXISTS, measured 2026-09-09 against production: 482 live
 * bills carry NO `customerId` at all, and 259 carry `shipToOverride = true`
 * with a NULL `shipToOverrideCustomerId`. A key that were the FK alone would
 * collapse every unmatched bill on a trip onto ONE stop — unrelated shops, one
 * address, one signature line. The SAP code is the only identity such a bill
 * has, so it is what the fallback uses.
 *
 * ⚠ AND WHAT IT STILL GETS WRONG, recorded so nobody rediscovers it as a bug:
 * those 259 free-text redirects group under their ORIGINAL customer, because
 * the effective-customer rule falls through to `customerId` when the override
 * never resolved to a master row. That is wrong for a delivery and it is the
 * only answer the data supports. The fix is upstream, in how a redirect is
 * captured — do not invent an address here.
 */
export function computeDropKey(order: DropKeyInput): string {
  const customerId = effectiveCustomerId(order);
  return customerId !== null
    ? `${CUSTOMER_PREFIX}${customerId}`
    : `${SHIP_TO_PREFIX}${order.shipToCustomerId}`;
}

/**
 * The `shipToCode` to store on the drop row.
 *
 * Always SAP's own code, whether or not the customer FK resolved — the column
 * is NOT NULL and the CHECK reads it on the fallback branch. Kept as its own
 * one-line function so a caller cannot accidentally store the override's code
 * on one row and the original's on another and make two stops out of one shop.
 */
export function dropShipToCode(order: DropKeyInput): string {
  return order.shipToCustomerId;
}
