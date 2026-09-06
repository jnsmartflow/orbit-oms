// Hidden v2 salesman order page — DATA, CURATION, AND THE CATALOG JOIN.
//
// 🔴 CONTAINMENT — everything v2 needs lives inside app/po-v2-8f4kd2/.
// Colours are exported constants used as INLINE STYLES, never CSS variables in
// globals.css and never entries in tailwind.config.ts. Nothing here imports
// from lib/ or app/po/ — where shared logic is needed it is COPIED in with its
// source named, so deleting this one folder removes v2 whole.

// ── Design tokens ──────────────────────────────────────────────────────────
export const RULE      = "#E9E7ED";             // hairline borders + rules
export const INK       = "#16151A";             // near-black text
export const VIOLET    = "#6D28D9";             // violet-700, the v2 accent
export const VIOLET_BG = "#F5F1FE";             // selected-chip / active-tile fill
export const SEARCH_BG = "#F4F3F7";
export const SCRIM     = "rgba(18,14,26,.42)";

export const STAR      = "#F0A020";             // the recents star
export const DIVIDER   = "#F3F2F6";             // list-row dividers
export const MONO_BG   = "#F2F1F5";             // monogram square fill
export const CHEVRON   = "#C7C3CE";

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

export type V2Tile   = { label: string; sap: string };
export type V2Family = { name: string; tint: string; tiles: readonly V2Tile[] };

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
// 🔴 THIS IS NOT THE CATALOGUE. These are the options actually ordered over
// 90 days — the short list a salesman reaches for. Everything else in the
// catalogue is behind "+ More". Values are EXACT `baseColour` strings and are
// matched literally, including case: Sadolin stores "90 Base" while every
// other family stores "90 BASE", and that difference is real, not a typo.
//
// `variants` is not a different KIND of thing — Smart Choice and Promise
// Primer store their variants in `baseColour` too. It is a separate field only
// so the drawer can render them as one un-pre-selected row with no tabs.

export type V2Curation = {
  bases:    readonly string[];
  shades:   readonly string[];
  variants: readonly string[];
};

const NONE: readonly string[] = [];

export const CURATION: Record<string, V2Curation> = {
  "GLOSS":                    { bases: ["BRILLIANT WHITE", "90 BASE", "92 BASE", "93 BASE"], shades: ["BLACK", "DARK BROWN", "GOLDEN BROWN", "SMOKE GREY", "DA GREY", "GOLDEN YELLOW"], variants: NONE },
  "PROMISE ENAMEL":           { bases: NONE, shades: ["CLASSIC WHITE", "BRILLIANT WHITE", "BLACK", "SMOKE GREY", "PHIROZA BLUE", "PO RED"], variants: NONE },
  "SUPER SATIN":              { bases: ["BRILLIANT WHITE", "90 BASE", "93 BASE", "92 BASE", "94 BASE"], shades: ["BLACK", "BROWN", "RICH BROWN"], variants: NONE },
  "M900 GLOSS":               { bases: ["BRILLIANT WHITE", "90 BASE", "92 BASE", "94 BASE"], shades: ["BLACK", "GOLDEN YELLOW", "GOLDEN BROWN", "DARK BROWN"], variants: NONE },
  "SATIN STAY BRIGHT":        { bases: ["BRILLIANT WHITE", "90 BASE", "92 BASE", "93 BASE", "94 BASE"], shades: NONE, variants: NONE },
  "SUPERCOVER":               { bases: ["BRILLIANT WHITE", "90 BASE", "92 BASE", "93 BASE", "94 BASE"], shades: NONE, variants: NONE },
  "VT PEARL GLO":             { bases: ["BRILLIANT WHITE", "90 BASE", "92 BASE", "93 BASE", "94 BASE"], shades: NONE, variants: NONE },
  "VT PLATINUM GLO":          { bases: ["BRILLIANT WHITE", "90 BASE", "92 BASE", "93 BASE"], shades: NONE, variants: NONE },
  "PROMISE INTERIOR":         { bases: ["BRILLIANT WHITE", "90 BASE", "92 BASE", "93 BASE"], shades: NONE, variants: NONE },
  "PROMISE EXTERIOR":         { bases: ["93 BASE", "BRILLIANT WHITE", "92 BASE", "90 BASE", "94 BASE"], shades: NONE, variants: NONE },
  "WS PROTECT DUSTPROOF":     { bases: ["BRILLIANT WHITE", "92 BASE", "93 BASE", "90 BASE", "94 BASE"], shades: ["TERACOTTA", "SIGNAL RED"], variants: NONE },
  "WS PROTECT HI-SHEEN":      { bases: ["93 BASE", "BRILLIANT WHITE", "90 BASE", "92 BASE"], shades: NONE, variants: NONE },
  "WS MAX":                   { bases: ["90 BASE", "92 BASE", "BRILLIANT WHITE", "93 BASE", "94 BASE"], shades: NONE, variants: NONE },
  "WS POWERFLEXX":            { bases: ["BRILLIANT WHITE", "90 BASE", "92 BASE", "93 BASE", "94 BASE"], shades: NONE, variants: NONE },
  "ACOTONE":                  { bases: NONE, shades: ["NO1", "XY1", "YE1", "WH1", "XR1", "RE1"], variants: NONE },
  "UNIVERSAL STAINER":        { bases: NONE, shades: ["FAST VIOLET", "BLACK", "YELLOW OXIDE", "BURNT SIENNA", "FAST RED", "FAST BLUE"], variants: NONE },
  "MACHINE TINTER":           { bases: NONE, shades: ["WHITE", "YOX", "OXR", "TBL", "LFY", "FFR"], variants: NONE },
  "GVA":                      { bases: NONE, shades: ["BRILLIANT WHITE", "BLACK", "YELLOW OXIDE", "ORGANIC ORANGE", "BLUE", "ORGANIC LEMON YELLOW"], variants: NONE },
  "2K PU MATT":               { bases: ["90 Base", "93 Base"], shades: ["Int Clear", "Opaque White", "Ext Clear"], variants: NONE },
  "PU PRIME MATT":            { bases: ["90 Base", "93 Base"], shades: ["Clear", "White"], variants: NONE },
  "PU PRIME SEALER":          { bases: NONE, shades: ["White", "Clear"], variants: NONE },
  "PROMISE SMARTCHOICE":      { bases: NONE, shades: NONE, variants: ["Interior", "Acrylic Distemper", "Exterior", "Int Primer", "Ext Primer"] },
  "PROMISE PRIMER":           { bases: NONE, shades: NONE, variants: ["Freedom 2in1 Primer", "2in1 Primer", "Promise Primer"] },
  // No options at all — one menu row each, baseColour NULL, straight to packs.
  "CEMENT PRIMER SB":         { bases: NONE, shades: NONE, variants: NONE },
  "ZINC YELLOW METAL PRIMER": { bases: NONE, shades: NONE, variants: NONE },
  "RED OXIDE METAL PRIMER":   { bases: NONE, shades: NONE, variants: NONE },
  "EXTERIOR ACRYLIC PRIMER":  { bases: NONE, shades: NONE, variants: NONE },
  "DAMP PROTECT 2IN1":        { bases: NONE, shades: NONE, variants: NONE },
  "ROOF COAT WHITE":          { bases: NONE, shades: NONE, variants: NONE },
  "CRACKFILLER 5MM":          { bases: NONE, shades: NONE, variants: NONE },
  "DAMP PROTECT BASECOAT":    { bases: NONE, shades: NONE, variants: NONE },
  "MULTI PURPOSE THINNER":    { bases: NONE, shades: NONE, variants: NONE },
};

// (The nine hard-coded "+ More" bases are GONE. "+ More" is no longer a second
// mechanism with its own invented list — it now runs the real product search,
// pre-filled with the product's name, so it returns that product's actual
// other options from the catalog. See ProductDrawer's `onMore`.)

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
 * 🔴 RULE 2 — baseColour is matched NULL-SAFELY.
 *
 * 36 payload rows carry `baseColour: null` — the nine no-option tiles among
 * them. NULL is a real, selectable identity here ("this product has exactly
 * one row"), not an absence, so it is mapped to an explicit sentinel rather
 * than left to fall through a lookup as `undefined`. A Map keyed on `null`
 * would work in JS; a sentinel makes the intent unmissable and survives the
 * key being serialised.
 */
export const NULL_OPTION = " NULL";

function optionKey(baseColour: string | null): string {
  return baseColour === null || baseColour === undefined ? NULL_OPTION : baseColour;
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
          bases: [], shades: [], variants: [], noOptionRow: null,
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
      });
    }
  }

  return { byTile, report };
}

/**
 * Turn ONE searched menu row into something the drawer can open on, with that
 * row's option already selected.
 *
 * Three cases, and the middle one is the reason this exists:
 *
 *  - The product is a TILE and the row's option is already curated -> hand back
 *    the curated resolution untouched. The salesman sees the same short chip
 *    row he sees from the board, with his hit selected.
 *  - The product is a TILE but the option is NOT curated (he searched "Gloss
 *    Cascade Green", one of the 34 shades the curated six do not cover) ->
 *    APPEND that option to the row. It must be visible and selected; showing
 *    the curated six with none of them selected would silently discard what he
 *    actually searched for.
 *  - The product is NOT a tile at all (most of the 143 catalog products) ->
 *    synthesise a one-option resolution from the row itself.
 */
export function resolveForSearch(
  row: ApiProduct,
  byTile: Map<string, V2Resolved>,
): { product: V2Resolved; initialOption: string | null } {
  const key    = row.product ?? row.subProduct;   // RULE 1, again
  const tile   = byTile.get(key);
  const option = row.baseColour;

  if (!tile) {
    return {
      product: {
        sap: key, label: row.displayName, family: row.family,
        bases:    option === null ? [] : [{ value: option, row }],
        shades:   [], variants: [],
        noOptionRow: option === null ? row : null,
      },
      initialOption: option,
    };
  }

  if (option === null) return { product: tile, initialOption: null };

  const known =
    tile.bases.some((o) => o.value === option) ||
    tile.shades.some((o) => o.value === option) ||
    tile.variants.some((o) => o.value === option);
  if (known) return { product: tile, initialOption: option };

  // Append to whichever list the drawer will actually be showing.
  const extra: V2Option = { value: option, row };
  if (tile.variants.length > 0) {
    return { product: { ...tile, variants: [...tile.variants, extra] }, initialOption: option };
  }
  if (tile.bases.length === 0 && tile.shades.length > 0) {
    return { product: { ...tile, shades: [...tile.shades, extra] }, initialOption: option };
  }
  return { product: { ...tile, bases: [...tile.bases, extra] }, initialOption: option };
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

/** "4L ×4, 1L ×6" — pack labels in catalog order, zero quantities dropped. */
export function packString(line: V2CartLine): string {
  return line.packOrder
    .filter((label) => (line.qtys[label] ?? 0) > 0)
    .map((label) => `${label} ×${line.qtys[label]}`)
    .join(", ");
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

/** First letters of the first two words — "Ambika Paints" -> "AP". */
export function monogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? "")).toUpperCase();
}

// ── Recent dealers (localStorage) ──────────────────────────────────────────
// 🔴 v2's OWN key. It never reads or writes any `po_*` key — /po's recents
// (`po_recent_customers`, cap 6), favourites, drafts and sent list all stay
// untouched, so running both apps on one phone cannot cross-contaminate.

const RECENTS_KEY = "po2_recent_customers";
const RECENTS_CAP = 8;

export type V2Recent = { name: string; code: string; area: string | null; ts: number };
type RecentStore = { version: 1; list: V2Recent[] };

/**
 * Every read and write is wrapped: private mode throws on ACCESS, not just on
 * write, and a full quota throws on set. Recents are a convenience — losing
 * them must never take the page down with them.
 */
export function loadRecents(): V2Recent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<RecentStore> | null;
    if (!parsed || !Array.isArray(parsed.list)) return [];
    return parsed.list
      .filter((e): e is V2Recent =>
        !!e && typeof e.name === "string" && typeof e.code === "string")
      .map((e) => ({
        name: e.name,
        code: e.code,
        area: typeof e.area === "string" ? e.area : null,
        ts:   typeof e.ts === "number" ? e.ts : 0,
      }))
      .slice(0, RECENTS_CAP);
  } catch {
    return [];
  }
}

/** Move this dealer to the top (deduped by code), persist, return the new list. */
export function addRecent(c: ApiCustomer): V2Recent[] {
  const entry: V2Recent = { name: c.name, code: c.code, area: c.area ?? null, ts: Date.now() };
  const next = [entry, ...loadRecents().filter((e) => e.code !== entry.code)].slice(0, RECENTS_CAP);
  if (typeof window !== "undefined") {
    try {
      const store: RecentStore = { version: 1, list: next };
      window.localStorage.setItem(RECENTS_KEY, JSON.stringify(store));
    } catch {
      // Quota / private mode — best-effort, and the returned list still
      // updates the current session even though it will not survive a reload.
    }
  }
  return next;
}
