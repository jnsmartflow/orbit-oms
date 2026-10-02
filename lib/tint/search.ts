// lib/tint/search.ts — the Tint Manager's header search ADAPTERS (2026-10-02).
//
// 🔴 ONE MATCHER: lib/floor/search.ts, IMPORTED, NEVER COPIED OR EDITED. That
// file matches one row-shaped `Searchable` — OBD, invoice, SO, ONE name
// (`dealerName`), route, the word "unmatched" — in two modes (text substring;
// a pasted number list matching an OBD on its full number or last 3+ digits,
// an invoice / SO on its full number or last 5+, with the I→1 rule).
//
// The Tint Manager searches MORE fields (owner, 2026-10-02): bill-to name +
// code, ship-to name + code, the original ship-to, and a sampling number where
// a row has one. Rather than re-implement any matching, a row is turned into a
// few `Searchable` VIEWS, each putting one field in the slot whose rule fits it:
//   - the MAIN view — the row's own OBD, invoice, SO, (effective) ship-to name,
//     route and in-master flag: exactly what Floor would match;
//   - one view per extra NAME (bill-to, original ship-to) in `dealerName` —
//     text substring, as Floor matches a name;
//   - one view per CODE (customer codes, sampling number) in `obdNumber` —
//     substring in text mode, full-or-tail in number mode, as Floor matches an
//     OBD. Their other slots are empty and `dealerInMaster` is true, so a view
//     can never match "unmatched" or an invoice it does not have.
// A row matches when ANY view matches. Pure — no React, no Prisma — so the
// header dropdown and GET /api/tint/manager/find share it.

import { matchesSearch, tokenMatchesObd, type ParsedSearch, type Searchable } from "@/lib/floor/search";
import { MISSING_CUSTOMER_SEARCH_TEXT } from "@/lib/tint/customer-missing";

export interface SearchFields {
  obdNumber:  string;
  invoiceNo?: string | null;
  soNumber?:  string | null;
  /** The effective ship-to name the row prints. */
  shipTo?:    string | null;
  route?:     string | null;
  /** False ⇒ dealer not in master (the word "unmatched"). Default true. */
  inMaster?:  boolean;
  /** Bill-to name, original ship-to, … — text-matched like a name. */
  names?:     Array<string | null | undefined>;
  /** Ship-to / bill-to codes, a sampling number — matched like an OBD. */
  codes?:     Array<string | null | undefined>;
  /** A missing-customer bill (lib/tint/customer-missing.ts) — the words
   *  "missing customer" become searchable on it (2026-10-02). Default false. */
  missingCustomer?: boolean;
}

const EMPTY: Omit<Searchable, "obdNumber" | "dealerName"> = {
  orderId: 0, route: null, invoiceNo: null, soNumber: null, dealerInMaster: true,
};

/** The `Searchable` views of one row (see the header). */
export function searchViews(f: SearchFields): Searchable[] {
  const views: Searchable[] = [{
    orderId:        0,
    obdNumber:      f.obdNumber,
    dealerName:     f.shipTo ?? "",
    route:          f.route ?? null,
    invoiceNo:      f.invoiceNo ?? null,
    soNumber:       f.soNumber ?? null,
    dealerInMaster: f.inMaster ?? true,
  }];
  for (const n of f.names ?? []) if (n) views.push({ ...EMPTY, obdNumber: "", dealerName: n });
  for (const c of f.codes ?? []) if (c) views.push({ ...EMPTY, obdNumber: c, dealerName: "" });
  // Text-matched like a name, so typing "missing" finds these bills.
  if (f.missingCustomer) views.push({ ...EMPTY, obdNumber: "", dealerName: MISSING_CUSTOMER_SEARCH_TEXT });
  return views;
}

/** Does any view of the row match? `none` matches nothing here — the dropdown
 *  only lists hits, it never lists "everything". */
export function matchesViews(views: Searchable[], parsed: ParsedSearch): boolean {
  if (parsed.mode === "none") return false;
  return views.some((v) => matchesSearch(v, parsed));
}

/** The part of an OBD to highlight for a parsed search, as [start, end) — or
 *  null when the OBD itself did not match (a name / code hit). DISPLAY ONLY;
 *  the match decision is always matchesViews above. */
export function obdHighlight(obd: string, parsed: ParsedSearch): [number, number] | null {
  if (parsed.mode === "text") {
    const i = obd.toLowerCase().indexOf(parsed.text);
    return i >= 0 ? [i, i + parsed.text.length] : null;
  }
  if (parsed.mode === "numbers") {
    for (const t of parsed.tokens) {
      if (!tokenMatchesObd(t, obd)) continue;
      const i = obd.indexOf(t);
      return i >= 0 ? [i, i + t.length] : [obd.length - t.length, obd.length];
    }
  }
  return null;
}

/** One row of GET /api/tint/manager/find — the dropdown's "Not on Tint Manager"
 *  group. Shared by the route (its response) and the page (its reader). */
export interface TintFindRow {
  orderId:   number;
  obdNumber: string;
  invoiceNo: string | null;
  billTo:    string | null;
  shipTo:    string | null;
  smu:       string | null;
  /** The stage in plain words (STAGE_LADDER labels). */
  stage:     string;
  dateLabel: "Dispatched" | "Cancelled" | "Updated";
  /** orders.updatedAt, ISO. */
  date:      string;
}
