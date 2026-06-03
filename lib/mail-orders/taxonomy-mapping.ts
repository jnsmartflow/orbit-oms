// Phase 1 taxonomy mapping — translates legacy (mo_sku_lookup.category,
// product, baseColour, description) tuples into new mo_order_form_index
// rows per the locked master taxonomy:
//   docs/prompts/drafts/web-update-2026-05-06-master-taxonomy-redesign.md
//
// Returns:
//   - null  → SKIPPED. Either an intentionally hidden family
//             (AUTO/DUCO/M900/SPRAY PAINT/5IN1/TOOLS), a deferred orphan
//             (SADOLIN/EPOXY INSULATOR), or a low-volume single-row orphan
//             (DULUX/SILK FINISH, DULUX/IAE PROJECT, DUWEL/DUWEL ENAMEL).
//             Use getSkipReason(legacy) to distinguish intentional skip
//             from "no rule found" — the latter is a warning condition for
//             the preview script.
//   - 1 row → standard mapping
//   - 2 rows → cross-listed (e.g. Promise Enamel: PROMISE ENAMEL family
//              + PROMISE umbrella)
//   - 3 rows → triple-listed Promise primer variants (PRIMER + PROMISE
//              INTERIOR/EXTERIOR + PROMISE umbrella)
//
// Cell qty semantic (boxes vs units) is unrelated to this mapping — that
// happens at email build time.

// ── Public types ─────────────────────────────────────────────────────────

export type LegacyKey = {
  category:    string;
  product:     string;
  baseColour:  string;
  description?: string;
};

export type ProductType = "PLAIN" | "BASE_VARIANT" | "COLOUR";

export type NewRow = {
  family:       string;
  subProduct:   string;
  displayName:  string;
  searchTokens: string;          // comma-separated alias list
  baseColour:   string | null;
  productType:  ProductType;
  tinterType:   string | null;
  sortOrder:    number;
  isActive:     boolean;
};

// ── Family base sortOrders (planning doc — Step D allocation) ───────────

export const FAMILY_BASE: Record<string, number> = {
  // WOODCARE (Round 1)
  "LUXURIO":          100,
  "2K PU":            200,
  "PU PRIME":         300,
  "NC":               400,
  "MELAMINE":         500,
  "WOOD STAIN":       600,
  "WOOD FILLER":      700,
  // ENAMELS (Round 2)
  "GLOSS":            800,
  "PU ENAMEL":        850,
  "SATIN":            900,
  "LUSTRE":          1000,
  // EXTERIORS (Round 3)
  "MAX":             1100,
  "POWERFLEXX":      1200,
  "PROTECT":         1300,
  "RAINPROOF":       1400,
  "HISHEEN":         1500,
  "TILE":            1600,
  "TEXTURE":         1700,
  "METALLIC":        1800,
  // INTERIORS (Round 4A)
  "SUPERCOVER":      1900,
  "SUPERCLEAN":      2000,
  "VELVET TOUCH":    2100,
  "VT SPECIALTY":    2300,
  // PROMISE family (umbrella) + dedicated tops (Rounds 2/3/4B)
  "PROMISE":         2400,
  "PROMISE ENAMEL":  2500,
  "PROMISE INTERIOR":2600,
  "PROMISE EXTERIOR":2700,
  // UTILITY / PREP (Round 4C)
  "AQUATECH":        2800,
  "FLOOR PLUS":      2900,
  "PRIMER":          3000,
  "DISTEMPER":       3100,
  "PUTTY":           3200,
  "STAINER":         3300,
  "SMOOTHOVER":      3400,
};

// Stable order of sub-products within each family. Used to derive sub_idx
// for sortOrder allocation. Sub-product not present here gets fallback
// index 50 (places it after named ones, lets the catalog still display).
export const SUB_PRODUCT_ORDER: Record<string, string[]> = {
  "LUXURIO":          ["MATT", "GLOSS", "SEALER"],
  "2K PU":            ["MATT", "GLOSS", "SEALER", "PRIMER SURFACER", "2K PU THINNER"],
  "PU PRIME":         ["MATT", "GLOSS", "SEALER", "MULTI PURPOSE THINNER"],
  "NC":               ["NC LACQUER", "NC OPAQUE", "SYNTHETIC VARNISH", "NC 1KPU GLOSS", "NC SANDING SEALER", "NC WOOD THINNER", "NC NECOL", "NC NECOL CLEAR", "NC NECOL THINNER"],
  "MELAMINE":         ["MELAMINE GLOSS", "MELAMINE MATT", "MELAMINE SEALER", "MELAMINE THINNER"],
  "WOOD STAIN":       ["WOOD STAIN"],
  "WOOD FILLER":      ["WOOD FILLER"],
  "GLOSS":            ["GLOSS"],
  "PU ENAMEL":        ["PU ENAMEL"],
  "SATIN":            ["SUPER SATIN", "SATIN STAY BRIGHT"],
  "LUSTRE":           ["LUSTRE"],
  "MAX":              ["MAX"],
  "POWERFLEXX":       ["POWERFLEXX"],
  "PROTECT":          ["PROTECT", "PROTECT DUSTPROOF"],
  "RAINPROOF":        ["RAINPROOF"],
  "HISHEEN":          ["HISHEEN"],
  "TILE":             ["TILE"],
  "TEXTURE":          ["RUSTIC", "DHOLPUR", "SUPERFINE", "ULTRAFINE", "MATT"],
  "METALLIC":         ["METALLIC"],
  "SUPERCOVER":       ["SUPERCOVER", "SUPERCOVER SHEEN", "SUPERCOVER ULTRA"],
  "SUPERCLEAN":       ["SUPERCLEAN", "SUPERCLEAN 3IN1"],
  "VELVET TOUCH":     ["PEARL GLO", "PLATINUM GLO", "DIAMOND GLO", "ETERNA", "ETERNA MATT", "ETERNA HI-SHEEN", "ETERNA BASECOAT"],
  "VT SPECIALTY":     ["VAF", "VT FIN", "LUXURY FINISHES", "VT CONCRETE FINISH", "VT METALLICS", "AMBIANCE", "VT CLEAR COAT", "VT MARBLE", "VELVETINO"],
  "PROMISE":          ["PROMISE ENAMEL", "PROMISE INTERIOR", "PROMISE SHEEN INTERIOR", "PROMISE EXTERIOR", "PROMISE SHEEN EXTERIOR", "PROMISE PRIMER", "PROMISE SMARTCHOICE"],
  "PROMISE ENAMEL":   ["PROMISE ENAMEL"],
  "PROMISE INTERIOR": ["PROMISE INTERIOR", "PROMISE SHEEN INTERIOR", "PROMISE SMARTCHOICE INT", "PROMISE SMARTCHOICE INT PRIMER", "PROMISE SMARTCHOICE ACRYLIC DISTEMPER", "PROMISE FREEDOM 2IN1 PRIMER", "PROMISE PRIMER"],
  "PROMISE EXTERIOR": ["PROMISE EXTERIOR", "PROMISE SHEEN EXTERIOR", "PROMISE SMARTCHOICE EXT", "PROMISE SMARTCHOICE EXT PRIMER"],
  "AQUATECH":         [],   // existing structure preserved minus WATERPROOF PUTTY; sub-products derived from legacy product field
  "FLOOR PLUS":       ["FLOOR PLUS"],
  "PRIMER":           ["WOOD PRIMER", "RED OXIDE METAL PRIMER", "ZINC YELLOW METAL PRIMER", "CEMENT PRIMER WB", "CEMENT PRIMER SB", "INTERIOR ACRYLIC PRIMER", "EXTERIOR ACRYLIC PRIMER", "ALKALI BLOC PRIMER", "QUICK DRYING PRIMER", "EPOXY PRIMER", "2IN1 INTERIOR-EXTERIOR PRIMER", "SMARTCHOICE INT PRIMER", "SMARTCHOICE EXT PRIMER", "PROMISE PRIMER"],
  "DISTEMPER":        ["ACRYLIC DISTEMPER", "MAGIK"],
  "PUTTY":            ["ACRYLIC PUTTY", "WATERPROOF PUTTY", "POLYPUTTY"],
  "STAINER":          ["UNIVERSAL STAINER", "PU STAINER", "ACOTONE TINTER", "MACHINE TINTER", "HP COLORANT"],
  "SMOOTHOVER":       ["SMOOTHOVER"],
};

// ── Hidden families & skipped orphans (return null) ─────────────────────

const HIDDEN_BY_CATEGORY: Record<string, string> = {
  AUTO:          "Hidden family — AUTO (per planning doc §6.2)",
  DUCO:          "Hidden family — DUCO (per planning doc §6.2)",
  M900:          "Hidden family — M900 (per planning doc §6.2)",
  "SPRAY PAINT": "Hidden family — SPRAY PAINT (per planning doc §6.2)",
  TOOLS:         "Hidden family — TOOLS (per planning doc §6.2)",
};

const SKIPPED_PAIRS: Array<[string, string, string]> = [
  ["DULUX",       "5IN1",                    "Hidden — DULUX/5IN1 (planning doc §6.2)"],
  ["DULUX",       "SILK FINISH",             "Skipped orphan — single-SKU low volume"],
  ["DULUX",       "IAE PROJECT",             "Skipped orphan — single-SKU low volume"],
  ["DUWEL",       "DUWEL ENAMEL",            "Skipped orphan — single-SKU, no good fit"],
  ["SADOLIN",     "EPOXY INSULATOR",         "Deferred — industrial round (planning doc §1.1)"],
  ["SADOLIN",     "EPOXY INSULATOR HARDNER", "Deferred — industrial round (planning doc §1.1)"],
  // WEATHERCOAT specialty exterior coatings — deferred to a separate
  // specialty round per planning doc §3.5. Listed individually so they
  // surface in `skippedTriples`, not `warnings`.
  ["WEATHERCOAT", "WS ELASTOMERIC", "Deferred — specialty exterior round (planning doc §3.5)"],
  ["WEATHERCOAT", "WS FLASH",       "Deferred — specialty exterior round (planning doc §3.5)"],
  ["WEATHERCOAT", "WS PRIMA E900",  "Deferred — specialty exterior round (planning doc §3.5)"],
  ["WEATHERCOAT", "WS PROJECT",     "Deferred — specialty exterior round (planning doc §3.5)"],
  ["WEATHERCOAT", "WS TR E2000",    "Deferred — specialty exterior round (planning doc §3.5)"],
  ["WEATHERCOAT", "WS ULTRACLEAN",  "Deferred — specialty exterior round (planning doc §3.5)"],
];

export function getSkipReason(legacy: LegacyKey): string | null {
  const cat  = legacy.category.toUpperCase().trim();
  const prod = legacy.product.toUpperCase().trim();
  if (HIDDEN_BY_CATEGORY[cat]) return HIDDEN_BY_CATEGORY[cat];
  for (const [c, p, reason] of SKIPPED_PAIRS) {
    if (cat === c && prod === p) return reason;
  }
  return null;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function normalizeBase(b: string | null | undefined): string {
  return (b ?? "").trim();
}

function classifyProductType(baseColour: string | null | undefined): ProductType {
  const bc = (baseColour ?? "").trim().toUpperCase();
  if (!bc || bc === "N/A" || bc === "NA") return "PLAIN";
  // Numeric-base pattern (90 BASE / 92 BASE / etc.)
  if (/^\d+\s*BASE/.test(bc))                                 return "BASE_VARIANT";
  // Named bases + tinting whites
  if (/\bBASE\b/.test(bc))                                    return "BASE_VARIANT";
  if (/^BRILLIANT\s+WHITE|^BLAZING\s+WHITE|^CLASSIC\s+WHITE|^OFF\s+WHITE/.test(bc))
                                                              return "BASE_VARIANT";
  return "COLOUR";
}

function variantOffset(baseColour: string | null, productType: ProductType): number {
  if (productType === "PLAIN") return 0;
  const bc = (baseColour ?? "").toUpperCase();
  if (productType === "BASE_VARIANT") {
    const m = bc.match(/^(\d+)\s*BASE/);
    if (m) {
      const ordered = [90, 92, 93, 94, 95, 96, 97, 98];
      const idx     = ordered.indexOf(parseInt(m[1], 10));
      if (idx >= 0) return idx + 1;             // 1..8
      return 9;                                  // unrecognised numeric base
    }
    if (/^BRILLIANT\s+WHITE/.test(bc)) return 0;  // sits before numeric bases
    return 9;                                     // other named bases
  }
  // COLOUR — stable hash inside 20..99 range. Page sorts by sortOrder ASC
  // then displayName, so collisions degrade gracefully.
  let h = 0;
  for (const ch of bc) h = ((h * 31) + ch.charCodeAt(0)) | 0;
  return 20 + (Math.abs(h) % 80);
}

function computeSortOrder(family: string, subProduct: string, baseColour: string | null, productType: ProductType): number {
  const familyBase = FAMILY_BASE[family] ?? 9000;
  const subOrder   = SUB_PRODUCT_ORDER[family] ?? [];
  const idx        = subOrder.indexOf(subProduct);
  const subBase    = familyBase + (idx >= 0 ? idx : 50) * 10;
  return subBase + variantOffset(baseColour, productType);
}

function smartTitleCase(s: string): string {
  if (!s) return s;
  // Light-touch — keep the few all-caps tokens we use and Title Case the rest.
  const KEEP_UPPER = new Set(["WS", "PU", "NC", "WB", "SB", "GVA", "HP", "JSW", "DULUX", "SADOLIN", "AQUATECH", "VT", "MAX"]);
  return s.split(/\s+/).map((w) => {
    if (!w) return w;
    if (KEEP_UPPER.has(w.toUpperCase())) return w.toUpperCase();
    if (/^\d+L$|^\d+ML$/i.test(w))       return w.toUpperCase();
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  }).join(" ");
}

function buildRow(
  family:       string,
  subProduct:   string,
  baseColour:   string | null,
  displayName:  string,
  searchTokens: string,
  tinterType:   string | null = null,
): NewRow {
  const productType = classifyProductType(baseColour);
  return {
    family,
    subProduct,
    displayName,
    searchTokens,
    baseColour:  baseColour && baseColour.trim() !== "" ? baseColour.trim() : null,
    productType,
    tinterType,
    sortOrder:   computeSortOrder(family, subProduct, baseColour, productType),
    isActive:    true,
  };
}

// ── Search-token aliases per sub-product (planning doc §x.7 tables) ─────

const ALIASES: Record<string, string> = {
  // WOODCARE
  "LUXURIO/MATT":             "LUXURIO MATT, LUXURIO PU MATT, SADOLIN LUXURIO MATT",
  "LUXURIO/GLOSS":            "LUXURIO GLOSS, LUXURIO PU GLOSS, SADOLIN LUXURIO GLOSS",
  "LUXURIO/SEALER":           "LUXURIO WHITE SEALER, LUXURIO CLEAR SEALER, LUXURIO SEALER",
  "2K PU/MATT":               "2KPU MATT, 2K PU MATT, SADOLIN 2K PU MATT, SADOLIN 2KPU MATT",
  "2K PU/GLOSS":              "2KPU GLOSS, 2K PU GLOSS, SADOLIN 2K PU GLOSS",
  "2K PU/SEALER":             "2KPU SEALER, 2K PU SEALER, SADOLIN 2K PU SEALER",
  "2K PU/PRIMER SURFACER":    "2KPU PRIMER SURFACER, 2K PU PRIMER SURFACER, OPAQUE 2KPU PRIMER",
  "2K PU/2K PU THINNER":      "2KPU THINNER, 2K PU THINNER, SADOLIN 2K PU THINNER",
  "PU PRIME/MATT":            "PU PRIME MATT, PRIME MATT, PU PRIME MAT",
  "PU PRIME/GLOSS":           "PU PRIME GLOSS, PU PRIME GLOSSY, PRIME GLOSS",
  "PU PRIME/SEALER":          "PU PRIME SEALER, PU PRIME WHITE SEALER, PU PRIME CLEAR SEALER",
  "PU PRIME/MULTI PURPOSE THINNER": "MULTI PURPOSE THINNER, MP THINNER, MULTIPURPOSE THINNER",
  "NC/NC LACQUER":            "NC LACQUER, NC CLEAR LACQUER, SADOLIN NC LACQUER",
  "NC/NC OPAQUE":             "NC OPAQUE, NC OPAQUE FINISH",
  "NC/SYNTHETIC VARNISH":     "SYNTHETIC VARNISH, SYNTHETIC CLEAR VARNISH, VARNISH, SADOLIN SYNTHETIC",
  "NC/NC 1KPU GLOSS":         "NC 1KPU GLOSS, 1KPU GLOSS, INTERIOR 1KPU GLOSS",
  "NC/NC SANDING SEALER":     "NC SANDING SEALER, NC SEALER, SANDING SEALER",
  "NC/NC WOOD THINNER":       "NC WOOD THINNER, NC THINNER, WOOD THINNER",
  "NC/NC NECOL":              "NC NECOL, NECOL, SADOLIN NECOL",
  "NC/NC NECOL CLEAR":        "NC NECOL CLEAR, NECOL CLEAR",
  "NC/NC NECOL THINNER":      "NC NECOL THINNER, NECOL THINNER",
  "MELAMINE/MELAMINE GLOSS":  "MELAMINE GLOSS, SADOLIN MELAMINE GLOSS, MELAMINE INT CLR GLOSS",
  "MELAMINE/MELAMINE MATT":   "MELAMINE MATT, MELAMINE MATT CLEAR, SADOLIN MELAMINE MATT, MELAMINE INT CLR MAT",
  "MELAMINE/MELAMINE SEALER": "MELAMINE SEALER, SADOLIN MELAMINE SEALER",
  "MELAMINE/MELAMINE THINNER":"MELAMINE THINNER, SADOLIN MELAMINE THINNER",
  "WOOD STAIN/WOOD STAIN":    "WOOD STAIN, WOOD STAINER, SADOLIN WOOD STAIN",
  "WOOD FILLER/WOOD FILLER":  "WOOD FILLER, WOODFILLER",
  // ENAMELS
  "GLOSS/GLOSS":              "GLOSS, DULUX GLOSS, GLOSS ENAMEL, ENAMEL GLOSS, GLOSS PREMIUM",
  "PU ENAMEL/PU ENAMEL":      "PU ENAMEL, POLYURETHANE ENAMEL, PU ENML, DN PU ENAMEL, PU",
  "SATIN/SUPER SATIN":        "SUPER SATIN, SATIN FINISH, OIL SATIN, OIL BASE, SAT FIN",
  "SATIN/SATIN STAY BRIGHT":  "WB SATIN, WATER SATIN, WATER BASE, SATIN STAY BRIGHT, STAY BRIGHT SATIN",
  "LUSTRE/LUSTRE":            "LUSTRE, LUSTRE FINISH, DULUX LUSTRE",
  "PROMISE ENAMEL/PROMISE ENAMEL": "PROMISE ENAMEL, PROMISE ENML, DULUX PROMISE ENAMEL",
  // EXTERIORS
  "MAX/MAX":                  "WS MAX, MAX, MAX 10YR, WS MAX 10YR",
  "POWERFLEXX/POWERFLEXX":    "WS PF, PF, POWERFLEXX, WS POWERFLEXX, PF 15YR, WS PF 15YR",
  "PROTECT/PROTECT":          "WS PROTECT, PROTECT",
  "PROTECT/PROTECT DUSTPROOF":"WS DUSTPROOF, DUSTPROOF, WS PROTECT DUSTPROOF, PROTECT DUSTPROOF",
  "RAINPROOF/RAINPROOF":      "WS RP, RP, RAINPROOF, WS RAINPROOF, PROTECT RAINPROOF, RP 8YR",
  "HISHEEN/HISHEEN":          "HI-SHEEN, HISHEEN, PROTECT HI-SHEEN, WS HI SHEEN, WS PROTECT HI-SHEEN",
  "TILE/TILE":                "WS TILE, TILE, WS TILE BASE",
  "TEXTURE/RUSTIC":           "WS TEXTURE, TEXTURE, RUSTIC, WS TEXTURE RUSTIC",
  "TEXTURE/DHOLPUR":          "WS TEXTURE, TEXTURE, DHOLPUR, WS TEXTURE DHOLPUR",
  "TEXTURE/SUPERFINE":        "WS TEXTURE, TEXTURE, SUPERFINE, WS TEXTURE SUPERFINE",
  "TEXTURE/ULTRAFINE":        "WS TEXTURE, TEXTURE, ULTRAFINE, WS TEXTURE ULTRAFINE",
  "TEXTURE/MATT":             "WS TEXTURE MATT, TEXTURE MATT, WS TEX MATT",
  "METALLIC/METALLIC":        "WS METALLIC, METALLIC SILVER, METALLIC GOLD, WS METALLIC SILVER, WS METALLIC GOLD",
  // INTERIORS — Round 4A
  "SUPERCOVER/SUPERCOVER":            "SUPERCOVER, SUPER COVER, DULUX SUPERCOVER",
  "SUPERCOVER/SUPERCOVER SHEEN":      "SUPERCOVER SHEEN, SUPER COVER SHEEN",
  "SUPERCOVER/SUPERCOVER ULTRA":      "SUPERCOVER ULTRA, SUPER COVER ULTRA, SC ULTRA, ULTRA",
  "SUPERCLEAN/SUPERCLEAN":            "SUPERCLEAN, SUPER CLEAN, SCN, SUPERCLEAN NEW, DULUX SUPERCLEAN",
  "SUPERCLEAN/SUPERCLEAN 3IN1":       "3IN1, 3-IN-1, SCN 3IN1, SUPERCLEAN 3IN1, 3IN1 MR, MARK RESISTANT, 3IN1 MARK RESISTANT, SCN 3IN1 MR",
  "VELVET TOUCH/PEARL GLO":           "PEARL GLO, PEARL GLOW, VT PEARL, PEARL, DULUX PEARL GLO, VT, VELVET TOUCH, DULUX VT",
  "VELVET TOUCH/PLATINUM GLO":        "PLATINUM GLO, PLATINUM GLOW, VT PLATINUM, PLATINUM, VELVET TOUCH, VT",
  "VELVET TOUCH/DIAMOND GLO":         "DIAMOND GLO, DIAMOND GLOW, VT DIAMOND, DIAMOND, VELVET TOUCH, VT",
  "VELVET TOUCH/ETERNA":              "ETERNA, VT ETERNA, ETERNA SHEEN, VELVET TOUCH, VT",
  "VELVET TOUCH/ETERNA MATT":         "ETERNA MATT, VT ETERNA MATT, ETERNA MAT, VELVET TOUCH, VT",
  "VELVET TOUCH/ETERNA HI-SHEEN":     "ETERNA HI-SHEEN, ETERNA HISHEEN, ETERNA HI SHEEN, VELVET TOUCH, VT",
  "VELVET TOUCH/ETERNA BASECOAT":     "ETERNA BASECOAT, ETERNA BASE COAT, VT ETERNA BASECOAT, VELVET TOUCH, VT",
  "VT SPECIALTY/VAF":                 "VAF, VAF METALLIC, VAF TRENDS, GLITTER SILVER, GLITTER GOLD",
  "VT SPECIALTY/VT FIN":              "VT FIN, FIN GOLD, FIN SILVER",
  "VT SPECIALTY/LUXURY FINISHES":     "LUXURY FINISHES, MARMORINO, CLAY, VT LUXURY",
  "VT SPECIALTY/VT CONCRETE FINISH": "CONCRETE FINISH, VT CONCRETE, ARCHI CONCRETE, VT FINISH ARCHI",
  "VT SPECIALTY/VT METALLICS":        "VT METALLICS, METALLICS GOLD, METALLICS SILVER",
  "VT SPECIALTY/AMBIANCE":            "AMBIANCE, VT AMBIANCE",
  "VT SPECIALTY/VT CLEAR COAT":       "VT CLEAR COAT, CLEAR COAT MATT",
  "VT SPECIALTY/VT MARBLE":           "VT MARBLE, MARBLE FINISH",
  "VT SPECIALTY/VELVETINO":           "VELVETINO, VELVETINO GOLD, VELVETINO SILVER",
  // PROMISE INTERIOR (Round 4B)
  "PROMISE INTERIOR/PROMISE INTERIOR":                       "PROMISE INTERIOR, PROMISE INT, PROMISE INTR, PROMISE INTERIOR WHITE",
  "PROMISE INTERIOR/PROMISE SHEEN INTERIOR":                 "PROMISE SHEEN INTERIOR, PROMISE SHEEN INT, SHEEN INTERIOR",
  "PROMISE INTERIOR/PROMISE SMARTCHOICE INT":                "PROMISE SMARTCHOICE INT, PROMISE SMARTCHOICE INTERIOR, SMARTCHOICE INT, SMARTCHOICE INTERIOR, PROMISE SMARTCH INT, PROMISE INT SMART CHOICE",
  "PROMISE INTERIOR/PROMISE SMARTCHOICE INT PRIMER":         "PROMISE SMARTCHOICE INT PRIMER, SMARTCHOICE INT PRIMER, SMARTCHOICE INTERIOR PRIMER",
  "PROMISE INTERIOR/PROMISE SMARTCHOICE ACRYLIC DISTEMPER":  "PROMISE SMARTCHOICE ACRYLIC DISTEMPER, SMARTCHOICE ACRYLIC DISTEMPER, PROMISE SMART CHOICE DISTEMPER, SMART CHOICE DISTEMPER, ACRYLIC DISTEMPER",
  "PROMISE INTERIOR/PROMISE FREEDOM 2IN1 PRIMER":            "PROMISE FREEDOM PRIMER, PROMISE FREEDOM 2IN1, FREEDOM PRIMER, PROMISE 2IN1 PRIMER, PROMISE 2IN1 INT EXT PRIMER, 2IN1 INT EXT PRIMER, FREEDOM 2IN1",
  "PROMISE INTERIOR/PROMISE PRIMER":                         "PROMISE PRIMER",
  // PROMISE EXTERIOR (Round 3)
  "PROMISE EXTERIOR/PROMISE EXTERIOR":                       "PROMISE EXTERIOR, PROMISE EXT",
  "PROMISE EXTERIOR/PROMISE SHEEN EXTERIOR":                 "PROMISE SHEEN EXTERIOR, PROMISE SHEEN EXT",
  "PROMISE EXTERIOR/PROMISE SMARTCHOICE EXT":                "PROMISE SMARTCHOICE EXT, PROMISE SC EXT, SMARTCHOICE EXTERIOR",
  "PROMISE EXTERIOR/PROMISE SMARTCHOICE EXT PRIMER":         "PROMISE SMARTCHOICE EXT PRIMER, SMARTCHOICE EXT PRIMER, SMARTCHOICE EXTERIOR PRIMER",
  // UTILITY / Round 4C
  "FLOOR PLUS/FLOOR PLUS":            "FLOOR PLUS, FLOORPLUS",
  "PRIMER/WOOD PRIMER":               "WOOD PRIMER, DUWEL WOOD PRIMER, FARCO WHITE PRIMER",
  "PRIMER/RED OXIDE METAL PRIMER":    "RED OXIDE METAL PRIMER, RED OXIDE PRIMER, METAL PRIMER",
  "PRIMER/ZINC YELLOW METAL PRIMER":  "ZINC YELLOW METAL PRIMER, ZINC YELLOW PRIMER, ZINC PRIMER",
  "PRIMER/CEMENT PRIMER WB":          "CEMENT PRIMER WB, WB CEMENT PRIMER, WATER BASED CEMENT PRIMER, DULUX WB CEMENT PRIMER, DUWEL WB CEMENT PRIMER",
  "PRIMER/CEMENT PRIMER SB":          "CEMENT PRIMER SB, SB CEMENT PRIMER, SOLVENT BASED CEMENT PRIMER, ICI DUWEL SB CEMENT PRIMER, IP DUWEL SB CEMENT PRIMER",
  "PRIMER/INTERIOR ACRYLIC PRIMER":   "INTERIOR ACRYLIC PRIMER, DUWEL INTERIOR ACRYLIC PRIMER",
  "PRIMER/EXTERIOR ACRYLIC PRIMER":   "EXTERIOR ACRYLIC PRIMER",
  "PRIMER/ALKALI BLOC PRIMER":        "ALKALI BLOC PRIMER, ALKALI BLOC, DULUX ALKALI BLOC PRIMER",
  "PRIMER/QUICK DRYING PRIMER":       "QUICK DRYING PRIMER, ROM, QD PRIMER",
  "PRIMER/EPOXY PRIMER":              "EPOXY PRIMER, EPOXY 1K PRIMER, SADOLIN EPOXY PRIMER, EPOXY",
  "PRIMER/2IN1 INTERIOR-EXTERIOR PRIMER": "PROMISE FREEDOM 2IN1, PROMISE 2IN1, FREEDOM 2IN1, 2IN1 INT EXT PRIMER, PROMISE 2IN1 INT EXT PRIMER, FREEDOM PRIMER",
  "PRIMER/SMARTCHOICE INT PRIMER":    "SMARTCHOICE INT PRIMER, PROMISE SMARTCHOICE INT PRIMER, SMARTCHOICE INTERIOR PRIMER",
  "PRIMER/SMARTCHOICE EXT PRIMER":    "SMARTCHOICE EXT PRIMER, PROMISE SMARTCHOICE EXT PRIMER, SMARTCHOICE EXTERIOR PRIMER",
  "PRIMER/PROMISE PRIMER":            "PROMISE PRIMER",
  "DISTEMPER/ACRYLIC DISTEMPER":      "ACRYLIC DISTEMPER, DUWEL ACRYLIC DISTEMPER, INTERIOR DISTEMPER, PROMISE SMARTCHOICE ACRYLIC DISTEMPER",
  "DISTEMPER/MAGIK":                  "MAGIK, DUWEL MAGIK",
  "PUTTY/ACRYLIC PUTTY":              "ACRYLIC PUTTY",
  "PUTTY/WATERPROOF PUTTY":           "WATERPROOF PUTTY, AQUATECH WATERPROOF PUTTY",
  "PUTTY/POLYPUTTY":                  "POLYPUTTY, DUWEL POLYPUTTY",
  "STAINER/UNIVERSAL STAINER":        "UNIVERSAL STAINER, FAST STAINER",
  "STAINER/PU STAINER":               "PU STAINER, GVA, GVA STAINER",
  "STAINER/ACOTONE TINTER":           "ACOTONE, ACOTONE TINTER",
  "STAINER/MACHINE TINTER":           "MACHINE TINTER, JSW DEALER TINTER, DEALER TINTER",
  "STAINER/HP COLORANT":              "HP COLORANT, HP TINTER, COLORANT",
  "SMOOTHOVER/SMOOTHOVER":            "SMOOTHOVER, DULUX SMOOTHOVER",
};

function aliasFor(family: string, subProduct: string): string {
  return ALIASES[`${family}/${subProduct}`] ?? subProduct;
}

// ── Mapping dispatch ─────────────────────────────────────────────────────

// Tinter-type tag for the new mo_order_form_index `tinterType` column.
// Empty for non-stainer products.
const TINTER_TYPE: Record<string, string> = {
  "STAINER/UNIVERSAL STAINER": "FAST_STAINER",
  "STAINER/PU STAINER":        "PU_STAINER",
  "STAINER/ACOTONE TINTER":    "ACOTONE",
  "STAINER/MACHINE TINTER":    "MACHINE_TINTER",
  "STAINER/HP COLORANT":       "HP_COLORANT",
};

function tinterTypeFor(family: string, subProduct: string): string | null {
  return TINTER_TYPE[`${family}/${subProduct}`] ?? null;
}

// Display label per (family, subProduct). Falls back to subProduct title-cased.
const DISPLAY_LABEL: Record<string, string> = {
  "LUXURIO/MATT":             "Luxurio Matt",
  "LUXURIO/GLOSS":            "Luxurio Gloss",
  "LUXURIO/SEALER":           "Luxurio Sealer",
  "2K PU/MATT":               "2K PU Matt",
  "2K PU/GLOSS":              "2K PU Gloss",
  "2K PU/SEALER":             "2K PU Sealer",
  "2K PU/PRIMER SURFACER":    "2K PU Primer Surfacer",
  "2K PU/2K PU THINNER":      "2K PU Thinner",
  "PU PRIME/MATT":            "PU Prime Matt",
  "PU PRIME/GLOSS":           "PU Prime Gloss",
  "PU PRIME/SEALER":          "PU Prime Sealer",
  "PU PRIME/MULTI PURPOSE THINNER": "Multi Purpose Thinner",
  "GLOSS/GLOSS":              "Gloss",
  "SATIN/SUPER SATIN":        "Satin Finish",
  "SATIN/SATIN STAY BRIGHT":  "Satin Stay Bright",
  "LUSTRE/LUSTRE":            "Lustre",
  "PROMISE ENAMEL/PROMISE ENAMEL": "Promise Enamel",
  "MAX/MAX":                  "Dulux WS Max",
  "POWERFLEXX/POWERFLEXX":    "Dulux WS Powerflexx",
  "PROTECT/PROTECT":          "Dulux WS Protect",
  "PROTECT/PROTECT DUSTPROOF":"Dulux WS Protect Dustproof",
  "RAINPROOF/RAINPROOF":      "Dulux WS Rainproof",
  "HISHEEN/HISHEEN":          "WS Protect Hi-Sheen",
  "TILE/TILE":                "Dulux WS Tile",
  "METALLIC/METALLIC":        "Dulux WS Metallic",
  "SUPERCOVER/SUPERCOVER":    "SuperCover",
  "SUPERCOVER/SUPERCOVER SHEEN": "SuperCover Sheen",
  "SUPERCOVER/SUPERCOVER ULTRA": "SuperCover Ultra",
  "SUPERCLEAN/SUPERCLEAN":    "SuperClean",
  "SUPERCLEAN/SUPERCLEAN 3IN1":"SuperClean 3in1",
  "VELVET TOUCH/PEARL GLO":         "Pearl Glo",
  "VELVET TOUCH/PLATINUM GLO":      "Platinum Glo",
  "VELVET TOUCH/DIAMOND GLO":       "Diamond Glo",
  "VELVET TOUCH/ETERNA":            "Eterna",
  "VELVET TOUCH/ETERNA MATT":       "Eterna Matt",
  "VELVET TOUCH/ETERNA HI-SHEEN":   "Eterna Hi-Sheen",
  "VELVET TOUCH/ETERNA BASECOAT":   "Eterna Basecoat",
  "FLOOR PLUS/FLOOR PLUS":    "Floor Plus",
  "DISTEMPER/ACRYLIC DISTEMPER": "Acrylic Distemper",
  "DISTEMPER/MAGIK":          "Magik (Distemper)",
  "PUTTY/ACRYLIC PUTTY":      "Acrylic Putty",
  "PUTTY/WATERPROOF PUTTY":   "Waterproof Putty (Aquatech)",
  "PUTTY/POLYPUTTY":          "PolyPutty",
  "NC/NC NECOL":              "NC Necol",
  "NC/NC NECOL CLEAR":        "NC Necol Clear",
  "NC/NC NECOL THINNER":      "NC Necol Thinner",
  "PRIMER/EPOXY PRIMER":      "Epoxy Primer (Sadolin)",
  "STAINER/UNIVERSAL STAINER":"Universal Stainer",
  "STAINER/PU STAINER":       "PU Stainer (GVA)",
  "STAINER/ACOTONE TINTER":   "Acotone Tinter",
  "STAINER/MACHINE TINTER":   "Machine Tinter (Dealer)",
  "STAINER/HP COLORANT":      "HP Colorant",
  "SMOOTHOVER/SMOOTHOVER":    "Smoothover",
  "PU ENAMEL/PU ENAMEL":      "PU Enamel",
};

function displayFor(family: string, subProduct: string): string {
  return DISPLAY_LABEL[`${family}/${subProduct}`] ?? smartTitleCase(subProduct);
}

function row(
  family: string,
  subProduct: string,
  baseColour: string | null,
): NewRow {
  return buildRow(
    family,
    subProduct,
    baseColour,
    displayFor(family, subProduct),
    aliasFor(family, subProduct),
    tinterTypeFor(family, subProduct),
  );
}

// ── Main mapping function ────────────────────────────────────────────────

export function mapLegacyToNew(legacy: LegacyKey): NewRow[] | null {
  if (getSkipReason(legacy)) return null;

  const cat  = legacy.category.toUpperCase().trim();
  const prod = legacy.product.toUpperCase().trim();
  const bc   = normalizeBase(legacy.baseColour);

  // ── WOODCARE (Round 1) — pattern-based SADOLIN dispatch ──────────────
  //
  // Real `mo_sku_lookup.product` strings have prefix/suffix variation that
  // the original exact-match dispatch missed (e.g. `EXT CLR 2K PU GLOSS`,
  // `INT CLR MELAMINE GLOSS`, `PU PRIME WHITE SEALER`, `NC NECOL CLEAR`).
  // Phase 1 Prompt 1.6 reworked the dispatch as ordered pattern matching:
  //   1. LUXURIO exact-match (no variants in current data)
  //   2. PU PRIME prefix → finish keyword
  //   3. 2K PU pattern → finish keyword (negative-guards LUXURIO/PU PRIME/1KPU)
  //   4. INT CLR 1K PU GLOSS → NC family
  //   5. MELAMINE pattern (with INT CLR prefix tolerance)
  //   6. NC family patterns (NECOL + LACQUER/OPAQUE/VARNISH/etc)
  //   7. EPOXY 1K PRIMER → PRIMER family (new sub-product)
  //   8. WOOD STAIN / WOOD FILLER exact-match
  if (cat === "SADOLIN") {
    // 1. LUXURIO
    if (prod === "LUXURIO PU MATT")           return [row("LUXURIO", "MATT", bc)];
    if (prod === "LUXURIO PU GLOSS")          return [row("LUXURIO", "GLOSS", bc)];
    if (prod === "LUXURIO PU SEALER")         return [row("LUXURIO", "SEALER", bc)];

    // 2. PU PRIME (prefix-based) — must run before 2K PU pattern.
    if (/^PU\s+PRIME\b/.test(prod)) {
      if (/THINNER/.test(prod))                  return [row("PU PRIME", "MULTI PURPOSE THINNER", bc)];
      if (/SEALER/.test(prod))                   return [row("PU PRIME", "SEALER", bc)];
      if (/MATT/.test(prod))                     return [row("PU PRIME", "MATT", bc)];
      if (/GLOSS/.test(prod))                    return [row("PU PRIME", "GLOSS", bc)];
      return null;
    }
    // Bare MULTI PURPOSE THINNER (master .md anticipated form, not seen in
    // current CSV but kept defensively).
    if (prod === "MULTI PURPOSE THINNER")        return [row("PU PRIME", "MULTI PURPOSE THINNER", bc)];

    // 3. 2K PU pattern. Requires literal `2`, with optional K and optional
    //    whitespace before PU. Negative guards keep LUXURIO/PU PRIME/1KPU
    //    out (belt-and-suspenders — they're already handled above, but the
    //    guard makes the predicate self-contained). Word boundary `\b` on
    //    PU PRIME prevents a false positive against `PU PRIMER` (as in
    //    `OPQ 2K PU PRIMER SURFACER` — found in Phase 1 Prompt 1.6 re-run).
    const is2KPU = /\b2K?\s*PU\b/.test(prod) && !/LUXURIO|\bPU\s+PRIME\b|1\s*KPU|1K\s*PU/.test(prod);
    if (is2KPU) {
      if (/THINNER/.test(prod))                  return [row("2K PU", "2K PU THINNER", bc)];
      if (/PRIMER\s+SURFACER/.test(prod))        return [row("2K PU", "PRIMER SURFACER", bc)];
      if (/SEALER/.test(prod))                   return [row("2K PU", "SEALER", bc)];
      if (/MATT/.test(prod))                     return [row("2K PU", "MATT", bc)];
      if (/GLOSS/.test(prod))                    return [row("2K PU", "GLOSS", bc)];
      return null;
    }

    // 4. INT CLR 1K PU GLOSS → NC/NC 1KPU GLOSS
    if (/INT\s+CLR\s+1\s*K\s*PU\s+GLOSS/.test(prod) || prod === "NC 1KPU GLOSS") {
      return [row("NC", "NC 1KPU GLOSS", bc)];
    }

    // 5. MELAMINE — tolerate optional INT CLR prefix.
    if (/MELAMINE\s+GLOSS/.test(prod))           return [row("MELAMINE", "MELAMINE GLOSS", bc)];
    if (/MELAMINE\s+MATT/.test(prod))            return [row("MELAMINE", "MELAMINE MATT", bc)];
    if (/MELAMINE\s+SEALER/.test(prod))          return [row("MELAMINE", "MELAMINE SEALER", bc)];
    if (/MELAMINE\s+THINNER/.test(prod))         return [row("MELAMINE", "MELAMINE THINNER", bc)];

    // 6. NC family — NECOL line + classic NC sub-products.
    if (prod === "NC NECOL")                     return [row("NC", "NC NECOL", bc)];
    if (prod === "NC NECOL CLEAR")               return [row("NC", "NC NECOL CLEAR", bc)];
    if (prod === "NC NECOL THINNER")             return [row("NC", "NC NECOL THINNER", bc)];
    if (/^NC(\s+CLEAR)?\s+LACQUER/.test(prod))   return [row("NC", "NC LACQUER", bc)];
    if (/^NC\s+OPAQUE/.test(prod))               return [row("NC", "NC OPAQUE", bc)];   // matches NC OPAQUE / NC OPAQUE FINISH
    if (/SYNTHETIC.*VARNISH/.test(prod))         return [row("NC", "SYNTHETIC VARNISH", bc)];
    if (prod === "NC SANDING SEALER")            return [row("NC", "NC SANDING SEALER", bc)];
    if (prod === "NC WOOD THINNER")              return [row("NC", "NC WOOD THINNER", bc)];

    // 7. EPOXY 1K PRIMER → PRIMER/EPOXY PRIMER (new sub-product, not in
    //    the master .md but found in live data — Phase 1 Prompt 1.5 finding).
    if (prod === "EPOXY 1K PRIMER")              return [row("PRIMER", "EPOXY PRIMER", bc)];

    // 8. WOOD STAIN / WOOD FILLER
    if (prod === "WOOD STAINER" || prod === "WOOD STAIN") return [row("WOOD STAIN", "WOOD STAIN", bc || legacy.product)];
    if (prod === "WOOD FILLER")                  return [row("WOOD FILLER", "WOOD FILLER", bc || legacy.product)];

    return null;  // unmapped SADOLIN fall-through
  }

  // ── ENAMELS (Round 2) ─────────────────────────────────────────────────
  if (cat === "GLOSS")         return [row("GLOSS", "GLOSS", bc)];
  if (cat === "LUSTRE")        return [row("LUSTRE", "LUSTRE", bc)];
  // PU ENAMEL (12-in-1) — Surat depot stocks one gloss line; PU ENAMEL is
  // folded into GLOSS family per planning doc §2. Live category is "PU"
  // (the existing DULUX/PU ENAMEL rule below stays as a defensive fallback).
  if (cat === "PU" && prod === "PU ENAMEL") return [row("GLOSS", "GLOSS", bc)];
  if (cat === "SATIN") {
    // Disambiguated by legacy.product (no description needed).
    if (prod === "SUPER SATIN")        return [row("SATIN", "SUPER SATIN", bc)];
    if (prod === "SATIN STAY BRIGHT")  return [row("SATIN", "SATIN STAY BRIGHT", bc)];
    return null;
  }

  // DULUX — partly retired into GLOSS / SATIN / LUSTRE / SUPERCOVER /
  // SUPERCLEAN / SMOOTHOVER / DISTEMPER / PRIMER. PU ENAMEL folds into GLOSS.
  if (cat === "DULUX") {
    if (prod === "GLOSS")        return [row("GLOSS", "GLOSS", bc)];
    if (prod === "LUSTRE")       return [row("LUSTRE", "LUSTRE", bc)];
    if (prod === "SATIN STAY BRIGHT") return [row("SATIN", "SATIN STAY BRIGHT", bc)];
    if (prod === "SUPER SATIN")  return [row("SATIN", "SUPER SATIN", bc)];
    if (prod === "PU ENAMEL")    return [row("GLOSS", "GLOSS", bc)];
    if (prod === "SUPERCLEAN")   return [row("SUPERCLEAN", "SUPERCLEAN", bc)];
    if (prod === "3IN1")         return [row("SUPERCLEAN", "SUPERCLEAN 3IN1", bc)];
    if (prod === "INTERIOR DISTEMPER") return [row("DISTEMPER", "ACRYLIC DISTEMPER", bc || legacy.product)];
    if (prod === "ALKALI BLOC PRIMER") return [row("PRIMER", "ALKALI BLOC PRIMER", bc)];
    if (prod === "SMOOTHOVER")   return [row("SMOOTHOVER", "SMOOTHOVER", bc)];
    // 2-row data drift — DULUX/SUPERCOVER stragglers belong under
    // SUPERCOVER family (Phase 2 cleanup: re-categorise from DULUX to
    // SUPERCOVER in mo_sku_lookup).
    if (prod === "SUPERCOVER")   return [row("SUPERCOVER", "SUPERCOVER", bc)];
    return null;
  }

  // PROMISE ENML — cross-listed (ENAMEL + PROMISE umbrella).
  // Live data category is `PROMISE ENML`, not `PROMISE` — Phase 1 Prompt 1.6
  // fix. Kept the legacy `PROMISE`/`PROMISE ENML` form too in case any
  // backfill rows still use the older shape.
  if ((cat === "PROMISE ENML" || cat === "PROMISE") && prod === "PROMISE ENML") {
    return [
      row("PROMISE ENAMEL", "PROMISE ENAMEL", bc),
      row("PROMISE",        "PROMISE ENAMEL", bc),
    ];
  }

  // ── EXTERIORS (Round 3) ───────────────────────────────────────────────
  if (cat === "WS") {
    if (prod === "MAX")             return [row("MAX", "MAX", bc)];
    if (prod === "POWERFLEXX")      return [row("POWERFLEXX", "POWERFLEXX", bc)];
    if (prod === "PROTECT")         return [row("PROTECT", "PROTECT", bc)];
    if (prod === "PROTECT RAINPROOF") return [row("RAINPROOF", "RAINPROOF", bc)];
    if (prod === "HISHEEN")         return [row("HISHEEN", "HISHEEN", bc)];
    if (prod === "TILE")            return [row("TILE", "TILE", bc)];
    if (prod === "TEXTURE")         return [row("TEXTURE", "RUSTIC", bc || legacy.product)];
    if (prod === "WS METALLIC")     return [row("METALLIC", "METALLIC", bc)];
    return null;  // ELASTOMERIC / FLASH / PRIMA E900 / PROJECT / TR E2000 / ULTRACLEAN deferred
  }

  if (cat === "WEATHERCOAT") {
    if (prod === "MAX")             return [row("MAX", "MAX", bc)];
    if (prod === "POWERFLEXX")      return [row("POWERFLEXX", "POWERFLEXX", bc)];
    if (prod === "PROTECT")         return [row("PROTECT", "PROTECT DUSTPROOF", bc)];
    if (prod === "PROTECT RAINPROOF") return [row("RAINPROOF", "RAINPROOF", bc)];
    if (prod === "TEXTURE")         return [row("TEXTURE", "MATT", bc || legacy.product)];
    return null;
  }

  // EMULSION — only WS METALLIC migrates here per Round 3.
  if (cat === "EMULSION" && prod === "WS METALLIC") {
    return [row("METALLIC", "METALLIC", bc)];
  }

  // TEXTURE category — 2 rows of `VT VELVETINO` mis-categorised from VT.
  // Phase 2 cleanup: re-categorise from TEXTURE to VT in mo_sku_lookup.
  if (cat === "TEXTURE" && prod === "VT VELVETINO") {
    return [row("VT SPECIALTY", "VELVETINO", bc || legacy.product)];
  }

  // PROMISE family — exterior + interior + cross-list.
  if (cat === "PROMISE") {
    if (prod === "PROMISE EXTERIOR") {
      return [
        row("PROMISE EXTERIOR", "PROMISE EXTERIOR", bc),
        row("PROMISE",          "PROMISE EXTERIOR", bc),
      ];
    }
    if (prod === "PROMISE INTERIOR") {
      return [
        row("PROMISE INTERIOR", "PROMISE INTERIOR", bc),
        row("PROMISE",          "PROMISE INTERIOR", bc),
      ];
    }
    if (prod === "PROMISE SHEEN INTERIOR") {
      return [
        row("PROMISE INTERIOR", "PROMISE SHEEN INTERIOR", bc),
        row("PROMISE",          "PROMISE SHEEN INTERIOR", bc),
      ];
    }
    if (prod === "PROMISE SHEEN EXTERIOR") {
      // 4-row drift in PROMISE category — re-route to PROMISE EXTERIOR top-level.
      return [
        row("PROMISE EXTERIOR", "PROMISE SHEEN EXTERIOR", bc),
        row("PROMISE",          "PROMISE SHEEN EXTERIOR", bc),
      ];
    }
    if (prod === "PROMISE PRIMER") {
      // Triple-list: PRIMER + PROMISE INTERIOR + PROMISE umbrella.
      return [
        row("PRIMER",           "PROMISE PRIMER", bc),
        row("PROMISE INTERIOR", "PROMISE PRIMER", bc),
        row("PROMISE",          "PROMISE PRIMER", bc),
      ];
    }
    return null;
  }

  if (cat === "PROMISE SHEEN") {
    if (prod === "PROMISE SHEEN EXTERIOR") {
      return [
        row("PROMISE EXTERIOR", "PROMISE SHEEN EXTERIOR", bc),
        row("PROMISE",          "PROMISE SHEEN EXTERIOR", bc),
      ];
    }
    if (prod === "PROMISE SHEEN INTERIOR") {
      return [
        row("PROMISE INTERIOR", "PROMISE SHEEN INTERIOR", bc),
        row("PROMISE",          "PROMISE SHEEN INTERIOR", bc),
      ];
    }
    return null;
  }

  if (cat === "PROMISE SMARTCHOICE") {
    if (prod === "PROMISE SMARTCHOICE EXT") {
      return [
        row("PROMISE EXTERIOR", "PROMISE SMARTCHOICE EXT", bc),
        row("PROMISE",          "PROMISE SMARTCHOICE EXT", bc),
      ];
    }
    if (prod === "PROMISE SMARTCHOICE EXT PRIMER") {
      return [
        row("PRIMER",           "SMARTCHOICE EXT PRIMER", bc),
        row("PROMISE EXTERIOR", "PROMISE SMARTCHOICE EXT PRIMER", bc),
        row("PROMISE",          "PROMISE SMARTCHOICE EXT PRIMER", bc),
      ];
    }
    if (prod === "PROMISE SMARTCHOICE INT") {
      return [
        row("PROMISE INTERIOR", "PROMISE SMARTCHOICE INT", bc),
        row("PROMISE",          "PROMISE SMARTCHOICE INT", bc),
      ];
    }
    if (prod === "PROMISE SMARTCHOICE INT PRIMER") {
      return [
        row("PRIMER",           "SMARTCHOICE INT PRIMER", bc),
        row("PROMISE INTERIOR", "PROMISE SMARTCHOICE INT PRIMER", bc),
        row("PROMISE",          "PROMISE SMARTCHOICE INT PRIMER", bc),
      ];
    }
    if (prod === "PROMISE SMARTCHOICE ACRYLIC DISTEMPER") {
      return [
        row("DISTEMPER",        "ACRYLIC DISTEMPER", bc),
        row("PROMISE INTERIOR", "PROMISE SMARTCHOICE ACRYLIC DISTEMPER", bc),
        row("PROMISE",          "PROMISE SMARTCHOICE ACRYLIC DISTEMPER", bc),
      ];
    }
    return null;
  }

  // ── INTERIORS Round 4A ────────────────────────────────────────────────
  if (cat === "SUPERCOVER") {
    if (prod === "SUPERCOVER")            return [row("SUPERCOVER", "SUPERCOVER", bc)];
    if (prod === "SUPERCOVER SHEEN")      return [row("SUPERCOVER", "SUPERCOVER SHEEN", bc)];
    if (prod === "SUPERCOVER ULTRA")      return [row("SUPERCOVER", "SUPERCOVER ULTRA", bc)];
    return null;
  }

  if (cat === "SUPERCLEAN") {
    if (prod === "SUPERCLEAN")  return [row("SUPERCLEAN", "SUPERCLEAN", bc)];
    if (prod === "3IN1")        return [row("SUPERCLEAN", "SUPERCLEAN 3IN1", bc)];
    return null;
  }

  if (cat === "VT") {
    if (prod === "PEARL GLO")        return [row("VELVET TOUCH", "PEARL GLO", bc)];
    if (prod === "PLATINUM GLO")     return [row("VELVET TOUCH", "PLATINUM GLO", bc)];
    if (prod === "DIAMOND GLO")      return [row("VELVET TOUCH", "DIAMOND GLO", bc)];
    if (prod === "ETERNA")           return [row("VELVET TOUCH", "ETERNA", bc)];
    if (prod === "ETERNA MATT")      return [row("VELVET TOUCH", "ETERNA MATT", bc)];
    if (prod === "ETERNA HI-SHEEN")  return [row("VELVET TOUCH", "ETERNA HI-SHEEN", bc)];
    if (prod === "ETERNA BASECOAT")  return [row("VELVET TOUCH", "ETERNA BASECOAT", bc)];
    if (prod === "VAF")              return [row("VT SPECIALTY", "VAF", bc)];
    if (prod === "VT FIN")           return [row("VT SPECIALTY", "VT FIN", bc)];
    if (prod === "LUXURY FINISHES")  return [row("VT SPECIALTY", "LUXURY FINISHES", bc)];
    if (prod === "VT METALLICS")     return [row("VT SPECIALTY", "VT METALLICS", bc)];
    if (prod === "VT CLEAR COAT")    return [row("VT SPECIALTY", "VT CLEAR COAT", bc)];
    if (prod === "VT MARBLE")        return [row("VT SPECIALTY", "VT MARBLE", bc)];
    if (prod === "VT VELVETINO" || prod === "VELVETINO") return [row("VT SPECIALTY", "VELVETINO", bc)];
    if (prod === "VT CONCRETE FINISH" || prod === "VT FINISH" || prod.includes("CONCRETE"))
                                     return [row("VT SPECIALTY", "VT CONCRETE FINISH", bc)];
    if (prod === "AMBIANCE")         return [row("VT SPECIALTY", "AMBIANCE", bc)];
    return null;
  }

  // ── UTILITY (Round 4C) ────────────────────────────────────────────────

  if (cat === "AQUATECH") {
    if (prod === "WATERPROOF PUTTY") return [row("PUTTY", "WATERPROOF PUTTY", bc)];
    // All other AQUATECH products preserved under AQUATECH family with
    // their existing product name as the sub-product.
    return [row("AQUATECH", legacy.product.trim().toUpperCase(), bc)];
  }

  if (cat === "FLOOR PLUS")            return [row("FLOOR PLUS", "FLOOR PLUS", bc)];

  if (cat === "DUWEL") {
    if (prod === "DUWEL WOOD PRIMER" || prod === "DUWEL FARCO WHITE PRIMER")
                                       return [row("PRIMER", "WOOD PRIMER", bc)];
    if (prod === "DUWEL RED OXIDE METAL PRIMER")
                                       return [row("PRIMER", "RED OXIDE METAL PRIMER", bc)];
    if (prod === "DUWEL WB CEMENT PRIMER")
                                       return [row("PRIMER", "CEMENT PRIMER WB", bc)];
    if (prod === "ICI DUWEL SB CEMENT PRIMER" || prod === "IP DUWEL SB CEMENT PRIMER" || prod === "DUWEL SB CEMENT PRIMER")
                                       return [row("PRIMER", "CEMENT PRIMER SB", bc)];
    if (prod === "DUWEL INTERIOR ACRYLIC PRIMER")
                                       return [row("PRIMER", "INTERIOR ACRYLIC PRIMER", bc)];
    if (prod === "DUWEL ACRYLIC DISTEMPER")
                                       return [row("DISTEMPER", "ACRYLIC DISTEMPER", bc || legacy.product)];
    if (prod === "DUWEL MAGIK")        return [row("DISTEMPER", "MAGIK", bc || legacy.product)];
    if (prod === "DUWEL POLYPUTTY")    return [row("PUTTY", "POLYPUTTY", bc || legacy.product)];
    return null;
  }

  if (cat === "PRIMER") {
    if (prod === "PROMISE FREEDOM 2IN1") {
      return [
        row("PRIMER",           "2IN1 INTERIOR-EXTERIOR PRIMER", bc),
        row("PROMISE INTERIOR", "PROMISE FREEDOM 2IN1 PRIMER", bc),
        row("PROMISE",          "PROMISE FREEDOM 2IN1 PRIMER", bc),
      ];
    }
    if (prod === "PROMISE 2IN1") {
      return [
        row("PRIMER",           "2IN1 INTERIOR-EXTERIOR PRIMER", bc),
        row("PROMISE INTERIOR", "PROMISE FREEDOM 2IN1 PRIMER", bc),
        row("PROMISE",          "PROMISE FREEDOM 2IN1 PRIMER", bc),
      ];
    }
    if (prod === "PROMISE PRIMER") {
      return [
        row("PRIMER",           "PROMISE PRIMER", bc),
        row("PROMISE INTERIOR", "PROMISE PRIMER", bc),
        row("PROMISE",          "PROMISE PRIMER", bc),
      ];
    }
    if (prod === "ZINC YELLOW METAL PRIMER")
                                       return [row("PRIMER", "ZINC YELLOW METAL PRIMER", bc)];
    if (prod === "DULUX WB CEMENT PRIMER")
                                       return [row("PRIMER", "CEMENT PRIMER WB", bc)];
    if (prod === "SB CEMENT PRIMER")   return [row("PRIMER", "CEMENT PRIMER SB", bc)];
    if (prod === "EXTERIOR ACRYLIC PRIMER")
                                       return [row("PRIMER", "EXTERIOR ACRYLIC PRIMER", bc)];
    if (prod === "ALKALI BLOC PRIMER") return [row("PRIMER", "ALKALI BLOC PRIMER", bc)];
    if (prod === "ROM")                return [row("PRIMER", "QUICK DRYING PRIMER", bc)];
    return null;
  }

  if (cat === "PUTTY") {
    if (prod === "ACRYLIC PUTTY")      return [row("PUTTY", "ACRYLIC PUTTY", bc || legacy.product)];
    return null;
  }

  // STAINER — collapse 10 colour-shade sub-products into UNIVERSAL STAINER
  // with colour as baseColour. legacy.product carries the colour name.
  if (cat === "STAINER") {
    const colour = legacy.product.trim();
    return [row("STAINER", "UNIVERSAL STAINER", colour)];
  }

  // TINTER — split into PU STAINER (GVA), ACOTONE TINTER, MACHINE TINTER.
  // Phase 1 Prompt 1.6 found that the live `product` column carries the
  // tinter code itself (BLK, BU1, NO1, etc.), not the system family. Regex
  // dispatch on shape:
  //   - GVA literal                     → PU STAINER
  //   - 2 letters + 1 digit (BU1, NO1…) → ACOTONE TINTER (14 codes)
  //   - 3 letters (BLK, GRN, YOX…)      → MACHINE TINTER (9 codes)
  // baseColour preserves the legacy.baseColour or falls back to the code
  // (so each code becomes a distinct row under (family, subProduct,
  // baseColour); a null fallback would collapse them into one and trip
  // the @@unique constraint).
  if (cat === "TINTER") {
    if (prod === "GVA")                  return [row("STAINER", "PU STAINER",     legacy.baseColour || legacy.product)];
    if (/^[A-Z]{2}[0-9]$/.test(prod))    return [row("STAINER", "ACOTONE TINTER", legacy.baseColour || legacy.product)];
    if (/^[A-Z]{3}$/.test(prod))         return [row("STAINER", "MACHINE TINTER", legacy.baseColour || legacy.product)];
    // Legacy aggregate-name fallbacks (kept for safety; not seen in live data).
    if (prod === "ACOTONE")              return [row("STAINER", "ACOTONE TINTER", legacy.baseColour || legacy.product)];
    if (prod === "DEALER" || prod === "MACHINE TINTER" || prod === "JSW DEALER")
                                         return [row("STAINER", "MACHINE TINTER", legacy.baseColour || legacy.product)];
    return null;
  }

  // OTHER — only HP COLORANT migrates.
  if (cat === "OTHER" && prod === "COLORANT") {
    return [row("STAINER", "HP COLORANT", legacy.baseColour || legacy.product)];
  }

  // No rule found — script will tag as warning.
  return null;
}
