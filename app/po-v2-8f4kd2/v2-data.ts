// Hidden v2 salesman order page — DATA, CURATION, AND THE CATALOG JOIN.
//
// 🔴 CONTAINMENT — everything v2 needs lives inside app/po-v2-8f4kd2/.
// Colours are exported constants used as INLINE STYLES, never CSS variables in
// globals.css and never entries in tailwind.config.ts. Nothing here imports
// from lib/ or app/po/ — where shared logic is needed it is COPIED in with its
// source named, so deleting this one folder removes v2 whole.

// ── Design tokens ──────────────────────────────────────────────────────────
//
// 🔴 THE NEUTRALS CARRY A VIOLET TINT ON PURPOSE. #74718A is not #737373 with a
// rounding error — every grey here is pulled a few points toward the brand hue
// so that a border beside a violet button reads as part of the same object
// rather than as a stray from a different design. Substituting plain greys is
// the one change that would quietly undo the whole palette, so do not.
//
// Three violets, and they do different jobs. Mixing them up is how a screen
// ends up with two things that look equally like the primary action.
export const BRAND      = "#7C3AED";  // brand.600 — THE ONE commit button per
                                      // screen, the theme colour, the focus ring
export const VIOLET     = "#6D28D9";  // brand.700 — every tappable TEXT
export const BRAND_DEEP = "#5B21B6";  // brand.800 — the wordmark on white

export const SURFACE    = "#FFFFFF";  // cards, sheets, bars
export const PAGE       = "#FAFAFC";  // the page behind them
export const FILL       = "#F4F3F8";  // inputs, inert squares
export const RULE       = "#E9E7F0";  // EVERY border, without exception
export const FAINT      = "#9C99AC";  // placeholders, disabled, chevrons
export const MUTED      = "#74718A";  // second lines, captions
export const BODY       = "#3A3748";  // ordinary text
export const INK        = "#1B1826";  // headings and anything that must land

export const VIOLET_BG  = "#F5F1FE";  // selected-chip / in-cart tile wash

/** The focused input border, violet-500 — a step lighter than brand.600 so
 *  the ring around it reads as a halo rather than a second border. */
export const FOCUS      = "#8B5CF6";
/** brand.600 at 13%. The ring, never a fill. */
export const FOCUS_RING = "rgba(124,58,237,.13)";

/**
 * The one destructive colour, red-600.
 *
 * 🔴 IT APPEARS ONLY INSIDE A CONFIRM, never on a trigger sitting loose on a
 * screen. A red button a thumb can reach by accident is not a warning, it is a
 * hazard; the trigger that leads here is quiet text and the weight lands on the
 * button you have to have already decided to press.
 */
export const URGENT     = "#DC2626";

/**
 * The favourite star, amber-500.
 *
 * 🔴 NOT BRAND VIOLET, DELIBERATELY. Violet means "selected" everywhere else in
 * this app — the chosen chip, the current dealer, the live button. A starred
 * dealer is not a selected one, and painting it violet would make a list of
 * favourites look like a list of things already picked.
 */
export const STAR       = "#F59E0B";

/**
 * 🔴 THE ONLY VIOLET GROUND IN THE APP — the brand row, and nothing else.
 * Every other surface is SURFACE white or PAGE #FAFAFC. A second tinted ground
 * anywhere else and this stops reading as "the masthead" and starts reading as
 * decoration applied at random.
 */
export const BRAND_WASH = "#F5F3FF";

/**
 * A family card lifted off the page. Two layers on purpose: the hairline
 * shadow gives it an edge at rest, the wide soft one gives it height. One
 * layer alone reads either as a border or as a smudge.
 */
export const CARD_SHADOW =
  "0 1px 2px rgba(27,24,38,.04), 0 6px 16px -8px rgba(27,24,38,.10)";
export const SCRIM      = "rgba(18,14,26,.42)";
export const SEARCH_BG  = FILL;
/** One border colour means one token. Kept as a name because rows read better
 *  saying DIVIDER, but it is RULE and must stay RULE. */
export const DIVIDER    = RULE;

/**
 * The brand gradient, for the SPLASH. Screen only — it never goes on paper.
 *
 * 🔴 TWO STOPS, NOT THREE. It used to fall to #581C87 at the far corner, which
 * read as a bruise on a full screen rather than as a brand. The radial geometry
 * is unchanged; only the dark stop is gone.
 *
 * ⚠ THE APP ICON STILL USES THE THREE-STOP VERSION and is not regenerated here.
 * A 512px tile can carry a depth a whole phone screen cannot, and that tile is
 * already approved — it is a separate decision, so public/brand/ is untouched.
 */
export const BRAND_GRADIENT =
  "radial-gradient(125% 125% at 26% 20%, #A78BFA 0%, #7C3AED 100%)";

// ── The payload from GET /api/order/data ───────────────────────────────────
// Field names and nesting mirror app/api/order/data/route.ts exactly. `packs`
// is the only nested field; `product`, `uiGroup`, `baseColour`, `tinterType`
// and `region` are all NULLABLE there and are typed nullable here.

export type ApiPack = { packCode: string; unit: string | null; material: string };

export type ApiProduct = {
  id:           number;
  family:       string;
  section:      string;
  subgroup:     string;
  subProduct:   string;
  product:      string | null;
  uiGroup:      string | null;
  baseColour:   string | null;
  displayName:  string;
  searchTokens: string;
  tinterType:   string | null;
  productType:  string;
  sortOrder:    number;
  region:       string | null;
  packs:        ApiPack[];
};

export type ApiCustomer = { name: string; code: string; area: string | null };
export type ApiPayload  = { customers: ApiCustomer[]; products: ApiProduct[] };

// ── Board ──────────────────────────────────────────────────────────────────
// `sap` is the catalog join key. It must equal COALESCE(product, subProduct)
// for that product's menu rows — see joinKey() below for why that COALESCE is
// not optional.

export type V2Tile   = {
  label: string;
  /** Catalog join key — COALESCE(product, subProduct) for this product's rows. */
  sap: string;
  /**
   * 🔴 THE IMAGE KEY, AND IT IS NEVER DERIVED FROM `label`.
   *
   * It would be one line to slugify the label instead, and that line would
   * break the board silently the next time a tile is renamed — which is not
   * hypothetical: "Dustproof" became "Protect Dustproof" and M900 was replaced
   * by PU Enamel, both in a single step, and neither touched a filename. A
   * derived slug would have turned both renames into a broken-image icon on a
   * salesman's phone with nothing failing anywhere a developer would look.
   *
   * So the slug is written down, matches the committed filename in
   * public/category-images/ exactly, and changes only when the FILE is renamed.
   * Labels are free to change; this is not.
   */
  slug: string;
};
export type V2Family = {
  name: string;
  tint: string;
  /**
   * 🔴 FAMILY-WIDE OPENING TAB, AND IT BEATS THE PER-PRODUCT RANKING.
   *
   * The general rule opens each product on whichever tab holds its single
   * most-ordered option. For ENAMEL that gets Super Satin wrong: its top base
   * (BRILLIANT WHITE, 431) outsells its top shade (BLACK, 197), so the ranking
   * says Base while the counter says Shade — an enamel customer is buying a
   * colour, and the base is what you reach for when he is not.
   *
   * Written HERE, on the family, and not as an if-statement over four product
   * names. Add a fifth enamel tomorrow and it inherits this; the four names
   * would not have.
   */
  openTab?: "base" | "shade";
  tiles: readonly V2Tile[];
};

export const FAMILIES: readonly V2Family[] = [
  {
    name: "Enamel",
    tint: "#F8F0E0",
    openTab: "shade",
    tiles: [
      { label: "Gloss",          sap: "GLOSS", slug: "gloss" },
      { label: "Promise Enamel", sap: "PROMISE ENAMEL", slug: "promise-enamel" },
      { label: "Super Satin",    sap: "SUPER SATIN", slug: "super-satin" },
      // M900 left the board 2026-09-07 and is now reachable by SEARCH ONLY -
      // a low-volume line was holding a permanent tile. PU Enamel took the
      // slot; "PU ENAMEL" is its real string, quoted from the live payload,
      // where menu.product and menu.subProduct are both exactly that.
      { label: "PU Enamel",      sap: "PU ENAMEL", slug: "pu-enamel" },
    ],
  },
  {
    name: "Interior",
    tint: "#E8EFFA",
    tiles: [
      { label: "Stay Bright",  sap: "SATIN STAY BRIGHT", slug: "stay-bright" },
      { label: "Supercover",   sap: "SUPERCOVER", slug: "supercover" },
      { label: "Pearl Glo",    sap: "VT PEARL GLO", slug: "pearl-glo" },
      { label: "Platinum Glo", sap: "VT PLATINUM GLO", slug: "platinum-glo" },
    ],
  },
  {
    name: "Promise",
    tint: "#FBECEF",
    tiles: [
      { label: "Smart Choice",   sap: "PROMISE SMARTCHOICE", slug: "smart-choice" },
      { label: "Promise Primer", sap: "PROMISE PRIMER", slug: "promise-primer" },
      { label: "Promise Int",    sap: "PROMISE INTERIOR", slug: "promise-int" },
      { label: "Promise Ext",    sap: "PROMISE EXTERIOR", slug: "promise-ext" },
    ],
  },
  {
    name: "Exterior",
    tint: "#EAF4E8",
    tiles: [
      // 🔴 THESE TWO LABELS ARE DISPLAY ONLY. `sap` is the catalog join key and
      // is untouched, and the email line is built by emailLineLabel() off the
      // menu ROW (product / baseColour / subProduct) - never off `label`. A
      // tile rename therefore cannot reach the wire, and it must not: the
      // PowerShell intake parser reads that product string, and a changed one
      // would break order intake silently.
      { label: "Protect Dustproof", sap: "WS PROTECT DUSTPROOF", slug: "protect-dustproof" },
      { label: "Protect Hi-Sheen",  sap: "WS PROTECT HI-SHEEN", slug: "protect-hi-sheen" },
      { label: "Max",        sap: "WS MAX", slug: "max" },
      { label: "Powerflexx", sap: "WS POWERFLEXX", slug: "powerflexx" },
    ],
  },
  {
    name: "Primer",
    tint: "#E3F1F8",
    tiles: [
      { label: "Cement SB",   sap: "CEMENT PRIMER SB", slug: "cement-sb" },
      { label: "Zinc Yellow", sap: "ZINC YELLOW METAL PRIMER", slug: "zinc-yellow" },
      { label: "Red Oxide",   sap: "RED OXIDE METAL PRIMER", slug: "red-oxide" },
      { label: "Ext Acrylic", sap: "EXTERIOR ACRYLIC PRIMER", slug: "ext-acrylic" },
    ],
  },
  {
    name: "Stainer",
    tint: "#F6E8C8",
    tiles: [
      { label: "Acotone",        sap: "ACOTONE", slug: "acotone" },
      { label: "Uni Stainer",    sap: "UNIVERSAL STAINER", slug: "uni-stainer" },
      { label: "Machine Tinter", sap: "MACHINE TINTER", slug: "machine-tinter" },
      { label: "GVA",            sap: "GVA", slug: "gva" },
    ],
  },
  {
    name: "Aquatech",
    tint: "#E0F1EA",
    tiles: [
      { label: "Damp 2in1", sap: "DAMP PROTECT 2IN1", slug: "damp-2in1" },
      { label: "Roof Coat", sap: "ROOF COAT WHITE", slug: "roof-coat" },
      { label: "Crack 5mm", sap: "CRACKFILLER 5MM", slug: "crack-5mm" },
      { label: "Damp Base", sap: "DAMP PROTECT BASECOAT", slug: "damp-base" },
    ],
  },
  {
    name: "Wood",
    tint: "#EFE6DA",
    tiles: [
      { label: "2K Matt",      sap: "2K PU MATT", slug: "2k-matt" },
      { label: "Prime Matt",   sap: "PU PRIME MATT", slug: "prime-matt" },
      { label: "Prime Sealer", sap: "PU PRIME SEALER", slug: "prime-sealer" },
      { label: "Thinner",      sap: "MULTI PURPOSE THINNER", slug: "thinner" },
    ],
  },
];

// ── Tile art ───────────────────────────────────────────────────────────────

/**
 * 🔴 THE SLUGS THAT ACTUALLY HAVE A FILE. An explicit list, checked before any
 * <img> is rendered — never "render it and hope".
 *
 * A missing file does not fail quietly. The browser paints a broken-image glyph
 * in the tile and the salesman is the one who sees it; the 404 lands in a
 * console nobody on a warehouse floor is reading. So the board asks this set
 * first and renders an empty tinted square when the answer is no.
 *
 * GENERATED by listing public/category-images/ (2026-09-07, second pass).
 * 7 of the 32 tiles have no art: smart-choice, acotone, uni-stainer, machine-tinter, gva, prime-sealer, thinner.
 * When art arrives, run scripts/convert-tile-images.mjs and re-derive this
 * from the folder; nothing else changes.
 *
 * ⚠ smart-choice IS ON THAT LIST AND USED TO HAVE ART. Its file was renamed
 * to smart-choice-exterior.webp because the picture was the Exterior tin, and
 * the Exterior tin is now a VARIANT image in the drawer's rail. Proven by
 * hash, not assumed: smart-choice-exterior.webp is byte-identical to the
 * smart-choice.webp committed at a911a89a. If the board tile should keep art,
 * the answer is a new photograph of the RANGE, not that one variant's tin
 * standing in for four others.
 */
export const TILE_IMAGES: ReadonlySet<string> = new Set([
  "2k-matt",
  "cement-sb",
  "crack-5mm",
  "damp-2in1",
  "damp-base",
  "ext-acrylic",
  "gloss",
  "max",
  "pearl-glo",
  "platinum-glo",
  "powerflexx",
  "prime-matt",
  "promise-enamel",
  "promise-ext",
  "promise-int",
  "promise-primer",
  "protect-dustproof",
  "protect-hi-sheen",
  "pu-enamel",
  "red-oxide",
  "roof-coat",
  "stay-bright",
  "super-satin",
  "supercover",
  "zinc-yellow",
]);

/**
 * 🔴 THE SAME IDEA FOR VARIANT ART, AND A SEPARATE SET ON PURPOSE.
 *
 * A variant slug is <tile-slug>-<variant-slug>, in the same folder. Keeping it
 * apart from TILE_IMAGES means a board tile can never accidentally resolve to
 * a variant's tin, or the reverse, however the two lists grow.
 *
 * WHY VARIANTS GET PICTURES AND BASES AND SHADES DO NOT. A base or a shade is
 * the SAME TIN in a different colour, so a photograph of it says nothing a
 * swatch does not say better. Smart Choice's five variants are five different
 * products in five differently coloured buckets — Acrylic Distemper red,
 * Interior cream, Exterior navy, Ext Primer blue-silver — and at 44px the
 * bucket's COLOUR separates them even though its text cannot be read.
 *
 * GENERATED by listing the folder, same pass as TILE_IMAGES.
 */
export const VARIANT_IMAGES: ReadonlySet<string> = new Set([
  "smart-choice-acrylic-distemper",
  "smart-choice-ext-primer",
  "smart-choice-exterior",
  "smart-choice-int-primer",
  "smart-choice-interior",
]);
/** The tile's image URL, or null when there is no file for that slug. */
export function tileImage(slug: string): string | null {
  return TILE_IMAGES.has(slug) ? `/category-images/${slug}.webp` : null;
}

/**
 * A variant option's image URL, or null when there is no file for it.
 *
 * The slug is built, not stored: <tile-slug>-<option-slug>. That is safe here
 * in a way it would NOT be for a tile — a tile slug is written down precisely
 * because a rename must not break it, whereas the option string IS the catalog
 * value and renaming it renames the product itself. The set below is still
 * consulted before anything renders, so a build that does not match a file
 * resolves to null and the option falls back to its text tile.
 */
export function variantImage(sap: string, option: string): string | null {
  const tile = TILE_SLUG.get(sap);
  if (!tile) return null;
  const slug = `${tile}-${optionSlug(option)}`;
  return VARIANT_IMAGES.has(slug) ? `/category-images/${slug}.webp` : null;
}

/** "Acrylic Distemper" -> "acrylic-distemper". Filenames only, never a value. */
function optionSlug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * Mix a hex colour toward white. `amount` is how far: 0 keeps it, 1 is white.
 *
 * The family tints were picked to fill an 84px block. Behind a product photo
 * they are far too strong — the tin ends up competing with its own background —
 * so the board washes them out to about half strength. The point of keeping ANY
 * colour is that the eye still bands four tiles into a family down the page;
 * the point of taking most of it away is that a tile should read as a product,
 * not as a coloured square with a product on it.
 */
export function mixToWhite(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    .map((c) => Math.round(c + (255 - c) * amount).toString(16).padStart(2, "0"));
  return "#" + ch.join("").toUpperCase();
}

/** How far the family tint is washed out behind the tile art. */
export const TILE_WASH = 0.55;

/**
 * The thumbnail for a cart line, looked up by its catalog join key.
 *
 * Built once at module load rather than searched per render: the review screen
 * calls this for every line on every keystroke in the notes field.
 *
 * A SEARCHED NON-TILE product is not in this map — there are 143 catalog
 * products and only 32 tiles — so it gets the neutral fill and no image, the
 * same treatment as the eight tiles whose art has not arrived.
 */
const TILE_ART = new Map<string, { src: string | null; wash: string }>();
/** sap -> the tile's image slug. The stem every variant filename is built on. */
const TILE_SLUG = new Map<string, string>();
for (const family of FAMILIES) {
  const wash = mixToWhite(family.tint, TILE_WASH);
  for (const tile of family.tiles) {
    TILE_ART.set(tile.sap, { src: tileImage(tile.slug), wash });
    TILE_SLUG.set(tile.sap, tile.slug);
  }
}

export function tileArtFor(sap: string): { src: string | null; wash: string } {
  return TILE_ART.get(sap) ?? { src: null, wash: FILL };
}

// ── Pack formatting ────────────────────────────────────────────────────────

/**
 * COPIED from lib/place-order/pack.ts's `formatPack` (read 2026-09-06),
 * behaviour for behaviour. Copied, not imported — containment. It is a
 * SNAPSHOT: if the original changes, this does not follow.
 *
 * The live payload carries units L / KG / GM / ML / PC and packCodes from
 * "0.2" to "925", so every branch below is reachable, not defensive padding.
 */
export function formatPack(packCode: string, unit?: string | null): string {
  const u = (unit ?? "").toUpperCase();
  if (u === "KG") return `${packCode}KG`;
  if (u === "GM") return `${packCode}GM`;
  // Tools sold by the piece: the carton size rides packCode, the label does not.
  if (u === "PC") return "1 pc";
  // Spray paint aerosol — a specific (packCode+unit) case so the 50/100/200 ML
  // magnitude path below stays byte-identical for paint.
  if (packCode === "400" && u === "ML") return "400 ml";
  const num = parseFloat(packCode);
  if (Number.isNaN(num)) return packCode;
  if (num >= 50)         return `${num}ML`;
  if (num < 1)           return `${Math.round(num * 1000)}ML`;
  return `${num}L`;
}

/**
 * COPIED VERBATIM from lib/place-order/pack.ts's `PACK_STEP_MAP`
 * (read 2026-09-06). Units in one box, keyed by the RENDERED pack label.
 * A pack absent from this table steps by 1 — which is also how the depot
 * table itself spells "this is a drum, not a box" (10L/20L are literal 1s).
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

/** Units moved by one tap of +/-: a whole box, or 1 for a drum. */
export function stepForLabel(label: string): number {
  return PACK_STEP_MAP[label] ?? 1;
}

// ── Curated option lists ───────────────────────────────────────────────────
// 🔴 THIS IS NOT THE CATALOGUE. It is EVERY option a tile has, IN RANK ORDER, ranked by what was
// actually ordered in the 90 days to 2026-09-07 — mail-order line frequency
// first (what the salesman ASKED for), SAP dispatch frequency breaking ties,
// catalog sortOrder last for anything never ordered. Anything the catalogue has
// that this does not name is appended AFTER it, in sortOrder, by the drawer —
// so the rail holds every option and nothing is unreachable.
//
// GENERATED from a read-only query, then frozen here BY DESIGN: the lists stay
// hand-editable in this exact shape so a list can be overridden by name without
// re-running anything. Re-rank deliberately, not on every deploy — the board
// should not reshuffle under a salesman who has learned where things are.
//
// Values are EXACT `baseColour` strings, matched literally including case:
// Sadolin stores "90 Base" while every other family stores "90 BASE", and that
// difference is real, not a typo.
//
// NOTHING IS TRUNCATED HERE OR ANYWHERE DOWNSTREAM. There is no cap and no
// expander any more — see the note where chipLimit() used to live.
//
// `variants` is not a different KIND of thing — Smart Choice and Promise
// Primer store their variants in `baseColour` too. It is a separate field only
// so the drawer can render them in one column with no group toggle.

export type V2Curation = {
  bases:    readonly string[];
  shades:   readonly string[];
  variants: readonly string[];
  /**
   * Which tab the drawer OPENS on — the one holding this product's single
   * most-ordered option, not always Base.
   *
   * GENERATED from the same 90-day ranking as the arrays, never hand-written.
   * Promise Enamel opens on SHADE because CLASSIC WHITE (797 mail orders) far
   * outsells its only base, BRILLIANT WHITE (241); opening on a one-chip Base
   * tab would put the thing he actually wants one tap away, every time.
   * Absent (or on a product with only one tab) means Base.
   */
  defaultTab?: "base" | "shade";
};

const NONE: readonly string[] = [];

export const CURATION: Record<string, V2Curation> = {
  "GLOSS":                     { bases: ["90 BASE", "BRILLIANT WHITE", "92 BASE", "93 BASE", "94 BASE", "GREEN BASE"], shades: ["BLACK", "DARK BROWN", "GOLDEN BROWN", "SMOKE GREY", "DA GREY", "GOLDEN YELLOW", "PO RED", "PHIROZA", "DEEP ORANGE", "BUS GREEN", "SIGNAL RED", "OXFORD BLUE", "SAND STONE", "ROYAL IVORY", "LEAF BROWN", "SKY BLUE", "LIGHT GREY", "CHERRY", "DAWN", "MINT GREEN", "CLASSIC WHITE", "MIDDLE BUFF", "DEEP GREEN", "BLAZING WHITE", "TRUCK BROWN", "WILD PURPLE", "AQUAMARINE", "MAHOGANY", "OFF WHITE", "PALE CREAM", "CASCADE GREEN", "OPALINE GREEN"], variants: NONE, defaultTab: "shade" },
  "PROMISE ENAMEL":            { bases: ["BRILLIANT WHITE"], shades: ["CLASSIC WHITE", "BLACK", "SMOKE GREY", "PHIROZA BLUE", "PO RED", "GOLDEN YELLOW", "GOLDEN BROWN", "DARK BROWN", "BUS GREEN"], variants: NONE, defaultTab: "shade" },
  "SUPER SATIN":               { bases: ["BRILLIANT WHITE", "90 BASE", "93 BASE", "92 BASE", "94 BASE", "96 BASE", "97 BASE"], shades: ["BLACK", "BROWN", "RICH BROWN", "MAHOGANY", "SPECIAL TEAK", "TEAK", "TIMBER GOLDEN BROWN"], variants: NONE, defaultTab: "base" },
  "PU ENAMEL":                 { bases: ["BRILLIANT WHITE", "90 BASE", "92 BASE", "94 BASE"], shades: ["BLACK", "SMOKE GREY", "DARK BROWN", "GOLDEN BROWN", "PHIROZA"], variants: NONE, defaultTab: "shade" },
  "SATIN STAY BRIGHT":         { bases: ["BRILLIANT WHITE", "90 BASE", "92 BASE", "93 BASE", "94 BASE"], shades: ["WALNUT", "BLACK"], variants: NONE, defaultTab: "base" },
  "SUPERCOVER":                { bases: ["BRILLIANT WHITE", "90 BASE", "92 BASE", "93 BASE", "94 BASE", "96 BASE", "95 BASE", "97 BASE"], shades: NONE, variants: NONE, defaultTab: "base" },
  "VT PEARL GLO":              { bases: ["BRILLIANT WHITE", "90 BASE", "92 BASE", "93 BASE", "94 BASE", "95 BASE", "96 BASE", "97 BASE", "PASTEL BASE"], shades: ["RARE PEARL COPPER", "RARE PEARL GREEN"], variants: NONE, defaultTab: "base" },
  "VT PLATINUM GLO":           { bases: ["BRILLIANT WHITE", "90 BASE", "92 BASE", "93 BASE", "94 BASE", "95 BASE", "96 BASE", "97 BASE"], shades: NONE, variants: NONE, defaultTab: "base" },
  "PROMISE SMARTCHOICE":       { bases: NONE, shades: NONE, variants: ["Interior", "Acrylic Distemper", "Exterior", "Int Primer", "Ext Primer"], defaultTab: "base" },
  "PROMISE PRIMER":            { bases: NONE, shades: NONE, variants: ["Freedom 2in1 Primer", "2in1 Primer", "Promise Primer"], defaultTab: "base" },
  "PROMISE INTERIOR":          { bases: ["BRILLIANT WHITE", "90 BASE", "93 BASE", "92 BASE", "94 BASE", "97 BASE", "96 BASE"], shades: NONE, variants: NONE, defaultTab: "base" },
  "PROMISE EXTERIOR":          { bases: ["BRILLIANT WHITE", "93 BASE", "90 BASE", "92 BASE", "94 BASE", "96 BASE", "98 BASE", "95 BASE"], shades: NONE, variants: NONE, defaultTab: "base" },
  "WS PROTECT DUSTPROOF":      { bases: ["BRILLIANT WHITE", "92 BASE", "93 BASE", "90 BASE", "94 BASE", "97 BASE", "96 BASE", "95 BASE", "98 BASE", "99 BASE"], shades: ["TERACOTTA", "SIGNAL RED", "PO RED", "SUNRISE", "ELECTRIC BLUE PLUS"], variants: NONE, defaultTab: "base" },
  "WS PROTECT HI-SHEEN":       { bases: ["93 BASE", "BRILLIANT WHITE", "92 BASE", "90 BASE"], shades: NONE, variants: NONE, defaultTab: "base" },
  "WS MAX":                    { bases: ["92 BASE", "90 BASE", "93 BASE", "BRILLIANT WHITE", "94 BASE", "97 BASE", "96 BASE", "95 BASE", "98 BASE"], shades: NONE, variants: NONE, defaultTab: "base" },
  "WS POWERFLEXX":             { bases: ["BRILLIANT WHITE", "90 BASE", "92 BASE", "93 BASE", "94 BASE", "95 BASE", "96 BASE", "97 BASE", "98 BASE"], shades: NONE, variants: NONE, defaultTab: "base" },
  "CEMENT PRIMER SB":          { bases: NONE, shades: NONE, variants: NONE, defaultTab: "base" },
  "ZINC YELLOW METAL PRIMER":  { bases: NONE, shades: NONE, variants: NONE, defaultTab: "base" },
  "RED OXIDE METAL PRIMER":    { bases: NONE, shades: NONE, variants: NONE, defaultTab: "base" },
  "EXTERIOR ACRYLIC PRIMER":   { bases: NONE, shades: NONE, variants: NONE, defaultTab: "base" },
  "ACOTONE":                   { bases: NONE, shades: ["NO1", "XY1", "WH1", "YE1", "XR1", "RE1", "OR1", "MA1", "BU1", "GR1", "BU2", "YE2", "NO2", "RE2"], variants: NONE, defaultTab: "shade" },
  "UNIVERSAL STAINER":         { bases: NONE, shades: ["FAST VIOLET", "BLACK", "YELLOW OXIDE", "FAST RED", "BURNT SIENNA", "FAST BLUE", "FAST YELLOW", "FAST ORANGE", "FAST GREEN", "FASTYELLOWGREEN"], variants: NONE, defaultTab: "shade" },
  "MACHINE TINTER":            { bases: NONE, shades: ["WHITE", "YOX", "OXR", "TBL", "LFY", "FFR", "BLACK", "MAG", "GRN"], variants: NONE, defaultTab: "shade" },
  "GVA":                       { bases: ["BRILLIANT WHITE"], shades: ["BLACK", "YELLOW OXIDE", "ORGANIC ORANGE", "ORGANIC LEMON YELLOW", "BLUE", "RED OXIDE", "ORGANIC MIDDLE YELLOW", "ORGANIC VIOLET", "ORGANIC RED VIOLET", "FAST RED", "GREEN"], variants: NONE, defaultTab: "base" },
  "DAMP PROTECT 2IN1":         { bases: NONE, shades: NONE, variants: NONE, defaultTab: "base" },
  "ROOF COAT WHITE":           { bases: NONE, shades: NONE, variants: NONE, defaultTab: "base" },
  "CRACKFILLER 5MM":           { bases: NONE, shades: NONE, variants: NONE, defaultTab: "base" },
  "DAMP PROTECT BASECOAT":     { bases: NONE, shades: NONE, variants: NONE, defaultTab: "base" },
  "2K PU MATT":                { bases: ["90 Base", "93 Base"], shades: ["Int Clear", "Opaque White", "Ext Clear"], variants: NONE, defaultTab: "base" },
  "PU PRIME MATT":             { bases: ["90 Base", "93 Base"], shades: ["Clear", "White"], variants: NONE, defaultTab: "base" },
  "PU PRIME SEALER":           { bases: NONE, shades: ["White", "Clear"], variants: NONE, defaultTab: "shade" },
  "MULTI PURPOSE THINNER":     { bases: NONE, shades: NONE, variants: NONE, defaultTab: "base" },
};

// (The nine hard-coded "+ More" bases went first, then the search round-trip
// that replaced them, then the in-place expansion that replaced THAT. The rail
// replaced the question: a column shows the lot.)

// ── The join ───────────────────────────────────────────────────────────────

/**
 * 🔴 RULE 1 — THE GROUP KEY IS COALESCE(product, subProduct), NEVER `product`.
 *
 * `mo_order_form_index_v2.product` is NULLABLE. Measured against the live
 * payload on 2026-09-06: 133 of 471 rows carry NULL, and **13 of our 32 tiles**
 * resolve only through `subProduct` — GLOSS itself, all four primers, all four
 * Aquatech, all three Sadolin, and Thinner. Joining on `product` alone finds
 * nothing for any of them and those tiles open empty. The payload route does
 * the same COALESCE for its own pack join (route.ts:114).
 */
function joinKey(row: ApiProduct): string {
  return row.product ?? row.subProduct;
}

/**
 * 🔴 RULE 2 — baseColour is matched NULL-SAFELY, AND BLANK COUNTS AS NULL.
 *
 * 36 payload rows carry `baseColour: null` — the nine no-option tiles among
 * them. NULL is a real, selectable identity here ("this product has exactly
 * one row"), not an absence, so it is mapped to an explicit sentinel rather
 * than left to fall through a lookup as `undefined`. A Map keyed on `null`
 * would work in JS; a sentinel makes the intent unmissable and survives the
 * key being serialised.
 *
 * 🔴 AND 37 MORE ROWS CARRY AN EMPTY STRING, WHICH IS THE SAME FACT WRITTEN A
 * SECOND WAY. `mo_order_form_index_v2.baseColour` is nullable, and the depot's
 * data has both spellings of "this product has no options": 36 NULL and 37
 * "". Measured 2026-09-07 — 398 rows carry a real value, 36 NULL, 37 blank.
 *
 * Until this rule existed, "" fell through every null test in the file and
 * became a SELECTABLE OPTION WHOSE VALUE WAS THE EMPTY STRING, and that made
 * all 37 products IMPOSSIBLE TO ORDER. The screen looked perfectly normal:
 * resolveGroup saw a row that was not null, so it built `bases: [{ value: "" }]`
 * and left `noOptionRow` null; the drawer selected that option, rendered a
 * blank 44px rail tile and the right pack rows, and took a quantity into
 * `matrix[""]`. Then the drawer's rowFor() short-circuits on `key === ""` —
 * the key it uses for a product with NO options — and returned the null
 * noOptionRow, so the pick was filtered out and Add never lit. Nineteen of the
 * 37 were ordered by mail in the 90 days to 2026-09-07, 136 lines across 123
 * orders, Acrylic Putty the largest at 44.
 *
 * ⚠ THE FIX BELONGS HERE AND NOWHERE ELSE. Teaching the drawer about "" would
 * have left the empty string a legal option value and simply moved the bug to
 * whatever reads it next — the cart, the email, the parser. A blank baseColour
 * is not a colour; it is the absence of one, and this is the line that says so.
 */
export const NULL_OPTION = " NULL";

/**
 * Does this row actually carry an option, or is it a product with exactly one
 * row? The ONE test. Every place that used to ask `!== null` asks this.
 */
export function hasOption(baseColour: string | null | undefined): boolean {
  return baseColour !== null && baseColour !== undefined && baseColour.trim() !== "";
}

function optionKey(baseColour: string | null): string {
  return hasOption(baseColour) ? (baseColour as string) : NULL_OPTION;
}

/** One curated chip that resolved to a real menu row. */
export type V2Option = { value: string; row: ApiProduct };

export type V2Resolved = {
  sap:      string;
  /** Header name — the curated tile label. Catalog `displayName` is NOT used:
   *  it varies per row ("M900 Gloss - 90 Base"), so it names a variant, not a
   *  product. */
  label:    string;
  /** Sub-line when nothing is selected — the board family ("Enamel"). */
  family:   string;
  bases:    V2Option[];
  shades:   V2Option[];
  variants: V2Option[];
  /** The single NULL-baseColour row, for tiles with no options at all. */
  noOptionRow: ApiProduct | null;
  /** Which tab to open on — from CURATION, generated off the 90-day ranking. */
  defaultTab: "base" | "shade";
  /**
   * True for the 32 board tiles, whose lists are RANKED and split base/shade.
   * False for a searched non-tile, whose single list is raw catalog order and
   * is neither — the drawer reads this to know whether to offer a group toggle.
   */
  curated: boolean;
};

/** What the Task-5 gate found. Reported, never papered over. */
export type V2GateReport = {
  missingOptions: { tile: string; option: string }[];
  zeroRowTiles:   string[];
  emptyPackChips: { tile: string; option: string; rowId: number }[];
  droppedDupes:   { tile: string; baseColour: string; keptId: number; droppedId: number; droppedFamily: string }[];
};

export function buildCatalog(products: ApiProduct[]): {
  byTile: Map<string, V2Resolved>;
  report: V2GateReport;
} {
  const report: V2GateReport = {
    missingOptions: [], zeroRowTiles: [], emptyPackChips: [], droppedDupes: [],
  };

  // Group every payload row under COALESCE(product, subProduct).
  const groups = new Map<string, ApiProduct[]>();
  for (const row of products) {
    const key = joinKey(row);
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }

  const byTile = new Map<string, V2Resolved>();

  for (const family of FAMILIES) {
    for (const tile of family.tiles) {
      const curation = CURATION[tile.sap];
      if (!curation) continue;
      const rows = groups.get(tile.sap) ?? [];

      if (rows.length === 0) {
        report.zeroRowTiles.push(tile.label);
        byTile.set(tile.sap, {
          sap: tile.sap, label: tile.label, family: family.name,
          bases: [], shades: [], variants: [], noOptionRow: null, defaultTab: "base", curated: true,
        });
        continue;
      }

      // 🔴 RULE 3 — DEDUPE. The menu's unique key is
      // (family, subProduct, baseColour), so one product reached from two
      // families can yield the same baseColour twice, and mo_sku_lookup_v2
      // still carries shadow rows from the June dual-homing. Lowest sortOrder
      // wins; the loser is REPORTED, never silently rendered as a second chip
      // with the same label.
      const byOption = new Map<string, ApiProduct>();
      for (const row of [...rows].sort((a, b) => a.sortOrder - b.sortOrder)) {
        const key = optionKey(row.baseColour);
        const kept = byOption.get(key);
        if (kept) {
          report.droppedDupes.push({
            tile: tile.label,
            baseColour: key === NULL_OPTION ? "(null)" : key,
            keptId: kept.id, droppedId: row.id, droppedFamily: row.family,
          });
          continue;
        }
        byOption.set(key, row);
      }

      // Resolve each curated option. A miss DROPS the chip and is reported —
      // never falls back to some other row, which would quietly sell the
      // salesman a product he did not choose.
      const resolve = (values: readonly string[]): V2Option[] => {
        const out: V2Option[] = [];
        for (const value of values) {
          const row = byOption.get(value);
          if (!row) {
            report.missingOptions.push({ tile: tile.label, option: value });
            continue;
          }
          if (row.packs.length === 0) {
            report.emptyPackChips.push({ tile: tile.label, option: value, rowId: row.id });
          }
          out.push({ value, row });
        }
        return out;
      };

      const hasOptions =
        curation.bases.length + curation.shades.length + curation.variants.length > 0;
      const noOptionRow = hasOptions ? null : (byOption.get(NULL_OPTION) ?? null);

      if (!hasOptions) {
        if (!noOptionRow) {
          report.missingOptions.push({ tile: tile.label, option: "(expected one NULL-baseColour row)" });
        } else if (noOptionRow.packs.length === 0) {
          report.emptyPackChips.push({ tile: tile.label, option: "(no-options row)", rowId: noOptionRow.id });
        }
      }

      byTile.set(tile.sap, {
        sap: tile.sap, label: tile.label, family: family.name,
        bases:    resolve(curation.bases),
        shades:   resolve(curation.shades),
        variants: resolve(curation.variants),
        noOptionRow,
        // The family override wins over the per-product ranking. See openTab.
        defaultTab: family.openTab ?? curation.defaultTab ?? "base",
        curated: true,
      });
    }
  }

  return { byTile, report };
}

// ── Shade colours ──────────────────────────────────────────────────────────

/**
 * Shade name -> swatch hex. Hand-authored, keyed by the EXACT `baseColour`
 * string, uppercased.
 *
 * ── WHERE THE VALUES COME FROM ───────────────────────────────────────────
 *
 * 🔴 dulux.in's OWN PER-SHADE PAGES — the colour is read off the shade page's
 * markup, e.g. /en/colour-palettes/gloss-oxford-blue-1975129. That source
 * replaced eleven earlier values on 2026-09-07 and supplied six new ones.
 *
 * NOT the shade-card PDF: its yellow plate is missing, so every value taken
 * from it ran cold. If a value here is ever questioned, the per-shade page is
 * the thing to check it against, and nothing else is.
 *
 * A shade Dulux does not publish a page for is NOT in this table. See the
 * still-unmapped list at the foot of it.
 *
 * 🔴 A NAME THAT IS NOT HERE GETS NO COLOUR. Not a guess, not a nearest match,
 * not a hash of the string — a text chip. A wrong colour on a paint order is
 * worse than no colour: the salesman reads the swatch, not the code, and a
 * plausible-but-wrong brown ships the wrong tin. Adding a shade means adding
 * a real value here, deliberately.
 */
const SHADE_HEX: Record<string, string> = {
  "BLACK":                 "#1D1E1F",
  "DARK BROWN":            "#4B2D25",
  "GOLDEN BROWN":          "#834A1E",
  "SMOKE GREY":            "#5E7D8C",
  "DA GREY":               "#6E7175",
  "GOLDEN YELLOW":         "#F3A000",
  "CLASSIC WHITE":         "#F4F1E6",
  "BRILLIANT WHITE":       "#FAF8F2",
  "PHIROZA BLUE":          "#1B8A9E",
  "PO RED":                "#8D2023",
  "BROWN":                 "#59352F",
  "RICH BROWN":            "#48332F",
  "TERACOTTA":             "#A5502F",
  "SIGNAL RED":            "#B3312C",
  "BUS GREEN":             "#005C3A",
  "WALNUT":                "#5C4033",
  "WHITE":                 "#FFFFFF",
  "OPAQUE WHITE":          "#FAFAF7",
  "RED OXIDE":             "#8C3A26",
  "YELLOW OXIDE":          "#C8981F",
  "BURNT SIENNA":          "#8A4B2A",
  "FAST VIOLET":           "#6B3FA0",
  "FAST RED":              "#CC2222",
  "FAST BLUE":             "#1F4FA8",
  "FAST GREEN":            "#1F7A4A",
  "FAST ORANGE":           "#E2701E",
  "FAST YELLOW":           "#EFC223",
  "FASTYELLOWGREEN":       "#9BB82E",
  "ORGANIC ORANGE":        "#E86A16",
  "ORGANIC VIOLET":        "#6B3FA0",
  "ORGANIC LEMON YELLOW":  "#EFD73B",
  "ORGANIC MIDDLE YELLOW": "#F0B71C",
  "BLUE":                  "#1F4FA8",

  // Added 2026-09-07, each one approved by name before it was written.
  //
  // 🔴 PHIROZA AND PHIROZA BLUE ARE DELIBERATELY DIFFERENT — DO NOT "FIX" IT.
  // They were identical on purpose for one day, because two hexes a shade
  // apart on the same colour read as a bug. The reason that no longer applies:
  // PHIROZA now carries Dulux's OWN published value (#0081B0, off its shade
  // page) and PHIROZA BLUE has no published page, so it keeps the earlier
  // hand-authored value. An authoritative value and a hand-authored one are
  // not the same kind of thing and should not be forced to agree.
  //
  // They also never meet: PHIROZA is on Gloss and PU Enamel, PHIROZA BLUE on
  // Promise Enamel, so no rail column ever shows both. If Dulux publishes a
  // Phiroza Blue page, take that value — do not copy PHIROZA's across.
  "PHIROZA":               "#0081B0",
  "DEEP ORANGE":           "#D2540B",
  "MAHOGANY":              "#6E2C1F",
  "TEAK":                  "#63483D",
  "ELECTRIC BLUE PLUS":    "#1560BD",
  "ORGANIC RED VIOLET":    "#9B3B7A",

  // ── SPECIAL TEAK AND TIMBER GOLDEN BROWN STOOD HERE, AND CAME BACK OUT ──
  //
  // Both were hand-authored guesses (#A56B2E and #BC8A3C), added on 2026-09-07
  // and REMOVED the same day. They were refused once on the grounds that as
  // bare squares they sit next to TEAK and GOLDEN BROWN as near-identical
  // browns; that refusal was overturned when a swatch + NAME chip made the
  // word decide, and it came back the moment the rail took the names off the
  // swatches and dulux.in's published browns landed. Measured on the rail:
  //
  //   before the dulux.in values   closest pair 7.9  (SPECIAL TEAK / TEAK)
  //   after them                   closest pair 5.9  (BROWN / RICH BROWN)
  //
  // 🔴 SO SUPER SATIN'S IS THE TIGHTEST CLUSTER IN THE APP, and a GUESSED
  // colour in the one place colours are hardest to tell apart is the worst
  // combination available. They are text tiles again, and the word is the only
  // thing that was ever deciding between them anyway. Do not re-add them
  // without a published Dulux value; a plausible brown is not a value.
  //
  // ⚠ THE CLUSTER IS STILL TIGHT WITHOUT THEM. BROWN #59352F, RICH BROWN
  // #48332F and TEAK #63483D are all published values and all within ΔE 8.2 of
  // each other. That is a known cost of using what Dulux prints rather than
  // colours chosen to separate, and the mitigation is the name bar and the
  // rail search — never a nudged hex, because a hex nudged to look different
  // is a wrong colour.

  // Added 2026-09-07 from the SAME dulux.in source as the replacements above.
  // MIDDLE BUFF and SAND STONE are keyed on the payload's spelling, not the
  // shade page's — Dulux writes "Midbuff" and "Sandstone", the menu row says
  // "MIDDLE BUFF" and "SAND STONE", and the KEY has to be the menu row or the
  // lookup silently misses. ROSEWOOD is the only one of the six that is not on
  // a board tile: it belongs to Wood Stain, which is reached through search.
  "OXFORD BLUE":           "#1C2A40",
  "CHERRY":                "#5C2428",
  "LEAF BROWN":            "#794830",
  "MIDDLE BUFF":           "#C48A42",
  "SAND STONE":            "#9A7C62",
  "ROSEWOOD":              "#824640",

  // 🔴 CLEAR / INT CLEAR / EXT CLEAR ARE PERMANENTLY ABSENT - DO NOT "FIX" THIS.
  // They are TRANSPARENT products. There is no colour to show, so a swatch
  // would be a lie; 2K Matt, Prime Matt and Prime Sealer stay text tiles.
  //
  // ── STILL UNMAPPED, ON PURPOSE — 2026-09-07 ─────────────────────────────
  //
  // Dulux publishes no per-shade page for these, so there is no authoritative
  // value and none is invented. They render as TEXT TILES in the rail, which
  // is the correct outcome: a wrong swatch ships a wrong order, a word does
  // not. Do not fill these from a screenshot, a PDF plate or a nearest match.
  //
  //   SKY BLUE · MINT GREEN · DEEP GREEN · AQUAMARINE · OFF WHITE
  //   PALE CREAM · ROYAL IVORY · CASCADE GREEN · OPALINE GREEN
  //   LIGHT GREY · DAWN · TRUCK BROWN · WILD PURPLE · SUNRISE
  //   RARE PEARL COPPER · RARE PEARL GREEN
  //   SPECIAL TEAK · TIMBER GOLDEN BROWN   (were mapped; withdrawn — see above)
  //
  // ⚠ THREE HAND-AUTHORED VALUES ARE KEPT ON PURPOSE, and they are the only
  // ones left in the table that Dulux does not publish a page for:
  //
  //   MAHOGANY #6E2C1F · TERACOTTA #A5502F · ELECTRIC BLUE PLUS #1560BD
  //
  // They stay because the risk that retires a guessed colour is CONFUSION WITH
  // A NEIGHBOUR, not the guess itself — and the neighbour that matters is the
  // NAME, not the hex.
  //
  // ⚠ MEASURED, BECAUSE "no near neighbours" IS NOT WHAT THE NUMBERS SAY. Two
  // of the three have a close colour beside them:
  //
  //   MAHOGANY   @ Gloss        7.5 from PO RED, 8.4 from CHERRY
  //              @ Super Satin  8.2 from BROWN, 11.9 from TEAK
  //   TERACOTTA  @ Dustproof    9.6 from SIGNAL RED, 14.5 from PO RED
  //   ELEC BLUE  @ Dustproof   41.6 from PO RED — genuinely alone
  //
  // They are kept anyway, and the reason is the NAMES. Nobody reaching for
  // Mahogany taps Cherry or PO Red by mistake: the words are nothing alike, so
  // the rail search finds it and the name bar confirms it. SPECIAL TEAK beside
  // TEAK, and TIMBER GOLDEN BROWN beside GOLDEN BROWN, are near-duplicate
  // WORDS on near-duplicate browns — the word could not break the tie because
  // the word was half the problem. That is the test, and it is a test about
  // names as much as colours: not "is the hex plausible" but "if he picks the
  // wrong one, is there anything on screen that would have told him".
  //
  // Also unmapped and never to be mapped: every Acotone (NO1, XY1...) and
  // Machine Tinter (YOX, TBL...) colorant CODE.
};

/** The swatch for a shade name, or undefined when it has none. Case-insensitive
 *  because Sadolin stores title case ("Opaque White") and everyone else caps. */
export function shadeHex(value: string): string | undefined {
  return SHADE_HEX[value.trim().toUpperCase()];
}

/**
 * WCAG relative luminance. Above 0.85 the swatch is near-white and needs an
 * inner border, or a white chip on a white sheet simply is not there.
 */
export function isLightHex(hex: string): boolean {
  const n = parseInt(hex.replace("#", ""), 16);
  const chan = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const r = chan((n >> 16) & 255), g = chan((n >> 8) & 255), b = chan(n & 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.85;
}

// ── THE ΔE CLOSE-PAIR RULE — RETIRED 2026-09-07, RECORDED HERE ─────────────
//
// deltaE2000(), labOf(), shadeRowMode(), CLOSE_DE, TWINS_DE and the V2ChipStyle
// type stood here until the drawer's chip row became a RAIL. They are removed
// because the rail leaves nothing to call them: the question they answered —
// "does this whole row render as colour, or as swatch+name, or as text?" — is
// no longer asked. A rail tile decides for ITSELF, from one fact: a name in
// SHADE_HEX gets a swatch, a name that is not there gets a text tile. Mixed
// columns are now the intended outcome, not the thing the rule existed to
// prevent. Grepped before deleting: product-drawer.tsx was the only caller of
// any of them, and it no longer has a chip row.
//
// WHAT THE RULE WAS, so it is not re-derived from scratch if a row-level
// decision is ever wanted again — it is in git at 2679c189:
//
//   Perceptual distance, CIE Lab / D65, ΔE2000 — because plain RGB distance is
//   useless here: #6B4423 and #4A2C1A are far apart in RGB and all but
//   identical as two squares on a phone. A row went to swatch+name when it had
//   TWO OR MORE pairs within ΔE 12, or ANY single pair within ΔE 6; otherwise
//   bare squares. Measured on the live curation:
//
//     Super Satin     6 close pairs of 21, closest  7.9  -> swatch + name
//     Gloss           1 close pair  of 36, closest 10.4  -> bare squares
//     Uni Stainer     1 close pair  of 45, closest 11.9  -> bare squares
//     Promise Enamel  0 close pairs of 36, closest 17.3  -> bare squares
//     PU Enamel       0 close pairs of 10, closest 17.3  -> bare squares
//     Stay Bright     0 close pairs of 1,  closest 19.8  -> bare squares
//
//   COUNTING pairs rather than taking the minimum was the whole point: one
//   ambiguous pair among nine well-separated colours is survivable, five browns
//   are not, and no single-minimum threshold separates those two cases without
//   landing in the 2.5-point gap between 7.9 and 10.4.
//
// 🔴 WHAT THE RULE PROVED IS STILL TRUE, and the rail answers it a different
// way: Super Satin's browns cannot be told apart as bare squares. They are
// still bare squares — but the NAME BAR above the packs spells the selection
// out at 15px the moment a tile is tapped, which is a bigger, later and more
// legible check than a caption on a chip ever was. The hexes themselves, each
// approved by name, are untouched above.

// ── Drawer shape ───────────────────────────────────────────────────────────

export type V2DrawerMode = "single" | "flat" | "standard";

/** Every distinct RENDERED pack label a product sells, across all its options. */
export function packsOf(rows: ApiProduct[]): string[] {
  const seen = new Set<string>();
  for (const r of rows) for (const p of r.packs) seen.add(formatPack(p.packCode, p.unit));
  // Array.from, not spread — the tsconfig target is below ES2015 and a Set
  // spread does not downlevel (CLAUDE.md §1).
  return Array.from(seen);
}

/**
 * 🔴 THE ONE PLACE THE DRAWER'S SHAPE IS DECIDED. Option count first, then
 * pack count. Nothing else in v2 may re-derive this.
 *
 *   1 option           -> single  : no chips, straight to packs, ANY pack count
 *   2+ options, 1 pack  -> flat    : every option listed, a stepper on each
 *   2+ options, 2+ packs-> standard: pick an option, then its packs
 *
 * GRID (options down, packs across) WAS a fourth outcome and is deleted: the
 * bare "+" cell read as inert and the minus was invisible until you had
 * already tapped. Uni Stainer, 2K Matt, Prime Matt and Prime Sealer return to
 * standard, the pattern that already works.
 *
 * ⚠ `single` IS NOT A NEW CODE PATH. The nine one-option products already open
 * straight to their packs: their curated lists are all empty, so the drawer's
 * control block never renders (its gate is `hasVariants || activeList.length`)
 * and `selectedRow` falls through to `noOptionRow`. This mode NAMES that
 * existing behaviour so the census can report it; it does not re-implement it.
 * Measured live 2026-09-07: 9 single, 4 flat, 19 standard.
 */
export function drawerMode(rows: ApiProduct[]): V2DrawerMode {
  if (rows.length <= 1) return "single";
  const packs = packsOf(rows).length;
  if (packs <= 1) return "flat";
  return "standard";
}

/**
 * Is this option a BASE — something a machine tints into — or a finished
 * shade a dealer buys off the shelf?
 *
 * 🔴 A NAME RULE, DELIBERATELY, AND IT REPLACES A productType RULE THAT WAS
 * WRONG. The payload types some ready-made colours as BASE_VARIANT: on Gloss
 * that put BLAZING WHITE, CLASSIC WHITE and OFF WHITE on the Base tab, where a
 * dealer would never look for them. They are finished paint, not tinting bases.
 *
 * The rule is exactly two clauses, and it is case-insensitive because Sadolin
 * stores "90 Base" in title case while everyone else stores "90 BASE":
 *   - the name contains "BASE"  (90 BASE, 94 BASE, GREEN BASE, PASTEL BASE)
 *   - or the name IS Brilliant White (or its "BW" short form)
 * Everything else is a shade, whatever productType says.
 *
 * DISPLAY ONLY. `productType` is not rewritten and the payload is not touched;
 * this decides which tab an option appears under and nothing else.
 */
export function isBaseOption(value: string): boolean {
  const v = value.trim().toUpperCase();
  return v.includes("BASE") || v === "BRILLIANT WHITE" || v === "BW";
}

/**
 * 🔴 THE BASE COLUMN SORTS IN SEQUENCE, NOT BY SALES.
 *
 *   BW first, then numeric ascending (90, 92, 93, 94, 95, 96, 97, 98, 99),
 *   then named bases (GREEN BASE, PASTEL BASE) alphabetically.
 *
 * A NUMBERED SERIES ALREADY HAS AN ORDER THE SALESMAN KNOWS, and sorting it by
 * sales destroys the one thing that made it findable — he ends up hunting for
 * 93 somewhere between BW and 90. Frequency ordering is right for SHADES, where
 * there is no natural sequence and the top of the column is the curation, and
 * wrong for BASES, where the sequence is the curation. Shades and variants are
 * untouched by this.
 *
 * Sadolin's title-case "90 Base" sorts by its number like everyone else's
 * "90 BASE": the match is case-insensitive.
 *
 * ⚠ THIS SORTS THE COLUMN, IT DOES NOT CHOOSE THE DEFAULT. The drawer still
 * pre-selects the most-ORDERED base, which after this sort is usually not the
 * first tile. Those are two different jobs: the sequence is for finding, the
 * default is for selling, and making the default follow the sort would quietly
 * change what Protect Hi-Sheen and Max send when nobody touches the rail.
 */
export function sortBases(options: V2Option[]): V2Option[] {
  const rank = (value: string): [number, number, string] => {
    const v = value.trim().toUpperCase();
    if (v === "BRILLIANT WHITE" || v === "BW") return [0, 0, ""];
    const m = v.match(/^(\d+)\s+BASE$/);
    if (m) return [1, Number(m[1]), ""];
    return [2, 0, v];
  };
  return [...options].sort((a, b) => {
    const ra = rank(a.value), rb = rank(b.value);
    if (ra[0] !== rb[0]) return ra[0] - rb[0];
    if (ra[1] !== rb[1]) return ra[1] - rb[1];
    return ra[2].localeCompare(rb[2]);
  });
}

/**
 * The base and shade pools the RAIL's two groups are built from, split by
 * isBaseOption().
 *
 * Both pools are drawn from EVERY option the product has, so nothing in the
 * catalog is unreachable: whatever is not a base is a shade, and the two are
 * exhaustive and disjoint. The drawer lists the ranked curation first and
 * appends whatever these hold that the ranking does not name.
 */
export function optionPools(
  rows: ApiProduct[],
): { all: V2Option[]; bases: V2Option[]; shades: V2Option[] } {
  const all = allOptionsFor(rows);
  const bases: V2Option[]  = [];
  const shades: V2Option[] = [];
  for (const opt of all) (isBaseOption(opt.value) ? bases : shades).push(opt);
  return { all, bases, shades };
}

// 🔴 chipLimit() IS GONE, AND SO IS THE IDEA BEHIND IT. It decided how many
// chips a row showed before "+ More" — the top 4 bases, the top 9 shades — and
// it was the last survivor of a cut that had already been rebuilt three times.
// A cut only exists because a horizontal row is finite. The rail is a vertical
// column that scrolls, so it holds EVERY option in rank order and hides none:
// the top of the column is the curation, and there is nothing behind anything.
// Deleted 2026-09-07 with "+ More" itself; in git at 2679c189 if the reasoning
// is ever wanted.

/**
 * Turn a whole searched PRODUCT into something the drawer can open on.
 *
 * A tile hands back its curated resolution untouched — searching "gloss" and
 * tapping its tile must land on the same six shades and four bases, or the
 * board and the search would teach two different products.
 *
 * A non-tile (most of the 143 catalog products) gets its options straight from
 * the payload, ordered by sortOrder — the depot's own order — IN FULL. Nothing
 * cuts it, here or later: the drawer puts the whole list in one rail column
 * with no group toggle, because an uncurated list has no base/shade split to
 * offer.
 */
export function resolveGroup(
  key: string,
  rows: ApiProduct[],
  label: string,
  byTile: Map<string, V2Resolved>,
): V2Resolved {
  const tile = byTile.get(key);
  if (tile) return tile;

  const ordered = [...rows].sort((a, b) => a.sortOrder - b.sortOrder);
  // hasOption(), not `!== null` — a blank baseColour is a product with no
  // options, exactly like a NULL one. See RULE 2; this test is where the
  // empty string used to slip through and become an unorderable option.
  const single = ordered.length === 1 && !hasOption(ordered[0].baseColour);

  return {
    sap: key,
    label,
    family: ordered[0]?.family ?? "",
    bases: single ? [] : ordered
      .filter((r) => hasOption(r.baseColour))
      .map((r) => ({ value: r.baseColour as string, row: r })),
    shades: [],
    variants: [],
    noOptionRow: single ? ordered[0] : null,
    defaultTab: "base",
    curated: false,
  };
}

/**
 * EVERY option a product has, in catalog order.
 *
 * Passed to the drawer alongside the ranked curation; the rail shows the
 * ranking first and then whatever this holds that the ranking does not name,
 * so one column is the complete list.
 */
export function allOptionsFor(rows: ApiProduct[]): V2Option[] {
  return [...rows]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    // 🔴 THE THIRD PLACE "" COULD BECOME AN OPTION, and the one that would
    // have survived fixing the other two: optionPools() is built from this,
    // the drawer's rail is built from optionPools(), so a blank row left here
    // would still have drawn a nameless 44px tile the salesman could tap.
    .filter((r) => hasOption(r.baseColour))
    .map((r) => ({ value: r.baseColour as string, row: r }));
}

// ── Cart ───────────────────────────────────────────────────────────────────

export type V2CartLine = {
  id:      string;
  /** Which board tile produced this line — drives the tile badge + fill. */
  tileSap: string;
  label:   string;
  /** The chosen baseColour, or null for a no-options product. */
  option:  string | null;
  /** The resolved menu row's id — the catalog anchor. */
  rowId:   number;
  /**
   * 🔴 THE THREE FIELDS emailLineLabel() READS, snapshotted from the menu row.
   *
   * The wire name is NOT our tile label. `label` above is the curated board
   * word ("Smart Choice", "M900") and must never reach an email — /po sends
   * emailLineLabel(product, baseColour, subProduct) for that same row, and v2
   * has to send the identical string or the parser sees a different product.
   */
  product:    string | null;
  baseColour: string | null;
  subProduct: string;
  /** Rendered pack label -> quantity in UNITS. Only non-zero entries kept. */
  qtys:    Record<string, number>;
  /**
   * The row's pack labels in CATALOG order, snapshotted at add time.
   *
   * `qtys` is a Record, so its key order is the order the salesman TAPPED —
   * fine for a total, wrong for a printed pack string. The payload sorts packs
   * ascending by millilitres with KG last (route.ts:21-28), and step 9's email
   * has to match /po byte for byte, so the order has to come from the catalog
   * rather than from the order of his thumbs.
   */
  packOrder: string[];
};

/**
 * The ordered packs of one line, smallest first, zero quantities dropped.
 *
 * `packOrder` is already ascending by size with KG last — the payload sorts it
 * that way (route.ts:21-28) — so this is a filter, not a re-sort.
 *
 * Returned as ROWS rather than a joined string: a review line is what somebody
 * checks a physical load against, and "100ML ×24, 200ML ×12, 500ML ×12, 1L ×6"
 * wrapping across two lines is not checkable. One pack per row, right-aligned
 * and tabular, is.
 */
export function packRows(line: V2CartLine): { label: string; qty: number }[] {
  return line.packOrder
    .filter((label) => (line.qtys[label] ?? 0) > 0)
    .map((label) => ({ label, qty: line.qtys[label] }));
}

/**
 * DISPLAY-ONLY chip text for a BASE.
 *
 * 🔴 THE WIRE VALUE IS UNTOUCHED. This is called in JSX and nowhere else: the
 * selection state, the cart line and the email all carry the raw `baseColour`
 * ("90 BASE", "BRILLIANT WHITE") straight off the menu row. Changing what the
 * chip says must never change what the depot is asked for.
 *
 * Scoped to bases on purpose — "BRILLIANT WHITE" is also a SHADE on GVA and
 * Promise Enamel, and shortening it to "BW" there would rename a colour.
 */
export function baseChipLabel(value: string): string {
  const v = value.trim();
  if (/^brilliant\s+white$/i.test(v)) return "BW";
  const m = v.match(/^(.+?)\s+base$/i);   // "90 BASE" and Sadolin's "90 Base"
  return m ? m[1] : v;
}

// ── Order-level fields ─────────────────────────────────────────────────────
// 🔴 THESE MIRROR lib/place-order/email.ts's TYPES EXACTLY (EmailDispatch,
// EmailCallTarget, EmailMarker — read 2026-09-06). Mirrored, not imported:
// step 9 does the importing. If they drift, the email silently stops matching
// what /po sends and the parser's app-format path stops recognising it.
//
// Dispatch is TWO fields, not one. "Call" is not a complete state — email.ts
// emits "Call to " + (callTarget ?? "SO"), so a Call with no target silently
// becomes a Call to SO. The UI surfaces both rather than hiding that default.

export type V2Dispatch   = "Normal" | "Urgent" | "Call";
export type V2CallTarget = "SO" | "Dealer";
export type V2Marker     = "Truck" | "Cross Delivery" | "Bounce" | "DTS" | null;

export type V2Order = {
  dispatch:   V2Dispatch;
  callTarget: V2CallTarget;
  marker:     V2Marker;
  crossDepot: string;
  notes:      string;
};

/** Defaults = the state email.ts OMITS from the body: no Dispatch, no Remark. */
export const EMPTY_ORDER: V2Order = {
  dispatch: "Normal", callTarget: "SO", marker: null, crossDepot: "", notes: "",
};

/** Shared chip shell. Selected is an OUTLINE + tint, never a solid violet fill. */
export function chipStyle(selected: boolean, dashed = false): React.CSSProperties {
  return {
    border:       `1.5px ${dashed ? "dashed" : "solid"} ${selected ? VIOLET : RULE}`,
    borderRadius: 11,
    background:   selected ? VIOLET_BG : "#fff",
    color:        INK,
  };
}

/**
 * Total UNITS in one set of quantities — a plain sum, nothing else.
 *
 * 🔴 THERE IS DELIBERATELY NO BOX COUNT ANYWHERE IN v2. An earlier cut divided
 * qty by the carton size and reported boxes to one decimal; "2.5 boxes" is not
 * a thing anyone can pick, load or check on a depot floor. Units are always
 * whole, so every number this app shows is a number a person can act on.
 */
/**
 * A TYPED unit figure, snapped to the nearest whole box.
 *
 * The stepper moves by a box and always has; typing is the same rule reached a
 * different way, so 5 typed on a six-per-box pack is 6 and the field says 6
 * before the salesman looks away. Silently keeping 5 would put a number on the
 * order that the depot cannot pick.
 *
 * 🔴 A POSITIVE ASK NEVER SNAPS TO NOTHING. Nearest-multiple alone sends 1 to 0
 * on a six-per, which reads as the app ignoring him rather than correcting him,
 * and he has no way to tell the two apart. One box is the floor.
 */
export function snapToBox(units: number, step: number): number {
  if (!Number.isFinite(units) || units <= 0) return 0;
  if (step <= 1) return Math.round(units);
  return Math.max(step, Math.round(units / step) * step);
}

export function unitsIn(qtys: Record<string, number>): number {
  let units = 0;
  for (const qty of Object.values(qtys)) {
    if (qty > 0) units += qty;
  }
  return units;
}

// ── Customer search ────────────────────────────────────────────────────────
// No shared helper exists for this anywhere in the app: /po filters inline at
// po-page.tsx:1139-1145 and the desktop page has its own copy at
// customer-search.tsx:57-62. Neither is exported, so this is written here
// rather than imported — and it is deliberately stricter than either.

const SEARCH_CAP = 30;

/**
 * THREE TIERS, in this order: code-PREFIX, then NAME-contains, then
 * code-SUBSTRING. Case-insensitive, each tier alphabetical by name, the whole
 * list capped at 30.
 *
 * The third tier is what restores parity with /po's `code.includes(q)`
 * (po-page.tsx:1143) — a dealer whose code merely CONTAINS the digits is still
 * findable. Keeping it in its own tier below the other two is the point: as a
 * flat rule it floods the top, because typing "24" matches every 6-digit code
 * with a 24 anywhere in it. Tiered, the dealer whose code STARTS with what was
 * typed still wins, and the loose matches wait underneath.
 */
export function searchCustomers(customers: ApiCustomer[], rawQuery: string): ApiCustomer[] {
  const q = rawQuery.trim().toLowerCase();
  if (q.length < 1) return [];

  const codePrefix: ApiCustomer[] = [];
  const nameHits:   ApiCustomer[] = [];
  const codeSub:    ApiCustomer[] = [];
  for (const c of customers) {
    const code = c.code.toLowerCase();
    if (code.startsWith(q))                    codePrefix.push(c);
    else if (c.name.toLowerCase().includes(q)) nameHits.push(c);
    else if (code.includes(q))                 codeSub.push(c);
  }
  const byName = (a: ApiCustomer, b: ApiCustomer): number => a.name.localeCompare(b.name);
  codePrefix.sort(byName);
  nameHits.sort(byName);
  codeSub.sort(byName);
  return [...codePrefix, ...nameHits, ...codeSub].slice(0, SEARCH_CAP);
}

