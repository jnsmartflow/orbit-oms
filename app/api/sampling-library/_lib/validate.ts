import { PackCode, Prisma, TinterType } from "@prisma/client";

// ── All 27 pigment codes (13 TINTER + 14 ACOTONE) ───────────────────────────
export const PIGMENT_CODES = [
  "YOX", "LFY", "GRN", "TBL", "WHT", "MAG", "FFR", "BLK", "OXR", "HEY",
  "HER", "COB", "COG",
  "YE2", "YE1", "XY1", "XR1", "WH1", "RE2", "RE1", "OR1", "NO2", "NO1",
  "MA1", "GR1", "BU2", "BU1",
] as const;
export type PigmentCode = (typeof PIGMENT_CODES)[number];

export function decToNum(d: Prisma.Decimal | null | undefined): number {
  if (d == null) return 0;
  return d.toNumber();
}

export function isValidPackCode(v: unknown): v is PackCode {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(PackCode, v);
}

export function isValidTinterType(v: unknown): v is TinterType {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(TinterType, v);
}

/**
 * Convert partial pigment input → full 27-key number record. Missing/invalid
 * keys default to 0. Negative values clamp to 0. Prisma's Decimal column type
 * accepts plain numbers, so callers can spread this directly into `data`.
 */
export function buildPigmentNumbers(
  input: unknown,
): Record<PigmentCode, number> {
  const src = input && typeof input === "object"
    ? (input as Record<string, unknown>)
    : {};
  const out = {} as Record<PigmentCode, number>;
  for (const code of PIGMENT_CODES) {
    const raw = src[code];
    out[code] = typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : 0;
  }
  return out;
}

/**
 * Build the outgoing pigments object + activePigments list for a recipe row.
 */
export function buildPigmentsResponse(
  row: Record<PigmentCode, Prisma.Decimal | null>,
): { pigments: Record<PigmentCode, number>; activePigments: string[] } {
  const pigments = {} as Record<PigmentCode, number>;
  const activePigments: string[] = [];
  for (const code of PIGMENT_CODES) {
    const v = decToNum(row[code]);
    pigments[code] = v;
    if (v > 0) activePigments.push(code);
  }
  return { pigments, activePigments };
}
