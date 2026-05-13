// Shared types for /place-order. Mirrors the JSON shape returned by
// /api/order/data — see app/api/order/data/route.ts for the source.

import type { RawPack } from "@/lib/place-order/pack-buckets";

export type Customer = {
  name: string;
  code: string;
  // Area / locality from mo_customer_keywords. Surfaced in the
  // /place-order customer-search dropdown so operators can
  // distinguish customers with similar names (Phase 3.6,
  // 2026-05-13). Null when no keyword row for the customer has a
  // non-null area; dropdown then renders just the code.
  area?: string | null;
};

export type Product = {
  // Catalog row primary key from mo_order_form_index_v2.id. Used as
  // the stable cart-line identity post-Phase 3 (2026-05-13) so cart
  // dedup survives multiple rows sharing (subProduct, baseColour)
  // but differing in `product` — the case that broke setQty/qtyAt
  // when Phase 2 packed multiple products under one subProduct.
  id:           number;
  family:       string;        // category — "WS", "GLOSS", "VT", etc.
  section:      string;        // grid section — UTILITY / INTERIORS / EXTERIORS / ENAMELS / WOODCARE / MULTI-USE
  subgroup:     string;        // within-section visual cluster — render-time row-break label, never displayed
  subProduct:   string;        // product line — "MAX", "ETERNA", "DIAMOND GLO"
  // Real product name for email, parser, dispatch (Phase 3 taxonomy
  // cutover, 2026-05-13). Null for families not yet migrated; falls
  // back to subProduct at consumer sites.
  product:      string | null;
  // Tab label on /place-order. Null for unmigrated families; falls
  // back to subProduct at consumer sites.
  uiGroup:      string | null;
  baseColour:   string | null; // null for PLAIN rows; named base/colour for variants
  displayName:  string;
  searchTokens: string;        // pre-built lowercase token blob for filtering
  tinterType:   string | null;
  productType:  string;        // "PLAIN" | "BASE_VARIANT" | "COLOUR" — informational
  // Phase 3.5 (2026-05-13): packs now carry unit alongside packCode so
  // KG SKUs (5 KG, 25 KG) survive into bucket placement, cart key, and
  // email rendering. formatPack(packCode, unit) renders the label;
  // bucket-buckets.packToBucket(pack) places it in a column.
  packs:        RawPack[];
};

// Cart shape — used by page state, cart panel, draft persistence, and email
// build. CartLine.packQtys values are UNITS (2026-05-12 flip — supersedes
// the prior boxes-semantics decision in memory note
// place_order_cell_vs_email_units.md). Email build is a no-op pass-through;
// the +/- keys in the variant cell move qty in box-step multiples
// (boxSize × units per "+"/"−" press) so the operator still thinks in boxes
// while the stored number is always units.
export type CartLine = {
  // Catalog row id — Phase 3 cart-line identity (2026-05-13). Optional
  // for backward compat with pre-existing localStorage drafts that
  // pre-date the cutover; matching falls back to (subProduct,
  // baseColour) when productId is missing. New cart lines always
  // populate this from Product.id.
  productId?:  number;
  family:      string;
  subProduct:  string;
  // Real product name copied from Product.product at add-to-cart
  // time. Null for unmigrated families; email builder falls back to
  // subProduct.
  product?:    string | null;
  // Tab label copied from Product.uiGroup at add-to-cart time
  // (Phase 3.5+ — 2026-05-13). Null for unmigrated families; cart
  // panel groups by `${family}|||${uiGroup ?? subProduct}` so each
  // tab gets its own section with header "FAMILY · uiGroup".
  uiGroup?:    string | null;
  displayName: string;
  baseColour:  string | null;
  packQtys:    Record<string, number>;
  touchedAt?:  number;                 // ms epoch — last setQty call on this line; powers RecentlyUsed sort. Optional for back-compat with pre-existing localStorage drafts.
};

export type Bill = {
  id:    number;
  lines: CartLine[];
};
