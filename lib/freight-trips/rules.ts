// lib/freight-trips/rules.ts — the freight refusals that need no database.
// PURE and CLIENT-SAFE. Tests: lib/freight-trips/rules.test.ts
// (npx tsx --test lib/freight-trips/rules.test.ts).

/**
 * SPLIT LOAD (Phase 4 batch 2, plan F9): a bill whose invoice is split across
 * trucks is never on a freight paper trip — a freight trip holds WHOLE bills.
 * The pool leaves it out (pool.ts); an add that names it anyway is skipped
 * with this.
 */
export function splitLoadFreightRefusal(obdNumber: string): string {
  return `${obdNumber} is split across trucks — merge its parts back first`;
}
