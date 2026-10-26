// Floor Control — client-side search (design §5.2, mockup 01-board.html
// runSearch/applySearch). Pure: no DB, no React. Operates over already-loaded
// rows, the same way Support searches.
//
// One box, two behaviours (fields widened 2026-09-29, owner):
//   - TEXT    → matches OBD, invoice number, SO number, ship-to name, route or
//               the Sales Officer's name (board rows only, 2026-10-06)
//               (substring, case-insensitive), plus the synthetic word
//               "unmatched" for a bill whose dealer is not in master.
//   - NUMBERS → a pasted list (comma / space / newline separated); each number
//               matches
//                 · an OBD on the FULL number or its last 3+ digits (unchanged);
//                 · an INVOICE or SO on the FULL number or its last 5+ digits.
//               Fewer than 5 digits never match an invoice or an SO.
//   "Invoice" = ANY invoice of the bill (2026-10-13, Add invoices Phase 4):
//   SAP's `invoiceNo` and, on a split OBD's board row, every `invoiceRows`
//   number — so 30713 finds 9109951956 by its typed invoice I536230713.
// Runs on Enter (the box, not this file, enforces that) — live filtering would
// make the list jump mid-paste and "2" would match forty bills before "237" is
// finished.
//
// ⚠ SO IS SEARCHED, NEVER SHOWN (owner decision 2026-09-29). It rides the Floor
// rows (FloorBoardRow / FloorHoldRow / FloorCancelledRow) for this file alone.

import { isOrbNumber } from "@/lib/challan-orders/orb-number";
import type { FloorSearchHit, FloorSearchPart, FloorSearchTarget } from "@/lib/floor/types";

export interface ParsedSearch {
  mode: "none" | "text" | "numbers";
  text: string; // lowercased, text mode only
  tokens: string[]; // 3+ digit numeric tokens, numbers mode only
}

/** Decide text-vs-numbers the same way the mockup does: the input is "numbers"
 *  when 3+-digit numeric tokens dominate the non-separator characters (so
 *  "9108440731, 9108440749" is numbers, but "Shree 12" stays text). */
export function parseSearch(raw: string): ParsedSearch {
  const q = raw.trim();
  if (!q) return { mode: "none", text: "", tokens: [] };
  const tokens = q.split(/[\s,;\n\t]+/).filter((x) => /^\d{3,}$/.test(x));
  const compact = q.replace(/[\s,;\n\t]/g, "");
  if (tokens.length > 0 && tokens.join("").length >= compact.length - 2) {
    return { mode: "numbers", text: "", tokens };
  }
  return { mode: "text", text: q.toLowerCase(), tokens: [] };
}

// Any searchable row exposes these — floor / hold / cancelled rows all do.
export interface Searchable {
  orderId: number;
  obdNumber: string;
  dealerName: string;
  route: string | null;
  /** SAP's invoice number — `I` + 9 digits on every live row (lib/ci/queries.ts). */
  invoiceNo: string | null;
  /** A split OBD's invoices (board rows only, Add invoices Phase 4) — each
   *  number is matched like `invoiceNo`. Hold / Cancelled rows do not carry it. */
  invoiceRows?: ReadonlyArray<{ invoiceNo: string | null }>;
  /** SEARCH ONLY — never displayed (owner decision 2026-09-29). */
  soNumber: string | null;
  /** False ⇒ the dealer is not in master; matched by the word "unmatched". */
  dealerInMaster: boolean;
  /** The Sales Officer as the SO column shows it (2026-10-06) — text mode
   *  only. Optional: board rows carry it, Hold / Cancelled rows do not. */
  salesOfficerName?: string | null;
  /** The text that SO name came from (2026-10-10) — matched too, so a short
   *  name ("Roopesh") is still found by the long one ("Jha"). */
  salesOfficerRawName?: string | null;
  /** The bill's own dealer (orders.customer) and SAP's bill-to name — matched
   *  so a TYPED ship-to bill (v27.73, step 7A), whose `dealerName` is now the
   *  site name or "As per challan", is still found by its dealer. Optional:
   *  board and Cancelled rows carry customerName; board and Hold carry billToName. */
  customerName?: string | null;
  billToName?: string | null;
}

/** Invoice and SO need at least this many digits — a shorter tail is too
 *  likely to hit an unrelated bill (owner, 2026-09-29). */
export const MIN_INVOICE_SO_DIGITS = 5;

/** A numeric token matches an OBD by full substring OR by its last-N digits
 *  (design §5.2 — the operator often pastes just a tail). */
export function tokenMatchesObd(token: string, obdNumber: string): boolean {
  return obdNumber.includes(token) || obdNumber.slice(-token.length) === token;
}

/**
 * A numeric token matches an invoice on the full number or its last 5+ digits.
 *
 * ⚠ THE `I` PREFIX. Every live invoice is `I` + 9 digits (I536229654). The
 * number box only takes digits, and a person reading the paper types the `I`
 * as a `1` — so the digits are compared as "1" + the nine digits. That one
 * rule accepts all three ways it gets typed: the misread `1536229654`, the bare
 * `536229654` (CI search's own rule, lib/ci/queries.ts), and any 5+ digit tail.
 * An invoice without the prefix is compared as it stands.
 */
export function tokenMatchesInvoice(token: string, invoiceNo: string | null): boolean {
  if (!invoiceNo || token.length < MIN_INVOICE_SO_DIGITS) return false;
  const inv = invoiceNo.toUpperCase();
  const digits = /^I\d+$/.test(inv) ? `1${inv.slice(1)}` : inv;
  return digits.endsWith(token);
}

/** A numeric token matches an SO on the full number or its last 5+ digits. */
export function tokenMatchesSo(token: string, soNumber: string | null): boolean {
  if (!soNumber || token.length < MIN_INVOICE_SO_DIGITS) return false;
  return soNumber.endsWith(token);
}

function tokenMatchesRow(token: string, row: Searchable): boolean {
  return (
    tokenMatchesObd(token, row.obdNumber) ||
    tokenMatchesInvoice(token, row.invoiceNo) ||
    (row.invoiceRows ?? []).some((r) => tokenMatchesInvoice(token, r.invoiceNo)) ||
    tokenMatchesSo(token, row.soNumber)
  );
}

/**
 * Which of a split OBD's invoices a search names — the seq of the first
 * `invoiceRows` entry a token (numbers) or the text matches; null when none
 * does (or the row is not split). For commit 3's "open the invoice it found".
 */
export function matchedInvoiceSeqOf(
  row: { invoiceRows?: ReadonlyArray<{ seq: number; invoiceNo: string | null }> },
  parsed: ParsedSearch,
): number | null {
  const rows = row.invoiceRows ?? [];
  if (parsed.mode === "numbers") {
    return rows.find((r) => parsed.tokens.some((t) => tokenMatchesInvoice(t, r.invoiceNo)))?.seq ?? null;
  }
  if (parsed.mode === "text") return rows.find((r) => (r.invoiceNo ?? "").toLowerCase().includes(parsed.text))?.seq ?? null;
  return null;
}

/**
 * The search AUTO-TICK on a split OBD (P5-3, 2026-10-17): the ids of every
 * invoice a pasted number names. [] when the number named the OBD (or its SO)
 * rather than one of its invoices — the caller then ticks every invoice shown.
 */
export function matchedInvoiceIdsOf(
  row: { invoiceRows?: ReadonlyArray<{ id: number; invoiceNo: string | null }> },
  parsed: ParsedSearch,
): number[] {
  if (parsed.mode !== "numbers") return [];
  return (row.invoiceRows ?? [])
    .filter((r) => parsed.tokens.some((t) => tokenMatchesInvoice(t, r.invoiceNo)))
    .map((r) => r.id);
}

function matchesText(row: Searchable, text: string): boolean {
  return (
    row.obdNumber.toLowerCase().includes(text) ||
    (row.invoiceNo ?? "").toLowerCase().includes(text) ||
    (row.invoiceRows ?? []).some((r) => (r.invoiceNo ?? "").toLowerCase().includes(text)) ||
    (row.soNumber ?? "").toLowerCase().includes(text) ||
    row.dealerName.toLowerCase().includes(text) ||
    (row.customerName ?? "").toLowerCase().includes(text) ||
    (row.billToName ?? "").toLowerCase().includes(text) ||
    (row.route ?? "").toLowerCase().includes(text) ||
    (row.salesOfficerName ?? "").toLowerCase().includes(text) ||
    (row.salesOfficerRawName ?? "").toLowerCase().includes(text) ||
    // The synthetic term, as lib/picking/search.ts keeps it: "" for a bill in
    // master (matches nothing), "unmatched" for one that is not — so the word
    // still finds these bills whatever name the row happens to print.
    (row.dealerInMaster ? "" : "unmatched").includes(text)
  );
}

function matchesTokens(row: Searchable, tokens: string[]): boolean {
  return tokens.some((tok) => tokenMatchesRow(tok, row));
}

export function matchesSearch(row: Searchable, parsed: ParsedSearch): boolean {
  if (parsed.mode === "none") return true;
  if (parsed.mode === "text") return matchesText(row, parsed.text);
  return matchesTokens(row, parsed.tokens);
}

/** Filter a surface's rows by a parsed search. `none` → unchanged. */
export function applySearch<T extends Searchable>(rows: T[], parsed: ParsedSearch): T[] {
  if (parsed.mode === "none") return rows;
  return rows.filter((r) => matchesSearch(r, parsed));
}

// Per-token counts + not-found tally, for the chips + one-line summary. Counted
// against the CURRENT tab's list so "not found here" is honest.
//
// `elsewhere` (2026-09-29): bills the search can also reach that are NOT in this
// list — on the Floor tab, bills sitting on trips. They are never counted as
// hits in the list (`count`, `matchedCount`), but a number found there is not
// "not found" either: its chip says `elsewhere` instead of going red.
export interface SearchReport {
  perToken: Array<{ token: string; count: number; elsewhere: number }>;
  matchedCount: number; // distinct rows IN THE LIST matched by ANY token / the text
  notFound: number; // tokens that matched nothing, in the list or elsewhere
}

export function searchReport<T extends Searchable>(
  pool: T[],
  parsed: ParsedSearch,
  elsewhere: Searchable[] = [],
): SearchReport | null {
  if (parsed.mode === "none") return null;
  if (parsed.mode === "text") {
    return { perToken: [], matchedCount: pool.filter((r) => matchesText(r, parsed.text)).length, notFound: 0 };
  }
  const perToken = parsed.tokens.map((token) => ({
    token,
    count: pool.filter((r) => tokenMatchesRow(token, r)).length,
    elsewhere: elsewhere.filter((r) => tokenMatchesRow(token, r)).length,
  }));
  const matchedCount = pool.filter((r) => matchesTokens(r, parsed.tokens)).length;
  const notFound = perToken.filter((t) => t.count === 0 && t.elsewhere === 0).length;
  return { perToken, matchedCount, notFound };
}

/**
 * The term to send to GET /api/floor/trips/lookup, or null when the input is
 * not ONE full number. Full = an OBD / SO (10 digits), an invoice typed with
 * its `I` (I536229654), or an invoice's bare 9 digits. Tails are never looked
 * up — the server matches whole numbers only.
 */
export function lookupTermOf(raw: string): string | null {
  const q = raw.trim().toUpperCase();
  // A challan order's ORB number (2026-10-06) is ONE full number too — the
  // server's parseBillLookupTerm (lib/trips/find-bill.ts) accepts the same shape.
  if (isOrbNumber(q)) return q;
  return /^\d{9,12}$/.test(q) || /^I\d{9}$/.test(q) ? q : null;
}

// ── SPLIT LOAD: a search that names every truck part (Phase 4 batch 4) ──────
//
// One SAP invoice split across trucks is ONE number on two or more rows of the
// OBD (lib/order-invoices/load-plan.ts). GET /api/floor/search then sends the
// hit with `parts` (lib/floor/search-hits.ts) — absent on every other hit. The
// page lights EVERY part wherever it is drawn, and when the parts are in
// different places it offers the short list, one button per part (owner
// answer 11, 2026-10-25): "I536233980 part 2 of 2 · L-261024-23".

/**
 * Where ONE part of a bill is, by the hit's own precedence (cancel_ci > hold >
 * tinting > trip > floor): a cancelled / wholly held OBD keeps its tab for
 * every part; else a held part is On hold, a part on a live trip is on that
 * trip, the rest are in the OBD's Tinting / Floor place.
 */
export function partTargetOf(
  obdTarget: FloorSearchTarget,
  part: { isHeld: boolean; onLiveTrip: boolean },
): FloorSearchTarget {
  if (obdTarget === "cancel_ci" || obdTarget === "hold") return obdTarget;
  if (part.isHeld) return "hold";
  if (part.onLiveTrip) return "trip";
  return obdTarget === "tinting" ? "tinting" : "floor";
}

/**
 * The choices a hit offers the search strip: [hit] as it is, unless its parts
 * sit in DIFFERENT places (target + trip) — then one hit per part, each
 * standing for that part alone (its own target / trip / seq, `part` set,
 * `parts` dropped). Parts all in one place stay one hit (both lit there).
 */
export function partHitsOf(hit: FloorSearchHit): FloorSearchHit[] {
  const parts = hit.parts ?? [];
  if (parts.length < 2) return [hit];
  const placeOf = (p: FloorSearchPart) => `${p.target}:${p.trip?.id ?? "-"}`;
  if (new Set(parts.map(placeOf)).size < 2) return [hit];
  return parts.map((p) => {
    const { parts: _drop, ...rest } = hit;
    void _drop;
    return { ...rest, target: p.target, trip: p.trip, matchedInvoiceSeq: p.seq, part: p };
  });
}

/** The invoice seqs a hit lights: every part, else the one invoice it named, else null (the whole bill). */
export function litSeqsOf(hit: Pick<FloorSearchHit, "parts" | "matchedInvoiceSeq">): number[] | null {
  if (hit.parts && hit.parts.length > 0) return hit.parts.map((p) => p.seq);
  return hit.matchedInvoiceSeq === null ? null : [hit.matchedInvoiceSeq];
}

/**
 * The DOM rows a search hit marks / scrolls to. A split OBD draws one row per
 * invoice (floor-table.tsx, each with data-invoice-seq), so a hit that named
 * invoices (`seqs`) lands on those rows only; every other row of the bill —
 * unsplit, Hold, Cancel & CI, a layout that does not expand — has no
 * data-invoice-seq and is matched as before. Moved from floor-page.tsx
 * (batch 4); one seq gives the exact selector it gave.
 */
export function searchRowSelector(orderId: number, seqs: readonly number[] | null): string {
  const id = `[data-order-id="${orderId}"]`;
  if (seqs === null || seqs.length === 0) return id;
  return `${seqs.map((s) => `${id}[data-invoice-seq="${s}"]`).join(", ")}, ${id}:not([data-invoice-seq])`;
}
