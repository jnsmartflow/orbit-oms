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
  "supercover":   "SUPERCOVER",
  "super cover":  "SUPERCOVER",
  "superclean":   "SUPERCLEAN",
  "super clean":  "SUPERCLEAN",
  "3in1":         "SUPERCLEAN",
  "sadolin":      "SADOLIN",
  "woodcare":     "SADOLIN",
  "tools":        "TOOLS",
  "roller":       "TOOLS",
  "brush":        "TOOLS",
  "distemper":    "DISTEMPER",
  "magik":        "DISTEMPER",
  "duwel":        "DISTEMPER",
  // PUTTY + TEXTURE (2026-06-12). "texture"/"rustic" promote TEXTURE (decoupled
  // from WS — the "WS TEXTURE" searchToken was dropped from the menu rows).
  "putty":         "PUTTY",
  "acrylic putty": "PUTTY",
  "polyputty":     "PUTTY",
  "poly putty":    "PUTTY",
  "texture":       "TEXTURE",
  "rustic":        "TEXTURE",
  // VT SPECIALTY (2026-06-13) — only the VISIBLE products promote. The hidden
  // ranges (vt fin / vt metallics / ambiance / luxury finishes) are intentionally
  // absent (no menu row, not searchable).
  "vaf":             "VT SPECIALTY",
  "velvetino":       "VT SPECIALTY",
  "concrete finish": "VT SPECIALTY",
  "vt marble":       "VT SPECIALTY",
  "clear coat":      "VT SPECIALTY",
  "vt specialty":    "VT SPECIALTY",
  // REMAINING-5 (2026-06-14)
  "tile":            "TILE",
  "metallic":        "METALLIC",
  "lustre":          "LUSTRE",
  "smoothover":      "SMOOTHOVER",
  "floor plus":      "FLOOR PLUS",
  "floorplus":       "FLOOR PLUS",
  // SPRAY PAINT (2026-06-14) — search-only family (no speed-dial tile).
  "spray":           "SPRAY PAINT",
  "spray paint":     "SPRAY PAINT",
  "aerosol":         "SPRAY PAINT",
  // M900 (2026-06-14) — folded into GLOSS as a 3rd tab; promote the GLOSS family
  // (the M900 rows then rank via their "m900" searchTokens).
  "m900":            "GLOSS",
  "m900 gloss":      "GLOSS",
  // 5IN1 (2026-06-15) — folded into GLOSS as a 4th tab; promote GLOSS (the 5IN1
  // rows rank via their "5in1" searchTokens).
  "5in1":            "GLOSS",
  "5 in 1":          "GLOSS",
  "5-in-1":          "GLOSS",
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
