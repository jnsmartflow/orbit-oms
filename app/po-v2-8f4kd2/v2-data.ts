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

/**
 * COPIED VERBATIM from lib/place-order/pack.ts (its `PACK_STEP_MAP`, read
 * 2026-09-06). Copied rather than imported so v2 stays self-contained and
 * deletable in one command — the containment rule. It is a SNAPSHOT: if the
 * depot re-sizes a carton, the original moves and this does not.
 *
 * ⚠ WHERE IT DISAGREES WITH OUR `per` VALUES — reported, not silently merged:
 *   500ML  their 12  ·  our per 12   agree
 *   1L     their  6  ·  our per  6   agree
 *   4L     their  4  ·  our per  4   agree
 *   10L    their  1  ·  our per NULL  ← different SPELLING, same meaning
 *   20L    their  1  ·  our per NULL  ← different SPELLING, same meaning
 * Their table states an explicit step of 1 for the drums ("10L is a drum at
 * this depot, no box"); ours says "no box" by writing `per: null`. Both mean
 * "step by one unit", so `stepFor` below produces the same number either way.
 */
const PACK_STEP_MAP: Record<string, number> = {
  "50ML":  12,
  "100ML": 24,
  "200ML": 12,
  "500ML": 12,
  "1L":    6,
  "4L":    4,
  "10L":   1,
  "20L":   1,
  "30L":   1,
  "40KG":  1,
  "25KG":  1,
  "30KG":  1,
  "5KG":   1,
  "1 pc":  1,
};

/**
 * How many UNITS one tap of +/- moves: a whole box.
 *
 * `per` wins because it is this product's own carton size; the copied depot
 * table is the fallback that answers for the drums (10L/20L -> 1), and 1 is
 * the last resort for a pack neither knows. So 1L steps 0 -> 6 -> 12, 4L
 * steps 0 -> 4 -> 8, and 20L steps 0 -> 1 -> 2.
 */
export function stepFor(pack: V2Pack): number {
  return pack.per ?? PACK_STEP_MAP[pack.size] ?? 1;
}

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
  /**
   * The product's pack table, snapshotted onto the line. Nothing reads it for
   * a COUNT — `unitsIn` does not need it. It is kept so a review screen can
   * render this line's rows in catalog order: `qtys` is a Record, and its key
   * order follows the order the salesman tapped, not the pack table.
   */
  packs:      readonly V2Pack[];
};

/**
 * Total UNITS in one set of quantities — a plain sum, nothing else.
 *
 * 🔴 THERE IS DELIBERATELY NO BOX COUNT ANYWHERE IN v2. An earlier cut
 * divided qty by `per` and reported boxes to one decimal; "2.5 boxes" is not
 * a thing anyone can pick, load or check on a depot floor. Units are always
 * whole, so every number this app shows is a number a person can act on.
 * Do not reintroduce a boxes figure without a reason that survives that test.
 */
export function unitsIn(qtys: Record<string, number>): number {
  let units = 0;
  for (const qty of Object.values(qtys)) {
    if (qty > 0) units += qty;
  }
  return units;
}
