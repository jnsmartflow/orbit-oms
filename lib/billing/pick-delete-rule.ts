// lib/billing/pick-delete-rule.ts — PURE pieces of the bounded Pick delete read
// (2026-09-30). No Prisma, no clock — unit-tested in pick-delete-rule.test.ts.
// The SQL that uses them lives in lib/billing/pick-delete.ts (openGroupsSql).

import { SMU_CODE_BY_NAME } from "@/lib/import-upsert/types";
import { isProjectSmu } from "@/lib/picking/colour-work";

// ── Who decides a group (2026-10-01, Tint Manager tabs build step 4) ─────────
//
// Plan: docs/prompts/drafts/code-discovery-2026-10-01-tint-manager-build-plan.md §E.
// A same-SO group whose EVERY live twin is SMU 74 (Decorative Projects) or 77
// (Retail Offtake) is decided on the TINT MANAGER; every other group — mixed, or
// any twin with no SMU — stays with BILLING. orders carries the SMU NAME
// (orders.smu), which is 1:1 with import_raw_summary.smuCode on every live bill
// (read-only SELECT 2026-10-01), so the rule reads the name.

/** The SMU names whose code is a project code (74 / 77) — DERIVED from
 *  SMU_CODE_BY_NAME (lib/import-upsert/types.ts) and PROJECT_SMU_CODES
 *  (lib/picking/colour-work.ts), never retyped. The SQL form in
 *  openGroupsCte() binds this same array. */
export const PROJECT_SMU_NAMES: readonly string[] = Object.entries(SMU_CODE_BY_NAME)
  .filter(([, code]) => isProjectSmu(code))
  .map(([name]) => name);

/** Which desk decides a same-SO group. */
export type PickDeleteOwner = "billing" | "tint";

/**
 * The owner of a group from its twins' SMU names: "tint" only when there is at
 * least one twin and EVERY twin is a project SMU. A null / blank / unknown SMU
 * anywhere → "billing" (the safe side: billing sees it). Empty → "billing".
 * 🔴 The SQL mirror is bool_and(coalesce(smu = ANY(names), false)) — the
 * coalesce is what makes a null SMU count as "not project" there too.
 */
export function ownerOfSmus(smus: readonly (string | null | undefined)[]): PickDeleteOwner {
  if (smus.length === 0) return "billing";
  return smus.every((s) => typeof s === "string" && PROJECT_SMU_NAMES.includes(s)) ? "tint" : "billing";
}

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
