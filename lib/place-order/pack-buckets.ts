// Pack-bucket mapping for /place-order's variant-grid column header.
//
// Phase 3.5 taxonomy refinement (2026-05-13). Replaces the previous
// "every distinct packCode is a column" behaviour with a fixed bucket
// system so the grid header reads "1L · 4L · 10L · 20L" instead of
// "1L · 900ML · 3.6L · 4L · 9L · 10L · 18L · 20L". Real SAP pack info
// still rides on the cart line and the email body — buckets are
// presentation-only.
//
// Mapping rules: KG ≤ 20 collapses into the nearest L bucket (5 KG → 4 L);
// KG > 20 lives in its own column (25 KG, 30 KG, 40 KG). LT is an alias
// for L throughout. GM and sub-litre KG slots are catch-alls into the
// 500 ML "small" column.

export interface RawPack {
  packCode: string;        // bare numeric string from mo_sku_lookup_v2.packCode
  unit:     string | null; // mo_sku_lookup_v2.unit — "ML" | "L" | "LT" | "KG" | "GM" | null
}

export const STANDARD_COLUMNS = [
  "50ML",
  "100ML",
  "200ML",
  "500ML",
  "1L",
  "4L",
  "10L",
  "20L",
  // DISTEMPER KG columns (2026-06-12) — own KG buckets so distemper's 1/2/5/10/20 KG
  // render as distinct KG-labelled columns instead of colliding (1KG+2KG → "1L") or
  // mislabelling (5/10/20 KG under litre headers). Rendered ONLY for DISTEMPER (routed
  // via FAMILY_BUCKET_OVERRIDES); the global PACK_TO_BUCKET still folds these KG sizes
  // into litre buckets for every other family (Aquatech/Putty/Sadolin/VT Specialty/
  // Promise), so no other grid changes. Columns are derived-from-present-packs
  // (bucketColumnsForTab filters to present buckets), so these never show empty.
  "1KG",
  "2KG",
  "5KG",
  "10KG",
  "15KG",
  "20KG",
  "25KG",
  "30KG",
  "40KG",
  // Tools — pieces sold by the box. Disjoint from every paint pack; each Tools
  // tab surfaces exactly one of these. "1 pc · box of 25" / "box of 12".
  "25PC",
  "12PC",
] as const;

export type BucketColumn = (typeof STANDARD_COLUMNS)[number];

// Explicit lookup table keyed by `${packCode}${normalizedUnit}` where
// normalizedUnit collapses LT→L. Every entry seen in mo_sku_lookup_v2
// today is enumerated here so an audit of column placement is a single
// file read. New units/packCodes return null and console.warn at the
// caller — surfaces unmapped data without crashing.
const PACK_TO_BUCKET: Record<string, BucketColumn> = {
  // 50 ML
  "50ML":   "50ML",

  // 100 ML — 90 ML rounds up
  "90ML":   "100ML",
  "100ML":  "100ML",

  // 200 ML
  "200ML":  "200ML",

  // 500 ML — small catch-all swallows 0.2 LT, 0.5 KG, 400/500 GM
  "250ML":  "500ML",
  "400ML":  "500ML",
  "500ML":  "500ML",
  "0.2L":   "500ML",
  "0.5KG":  "500ML",
  "400GM":  "500ML",   // 2026-06-04 — Aquatech Crackfiller 5mm 400 GM
  "500GM":  "500ML",

  // 1 L — 900/925 ML round up; 1 KG / 2 KG live here per ops rule
  "900ML":  "1L",
  "925ML":  "1L",
  "0.9L":   "1L",
  "0.925L": "1L",
  "0.975L": "1L",
  "1L":     "1L",
  "1KG":    "1L",
  "2KG":    "1L",

  // 4 L — 3.6/3.7 + 5 L + 3/5 KG collapse here
  "3.6L":   "4L",
  "3.7L":   "4L",
  "4L":     "4L",
  "5L":     "4L",
  "3KG":    "4L",   // 2026-06-04 — Aquatech Waterblock 2K 3 KG
  "5KG":    "4L",

  // 10 L
  "9L":     "10L",
  "9.25L":  "10L",
  "10L":    "10L",
  "10KG":   "10L",
  "11KG":   "10L",

  // 20 L
  "15L":    "20L",
  "15KG":   "20L",   // 2026-06-04 — Aquatech Waterblock 2K + VT Concrete Finish 15 KG
  "18L":    "20L",
  "18.5L":  "20L",
  "19L":    "20L",
  "20L":    "20L",
  "20KG":   "20L",
  "22L":    "20L",

  // Dedicated KG columns (≥ 25 KG). 25 L / 30 L / 40 L also land here
  // — they're functionally drums in this catalog.
  "25L":    "25KG",
  "25KG":   "25KG",
  "30L":    "30KG",
  "30KG":   "30KG",
  "40L":    "40KG",
  "40KG":   "40KG",

  // Tools — lookupKey == bucket so packNeedsHint stays false (no stray hint).
  // Carton size rides packCode ("25"/"12"); rendered "1 pc" via bucketDisplayLabel.
  "25PC":   "25PC",
  "12PC":   "12PC",
};

// Family-scoped bucket overrides (2026-06-04). Checked BEFORE the global
// PACK_TO_BUCKET so a single family can re-route a pack key without touching
// the shared table or any other family. Keyed by family → lookupKey → bucket.
//
// AQUATECH: collapse 25 KG into the 20 L column (PU Coat 25 KG drum) so the
// Aquatech tabs don't sprout a dedicated 25 KG column. Every OTHER family that
// carries 25 KG (TEXTURE/Rustic, VT Concrete Finish) keeps the global
// "25KG" → "25KG" own-column mapping untouched.
const FAMILY_BUCKET_OVERRIDES: Record<string, Record<string, BucketColumn>> = {
  AQUATECH: { "25KG": "20L" },
  // DISTEMPER (2026-06-12) is an all-KG family sold per bag. Route its 1/2/5/10/20 KG
  // to their OWN KG columns instead of the shared litre buckets, so 1KG and 2KG stop
  // colliding in "1L" and 5/10/20 KG stop rendering under litre headers. Scoped here
  // so the other KG-carrying families (Aquatech/Sadolin/VT Specialty/Promise),
  // which deliberately fold KG into litre via the global map, are unaffected.
  DISTEMPER: { "1KG": "1KG", "2KG": "2KG", "5KG": "5KG", "10KG": "10KG", "20KG": "20KG" },
  // PUTTY (2026-06-12) is an all-KG family. Acrylic Putty 1/5/20 KG would fold into
  // 1L/4L/20L via the global map — override to own KG columns. 40 KG (PolyPutty)
  // already maps to its own 40KG column globally; listed for explicitness.
  PUTTY: { "1KG": "1KG", "5KG": "5KG", "20KG": "20KG", "40KG": "40KG" },
  // TEXTURE (2026-06-12) carries 25/30 KG. The global map already routes 25/30 KG to
  // their own columns; listed here so the family's KG intent is explicit and local.
  TEXTURE: { "25KG": "25KG", "30KG": "30KG" },
  // VT SPECIALTY (2026-06-13) mixes 1L liquids (VAF/Velvetino/Clear Coat → global 1L)
  // with KG solids: VAF Marble 1KG, VT Marble 5KG, VT Concrete Finish 5/10/15/25 KG.
  // Route those KG sizes to OWN columns (global would fold 1KG→1L, 5KG→4L, 10KG→10L,
  // 15KG→20L). 25KG already maps to its own column globally; listed for explicitness.
  // Scoped here so Aquatech's 15 KG (Waterblock) keeps folding to 20L via the global map.
  "VT SPECIALTY": { "1KG": "1KG", "5KG": "5KG", "10KG": "10KG", "15KG": "15KG", "25KG": "25KG" },
};

/** Normalises LT → L. Other units pass through (KG, ML, GM stay). */
function normaliseUnit(unit: string | null | undefined): string {
  const u = (unit ?? "").toUpperCase();
  if (u === "LT") return "L";
  return u;
}

/** Lookup key used by both PACK_TO_BUCKET and packNeedsHint. */
function lookupKey(pack: RawPack): string {
  return `${pack.packCode}${normaliseUnit(pack.unit)}`;
}

/**
 * Map a raw SAP pack to its bucket column. When `family` is supplied and a
 * FAMILY_BUCKET_OVERRIDES entry exists for (family, lookupKey), that wins;
 * otherwise falls back to the global PACK_TO_BUCKET. Returns null for packs
 * not in either table — caller should console.warn and skip.
 */
export function packToBucket(pack: RawPack, family?: string | null): BucketColumn | null {
  const key = lookupKey(pack);
  if (family) {
    const override = FAMILY_BUCKET_OVERRIDES[family]?.[key];
    if (override) return override;
  }
  return PACK_TO_BUCKET[key] ?? null;
}

/**
 * Bucket columns for a tab, ordered per STANDARD_COLUMNS. Excludes
 * columns that no SKU in the tab maps to. `family` threads through to
 * packToBucket so family-scoped overrides shape the column set.
 */
export function bucketColumnsForTab(packs: RawPack[], family?: string | null): BucketColumn[] {
  const present = new Set<BucketColumn>();
  for (const p of packs) {
    const b = packToBucket(p, family);
    if (b) present.add(b);
  }
  return STANDARD_COLUMNS.filter((c) => present.has(c));
}

/**
 * Bucket columns for a tab whose rows may span MORE THAN ONE family (e.g. the
 * "Texture & Putty" tab = PUTTY + TEXTURE). Each row resolves its packs with its
 * OWN family override, so the column set is the union across families — PUTTY's
 * 1/5/20 KG (KG override) AND TEXTURE's 25/30 KG together. `bucketColumnsForTab`
 * can't express this: its single `family` arg would apply one family's override
 * to every pack, mis-bucketing the other family's KG packs into litre columns.
 * For single-family tabs this is identical to bucketColumnsForTab. Ordered per
 * STANDARD_COLUMNS; columns with no mapping SKU are excluded (no bloat).
 */
export function bucketColumnsForRows(
  rows: Array<{ packs: RawPack[]; family?: string | null }>,
): BucketColumn[] {
  const present = new Set<BucketColumn>();
  for (const row of rows) {
    for (const p of row.packs) {
      const b = packToBucket(p, row.family ?? null);
      if (b) present.add(b);
    }
  }
  return STANDARD_COLUMNS.filter((c) => present.has(c));
}

/**
 * Display label for a bucket column header — inserts a space between
 * number and unit. "1L" → "1 L", "25KG" → "25 KG".
 */
export function bucketDisplayLabel(b: BucketColumn): string {
  if (b === "25PC" || b === "12PC") return "1 pc";   // tools — pieces; carton via container label
  return b.replace(/([A-Z]+)$/, " $1");
}

/**
 * True when the real SAP pack differs from its bucket. Triggers a
 * hint below the qty input ("900ML" hint in a 1L column cell).
 */
export function packNeedsHint(pack: RawPack, bucket: BucketColumn): boolean {
  return lookupKey(pack) !== bucket;
}

/**
 * Hint label for a cell whose real pack differs from its bucket.
 * "900ML", "3.6L", "5KG". Used as small low-emphasis text below the
 * qty input.
 */
export function packHintLabel(pack: RawPack): string {
  return lookupKey(pack);
}
