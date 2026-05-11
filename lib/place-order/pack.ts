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
  "10L":   2,
  "20L":   1,
  "30L":   1,
  "40KG":  1,
};

export function packStep(packLabel: string): number {
  return PACK_STEP_MAP[packLabel] ?? 1;
}
