// Hidden v2 salesman order page — DATA + DESIGN TOKENS.
//
// 🔴 CONTAINMENT — everything v2 needs lives inside app/po-v2-8f4kd2/.
// Colours are exported constants used as INLINE STYLES, never CSS variables in
// globals.css and never entries in tailwind.config.ts, so deleting this one
// folder removes v2 whole with no orphans. Nothing here imports from lib/ or
// app/po/ — step 5 is what wires the real catalog in.
//
// Split out of po-v2-page.tsx when the drawer landed and the single file went
// past the ~700-line readability line.

// ── Design tokens ──────────────────────────────────────────────────────────
export const RULE     = "#E9E7ED";              // hairline borders + rules
export const INK      = "#16151A";              // near-black text
export const VIOLET    = "#6D28D9";             // violet-700, the v2 accent
export const VIOLET_BG = "#F5F1FE";             // selected-chip / active-tile fill
export const SEARCH_BG = "#F4F3F7";
export const SCRIM     = "rgba(18,14,26,.42)";

// ── Board ──────────────────────────────────────────────────────────────────
// `sap` is the REAL mo_order_form_index_v2.product name. Carried now, unused
// and undisplayed, purely so step 5 can join tiles to catalog rows on it
// without re-typing the mapping. A typo here costs a silent no-match later,
// so it is worth a careful read rather than a glance.

export type V2Tile = {
  /** Shown on the tile. Short enough to fit two lines at 13px bold. */
  label: string;
  /** mo_order_form_index_v2.product — join key for step 5. NOT displayed. */
  sap: string;
};

export type V2Family = {
  name: string;
  /** Tile background. Inline style, deliberately not a CSS variable. */
  tint: string;
  tiles: readonly V2Tile[];
};

export const FAMILIES: readonly V2Family[] = [
  {
    name: "Enamel",
    tint: "#F8F0E0",
    tiles: [
      { label: "Gloss",          sap: "GLOSS" },
      { label: "Promise Enamel", sap: "PROMISE ENAMEL" },
      { label: "Super Satin",    sap: "SUPER SATIN" },
      { label: "M900",           sap: "M900 GLOSS" },
    ],
  },
  {
    name: "Interior",
    tint: "#E8EFFA",
    tiles: [
      { label: "Stay Bright",  sap: "SATIN STAY BRIGHT" },
      { label: "Supercover",   sap: "SUPERCOVER" },
      { label: "Pearl Glo",    sap: "VT PEARL GLO" },
      { label: "Platinum Glo", sap: "VT PLATINUM GLO" },
    ],
  },
  {
    name: "Promise",
    tint: "#FBECEF",
    tiles: [
      { label: "Smart Choice",   sap: "PROMISE SMARTCHOICE" },
      { label: "Promise Primer", sap: "PROMISE PRIMER" },
      { label: "Promise Int",    sap: "PROMISE INTERIOR" },
      { label: "Promise Ext",    sap: "PROMISE EXTERIOR" },
    ],
  },
  {
    name: "Exterior",
    tint: "#EAF4E8",
    tiles: [
      { label: "Dustproof",  sap: "WS PROTECT DUSTPROOF" },
      { label: "Hi-Sheen",   sap: "WS PROTECT HI-SHEEN" },
      { label: "Max",        sap: "WS MAX" },
      { label: "Powerflexx", sap: "WS POWERFLEXX" },
    ],
  },
  {
    name: "Primer",
    tint: "#E3F1F8",
    tiles: [
      { label: "Cement SB",   sap: "CEMENT PRIMER SB" },
      { label: "Zinc Yellow", sap: "ZINC YELLOW METAL PRIMER" },
      { label: "Red Oxide",   sap: "RED OXIDE METAL PRIMER" },
      { label: "Ext Acrylic", sap: "EXTERIOR ACRYLIC PRIMER" },
    ],
  },
  {
    name: "Stainer",
    tint: "#F6E8C8",
    tiles: [
      { label: "Acotone",        sap: "ACOTONE" },
      { label: "Uni Stainer",    sap: "UNIVERSAL STAINER" },
      { label: "Machine Tinter", sap: "MACHINE TINTER" },
      { label: "GVA",            sap: "GVA" },
    ],
  },
  {
    name: "Aquatech",
    tint: "#E0F1EA",
    tiles: [
      { label: "Damp 2in1", sap: "DAMP PROTECT 2IN1" },
      { label: "Roof Coat", sap: "ROOF COAT WHITE" },
      { label: "Crack 5mm", sap: "CRACKFILLER 5MM" },
      { label: "Damp Base", sap: "DAMP PROTECT BASECOAT" },
    ],
  },
  {
    name: "Wood",
    tint: "#EFE6DA",
    tiles: [
      { label: "2K Matt",      sap: "2K PU MATT" },
      { label: "Prime Matt",   sap: "PU PRIME MATT" },
      { label: "Prime Sealer", sap: "PU PRIME SEALER" },
      { label: "Thinner",      sap: "MULTI PURPOSE THINNER" },
    ],
  },
];

// ── Product specs (hard-coded placeholders) ────────────────────────────────

export type V2Base  = { code: string; word: string };
export type V2Shade = { name: string; hex: string };
/** `per` = units in one box. NULL means the pack ships loose (drums). */
export type V2Pack  = { size: string; per: number | null };

export type V2Product = {
  key:      string;
  name:     string;
  category: string;
  variants: readonly string[];
  bases:    readonly V2Base[];
  shades:   readonly V2Shade[];
  packs:    readonly V2Pack[];
};

const GLOSS: V2Product = {
  key:      "GLOSS",
  name:     "Gloss",
  category: "Enamel",
  variants: [],
  bases: [
    { code: "BW", word: "WHITE" },
    { code: "90", word: "BASE" },
    { code: "92", word: "BASE" },
  ],
  shades: [
    { name: "Black",           hex: "#171717" },
    { name: "Brilliant White", hex: "#F8F6F0" },
    { name: "Golden Brown",    hex: "#A9762F" },
    { name: "Signal Red",      hex: "#C0271E" },
    { name: "Ivory",           hex: "#F1E5C4" },
    { name: "Deep Blue",       hex: "#1E3A8A" },
  ],
  packs: [
    { size: "500ML", per: 12 },
    { size: "1L",    per: 6 },
    { size: "4L",    per: 4 },
    { size: "10L",   per: null },
    { size: "20L",   per: null },
  ],
};

const SMARTCHOICE: V2Product = {
  key:      "SMARTCHOICE",
  name:     "Promise SmartChoice",
  category: "Promise",
  variants: ["Interior", "Exterior", "Int Primer", "Ext Primer", "Acrylic Distemper"],
  bases: [
    { code: "BW", word: "WHITE" },
    { code: "P1", word: "PASTEL" },
    { code: "D1", word: "DEEP" },
  ],
  shades: [],
  packs: [
    { size: "1L",  per: 6 },
    { size: "4L",  per: 4 },
    { size: "10L", per: null },
    { size: "20L", per: null },
  ],
};

const CEMENTSB: V2Product = {
  key:      "CEMENTSB",
  name:     "Cement Primer SB",
  category: "Primer",
  variants: [],
  bases:    [],
  shades:   [],
  packs: [
    { size: "1L",  per: 6 },
    { size: "4L",  per: 4 },
    { size: "10L", per: null },
    { size: "20L", per: null },
  ],
};

export const PRODUCTS = { GLOSS, SMARTCHOICE, CEMENTSB } as const;

/**
 * Which spec a tile opens. Only TWO tiles are wired to their real product —
 * Smart Choice and Cement SB. Every other tile falls through to GLOSS as a
 * deliberate PLACEHOLDER, so the drawer can be exercised from anywhere on the
 * board. Step 5 replaces this whole function with a catalog lookup on
 * `V2Tile.sap`, which is why the mapping keys on `sap` rather than on `label`.
 */
export function productForTile(sap: string): V2Product {
  if (sap === "PROMISE SMARTCHOICE") return SMARTCHOICE;
  if (sap === "CEMENT PRIMER SB")    return CEMENTSB;
  return GLOSS;
}

/** The nine bases offered behind "+ More" on the Base tab. */
export const ALL_BASES: readonly V2Base[] = [
  { code: "BW",  word: "WHITE" },
  { code: "90",  word: "BASE" },
  { code: "91",  word: "BASE" },
  { code: "92",  word: "BASE" },
  { code: "93",  word: "BASE" },
  { code: "94",  word: "BASE" },
  { code: "P1",  word: "PASTEL" },
  { code: "D1",  word: "DEEP" },
  { code: "CLR", word: "CLEAR" },
];

// ── Cart ───────────────────────────────────────────────────────────────────

export type V2CartLine = {
  id:         string;
  /** Which board tile produced this line — drives the tile badge + fill. */
  tileSap:    string;
  productKey: string;
  productName: string;
  variant:    string | null;
  base:       string | null;
  shade:      string | null;
  /** pack size -> quantity in UNITS. Only non-zero entries are kept. */
  qtys:       Record<string, number>;
  packs:      readonly V2Pack[];
};

/**
 * Boxes and loose units for one set of quantities.
 *
 * A pack with a `per` value converts to boxes (qty / per); a pack without one
 * is a drum and counts as a LOOSE unit — the two are never added together,
 * because half a drum is not half a box and summing them would print a number
 * that means nothing on the floor. Boxes round to one decimal.
 */
export function tally(
  qtys: Record<string, number>,
  packs: readonly V2Pack[],
): { boxes: number; loose: number; units: number } {
  let boxes = 0;
  let loose = 0;
  let units = 0;
  for (const pack of packs) {
    const qty = qtys[pack.size] ?? 0;
    if (qty <= 0) continue;
    units += qty;
    if (pack.per && pack.per > 0) boxes += qty / pack.per;
    else loose += qty;
  }
  return { boxes: Math.round(boxes * 10) / 10, loose, units };
}
