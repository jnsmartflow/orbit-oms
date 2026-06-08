// Light secondary descriptor line shown under a product's display name on the
// order surfaces (mobile /order + desktop /place-order). DISPLAY-ONLY:
//   - never written to the catalog, the search haystack, or the order email,
//   - purely a UI subtitle that clarifies the sub-product (e.g. distinguishing
//     the two Satin finishes by binder).
//
// Keyed by `${family}|${subProduct}`. Returns null when no descriptor applies
// (the caller renders nothing in that case). Add entries here as families gain
// a meaningful one-line clarifier; most products need none.

export const SUB_PRODUCT_DESCRIPTORS: Record<string, string> = {
  "SATIN|SUPER SATIN":       "Super Satin · Oil Base",
  "SATIN|SATIN STAY BRIGHT": "Satin · Water Base",
  // STAINER tabs — short displayName (GVA / Universal / Tinter / Acotone) on
  // line 1, the fuller name on the light second line (Satin pattern).
  "STAINER|PU STAINER":        "PU Stainer",
  "STAINER|UNIVERSAL STAINER": "Universal Stainer",
  "STAINER|MACHINE TINTER":    "Dramatone",
  "STAINER|ACOTONE TINTER":    "Acotone Tinter",
  // Promise single-base variant tabs — the variant is the row (baseColour); the
  // per-variant qualifier (Br White / Int & Ext, from base-aliases) is appended
  // on the SAME light second line via getSecondLine() below.
  "PROMISE|PROMISE SMARTCHOICE": "SmartChoice",
  "PROMISE|PROMISE PRIMER":      "Promise Primer",
};

// Tabs whose per-variant base-alias qualifier moves to the light SECOND line
// (and is therefore SUPPRESSED from the line-1 "· alias" suffix). Emulsion tabs
// are NOT here — they keep "— base · alias" on line 1.
const VARIANT_QUALIFIER_TABS = new Set<string>([
  "PROMISE|PROMISE SMARTCHOICE",
  "PROMISE|PROMISE PRIMER",
]);

export function getSubProductDescriptor(
  family: string | null | undefined,
  subProduct: string | null | undefined,
): string | null {
  if (!family || !subProduct) return null;
  return SUB_PRODUCT_DESCRIPTORS[`${family}|${subProduct}`] ?? null;
}

// True when this tab carries its base-alias qualifier on the second line (so the
// caller should NOT render the line-1 alias suffix).
export function isVariantQualifierTab(
  family: string | null | undefined,
  subProduct: string | null | undefined,
): boolean {
  if (!family || !subProduct) return false;
  return VARIANT_QUALIFIER_TABS.has(`${family}|${subProduct}`);
}

// The light second line. For variant-qualifier tabs it is
// "{tab descriptor} · {qualifier}" (qualifier omitted when null); for every
// other row it is just the descriptor (or null). `qualifier` is the
// getBaseAliasDisplay() value for the row.
export function getSecondLine(
  family: string | null | undefined,
  subProduct: string | null | undefined,
  qualifier: string | null | undefined,
): string | null {
  const desc = getSubProductDescriptor(family, subProduct);
  if (!desc) return null;
  if (isVariantQualifierTab(family, subProduct)) {
    return qualifier ? `${desc} · ${qualifier}` : desc;
  }
  return desc;
}
