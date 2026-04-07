// ─────────────────────────────────────────────────────────
// Mail Order Enrichment Engine v2 — full-text scoring
// ─────────────────────────────────────────────────────────
// Architecture: generate → verify → rank
// 1. Find all product keywords in FULL text (no stripping)
// 2. Find all base keywords in FULL text (parallel, not sequential)
// 3. Classify each product (DIRECT/FIXED/NUMBERED/COLOUR)
// 4. Generate all valid (product × base × pack) candidates
// 5. Verify each against SKU table
// 6. Score by keyword coverage + strategy confidence
// 7. Highest score wins; ties → partial for manual resolution
// ─────────────────────────────────────────────────────────

export interface ProductKeyword {
  keyword: string; // already UPPERCASED
  category: string;
  product: string;
}

export interface BaseKeyword {
  keyword: string; // already UPPERCASED
  category: string;
  baseColour: string;
}

export interface SkuEntry {
  material: string;
  description: string;
  category: string;
  product: string;
  baseColour: string;
  packCode: string;
  unit: string | null;
  refMaterial: string | null;
  paintType: string | null;
  materialType: string | null;
}

export interface EnrichResult {
  productName: string;
  baseColour: string;
  skuCode: string;
  skuDescription: string;
  refSkuCode: string;
  paintType: string;
  materialType: string;
  packCode: string;
  matchStatus: "matched" | "partial" | "unmatched";
}

/* ── Helpers ───────────────────────────────────────────────── */

function resolvedPackCode(sku: SkuEntry): string {
  const unit = (sku.unit ?? "").toUpperCase().trim();
  if (unit === "ML") return `${sku.packCode}ML`;
  return sku.packCode;
}

/** Product base resolution strategy */
type BaseStrategy = "DIRECT" | "FIXED" | "NUMBERED" | "COLOUR";

/** Product profile: precomputed from SKU table */
interface ProductProfile {
  bases: Set<string>;
  packs: Set<string>;
  strategy: BaseStrategy;
  isBaseProduct: boolean; // product name IS a base colour (e.g. BLACK stainer)
}

/** Internal scored candidate */
interface ScoredCandidate {
  product: string;
  base: string;
  pack: string;
  sku: SkuEntry;
  altSku: SkuEntry | null;
  score: number;
  prodKwLen: number;
  isFallback: boolean;
}

/* ── Pack rounding: fractional → standard ──────────────────── */

const PACK_ROUND: Record<string, string> = {
  "0.925": "1",
  "0.9": "1",
  "0.975": "1",
  "3.6": "4",
  "3.7": "4",
  "9": "10",
  "9.25": "10",
  "18": "20",
  "18.5": "20",
};

/** Reverse: standard → fractional equivalents to also try */
const PACK_EXPAND: Record<string, string[]> = {
  "1": ["2", "0.925", "0.9", "0.975"],
  "2": ["1"],
  "4": ["3.6", "3.7"],
  "10": ["9", "9.25"],
  "20": ["18", "18.5"],
};

/* ── Category keywords: generic terms that don't identify
     a specific product (STAINER, TINTER, FAST, etc.) ────── */

const CATEGORY_KEYWORDS = new Set([
  "STAINER",
  "UNIVERSAL STAINER",
  "UNIVERSAL STAINER FAST",
  "MACHINE STAINER",
  "MACHINE TINTER",
  "MACHINE TINTERS",
  "MACHINE",
  "TINTER",
  "FAST",
]);

const FALLBACK_BASES = ["BRILLIANT WHITE", "ADVANCE"];

const NUMBERED_BASE_RE = /\b(9[0-8])\b/;

/* ── SKU index maps (enhanced for v2) ─────────────────────── */

export function buildSkuMaps(skus: SkuEntry[]) {
  const byCombo = new Map<string, SkuEntry>();
  const byComboAlt = new Map<string, SkuEntry>(); // alternate SKU for same combo
  const byMaterial = new Map<string, SkuEntry>();

  for (const s of skus) {
    const key = `${s.product}|${s.baseColour}|${s.packCode}`;
    if (!byCombo.has(key)) {
      byCombo.set(key, s);
    } else if (!byComboAlt.has(key)) {
      byComboAlt.set(key, s);
    }
    byMaterial.set(s.material, s);
  }

  return { byCombo, byComboAlt, byMaterial };
}

/* ── Build product profiles (call once per import batch) ───── */

export function buildProductProfiles(
  skus: SkuEntry[],
  productKeywords: ProductKeyword[],
  baseKeywords: BaseKeyword[],
): Map<string, ProductProfile> {
  const profiles = new Map<string, ProductProfile>();

  // Collect bases and packs per product
  for (const s of skus) {
    let p = profiles.get(s.product);
    if (!p) {
      p = {
        bases: new Set<string>(),
        packs: new Set<string>(),
        strategy: "DIRECT",
        isBaseProduct: false,
      };
      profiles.set(s.product, p);
    }
    p.bases.add(s.baseColour ?? "");
    p.packs.add(s.packCode);
  }

  // All known base colour values
  const allBaseColours = new Set<string>();
  for (const bk of baseKeywords) allBaseColours.add(bk.baseColour);

  // All product keyword texts (for cross-check)
  const prodKwTexts = new Set<string>();
  for (const pk of productKeywords) prodKwTexts.add(pk.keyword);

  // Classify each product
  for (const [prodName, profile] of Array.from(profiles.entries())) {
    const bases = profile.bases;

    // Single empty base → DIRECT (primer, thinner, clear, etc.)
    if (bases.size === 1 && bases.has("")) {
      profile.strategy = "DIRECT";
    }
    // Single non-empty base → FIXED
    else if (bases.size === 1) {
      profile.strategy = "FIXED";
    } else {
      // Check if any base is a named colour (not numbered, not BW/ADVANCE/BASECOAT)
      let hasNamedBase = false;
      for (const b of Array.from(bases)) {
        if (
          b &&
          !/^9[0-8]/.test(b) &&
          b !== "BRILLIANT WHITE" &&
          b !== "ADVANCE" &&
          b !== "BASECOAT" &&
          b !== "NEO"
        ) {
          hasNamedBase = true;
          break;
        }
      }
      profile.strategy = hasNamedBase ? "COLOUR" : "NUMBERED";
    }

    // Check if this product's name IS a base colour
    // (e.g. product BLACK with base BLACK, product FAST RED with base RED)
    if (bases.size === 1) {
      const theBase = Array.from(bases)[0];
      if (theBase && allBaseColours.has(theBase)) {
        // Check if any product keyword for this product matches a base keyword
        for (const pk of productKeywords) {
          if (pk.product !== prodName) continue;
          for (const bk of baseKeywords) {
            if (pk.keyword === bk.keyword) {
              profile.isBaseProduct = true;
              break;
            }
          }
          if (profile.isBaseProduct) break;
        }
      }
    }
  }

  return profiles;
}

/* ── Core enrichment algorithm v2 ─────────────────────────── */

export function enrichLine(
  rawText: string,
  packCode: string,
  productKeywords: ProductKeyword[],
  baseKeywords: BaseKeyword[],
  skuByCombo: Map<string, SkuEntry>,
  skuByMaterial: Map<string, SkuEntry>,
  // v2 additions — optional for backward compatibility
  skuByComboAlt?: Map<string, SkuEntry>,
  productProfiles?: Map<string, ProductProfile>,
): EnrichResult {
  const EMPTY: EnrichResult = {
    productName: "",
    baseColour: "",
    skuCode: "",
    skuDescription: "",
    refSkuCode: "",
    paintType: "",
    materialType: "",
    packCode: "",
    matchStatus: "unmatched",
  };

  if (!rawText || !rawText.trim()) return EMPTY;

  const text = rawText.trim().toUpperCase();

  // ── Step 1: Direct material code lookup (unchanged) ──────
  const noWs = text.replace(/\s+/g, "");
  if (/^(IN)?\d{5,10}$/.test(noWs)) {
    const sku = skuByMaterial.get(noWs);
    if (sku) {
      return {
        productName: sku.product,
        baseColour: sku.baseColour,
        skuCode: sku.material,
        skuDescription: sku.description,
        refSkuCode: sku.refMaterial ?? "",
        paintType: sku.paintType ?? "",
        materialType: sku.materialType ?? "",
        packCode: resolvedPackCode(sku),
        matchStatus: "matched",
      };
    }
    return {
      ...EMPTY,
      skuDescription: `Unknown material code: ${noWs}`,
    };
  }

  // ── Step 2: Clean pack code + build packs to try ─────────
  let cleanPack = (packCode ?? "").toUpperCase().replace(/\s+/g, "");
  cleanPack = cleanPack.replace(/(ML|LTR|LT|KG|LITT|G|L)$/i, "");
  if (!cleanPack) cleanPack = "1";

  // Round fractional packs to standard
  if (PACK_ROUND[cleanPack]) cleanPack = PACK_ROUND[cleanPack];

  // Build packs to try: primary + fallback equivalents
  const packsToTry = [cleanPack];
  const expansions = PACK_EXPAND[cleanPack];
  if (expansions) {
    for (const alt of expansions) {
      if (!packsToTry.includes(alt)) packsToTry.push(alt);
    }
  }

  // ── Step 3: Find ALL product keywords in FULL text ───────
  const prodMatches: { keyword: string; product: string; len: number }[] = [];
  const seenProdKw = new Set<string>();

  for (const pk of productKeywords) {
    if (!text.includes(pk.keyword)) continue;
    const dedup = `${pk.product}|${pk.keyword}`;
    if (seenProdKw.has(dedup)) continue;
    seenProdKw.add(dedup);
    prodMatches.push({
      keyword: pk.keyword,
      product: pk.product,
      len: pk.keyword.length,
    });
  }

  if (prodMatches.length === 0) return EMPTY;

  // ── Step 4: Find ALL base keywords in FULL text ──────────
  const detectedBases: { keyword: string; baseColour: string; len: number }[] =
    [];
  const seenBase = new Set<string>();

  for (const bk of baseKeywords) {
    if (text.includes(bk.keyword) && !seenBase.has(bk.baseColour)) {
      seenBase.add(bk.baseColour);
      detectedBases.push({
        keyword: bk.keyword,
        baseColour: bk.baseColour,
        len: bk.keyword.length,
      });
    }
  }

  // Also detect numbered base via regex (catches "90BASE" etc.)
  const numMatch = NUMBERED_BASE_RE.exec(text);
  const numberedBase = numMatch ? `${numMatch[1]} BASE` : null;

  // ── Step 5: Generate & score all valid candidates ────────
  const candidates: ScoredCandidate[] = [];

  for (const pm of prodMatches) {
    const profile = productProfiles?.get(pm.product);
    if (!profile) continue;

    const strategy = profile.strategy;
    const validBases = profile.bases;
    const isCategoryKw = CATEGORY_KEYWORDS.has(pm.keyword);

    // Determine which bases to try based on product strategy
    const basesToTry: string[] = [];

    if (strategy === "DIRECT") {
      basesToTry.push("");
    } else if (strategy === "FIXED") {
      for (const b of Array.from(validBases)) basesToTry.push(b);
    } else if (strategy === "NUMBERED") {
      // Detected base keywords first (authoritative)
      for (const db of detectedBases) {
        if (validBases.has(db.baseColour) && !basesToTry.includes(db.baseColour)) {
          basesToTry.push(db.baseColour);
        }
      }
      // Regex-detected numbered base (backup for "90 BASE" with space)
      if (numberedBase && validBases.has(numberedBase) && !basesToTry.includes(numberedBase)) {
        basesToTry.push(numberedBase);
      }
      // BW fallback
      if (validBases.has("BRILLIANT WHITE") && !basesToTry.includes("BRILLIANT WHITE")) {
        basesToTry.push("BRILLIANT WHITE");
      }
      if (validBases.has("") && !basesToTry.includes("")) {
        basesToTry.push("");
      }
    } else {
      // COLOUR strategy
      for (const db of detectedBases) {
        if (validBases.has(db.baseColour) && !basesToTry.includes(db.baseColour)) {
          basesToTry.push(db.baseColour);
        }
      }
      for (const fb of FALLBACK_BASES) {
        if (validBases.has(fb) && !basesToTry.includes(fb)) {
          basesToTry.push(fb);
        }
      }
      if (validBases.has("") && !basesToTry.includes("")) {
        basesToTry.push("");
      }
    }

    // Try each base × pack against SKU table
    for (const base of basesToTry) {
      for (const pack of packsToTry) {
        const key = `${pm.product}|${base}|${pack}`;
        const sku = skuByCombo.get(key);
        if (!sku) continue;

        // ── SCORING ──
        let score = pm.len; // product keyword length

        // Base keyword score — only add if base was detected AND
        // this product is NOT a "colour-as-product" (avoids double-counting)
        let baseDetected = false;
        for (const db of detectedBases) {
          if (db.baseColour === base) {
            baseDetected = true;
            if (!profile.isBaseProduct) {
              score += db.len;
            }
            break;
          }
        }

        // Numbered base detection bonus
        const isNumbered = numberedBase !== null && base === numberedBase;
        if (isNumbered && !baseDetected) score += 2;

        // Is this a fallback base (not detected, not numbered)?
        const isFallback =
          !baseDetected &&
          !isNumbered &&
          (strategy === "COLOUR" || strategy === "NUMBERED");

        // Strategy confidence bonus
        if (strategy === "DIRECT") {
          score += 3;
        } else if (strategy === "FIXED" && !profile.isBaseProduct) {
          score += 2;
        } else if ((baseDetected || isNumbered) && strategy === "NUMBERED") {
          score += 1;
        } else if (isFallback) {
          score -= 1;
        }

        // Category keyword penalty
        if (isCategoryKw) score -= 2;

        // Alt SKU for same combo (for Deepanshu signal)
        const altSku = skuByComboAlt?.get(key) ?? null;

        candidates.push({
          product: pm.product,
          base,
          pack,
          sku,
          altSku,
          score,
          prodKwLen: pm.len,
          isFallback,
        });
      }
    }
  }

  // ── Step 6: Rank and select winner ───────────────────────
  if (candidates.length === 0) {
    // Product matched but no valid SKU found → partial
    const best = prodMatches.reduce((a, b) => (a.len > b.len ? a : b));

    // Try to find a base for the partial result
    let partialBase = "";
    for (const db of detectedBases) {
      partialBase = db.baseColour;
      break;
    }

    return {
      productName: best.product,
      baseColour: partialBase,
      skuCode: "",
      skuDescription: "",
      refSkuCode: "",
      paintType: "",
      materialType: "",
      packCode: "",
      matchStatus: "partial",
    };
  }

  // Sort: score DESC → prefer non-fallback → prefer longer product keyword
  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.isFallback !== b.isFallback) return a.isFallback ? 1 : -1;
    return b.prodKwLen - a.prodKwLen;
  });

  const top = candidates[0];

  // Check for tie: second candidate has same score but different SKU
  if (
    candidates.length > 1 &&
    candidates[1].score === top.score &&
    candidates[1].sku.material !== top.sku.material
  ) {
    // Tie → partial, let Deepanshu resolve
    return {
      productName: top.product,
      baseColour: top.base,
      skuCode: "",
      skuDescription: "",
      refSkuCode: "",
      paintType: "",
      materialType: "",
      packCode: "",
      matchStatus: "partial",
    };
  }

  // Clear winner
  return {
    productName: top.sku.product,
    baseColour: top.sku.baseColour,
    skuCode: top.sku.material,
    skuDescription: top.sku.description,
    refSkuCode: top.sku.refMaterial ?? "",
    paintType: top.sku.paintType ?? "",
    materialType: top.sku.materialType ?? "",
    packCode: resolvedPackCode(top.sku),
    matchStatus: "matched",
  };
}

/* ── Legacy exports (keep for backward compat) ─────────────── */

export function findAllBases(
  text: string,
  baseKeywords: BaseKeyword[],
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const bk of baseKeywords) {
    if (text.includes(bk.keyword) && !seen.has(bk.baseColour)) {
      seen.add(bk.baseColour);
      result.push(bk.baseColour);
    }
  }
  return result;
}
