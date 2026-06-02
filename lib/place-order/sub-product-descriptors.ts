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
};

export function getSubProductDescriptor(
  family: string | null | undefined,
  subProduct: string | null | undefined,
): string | null {
  if (!family || !subProduct) return null;
  return SUB_PRODUCT_DESCRIPTORS[`${family}|${subProduct}`] ?? null;
}
