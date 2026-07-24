// Floor Control — client-side search (design §5.2, mockup 01-board.html
// runSearch/applySearch). Pure: no DB, no React. Operates over already-loaded
// rows, the same way Support searches.
//
// One box, two behaviours:
//   - TEXT    → matches ship-to name, route, or OBD (substring, case-insensitive)
//   - NUMBERS → OBD match on the FULL number or the last 3+ digits; a pasted list
//               (comma / space / newline separated) matches them all.
// Runs on Enter (the box, not this file, enforces that) — live filtering would
// make the list jump mid-paste and "2" would match forty bills before "237" is
// finished.

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

// Any searchable row exposes these — floor / hold / cancelled rows all do, and
// so do rail cards (search HIGHLIGHTS the rail, never hides it — §6.1).
export interface Searchable {
  orderId: number;
  obdNumber: string;
  dealerName: string;
  route: string | null;
}

/** A numeric token matches an OBD by full substring OR by its last-N digits
 *  (design §5.2 — the operator often pastes just a tail). */
export function tokenMatchesObd(token: string, obdNumber: string): boolean {
  return obdNumber.includes(token) || obdNumber.slice(-token.length) === token;
}

function matchesText(row: Searchable, text: string): boolean {
  return (
    row.obdNumber.toLowerCase().includes(text) ||
    row.dealerName.toLowerCase().includes(text) ||
    (row.route ?? "").toLowerCase().includes(text)
  );
}

function matchesTokens(row: Searchable, tokens: string[]): boolean {
  return tokens.some((tok) => tokenMatchesObd(tok, row.obdNumber));
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
// against the CURRENT tab's full pool so "not found here" is honest.
export interface SearchReport {
  perToken: Array<{ token: string; count: number }>;
  matchedCount: number; // distinct rows matched by ANY token / the text
  notFound: number; // tokens that matched nothing
}

export function searchReport<T extends Searchable>(pool: T[], parsed: ParsedSearch): SearchReport | null {
  if (parsed.mode === "none") return null;
  if (parsed.mode === "text") {
    return { perToken: [], matchedCount: pool.filter((r) => matchesText(r, parsed.text)).length, notFound: 0 };
  }
  const perToken = parsed.tokens.map((token) => ({
    token,
    count: pool.filter((r) => tokenMatchesObd(token, r.obdNumber)).length,
  }));
  const matchedCount = pool.filter((r) => matchesTokens(r, parsed.tokens)).length;
  const notFound = perToken.filter((t) => t.count === 0).length;
  return { perToken, matchedCount, notFound };
}
