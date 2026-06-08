// Whole-query keyword → family default for the order-form search (mobile /order
// + desktop /place-order). When an operator types a brand acronym / family name
// that should surface a WHOLE family first (e.g. "VT" → the Velvet Touch line),
// the rankers promote that family's rows to the top in natural tab order, with
// every other match kept BELOW (promote-only — nothing is hidden).
//
// This is the single shared source both surfaces import — a small, hand-curated
// precursor to the §19 universal keyword layer. Pure data + lookup (no React, no
// fetch) so the route, both rankers, and test harnesses can all import it.
//
// MATCH RULE: WHOLE-query only. "vt" and "velvet touch" trigger; "vt pearl" and
// "vt clear coat" do NOT — they fall through to normal token ranking. This keeps
// the keyword a deliberate "I want the whole family" signal, never a hijack of a
// more specific query.

// Keyed by the normalized query (trim → lowercase → collapse inner whitespace).
// Value is the exact `family` string in mo_order_form_index_v2.
const KEYWORD_FAMILY: Record<string, string> = {
  "vt":           "VELVET TOUCH",
  "velvet touch": "VELVET TOUCH",
  "velvettouch":  "VELVET TOUCH",
  "sadolin":      "SADOLIN",
  "woodcare":     "SADOLIN",
  "tools":        "TOOLS",
  "roller":       "TOOLS",
  "brush":        "TOOLS",
};

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Family to promote to the top of search results for this query, or null.
 * Only returns a family on a WHOLE-query keyword match.
 */
export function getFamilyDefaultForQuery(query: string): string | null {
  if (!query) return null;
  return KEYWORD_FAMILY[normalizeQuery(query)] ?? null;
}
