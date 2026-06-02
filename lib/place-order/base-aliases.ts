// Subtle, friendly on-screen names for opaque base-tint codes — e.g. WS Max
// "94 BASE" shows a faint "· Accent" after the base. DISPLAY-ONLY:
//   - never written to `baseColour`,
//   - never added to productLabel's returned string (the mobile search
//     haystack depends on that string verbatim),
//   - never emitted in the order email (the email keeps the raw
//     "WS MAX 94 BASE" the parser was trained on).
//
// Keyed by the v2 row's `product` (the SAP-clean stock name, e.g. "WS MAX"),
// then by the exact `baseColour`. Bases with no entry (93 BASE, BRILLIANT
// WHITE) intentionally get no alias.
//
// The `search` arrays are RESERVED for a later searchTokens-seeding step
// (so "accent"/"deep" become findable) — nothing consumes them yet. This
// module is pure data + a lookup helper so BOTH the frontend (display) and
// the seed (searchTokens) can import it.

export type BaseAlias = { display: string; search: string[] };

export const BASE_ALIASES: Record<string, Record<string, BaseAlias>> = {
  "WS MAX": {
    "90 BASE": { display: "White",          search: ["white", "white base"] },
    "92 BASE": { display: "Intermediate",   search: ["intermediate", "intermediate base"] },
    "94 BASE": { display: "Accent",         search: ["accent", "accent base"] },
    "95 BASE": { display: "Deep",           search: ["deep", "deep base"] },
    "96 BASE": { display: "YOX",            search: ["yox", "yellow oxide", "yellow oxide base"] },
    "97 BASE": { display: "ROX",            search: ["rox", "red oxide", "red oxide base"] },
    "98 BASE": { display: "Vibrant Yellow", search: ["vibrant yellow", "vibrant yellow base"] },
  },
  "WS PROTECT DUSTPROOF": {
    "90 BASE": { display: "White",          search: ["white", "white base"] },
    "92 BASE": { display: "Intermediate",   search: ["intermediate", "intermediate base"] },
    "94 BASE": { display: "Accent",         search: ["accent", "accent base"] },
    "95 BASE": { display: "Deep",           search: ["deep", "deep base"] },
    "96 BASE": { display: "YOX",            search: ["yox", "yellow oxide", "yellow oxide base"] },
    "97 BASE": { display: "ROX",            search: ["rox", "red oxide", "red oxide base"] },
    "98 BASE": { display: "Vibrant Yellow", search: ["vibrant yellow", "vibrant yellow base"] },
    "99 BASE": { display: "Vibrant Red",    search: ["vibrant red", "vibrant red base"] },
  },
  "WS PROTECT RAINPROOF": {
    "90 BASE": { display: "White",          search: ["white", "white base"] },
    "92 BASE": { display: "Intermediate",   search: ["intermediate", "intermediate base"] },
    "94 BASE": { display: "Accent",         search: ["accent", "accent base"] },
    "95 BASE": { display: "Deep",           search: ["deep", "deep base"] },
    "96 BASE": { display: "YOX",            search: ["yox", "yellow oxide", "yellow oxide base"] },
    "97 BASE": { display: "ROX",            search: ["rox", "red oxide", "red oxide base"] },
    "98 BASE": { display: "Vibrant Yellow", search: ["vibrant yellow", "vibrant yellow base"] },
    "99 BASE": { display: "Vibrant Red",    search: ["vibrant red", "vibrant red base"] },
  },
  "WS POWERFLEXX": {
    "90 BASE": { display: "White",          search: ["white", "white base"] },
    "92 BASE": { display: "Intermediate",   search: ["intermediate", "intermediate base"] },
    "94 BASE": { display: "Accent",         search: ["accent", "accent base"] },
    "95 BASE": { display: "Deep",           search: ["deep", "deep base"] },
    "96 BASE": { display: "YOX",            search: ["yox", "yellow oxide", "yellow oxide base"] },
    "97 BASE": { display: "ROX",            search: ["rox", "red oxide", "red oxide base"] },
    "98 BASE": { display: "Vibrant Yellow", search: ["vibrant yellow", "vibrant yellow base"] },
    "99 BASE": { display: "Vibrant Red",    search: ["vibrant red", "vibrant red base"] },
  },
  // WS Protect Hi-Sheen ships only the lighter bases (BrWhite / 90 / 92 / 93).
  // Only 90 + 92 carry a friendly alias — BW and 93 get none, same as the
  // Dustproof block above.
  "WS PROTECT HI-SHEEN": {
    "90 BASE": { display: "White",          search: ["white", "white base"] },
    "92 BASE": { display: "Intermediate",   search: ["intermediate", "intermediate base"] },
  },
  // PU Enamel ships only 90 / 92 / 94 tint bases (+ Brilliant White, no alias).
  // NOTE: PU Enamel menu rows join stock via subProduct (product=null, like
  // GLOSS), so this block is currently dormant — neither the catalog seed's
  // §7.8 token-baking nor the frontend's getBaseAliasDisplay (both keyed on a
  // non-null `product`) consult it yet. Kept for parity / a future product-key.
  "PU ENAMEL": {
    "90 BASE": { display: "White",          search: ["white", "white base"] },
    "92 BASE": { display: "Intermediate",   search: ["intermediate", "intermediate base"] },
    "94 BASE": { display: "Accent",         search: ["accent", "accent base"] },
  },
};

/**
 * Friendly display alias for a (product, baseColour) pair, or null when none.
 * `product` is the v2 row's SAP-clean name ("WS MAX"); pass the row's
 * `product` (NOT `subProduct`, which is "MAX").
 */
export function getBaseAliasDisplay(
  product: string | null | undefined,
  baseColour: string | null | undefined,
): string | null {
  if (!product || !baseColour) return null;
  return BASE_ALIASES[product]?.[baseColour]?.display ?? null;
}
