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
  if (u === "KG" || u === "GM") return 0;
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
  "100ML": 12,
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
};

export function packStep(packLabel: string): number {
  return PACK_STEP_MAP[packLabel] ?? 1;
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
  "100ML": "box 12",
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
};

export function packContainerLabel(packLabel: string): string | null {
  return PACK_CONTAINER_MAP[packLabel] ?? null;
}
