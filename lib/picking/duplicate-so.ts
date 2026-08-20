import { prisma } from "@/lib/prisma";

/**
 * Which of these SO numbers are carried by MORE THAN ONE live order.
 *
 * The signal means "same SO, go check" — not "this is wrong". A supervisor
 * opens the flagged bills and decides which is the real one; nothing here
 * blocks, edits or ranks anything.
 *
 * ⚠ BOUNDED ON PURPOSE. It asks only about the SO numbers on the rows a board
 * is already returning (`soNumber: { in: [...] }`), never about the whole
 * table. Do NOT "improve" it into an unbounded `having: { _count: { gt: 1 } }`
 * scan across all ~11k orders: the boards call this on every fetch, and the
 * answer for a bill that is not on screen is not wanted.
 *
 * WHAT COUNTS AS A TWIN — `isRemoved: false` AND `workflowStage <> 'cancelled'`,
 * and NOTHING else:
 *   - a DISPATCHED or legacy-'closed' twin DOES count. A re-punch of a bill
 *     that already shipped is precisely the case this exists for, so the stage
 *     ladder is deliberately NOT fenced at rank < 100.
 *   - `isRemoved` is the soft-delete read rule (CORE §3); a removed OBD is not
 *     a live bill.
 *   - no `dispatchStatus` term and no hide exclusion — a bill held, un-slotted,
 *     or admin-hidden is still a real bill sharing this SO, and Picking applies
 *     no hide filter at all (CORE §13 / PICKING §7). Both boards therefore get
 *     the same answer for the same SO.
 *
 * ⚠ BLANK AND NULL ARE NEVER FLAGGED. `orders.soNumber` is nullable and Postgres
 * groups every NULL into ONE group — an unguarded call would come back with a
 * single enormous group and paint every un-punched bill as a duplicate. The
 * filter below drops null/whitespace-only values BEFORE they can reach the
 * `in` list, and the result loop re-checks for null so the flag can never be
 * set from a null-vs-null match.
 *
 * ⚠ MATCHES THE RAW STORED VALUE — no trim, no normalisation. `.trim()` below
 * is a BLANKNESS TEST only; the value put into the `in` list is the untouched
 * string. A stored SO carrying a stray leading/trailing space would therefore
 * not match its clean twin. Verified 2026-08-20 by a read-only count: ZERO live
 * rows have `soNumber <> btrim(soNumber)`, so no normalisation is warranted —
 * inventing one would be guessing at data that does not exist.
 *
 * Owner: Picking. Floor imports it, the same way it imports assign/unassign and
 * the sort rule objects (PICKING §3/§4, FLOOR §"Ownership boundary") — one
 * owner per behaviour, so the two surfaces can never disagree about what a
 * duplicate is.
 *
 * SELECT-only, ONE query, sequential await, never `prisma.$transaction`
 * (CORE §3). It is a POST-FETCH enrichment: it adds no term to
 * `buildPickingWhere` / `floorLiveBaseWhere` / `getFloorLiveMarkerWhere`, so
 * neither live-sync marker moves and no board's row set changes.
 */
export async function getDuplicateSoNumbers(
  soNumbers: (string | null)[],
): Promise<Set<string>> {
  // Non-null, non-blank, de-duplicated. The `in` list is the raw values.
  const candidates = Array.from(
    new Set(soNumbers.filter((s): s is string => s !== null && s.trim() !== "")),
  );

  // Never query with an empty `in` list.
  if (candidates.length === 0) return new Set<string>();

  const groups = await prisma.orders.groupBy({
    by: ["soNumber"],
    where: {
      soNumber: { in: candidates },
      isRemoved: false,
      workflowStage: { not: "cancelled" },
    },
    _count: { _all: true },
  });

  const duplicates = new Set<string>();
  for (const g of groups) {
    if (g.soNumber !== null && g._count._all > 1) duplicates.add(g.soNumber);
  }
  return duplicates;
}
