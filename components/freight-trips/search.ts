// components/freight-trips/search.ts — what the freight search box matches.
//
// REUSES Floor's pure search (lib/floor/search.ts, imported READ-ONLY — never
// edited): parseSearch decides text vs a pasted list of numbers; matchesSearch
// matches OBD (full or a 3+ digit tail), invoice (full, `I`-as-`1`, or a 5+
// digit tail), SO, the effective ship-to / customer name, the route and the
// word "unmatched". A pasted list (spaces, commas, newlines) matches ANY number.
//
// ONE freight addition, here and not in Floor's file: in TEXT mode the BILL-TO
// name (row.billToName, the party billed on a site / project bill) matches too.

import { matchesSearch, parseSearch, type ParsedSearch } from "@/lib/floor/search";
import type { FloorHoldRow } from "@/lib/floor/types";

export { parseSearch, type ParsedSearch };

export function freightMatches(row: FloorHoldRow, parsed: ParsedSearch): boolean {
  if (matchesSearch(row, parsed)) return true;
  return parsed.mode === "text" && (row.billToName ?? "").toLowerCase().includes(parsed.text);
}

/** Filter rows by a parsed search; mode `none` → unchanged (same array). */
export function freightSearch<T extends FloorHoldRow>(rows: T[], parsed: ParsedSearch): T[] {
  if (parsed.mode === "none") return rows;
  return rows.filter((r) => freightMatches(r, parsed));
}
