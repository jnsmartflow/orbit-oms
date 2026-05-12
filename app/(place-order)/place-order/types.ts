// Shared types for /place-order. Mirrors the JSON shape returned by
// /api/order/data — see app/api/order/data/route.ts for the source.

export type Customer = {
  name: string;
  code: string;
};

export type Product = {
  family:       string;        // category — "WS", "GLOSS", "VT", etc.
  section:      string;        // grid section — UTILITY / INTERIORS / EXTERIORS / ENAMELS / WOODCARE / MULTI-USE
  subgroup:     string;        // within-section visual cluster — render-time row-break label, never displayed
  subProduct:   string;        // product line — "MAX", "ETERNA", "DIAMOND GLO"
  baseColour:   string | null; // null for PLAIN rows; named base/colour for variants
  displayName:  string;
  searchTokens: string;        // pre-built lowercase token blob for filtering
  tinterType:   string | null;
  productType:  string;        // "PLAIN" | "BASE_VARIANT" | "COLOUR" — informational
  packs:        string[];      // bare numeric pack codes — "1", "4", "200" — formatPack() turns these into "1L" / "200ML"
};

// Cart shape — used by page state, cart panel, draft persistence, and email
// build. CartLine.packQtys values are UNITS (2026-05-12 flip — supersedes
// the prior boxes-semantics decision in memory note
// place_order_cell_vs_email_units.md). Email build is a no-op pass-through;
// the +/- keys in the variant cell move qty in box-step multiples
// (boxSize × units per "+"/"−" press) so the operator still thinks in boxes
// while the stored number is always units.
export type CartLine = {
  family:      string;
  subProduct:  string;
  displayName: string;
  baseColour:  string | null;
  packQtys:    Record<string, number>;
  touchedAt?:  number;                 // ms epoch — last setQty call on this line; powers RecentlyUsed sort. Optional for back-compat with pre-existing localStorage drafts.
};

export type Bill = {
  id:    number;
  lines: CartLine[];
};
