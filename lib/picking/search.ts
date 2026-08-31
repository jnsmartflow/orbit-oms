// Picking — client-side search over already-loaded rows. Pure: no DB, no React.
//
// ⚠ PICKING'S OWN, DELIBERATELY NOT lib/floor/search.ts. That file is Floor's,
// and the two answer different questions:
//   • Floor's `Searchable` carries obdNumber / dealerName / route — it has NO
//     assignedToName and NO area, which are two of the five fields the picking
//     board must match on. Widening it to fit would silently change what
//     Floor's board finds, on every one of its surfaces at once.
//   • Floor also has a NUMBERS mode (3+ digit tokens, last-N-digit OBD tails,
//     pasted lists) driven by its Enter-to-search box. Picking filters live on
//     every keystroke, where "2" matching forty bills before "237" is finished
//     is the behaviour that mode exists to avoid.
// One owner per behaviour. Do not import that file here and do not import this
// one there.
//
// 🔴 THIS IS THE ONE PLACE THE MATCH RULE LIVES. It replaced the same
// expression copy-pasted into FOUR list memos in picking-board-mobile.tsx
// (filteredWaitingAll / filteredStillPicking / filteredNeedsCheck /
// filteredChecked), which is exactly how three of them stayed on
// customer-or-OBD while somebody widened the fourth. If a fifth list appears,
// it calls this — it does not grow its own copy.

/**
 * The narrowest shape the predicate needs — five fields, not the whole
 * PickingQueueRow. Same discipline as lib/floor/search.ts's `Searchable`:
 * typing against the fields actually read means a caller with a different row
 * shape (a future combined row, a test fixture) satisfies it without a cast,
 * and the signature documents the match surface on its face.
 */
export interface PickingSearchable {
  /** Never null (lib/picking/types.ts). */
  obdNumber: string;
  /** Never null. */
  dealerName: string;
  /** Nullable — an unmatched bill has no route. */
  route: string | null;
  /** Nullable — an unmatched bill has no area. */
  area: string | null;
  /** Nullable — an unassigned bill has no picker. */
  assignedToName: string | null;
  /**
   * False ⇒ the dealer is not in `delivery_point_master`. Matched against the
   * SYNTHETIC term "unmatched" below — this field is never itself displayed.
   */
  dealerInMaster: boolean;
}

/**
 * Does this bill match what was typed?
 *
 * ⚠ `q` MUST ARRIVE ALREADY TRIMMED AND ALREADY LOWERCASED. The board
 * normalises once, at its single `const q = query.trim().toLowerCase()`, and
 * every list memo reads that one value. Lowercasing again in here would run the
 * same transform once per row per keystroke for no benefit, and — worse — would
 * make it look safe to hand this a raw input string from some future call site.
 * It is not: a mixed-case `q` silently matches nothing.
 *
 * An EMPTY query matches everything. That is the honest answer to "no filter
 * applied", and it means a caller can drop the `q && …` guard if it wants to;
 * the four board memos keep theirs because it short-circuits before the call.
 *
 * NULL IS "no match on this field" — never a crash, and never a match. A bill
 * with no picker must not surface when someone searches a picker's name, and a
 * bill with no route must not surface on a route search. `?? ""` gives exactly
 * that, because "" only ever contains the empty string, which this function has
 * already returned true for.
 *
 * ⚠ PLAIN CASE-INSENSITIVE SUBSTRING, AND THAT IS THE WHOLE RULE. No accent
 * folding, no token splitting, no multi-term AND, no last-N-digit OBD tails.
 * Each of those is a real feature with a real cost, and none has been asked
 * for; adding one here changes every list on the board at once. Floor's numbers
 * mode is the closest precedent and it is deliberately not copied (see above).
 *
 * 🔴 SIX FIELDS NOW, AND THE SIXTH IS SYNTHETIC — "unmatched" (2026-08-31).
 * Before the SAP-name fallback landed, an unmastered bill's `dealerName` WAS
 * the literal "(Unmatched)", so typing "unmatched" found every one of them.
 * Nobody designed that, but it became the ONLY way to find them: the route
 * filter cannot reach a bill whose route is null (routeCounts skips it), so
 * these bills vanish the instant any route is selected. Giving them their real
 * SAP name would have silently deleted that escape hatch on the same commit
 * that made them findable by name — so the term is preserved DELIBERATELY, as
 * a synthetic value rather than as a leftover of how the name used to read.
 *
 * It behaves exactly like `route`/`area` above: a field that is "" for most
 * rows, and `"".includes(q)` is false for every non-empty q. So this widens the
 * match for unmastered bills ONLY and cannot affect any other row.
 */
export function matchesPickingSearch(row: PickingSearchable, q: string): boolean {
  if (q === "") return true;
  return (
    // Ordered cheapest-and-most-likely first: the two non-null fields lead, so
    // the common hit short-circuits before any ?? runs. Not a measured
    // optimisation — just no reason to order it the other way.
    row.dealerName.toLowerCase().includes(q) ||
    row.obdNumber.toLowerCase().includes(q) ||
    (row.assignedToName ?? "").toLowerCase().includes(q) ||
    (row.route ?? "").toLowerCase().includes(q) ||
    (row.area ?? "").toLowerCase().includes(q) ||
    // Already lowercase, so no .toLowerCase() — `q` arrives lowercased per this
    // function's contract above, and a literal cannot drift from itself.
    (row.dealerInMaster ? "" : "unmatched").includes(q)
  );
}
