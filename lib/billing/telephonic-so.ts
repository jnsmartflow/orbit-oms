// lib/billing/telephonic-so.ts
//
// The SO number rule for the Billing · Telephonic tab — PURE (no Prisma, no
// I/O), so the client entry bar and the server add route import the SAME
// function. One rule, one place. lib/billing/telephonic.ts imports Prisma and
// cannot be imported by a client component, which is why this is its own file.

/**
 * Normalise and validate an SO number typed on the tab. Returns the stored
 * form, or null when it is not a SAP SO number.
 *
 * Rule: trim, strip every inner whitespace character, then EXACTLY 10 digits.
 *
 * Measured live 2026-09-22 over all 15,222 `orders.soNumber` values:
 *   • 15,137 (99.4%) are exactly 10 digits — 15,106 start "104", 28 "451",
 *     3 others. Every one of the 13,783 digit-only mail-order SOs is 10 long.
 *   • 14 are 1-4 digit numbers (9, 81-83, 108-866, 1158) — challan / manual
 *     serials, not SAP SOs.
 *   • 71 rows (44 distinct) are text: POTLI (19), SAMPLE (5), CHALLAN
 *     variants ("CHALLAN - 1799", "88 - CHALLAN"), J2/GST-00xx, "86 - MANUAL",
 *     CHN-2026-00088, IE-2026-27-32, a timestamp.
 * So 10 digits accepts every real SAP SO seen and rejects all 85 others.
 * No leading-prefix check: "451…" SOs are real, and a prefix rule would be a
 * guess about SAP's numbering.
 */
export function normaliseSoNumber(raw: string): string | null {
  const compact = raw.replace(/\s+/g, "");
  return /^\d{10}$/.test(compact) ? compact : null;
}

/** The current IST month as `YYYY-MM`. Pure (the clock is passed in) — shared
 *  by the tab's month picker and the list route's default. */
export function currentIstMonth(now: Date): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }).slice(0, 7);
}
