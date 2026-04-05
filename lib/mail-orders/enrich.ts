// ─────────────────────────────────────────────
// Mail Order Enrichment Engine — try-and-verify
// ─────────────────────────────────────────────

export interface ProductKeyword {
  keyword: string;   // already UPPERCASED
  category: string;
  product: string;
}

export interface BaseKeyword {
  keyword: string;   // already UPPERCASED
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

function resolvedPackCode(sku: SkuEntry): string {
  const unit = (sku.unit ?? "").toUpperCase().trim();
  if (unit === "ML") return `${sku.packCode}ML`;
  return sku.packCode;
}

/* ── SKU index maps ────────────────────────────────────────── */

export function buildSkuMaps(skus: SkuEntry[]) {
  const byCombo = new Map<string, SkuEntry>();
  const byMaterial = new Map<string, SkuEntry>();

  for (const s of skus) {
    const key = `${s.product}|${s.baseColour}|${s.packCode}`;
    if (!byCombo.has(key)) byCombo.set(key, s);
    byMaterial.set(s.material, s);
  }

  return { byCombo, byMaterial };
}

/* ── Find all matching base colours in text ────────────────── */

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

/* ── Strip separators from edges ───────────────────────────── */

const SEPARATOR_RE = /^[\s\-:.,/\\]+|[\s\-:.,/\\]+$/g;

function stripEdgeSeparators(s: string): string {
  return s.replace(SEPARATOR_RE, "");
}

/* ── Core enrichment algorithm ─────────────────────────────── */

export function enrichLine(
  rawText: string,
  packCode: string,
  productKeywords: ProductKeyword[],
  baseKeywords: BaseKeyword[],
  skuByCombo: Map<string, SkuEntry>,
  skuByMaterial: Map<string, SkuEntry>,
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

  // ── Step 1: Direct material code lookup ──────────────────
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

  // ── Step 2: Clean pack code ──────────────────────────────
  let cleanPack = (packCode ?? "").toUpperCase().replace(/\s+/g, "");
  cleanPack = cleanPack.replace(/(ML|LTR|LT|KG|LITT|G|L)$/i, "");
  const packsToTry = cleanPack ? [cleanPack] : ["1"];

  // ── Step 3: Find ALL matching product keywords ───────────
  interface Candidate {
    product: string;
    category: string;
    keyword: string;
    remaining: string;
  }

  const seen = new Set<string>();
  const candidates: Candidate[] = [];

  for (const pk of productKeywords) {
    if (!text.includes(pk.keyword)) continue;
    const dedup = `${pk.product}|${pk.keyword}`;
    if (seen.has(dedup)) continue;
    seen.add(dedup);

    const remaining = stripEdgeSeparators(text.replace(pk.keyword, "").trim());
    candidates.push({
      product: pk.product,
      category: pk.category,
      keyword: pk.keyword,
      remaining,
    });
  }

  // ── Step 4: Try each candidate × base × pack ────────────
  for (const c of candidates) {
    // a/b: find bases from remaining text, or from product name if remaining is empty
    let bases: string[];
    if (c.remaining) {
      bases = findAllBases(c.remaining, baseKeywords);
    } else {
      bases = findAllBases(c.product.toUpperCase(), baseKeywords);
    }

    // c: always append empty base as last option
    // d: deduplicate while preserving order
    const basesToTry: string[] = [];
    const baseSeen = new Set<string>();
    for (const b of bases) {
      if (!baseSeen.has(b)) {
        baseSeen.add(b);
        basesToTry.push(b);
      }
    }
    if (!baseSeen.has("")) {
      basesToTry.push("");
    }

    // e: try every base × pack combo
    for (const base of basesToTry) {
      for (const pack of packsToTry) {
        const key = `${c.product}|${base}|${pack}`;
        const sku = skuByCombo.get(key);
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
      }
    }
  }

  // ── Step 5: Partial match fallback ───────────────────────
  if (candidates.length > 0) {
    const first = candidates[0];
    const bases = first.remaining
      ? findAllBases(first.remaining, baseKeywords)
      : findAllBases(first.product.toUpperCase(), baseKeywords);

    return {
      productName: first.product,
      baseColour: bases[0] ?? "",
      skuCode: "",
      skuDescription: "",
      refSkuCode: "",
      paintType: "",
      materialType: "",
      packCode: "",
      matchStatus: "partial",
    };
  }

  // ── Step 6: Unmatched ────────────────────────────────────
  return EMPTY;
}
