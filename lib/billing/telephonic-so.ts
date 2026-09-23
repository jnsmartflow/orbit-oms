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

/** The most SO numbers one Add may carry. A paste longer than this is almost
 *  always the wrong clipboard, and 50 already covers a day of phone orders
 *  (~33 no-mail bills a day across the whole depot). */
export const TELEPHONIC_MAX_PER_ADD = 50;

export interface ParsedSoBlock {
  /** Normalised, de-duplicated, in the order they were typed. */
  valid: string[];
  /** Everything that cannot be added, each with the reason to show on its chip. */
  invalid: { raw: string; reason: string }[];
}

/**
 * Split a pasted block into SO numbers. Newlines, spaces, commas, tabs — ANY
 * run of non-digits separates, because an operator pasting out of SAP or a
 * chat message cannot be asked which separator to use.
 *
 * ⚠ PURE, and it judges only FINISHED tokens. The entry rail decides what is
 * finished (a separator was typed, or Add was pressed) and never asks about
 * the token still under the caret — see billing-telephonic-tab.tsx.
 *
 * A duplicate inside one paste keeps its FIRST position and is dropped
 * silently: the operator typed the same number twice, which is not an error.
 */
export function parseSoBlock(text: string): ParsedSoBlock {
  const tokens = text.split(/\D+/).filter((t) => t !== "");
  const valid: string[] = [];
  const invalid: { raw: string; reason: string }[] = [];
  const seen = new Set<string>();

  for (const token of tokens) {
    const so = normaliseSoNumber(token);
    if (so === null) {
      invalid.push({ raw: token, reason: "not 10 digits" });
      continue;
    }
    if (seen.has(so)) continue; // same number twice in one paste — keep the first
    seen.add(so);
    if (valid.length >= TELEPHONIC_MAX_PER_ADD) {
      invalid.push({ raw: so, reason: "over 50" });
      continue;
    }
    valid.push(so);
  }

  return { valid, invalid };
}
