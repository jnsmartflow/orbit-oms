// Pack DOSE-litres + pigment scaling for the Sampling Library reuse flow.
//
// "Dose litres" is the litre basis a tinter dose is recorded against — NOT the
// raw fill volume. Several packs share a dose basis (e.g. 18L / 18.5L / 20L all
// dose as 20L; 0.9L / 0.925L / 1L all dose as 1L), so a formula scales between
// packs by the ratio of their dose litres.
//
// Pure functions, no side effects. CORE §3: no DB, no $transaction.

import type { PackCode } from "@prisma/client";

// Dose litres per pack (NOT raw base litres). Members match the Prisma PackCode
// enum exactly (verified against prisma/schema.prisma).
export const PACK_DOSE_LITRES: Record<PackCode, number> = {
  ml_500:  0.5,
  L_0_9:   1,
  L_0_925: 1,
  L_1:     1,
  L_3_6:   4,
  L_3_7:   4,
  L_4:     4,
  L_9:     10,
  L_9_25:  10,
  L_10:    10,
  L_15:    15,
  L_18:    20,
  L_18_5:  20,
  L_20:    20,
  L_22:    22,
  L_30:    30,
  L_40:    40,
};

function round(value: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(value * f) / f;
}

// Dose litres for a pack; null when the pack is null/undefined or unknown.
export function packDoseLitres(pack: PackCode | null | undefined): number | null {
  if (pack == null) return null;
  return PACK_DOSE_LITRES[pack] ?? null;
}

// Scalable only when BOTH sides have known dose litres.
export function canScale(
  from: PackCode | null | undefined,
  to:   PackCode | null | undefined,
): boolean {
  return packDoseLitres(from) !== null && packDoseLitres(to) !== null;
}

// Scale every pigment value by (toLitres / fromLitres), rounded to 3 dp.
// null when either pack has no dose litres.
export function scalePigments(
  values:   Record<string, number>,
  fromPack: PackCode | null | undefined,
  toPack:   PackCode | null | undefined,
): Record<string, number> | null {
  const fromLitres = packDoseLitres(fromPack);
  const toLitres   = packDoseLitres(toPack);
  if (fromLitres === null || toLitres === null) return null;
  const factor = toLitres / fromLitres;
  const out: Record<string, number> = {};
  for (const [code, v] of Object.entries(values)) {
    out[code] = round((v ?? 0) * factor, 3);
  }
  return out;
}

// Per-litre fingerprint string for pack-agnostic formula comparison.
// null when the pack has no dose litres.
export function perLitreFingerprint(
  values: Record<string, number>,
  pack:   PackCode | null | undefined,
  codes:  readonly string[],
): string | null {
  const litres = packDoseLitres(pack);
  if (litres === null) return null;
  return codes.map((c) => round((values[c] || 0) / litres, 2)).join("|");
}
