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

export type BaseAlias = { display: string; search: string[]; label?: string };

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
  // 5IN1 Gloss (2026-06-15) — folded into GLOSS as a flat 4th tab. Tint bases
  // 90/92/94 carry friendly aliases; 93 BASE + BRILLIANT WHITE + named colours
  // (Black/Brown/Cherry/Golden Brown/Phiroza) get none. Product join-key set via
  // CONFIRMED_SUBPRODUCT_MAP so these render + bake into tokens (§7.8).
  "5IN1 GLOSS": {
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
  "VT PEARL GLO": {
    "90 BASE": { display: "White",        search: ["white", "white base"] },
    "92 BASE": { display: "Intermediate", search: ["intermediate", "intermediate base"] },
    "94 BASE": { display: "Accent",       search: ["accent", "accent base"] },
    "95 BASE": { display: "Deep",         search: ["deep", "deep base"] },
    "96 BASE": { display: "Yellow",       search: ["yellow", "yellow base"] },
    "97 BASE": { display: "Red",          search: ["red", "red base"] },
  },
  "VT PLATINUM GLO": {
    "90 BASE": { display: "White",        search: ["white", "white base"] },
    "92 BASE": { display: "Intermediate", search: ["intermediate", "intermediate base"] },
    "94 BASE": { display: "Accent",       search: ["accent", "accent base"] },
    "95 BASE": { display: "Deep",         search: ["deep", "deep base"] },
    "96 BASE": { display: "Yellow",       search: ["yellow", "yellow base"] },
    "97 BASE": { display: "Red",          search: ["red", "red base"] },
  },
  "VT DIAMOND GLO": {
    "90 BASE": { display: "White",        search: ["white", "white base"] },
    "92 BASE": { display: "Intermediate", search: ["intermediate", "intermediate base"] },
    "94 BASE": { display: "Accent",       search: ["accent", "accent base"] },
    "95 BASE": { display: "Deep",         search: ["deep", "deep base"] },
    "96 BASE": { display: "Yellow",       search: ["yellow", "yellow base"] },
    "97 BASE": { display: "Red",          search: ["red", "red base"] },
  },
  "VT ETERNA": {
    "90 BASE": { display: "White",        search: ["white", "white base"] },
    "92 BASE": { display: "Intermediate", search: ["intermediate", "intermediate base"] },
    "94 BASE": { display: "Accent",       search: ["accent", "accent base"] },
  },
  "VT ETERNA MATT": {
    "92 BASE": { display: "Intermediate", search: ["intermediate", "intermediate base"] },
    "94 BASE": { display: "Accent",       search: ["accent", "accent base"] },
  },
  "VT ETERNA HI-SHEEN": {
    "90 BASE": { display: "White",        search: ["white", "white base"] },
    "92 BASE": { display: "Intermediate", search: ["intermediate", "intermediate base"] },
  },
  // Lustre (2026-06-14). Numeric bases 90/92/94/96 only; 96 labels plainly Yellow.
  // Product join-key set in CONFIRMED_SUBPRODUCT_MAP so these render + bake tokens.
  "LUSTRE": {
    "90 BASE": { display: "White",        search: ["white", "white base"] },
    "92 BASE": { display: "Intermediate", search: ["intermediate", "intermediate base"] },
    "94 BASE": { display: "Accent",       search: ["accent", "accent base"] },
    "96 BASE": { display: "Yellow",       search: ["yellow", "yellow base"] },
  },
  // ── Stainer tint codes (2026-06-14) ──────────────────────────────────────
  // display = the SAP tint code → renders "Black · 108"; search bakes the code
  // so "108" finds the shade. UNIVERSAL/GVA carry the colour name in the base
  // already; MACHINE TINTER's base is a 3-letter abbr (FFR/YOX), so it also
  // carries `label` = the full colour name for the mobile subtitle.
  "UNIVERSAL STAINER": {
    "YELLOW OXIDE":    { display: "101", search: ["101"] },
    "FAST YELLOW":     { display: "102", search: ["102"] },
    "FAST GREEN":      { display: "103", search: ["103"] },
    "FAST BLUE":       { display: "104", search: ["104"] },
    "FAST VIOLET":     { display: "106", search: ["106"] },
    "FAST RED":        { display: "107", search: ["107"] },
    "BLACK":           { display: "108", search: ["108"] },
    "FAST ORANGE":     { display: "110", search: ["110"] },
    "FASTYELLOWGREEN": { display: "111", search: ["111"] },
    "BURNT SIENNA":    { display: "112", search: ["112"] },
  },
  "GVA": {
    "RED OXIDE":             { display: "122", search: ["122"] },
    "BLUE":                  { display: "124", search: ["124"] },
    "BLACK":                 { display: "126", search: ["126"] },
    "YELLOW OXIDE":          { display: "127", search: ["127"] },
    "ORGANIC ORANGE":        { display: "140", search: ["140"] },
    "ORGANIC VIOLET":        { display: "142", search: ["142"] },
    "ORGANIC MIDDLE YELLOW": { display: "145", search: ["145"] },
    "ORGANIC LEMON YELLOW":  { display: "146", search: ["146"] },
    "BRILLIANT WHITE":       { display: "147", search: ["147"] },
    "GREEN":                 { display: "149", search: ["149"] },
    "FAST RED":              { display: "322", search: ["322"] },
    "ORGANIC RED VIOLET":    { display: "480", search: ["480"] },
  },
  "MACHINE TINTER": {
    "YOX":   { display: "101", search: ["101", "yellow oxide"],       label: "Yellow Oxide" },
    "LFY":   { display: "102", search: ["102", "light fast yellow"],  label: "Light Fast Yellow" },
    "GRN":   { display: "103", search: ["103", "green"],              label: "Green" },
    "TBL":   { display: "104", search: ["104", "pthalo blue"],        label: "Pthalo Blue" },
    "WHITE": { display: "105", search: ["105", "white"],              label: "White" },
    "MAG":   { display: "106", search: ["106", "magenta"],            label: "Magenta" },
    "FFR":   { display: "107", search: ["107", "fast red"],           label: "Fast Red" },
    "BLACK": { display: "108", search: ["108", "black"],              label: "Black" },
    "OXR":   { display: "109", search: ["109", "red oxide"],          label: "Red Oxide" },
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

/**
 * Optional full-name `label` for a (product, baseColour) pair, or null. Used by
 * the mobile /po subtitle for MACHINE TINTER (whose base is a 3-letter abbr) to
 * show "Dramatone · Fast Red". Most products have no label (their base already
 * carries the colour name) → returns null and nothing is appended.
 */
export function getBaseAliasLabel(
  product: string | null | undefined,
  baseColour: string | null | undefined,
): string | null {
  if (!product || !baseColour) return null;
  return BASE_ALIASES[product]?.[baseColour]?.label ?? null;
}
