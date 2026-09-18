// lib/trips/type-choice.ts
//
// Which delivery type a trip built from ticked bills is NUMBERED under.
//
// 🔴 THE NUMBER IS AN IDENTIFIER, NOT A CLASSIFICATION (owner, 2026-09-18). A
// trip may carry bills of more than one delivery type — a Varachha (Local) and
// a Kamrej (Upcountry) load share a truck, and that is ordinary. The number
// still needs ONE letter (chk_trips_number_shape), so it takes the type with
// the most bills. What the trip actually HOLDS is read off its bills, never off
// this letter.
//
// The rule, in order:
//   1. Bills with no delivery type are ignored. If nothing typed is left there
//      is no answer — null, and the caller refuses as before.
//   2. The type with the most bills wins.
//   3. A tie goes to the ACTIVE TAB when a typed tab is selected and it is one
//      of the tied types — on the Upcountry tab, a Local/Upcountry tie is U.
//   4. Otherwise (the All tab, or a tab that is not among the tied types) the
//      type of the FIRST BILL TICKED among the tied types wins.
// No type is a special default: Local does not win a tie on the Upcountry tab.
//
// PURE and client-safe — no prisma, no server imports — so the bottom bar can
// call it and a test can check it without a database.

import type { FloorScope } from "@/lib/floor/types";

/**
 * @param typesInTickOrder each ticked bill's delivery type name, in the order
 *   the bills were TICKED (a Set's insertion order), null for an untyped bill.
 * @param scope the page's active delivery-type tab.
 * @returns the delivery type name to number the trip under, or null when no
 *   ticked bill carries a type.
 */
export function chooseTripTypeName(
  typesInTickOrder: ReadonlyArray<string | null>,
  scope: FloorScope,
): string | null {
  const counts = new Map<string, number>();
  const firstSeen: string[] = [];
  for (const name of typesInTickOrder) {
    if (!name) continue;
    if (!counts.has(name)) firstSeen.push(name);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  if (firstSeen.length === 0) return null;

  const max = Math.max(...Array.from(counts.values()));
  // Kept in first-ticked order, so tied[0] IS rule 4.
  const tied = firstSeen.filter((n) => counts.get(n) === max);
  if (tied.length === 1) return tied[0];
  if (scope !== "All" && tied.includes(scope)) return scope;
  return tied[0];
}
