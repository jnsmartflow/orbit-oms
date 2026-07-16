// Pack-size formatting + sorting + carton-step helpers for /place-order.
//
// Matches the mobile /order page byte-for-byte so:
//   (a) the email body the desktop page produces is parser-compatible
//   (b) carton multiples (1L=6, 4L=4, 100ML=12) stay consistent across both
//
// packCode in mo_sku_lookup is a bare numeric string. Conventions when
// unit is null/undefined (legacy callers + magnitude inference):
//   - >= 50      → millilitres ("50" → "50ML",   "200" → "200ML")
//   - < 1        → also millilitres ("0.5" → "500ML")
//   - 1 .. 40    → litres        ("1" → "1L",   "4" → "4L")
//
// Phase 3.5 (2026-05-13) — formatPack now accepts an optional `unit`
// argument. KG packs render as "${packCode}KG" so a 5 KG pack reads
// "5KG" in the email instead of being mis-rendered as "5L" by the
// magnitude rule. GM is rendered explicitly the same way. ML/L/LT
// fall through to the magnitude path so legacy bare-packCode callers
// keep their current output.

export function formatPack(packCode: string, unit?: string | null): string {
  const u = (unit ?? "").toUpperCase();
  if (u === "KG") return `${packCode}KG`;
  if (u === "GM") return `${packCode}GM`;
  // PC — tools sold by the piece (boxed). The pack is "1 piece"; the carton
  // size (25 rollers / 12 brushes) rides packCode and surfaces only via the
  // container sub-label, so the cell label stays "1 pc". Additive: no paint
  // SKU carries unit "PC".
  if (u === "PC") return "1 pc";
  // Spray paint — 400 ml aerosol can. Specific (packCode+unit) case so the
  // 50/100/200 ML magnitude path stays byte-identical (paint untouched).
  if (packCode === "400" && u === "ML") return "400 ml";
  // ML / L / LT / null → magnitude inference (legacy behaviour).
  const num = parseFloat(packCode);
  if (Number.isNaN(num)) return packCode;
  if (num >= 50)         return `${num}ML`;
  if (num < 1)           return `${Math.round(num * 1000)}ML`;
  return `${num}L`;
}

export function packToMl(packCode: string, unit?: string | null): number {
  // KG / GM packs aren't litres — exclude from L-based totals by
  // returning 0. The cart panel's KG total reads packToKg below.
  const u = (unit ?? "").toUpperCase();
  if (u === "KG" || u === "GM" || u === "PC") return 0;   // pieces aren't litres
  const num = parseFloat(packCode);
  if (Number.isNaN(num)) return Number.MAX_SAFE_INTEGER;
  if (num >= 50)         return num;     // already millilitres
  return num * 1000;                     // litres or sub-1L decimals → ML
}

// Litres per single unit of this pack. Used for total-volume calculation in
// the cart panel: total L = qty (boxes) × packStep (units/box) × packToLitres.
export function packToLitres(packCode: string, unit?: string | null): number {
  return packToMl(packCode, unit) / 1000;
}

// KG per single unit of a KG pack. Returns 0 for non-KG packs so the
// cart panel can sum kg separately from litres (C1 policy — KG excluded
// from the L total, displayed as "+ Y KG" tail when > 0).
export function packToKg(packCode: string, unit?: string | null): number {
  const u = (unit ?? "").toUpperCase();
  if (u !== "KG") return 0;
  const num = parseFloat(packCode);
  return Number.isFinite(num) ? num : 0;
}

// ── Composite-key helpers ──────────────────────────────────────────────────
// CartLine.packQtys keys are composite "<packCode>|<unit>" strings so a
// row's 5 KG and 5 L SKUs don't collapse onto the same cart entry.
// Legacy drafts saved before Phase 3.5 used bare packCode strings; the
// fallback in place-order-page.tsx::qtyAt retries with a bare key when
// the composite lookup misses.

export function packKey(packCode: string, unit: string | null): string {
  return `${packCode}|${unit ?? ""}`;
}

export function parsePackKey(key: string): { packCode: string; unit: string | null } {
  const idx = key.indexOf("|");
  if (idx < 0) return { packCode: key, unit: null };   // legacy bare key
  const unit = key.slice(idx + 1);
  return { packCode: key.slice(0, idx), unit: unit.length > 0 ? unit : null };
}

// Sort by ML magnitude with KG packs anchored after everything else.
// Works on both composite keys ("5|KG") and legacy bare keys ("5").
// Within the KG group, smaller KG sorts first.
export function sortPacks(keys: string[]): string[] {
  return [...keys].sort((a, b) => {
    const pa = parsePackKey(a);
    const pb = parsePackKey(b);
    const aKg = (pa.unit ?? "").toUpperCase() === "KG";
    const bKg = (pb.unit ?? "").toUpperCase() === "KG";
    if (aKg !== bKg) return aKg ? 1 : -1;
    if (aKg && bKg) {
      const an = parseFloat(pa.packCode);
      const bn = parseFloat(pb.packCode);
      return (Number.isFinite(an) ? an : 0) - (Number.isFinite(bn) ? bn : 0);
    }
    return packToMl(pa.packCode, pa.unit) - packToMl(pb.packCode, pb.unit);
  });
}

// Carton / drum step-multiple per pack label. Used by the variant grid
// header ("box of N" sub-label) and by Phase 5's keyboard +/- handlers.
// Mirrors the mobile page's PACK_STEP map exactly, extended with KG
// drum/bag steps where they apply.
const PACK_STEP_MAP: Record<string, number> = {
  "50ML":  12,
  "100ML": 24,   // 2026-06-02 — 100ML carton is 24 (global; also Stainer + Wood Stain)
  "200ML": 12,
  "500ML": 12,
  "1L":    6,
  "4L":    4,
  "10L":   1,   // 2026-05-12 — 10L is a drum at this depot, no box
  "20L":   1,
  "30L":   1,
  "40KG":  1,
  "25KG":  1,
  "30KG":  1,
  "5KG":   1,
  "1 pc":  1,   // tools — step 1 piece (carton 25/12 is informational, not the step)
};

// Product-scoped carton overrides (2026-06-11). Mirrors the
// FAMILY_BUCKET_OVERRIDES precedent in pack-buckets.ts: checked BEFORE the
// global PACK_STEP_MAP / PACK_CONTAINER_MAP so a single product can re-size
// its cartons without touching the shared tables or any other product.
// Keyed by product identity (`product ?? subProduct`) → pack label → units
// per box. ONE table drives BOTH the +/- step (packStep) and the "box N"
// container label (packContainerLabel) so the two never drift.
//
// UNIVERSAL STAINER: depot cartons are 50ML→20, 100ML→20, 200ML→10 (the
// global stainer/wood-stain values are 12/24/12). Every OTHER product stays
// on the global maps — incl. the 100/200ML sharers (GLOSS, WOOD STAIN,
// METALLIC, PEARL GLO, SATIN STAY BRIGHT, VT METALLICS). Universal Stainer
// has product=null in the catalog, so its key is its subProduct
// "UNIVERSAL STAINER".
//
// MACHINE TINTER / ACOTONE / GVA (2026-07-16): depot sells these 1L STAINER
// tinters LOOSE, not by the carton — step 1, no box label. An override value
// of exactly 1 is the signal packContainerLabel uses to render no suffix
// (see below) — distinct from a pack simply being absent from this table
// (which falls through to the global PACK_STEP_MAP / PACK_CONTAINER_MAP).
//
// AQUATECH CRACKFILLER 5MM/10MM/20MM (2026-07-16): real depot cartons per
// product, keyed by the RAW pack label (packCode+unit — these fold into the
// shared 1L/500ML bucket columns via the global PACK_TO_BUCKET, so the
// override must key on what packStepForPack actually receives, not the
// bucket). 5MM: 1KG→6, 400GM→12. 10MM: 1KG→4, 500GM→12 (piecesPerCarton=12
// in mo_sku_lookup_v2 — previously undriven since "500GM" isn't a
// PACK_STEP_MAP key; this override makes the step agree with the carton).
// 20MM: 1KG→4. Scoped to these three products only — no other KG/GM pack
// gets an override in this cut.
const PRODUCT_CARTON_OVERRIDES: Record<string, Record<string, number>> = {
  "UNIVERSAL STAINER": { "50ML": 20, "100ML": 20, "200ML": 10 },
  "MACHINE TINTER":    { "1L": 1 },
  "ACOTONE":           { "1L": 1 },
  "GVA":               { "1L": 1 },
  "CRACKFILLER 5MM":   { "1KG": 6, "400GM": 12 },
  "CRACKFILLER 10MM":  { "1KG": 4, "500GM": 12 },
  "CRACKFILLER 20MM":  { "1KG": 4 },
};

// Shared override lookup for packStep + packContainerLabel. Returns the
// per-box unit count when (productKey, packLabel) is overridden, else null.
// No key (or no match) → null → caller falls back to the global map.
function cartonOverride(productKey: string | null | undefined, packLabel: string): number | null {
  if (!productKey) return null;
  return PRODUCT_CARTON_OVERRIDES[productKey]?.[packLabel] ?? null;
}

export function packStep(packLabel: string, productKey?: string | null): number {
  const override = cartonOverride(productKey, packLabel);
  if (override != null) return override;
  return PACK_STEP_MAP[packLabel] ?? 1;
}

// Carton step for tools (piece-with-box). Keyed by the DISTINCT pack
// (packCode + unit "PC") rather than the shared "1 pc" display label, so
// rollers (25PC) step by a whole box of 25 and brushes (12PC) by 12 — while
// both still render "1 pc". Additive: every non-PC pack delegates to
// packStep(formatPack(...)), so all litre/ML/KG steps are byte-identical.
const PIECE_BOX_STEP: Record<string, number> = {
  "25PC":  25,   // rollers — whole box of 25
  "12PC":  12,   // brushes — whole box of 12
  "500PC": 500,  // stickers — pack of 500
};

export function packStepForPack(packCode: string, unit?: string | null, productKey?: string | null): number {
  if ((unit ?? "").toUpperCase() === "PC") {
    return PIECE_BOX_STEP[`${packCode}PC`] ?? 1;
  }
  return packStep(formatPack(packCode, unit), productKey);
}

// Display-only container label for the variant grid column header.
// Intentionally decoupled from PACK_STEP_MAP — packStep is math (boxes
// → units multiplier), this is UI text. A future pack could have
// step=1 without being a drum (e.g. a loose can), or step>1 without
// being a "box" (carton vs. tray). Keep the two lookups independent.
//
// Returns null when the pack isn't in the map; the caller hides the
// suffix in that case (header renders just the pack label).
const PACK_CONTAINER_MAP: Record<string, string> = {
  "50ML":  "box 12",
  "100ML": "box 24",
  "200ML": "box 12",
  "500ML": "box 12",
  "1L":    "box 6",
  "4L":    "box 4",
  "10L":   "drum",
  "20L":   "drum",
  "30L":   "drum",
  "40KG":  "bag",
  "25KG":  "bag",
  "30KG":  "bag",
  "25PC":  "box of 25",   // tools — roller carton (keyed by the bucket name)
  "12PC":  "box of 12",   // tools — brush carton
  "500PC": "pack of 500", // stickers
  "400ML": "can",         // spray paint — aerosol can (keyed by the bucket name)
};

export function packContainerLabel(packLabel: string, productKey?: string | null): string | null {
  const override = cartonOverride(productKey, packLabel);
  // An override of exactly 1 (e.g. Machine Tinter/Acotone/GVA 1L, sold
  // loose) means no box — render no suffix rather than the nonsensical
  // "box 1". Every other override value is a real per-box count.
  if (override === 1) return null;
  if (override != null) return `box ${override}`;
  return PACK_CONTAINER_MAP[packLabel] ?? null;
}
