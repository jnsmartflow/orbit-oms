// lib/tint/base-bills.ts — "is this a BASE bill on the Tint Manager?" (2026-10-02)
//
// ONE helper, two forms, and NO SECOND COLOUR RULE.
//
// A Base bill is a project-division bill (SMU 74 / 77) that ships in the colour
// it arrived in. Two kinds reach the Base tab:
//   1. non-tint SMU 74/77 bills — BASE_BILL_WHERE (lib/tint/manager-bill.ts);
//   2. "Base — No Tint" bills — imported as tint, closed by the placeholder
//      worker (lib/tint/base-operator.ts) because nothing needed mixing.
//      They carry orderType "tint" forever, and the Tint tab excludes them.
//
// Which bills are base is decided by Picking's rule, lib/picking/colour-work.ts
// resolveColourWork — through the `colourWork` field getFloorBoard already
// fills (lib/picking/colour-work-query.ts). It handles the edge cases: a real
// operator's finish WINS over a placeholder finish, and a tint bill still in the
// tint room is null, never base. So:
//   - `tintManagerBaseWhere()` is only a SUPERSET FILTER for the database read.
//     It narrows the query and decides nothing.
//   - `isTintManagerBaseRow()` is the DECISION: colourWork === "base".
// Every Base surface uses both: the feed (live + history), and through the feed
// the header search's Base source. The marker's Base arm uses the superset,
// where an extra refresh is harmless.

import type { Prisma } from "@prisma/client";
import type { ColourWork } from "@/lib/picking/colour-work";
import { PROJECT_SMU_NAMES } from "@/lib/billing/pick-delete-rule";
import { getBaseOperatorId } from "@/lib/tint/base-operator";
import { TINT_STATUS_DONE } from "@/lib/tint/assignment-status";
import { BASE_BILL_WHERE } from "@/lib/tint/manager-bill";

/**
 * SUPERSET filter: non-tint SMU 74/77 bills, OR SMU 74/77 tint bills with a
 * finished placeholder-owned assignment (getBaseOperatorId(), never a fixed id).
 * With no placeholder row, only kind 1 matches (fails closed).
 */
export async function tintManagerBaseWhere(): Promise<Prisma.ordersWhereInput> {
  const baseOperatorId = await getBaseOperatorId();
  if (baseOperatorId === null) return BASE_BILL_WHERE;
  return {
    OR: [
      BASE_BILL_WHERE,
      {
        orderType: "tint",
        smu: { in: [...PROJECT_SMU_NAMES] },
        tintAssignments: { some: { assignedToId: baseOperatorId, status: TINT_STATUS_DONE } },
      },
    ],
  };
}

/** The DECISION, Picking's rule: the bill ships as base. */
export function isTintManagerBaseRow(r: { colourWork: ColourWork | null }): boolean {
  return r.colourWork === "base";
}

/** A Base row that is a "Base — No Tint" bill (tint-typed, base by the rule) —
 *  the Base tab's small grey "No tint" tag. */
export function isNoTintBaseRow(r: { isTint: boolean; colourWork: ColourWork | null }): boolean {
  return r.isTint && r.colourWork === "base";
}
