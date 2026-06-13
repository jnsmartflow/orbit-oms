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
  // PU Enamel ships only 90 / 92 / 94 tint bases (+ Brilliant White and named
  // shades — Black/Dark Brown/Golden Brown/Phiroza/Smoke Grey — which get no
  // alias and display as-is). Active since 2026-06-13: product join-key set in the
  // catalog seed's CONFIRMED_SUBPRODUCT_MAP so these render + bake into tokens.
  "PU ENAMEL": {
    "90 BASE": { display: "White",          search: ["white", "white base"] },
    "92 BASE": { display: "Intermediate",   search: ["intermediate", "intermediate base"] },
    "94 BASE": { display: "Accent",         search: ["accent", "accent base"] },
  },
  // Satin (oil + WB share the same tint bases). Product join-key set in the
  // catalog seed's CONFIRMED_SUBPRODUCT_MAP so these render + bake into tokens.
  "SUPER SATIN": {
    "90 BASE": { display: "White",          search: ["white", "white base"] },
    "92 BASE": { display: "Intermediate",   search: ["intermediate", "intermediate base"] },
    "94 BASE": { display: "Accent",         search: ["accent", "accent base"] },
    "96 BASE": { display: "YOX",            search: ["yox", "yellow oxide", "yellow oxide base"] },
    "97 BASE": { display: "ROX",            search: ["rox", "red oxide", "red oxide base"] },
  },
  "SATIN STAY BRIGHT": {
    "90 BASE": { display: "White",          search: ["white", "white base"] },
    "92 BASE": { display: "Intermediate",   search: ["intermediate", "intermediate base"] },
    "94 BASE": { display: "Accent",         search: ["accent", "accent base"] },
    "96 BASE": { display: "YOX",            search: ["yox", "yellow oxide", "yellow oxide base"] },
    "97 BASE": { display: "ROX",            search: ["rox", "red oxide", "red oxide base"] },
  },
  // SuperCover (mass-market emulsion). Product join-key set in the catalog seed's
  // CONFIRMED_SUBPRODUCT_MAP so these render + bake into tokens. SuperCover labels
  // 96/97 plainly as Yellow/Red (not YOX/ROX). Brilliant White + 93 BASE: no alias.
  "SUPERCOVER": {
    "90 BASE": { display: "White",          search: ["white", "white base"] },
    "92 BASE": { display: "Intermediate",   search: ["intermediate", "intermediate base"] },
    "94 BASE": { display: "Accent",         search: ["accent", "accent base"] },
    "95 BASE": { display: "Deep",           search: ["deep", "deep base"] },
    "96 BASE": { display: "Yellow",         search: ["yellow", "yellow base"] },
    "97 BASE": { display: "Red",            search: ["red", "red base"] },
  },
  "SUPERCOVER SHEEN": {
    "90 BASE": { display: "White",          search: ["white", "white base"] },
    "92 BASE": { display: "Intermediate",   search: ["intermediate", "intermediate base"] },
    "94 BASE": { display: "Accent",         search: ["accent", "accent base"] },
  },
  // SuperClean (mass-market emulsion) + its 3in1 sibling. Product join-keys set
  // in CONFIRMED_SUBPRODUCT_MAP so these render + bake into tokens. 96/97 label
  // plainly Yellow/Red. Brilliant White + 93 BASE: no alias. 3in1 adds Pastel/Pro.
  "SUPERCLEAN": {
    "90 BASE": { display: "White",          search: ["white", "white base"] },
    "92 BASE": { display: "Intermediate",   search: ["intermediate", "intermediate base"] },
    "94 BASE": { display: "Accent",         search: ["accent", "accent base"] },
    "95 BASE": { display: "Deep",           search: ["deep", "deep base"] },
    "96 BASE": { display: "Yellow",         search: ["yellow", "yellow base"] },
    "97 BASE": { display: "Red",            search: ["red", "red base"] },
  },
  "SUPERCLEAN 3IN1": {
    "90 BASE":     { display: "White",        search: ["white", "white base"] },
    "92 BASE":     { display: "Intermediate", search: ["intermediate", "intermediate base"] },
    "94 BASE":     { display: "Accent",       search: ["accent", "accent base"] },
    "95 BASE":     { display: "Deep",         search: ["deep", "deep base"] },
    "96 BASE":     { display: "Yellow",       search: ["yellow", "yellow base"] },
    "97 BASE":     { display: "Red",          search: ["red", "red base"] },
    "PASTEL BASE": { display: "Pastel",       search: ["pastel", "pastel base"] },
    "PRO BASE":    { display: "Pro",          search: ["pro", "pro base"] },
  },
  // ── Promise family (6 tabs) ──────────────────────────────────────────────
  // Emulsion tabs: numbered-base aliases (whichever present). SmartChoice/Primer
  // tabs: the row's baseColour is the VARIANT; the alias carries the light
  // qualifier ("Br White" / "Int & Ext"); variants with no qualifier are omitted.
  "PROMISE INTERIOR": {
    "90 BASE": { display: "White",          search: ["white", "white base"] },
    "92 BASE": { display: "Intermediate",   search: ["intermediate", "intermediate base"] },
    "94 BASE": { display: "Accent",         search: ["accent", "accent base"] },
    "96 BASE": { display: "YOX",            search: ["yox", "yellow oxide", "yellow oxide base"] },
    "97 BASE": { display: "ROX",            search: ["rox", "red oxide", "red oxide base"] },
  },
  "PROMISE SHEEN INTERIOR": {
    "90 BASE": { display: "White",          search: ["white", "white base"] },
    "92 BASE": { display: "Intermediate",   search: ["intermediate", "intermediate base"] },
    "94 BASE": { display: "Accent",         search: ["accent", "accent base"] },
  },
  "PROMISE EXTERIOR": {
    "90 BASE": { display: "White",          search: ["white", "white base"] },
    "92 BASE": { display: "Intermediate",   search: ["intermediate", "intermediate base"] },
    "94 BASE": { display: "Accent",         search: ["accent", "accent base"] },
    "96 BASE": { display: "YOX",            search: ["yox", "yellow oxide", "yellow oxide base"] },
  },
  "PROMISE SHEEN EXTERIOR": {
    "90 BASE": { display: "White",          search: ["white", "white base"] },
    "92 BASE": { display: "Intermediate",   search: ["intermediate", "intermediate base"] },
    "94 BASE": { display: "Accent",         search: ["accent", "accent base"] },
  },
  "PROMISE SMARTCHOICE": {
    "Interior":  { display: "Br White", search: ["br white", "brilliant white", "white"] },
    "Exterior":  { display: "Br White", search: ["br white", "brilliant white", "white"] },
  },
  "PROMISE PRIMER": {
    "2in1 Primer":         { display: "Int & Ext", search: ["int & ext", "interior exterior", "int ext"] },
    "Freedom 2in1 Primer": { display: "Int & Ext", search: ["int & ext", "interior exterior", "int ext"] },
  },
  // ── Velvet Touch family (6 ranges) ───────────────────────────────────────
  // Product join-keys set in the catalog seed's CONFIRMED_SUBPRODUCT_MAP so these
  // render + bake into tokens. GLO ranges label 96/97 plainly Yellow/Red (not
  // YOX/ROX). No alias for 93 BASE / BRILLIANT WHITE / PASTEL BASE / RARE PEARL
  // COPPER / RARE PEARL GREEN / BASECOAT (carried but unaliased, like BW elsewhere).
  "PEARL GLO": {
    "90 BASE": { display: "White",        search: ["white", "white base"] },
    "92 BASE": { display: "Intermediate", search: ["intermediate", "intermediate base"] },
    "94 BASE": { display: "Accent",       search: ["accent", "accent base"] },
    "95 BASE": { display: "Deep",         search: ["deep", "deep base"] },
    "96 BASE": { display: "Yellow",       search: ["yellow", "yellow base"] },
    "97 BASE": { display: "Red",          search: ["red", "red base"] },
  },
  "PLATINUM GLO": {
    "90 BASE": { display: "White",        search: ["white", "white base"] },
    "92 BASE": { display: "Intermediate", search: ["intermediate", "intermediate base"] },
    "94 BASE": { display: "Accent",       search: ["accent", "accent base"] },
    "95 BASE": { display: "Deep",         search: ["deep", "deep base"] },
    "96 BASE": { display: "Yellow",       search: ["yellow", "yellow base"] },
    "97 BASE": { display: "Red",          search: ["red", "red base"] },
  },
  "DIAMOND GLO": {
    "90 BASE": { display: "White",        search: ["white", "white base"] },
    "92 BASE": { display: "Intermediate", search: ["intermediate", "intermediate base"] },
    "94 BASE": { display: "Accent",       search: ["accent", "accent base"] },
    "95 BASE": { display: "Deep",         search: ["deep", "deep base"] },
    "96 BASE": { display: "Yellow",       search: ["yellow", "yellow base"] },
    "97 BASE": { display: "Red",          search: ["red", "red base"] },
  },
  "ETERNA": {
    "90 BASE": { display: "White",        search: ["white", "white base"] },
    "92 BASE": { display: "Intermediate", search: ["intermediate", "intermediate base"] },
    "94 BASE": { display: "Accent",       search: ["accent", "accent base"] },
  },
  "ETERNA MATT": {
    "92 BASE": { display: "Intermediate", search: ["intermediate", "intermediate base"] },
    "94 BASE": { display: "Accent",       search: ["accent", "accent base"] },
  },
  "ETERNA HI-SHEEN": {
    "90 BASE": { display: "White",        search: ["white", "white base"] },
    "92 BASE": { display: "Intermediate", search: ["intermediate", "intermediate base"] },
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
