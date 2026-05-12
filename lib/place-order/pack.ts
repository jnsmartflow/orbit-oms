// Pack-size formatting + sorting + carton-step helpers for /place-order.
//
// Matches the mobile /order page byte-for-byte so:
//   (a) the email body the desktop page produces is parser-compatible
//   (b) carton multiples (1L=6, 4L=4, 100ML=12) stay consistent across both
//
// packCode in mo_sku_lookup is a bare numeric string. Conventions:
//   - >= 50      → millilitres ("50" → "50ML",   "200" → "200ML")
//   - < 1        → also millilitres ("0.5" → "500ML")
//   - 1 .. 40    → litres        ("1" → "1L",   "4" → "4L")

export function formatPack(pack: string): string {
  const num = parseFloat(pack);
  if (Number.isNaN(num)) return pack;
  if (num >= 50)         return `${num}ML`;
  if (num < 1)           return `${Math.round(num * 1000)}ML`;
  return `${num}L`;
}

export function packToMl(pack: string): number {
  const num = parseFloat(pack);
  if (Number.isNaN(num)) return Number.MAX_SAFE_INTEGER;
  if (num >= 50)         return num;     // already millilitres
  return num * 1000;                     // litres or sub-1L decimals → ML
}

// Litres per single unit of this pack. Used for total-volume calculation in
// the cart panel: total L = qty (boxes) × packStep (units/box) × packToLitres.
export function packToLitres(pack: string): number {
  return packToMl(pack) / 1000;
}

export function sortPacks(packs: string[]): string[] {
  return [...packs].sort((a, b) => packToMl(a) - packToMl(b));
}

// Carton / drum step-multiple per pack label. Used by the variant grid
// header ("box of N" sub-label) and by Phase 5's keyboard +/- handlers.
// Mirrors the mobile page's PACK_STEP map exactly.
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
};

export function packContainerLabel(packLabel: string): string | null {
  return PACK_CONTAINER_MAP[packLabel] ?? null;
}
