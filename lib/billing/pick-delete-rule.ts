// lib/billing/pick-delete-rule.ts — PURE pieces of the bounded Pick delete read
// (2026-09-30). No Prisma, no clock — unit-tested in pick-delete-rule.test.ts.
// The SQL that uses them lives in lib/billing/pick-delete.ts (openGroupsSql).

/**
 * Every character JavaScript's String.prototype.trim() removes: WhiteSpace
 * (U+0009, U+000B, U+000C, U+0020, U+00A0, U+FEFF and category Zs) plus
 * LineTerminator (U+000A, U+000D, U+2028, U+2029). Handed to Postgres as the
 * character set of `btrim("soNumber", …)`, so the SQL's "blank SO" test is
 * exactly lib/picking/duplicate-so.ts nonBlankDistinct()'s `s.trim() !== ""`.
 * The test proves this list against trim() for every UTF-16 code unit.
 */
export const JS_TRIM_CHARS =
  "\u0009\u000A\u000B\u000C\u000D   " +
  "           " +
  "    　﻿";

/** One open same-SO group as the SQL returns it. */
export interface OpenGroupRow {
  so: string;
  /** Live twin ids, ascending. */
  ids: number[];
  /** MAX(orders.updatedAt) over the group's bills. */
  latest: Date | null;
  /** At least one bill passes the pickDeleteCheck predicates (SQL form). */
  actionable: boolean;
}

/** The marker from the rows + MAX(pick_delete_decisions.updatedAt) — the same arithmetic the old marker did. */
export function markerFromRows(
  rows: readonly OpenGroupRow[],
  decisionsLatest: Date | null,
): { count: number; latest: string | null } {
  const times = [decisionsLatest, ...rows.map((r) => r.latest)]
    .filter((d): d is Date => d !== null)
    .map((d) => d.getTime());
  return {
    count: rows.filter((r) => r.actionable).length,
    latest: times.length > 0 ? new Date(Math.max(...times)).toISOString() : null,
  };
}

/**
 * The list's group order: oldest first punch first, an unknown punch last —
 * the old rule — then SO number, so two groups with the same first punch no
 * longer fall back on whatever order the database returned twins in.
 */
export function compareGroups(
  a: { firstPunchAt: string | null; soNumber: string },
  b: { firstPunchAt: string | null; soNumber: string },
): number {
  return (a.firstPunchAt ?? "9999").localeCompare(b.firstPunchAt ?? "9999") || (a.soNumber < b.soNumber ? -1 : a.soNumber > b.soNumber ? 1 : 0);
}
