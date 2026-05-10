// Shared types for /place-order. Mirrors the JSON shape returned by
// /api/order/data — see app/api/order/data/route.ts for the source.

export type Customer = {
  name: string;
  code: string;
};

export type Product = {
  family:       string;        // category — "WS", "GLOSS", "VT", etc.
  subProduct:   string;        // product line — "MAX", "ETERNA", "DIAMOND GLO"
  baseColour:   string | null; // null for PLAIN rows; named base/colour for variants
  displayName:  string;
  searchTokens: string;        // pre-built lowercase token blob for filtering
  tinterType:   string | null;
  productType:  string;        // "PLAIN" | "BASE_VARIANT" | "COLOUR" — informational
  packs:        string[];      // bare numeric pack codes — "1", "4", "200" — formatPack() turns these into "1L" / "200ML"
};

// Cart shape — used by page state, cart panel, draft persistence, and email
// build. CartLine.packQtys values are BOXES (per locked decision in memory
// note place_order_cell_vs_email_units.md); email build multiplies by
// packStep at emission to convert boxes → units.
export type CartLine = {
  family:      string;
  subProduct:  string;
  displayName: string;
  baseColour:  string | null;
  packQtys:    Record<string, number>;
};

export type Bill = {
  id:    number;
  lines: CartLine[];
};
