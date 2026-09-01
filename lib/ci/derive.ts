// lib/ci/derive.ts
//
// Every derived CI value, in one place. PURE — no Prisma, no I/O, no clock.
// lib/mrn/derive.ts is the model.
//
// ═══════════════════════════════════════════════════════════════════════════
// 🔴🔴 LITRES COME FROM SAP. NEVER FROM THE CATALOG. 🔴🔴
// ═══════════════════════════════════════════════════════════════════════════
//
// litresPerTin = import_raw_line_items.volumeLine ÷ unitQty, and nothing else.
//
// This file carries the warning the way lib/ci/resolve-lines.ts carries the
// id-space one, because the tempting shortcut is RIGHT THERE: the catalog holds
// `sku_master_v2.packCode` + `unit`, which look like they say the pack size
// outright, and deriving "20L" → 20 litres is one line of code.
//
// IT IS WRONG, AND IT WAS MEASURED (step 3a, 2026-08-31). Across 36,380 active
// lines / 815 SKUs / 16 distinct pack sizes, volumeLine ÷ unitQty matched the
// catalog's declared pack size on 36,271 — 99.70%. Every one of the 109
// disagreements was inspected and every one is a CATALOG ERROR:
//
//   5880418   catalog says 0.9 L   · SAP says 1.0    (60 lines)
//   5856409   catalog says 925 L   · SAP says 0.925  (31 lines — the catalog
//             stores packCode "925" with unit "L", i.e. nine hundred and
//             twenty-five litres in a tin)
//   5856421   catalog says 4 L     · SAP says 3.7    (14 lines — the real 3.7L
//             pack, which the catalog rounds)
//   + 4 one-line oddities
//
// SAP WINS EVERY TIME THE TWO DISAGREE. A CI replaces a signed paper form; a
// plausible-looking wrong litre figure is worse than a blank one, and a figure
// derived from packCode would have been confidently wrong on 109 lines with
// nothing on screen to show it.
//
// Do not add a packCode fallback "for when volumeLine is missing" either. It is
// missing on 2 active lines out of 40,675. Two blanks are cheaper than a rule
// that is wrong 109 times.
//
// ═══════════════════════════════════════════════════════════════════════════

import { sortPackLabels } from "@/lib/picking/pack-sort";
import type { CiBillLine, CiDetailLine } from "./types";

// ── Litres ───────────────────────────────────────────────────────────────────

/**
 * Litres in one tin of this line.
 *
 * 🔴 THE GUARD IS ON `unitQty` ONLY — NEVER ON `volumeLine`.
 *
 * `volumeLine = 0` IS A REAL, CORRECT VALUE. 346 active lines (0.85%) carry it:
 * brushes, rollers, scrapers, putty knives — goods that genuinely have no
 * volume. They must produce 0 and render "0 L". A falsy check
 * (`if (!volumeLine) return null`) would blank all 346 of them, and a blank
 * reads as "unknown" — which is a different and wronger claim than "none".
 *
 * `unitQty` is what cannot be divided by. Live it is never null and never zero
 * across all 40,675 active lines, so this branch is a seatbelt rather than a
 * common path — but null/Infinity printed onto a goods-return document is
 * exactly the failure this exists to stop.
 *
 * Returns null ⇒ the caller renders the litres cell BLANK (genuinely unknown).
 * Returns 0    ⇒ the caller renders "0 L" (known to be nothing).
 */
export function litresPerTin(
  volumeLine: number | null,
  unitQty: number | null,
): number | null {
  if (volumeLine === null) return null;
  if (unitQty === null || unitQty === 0) return null;
  return volumeLine / unitQty;
}

/**
 * Litres coming back on one line = litresPerTin × returnedQty.
 *
 * Null propagates: if the per-tin figure is unknown, so is the total. Zero does
 * NOT propagate to null — 0 × 5 is 0 litres, which is the truthful answer for
 * five returned brushes.
 */
export function returnedLitres(
  perTin: number | null,
  returnedQty: number,
): number | null {
  if (perTin === null) return null;
  return round3(perTin * returnedQty);
}

/**
 * Round to 3 decimals — the scale of the live `numeric(12,3)` columns.
 *
 * (12,3) not (12,2) because pack sizes carry three decimals: a 0.925 L pack
 * would round to 0.93 at two, and 0.925 × 60 tins is 55.5 L against 55.8 L —
 * visibly wrong on a signed form.
 */
export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Σ litres over the whole bill. Lines whose litres are unknown contribute 0 —
 *  the header total is a best-known figure, and omitting the bill total because
 *  one line of forty is unmastered would be worse than a slightly low number.
 *  ⚠ This is deliberately NOT null-propagating; the per-line cell still shows a
 *  blank so the gap is visible where it actually is. */
export function sumLitres(values: readonly (number | null)[]): number {
  return round3(values.reduce<number>((s, v) => s + (v ?? 0), 0));
}

/** Header totals for a saved CI — the mockup's "10 tins · 120 L". */
export function ciTotals(lines: readonly CiDetailLine[]): {
  totalTins: number;
  totalLitres: number;
  lineCount: number;
} {
  return {
    lineCount: lines.length,
    totalTins: lines.reduce((s, l) => s + l.returnedQty, 0),
    totalLitres: sumLitres(lines.map((l) => l.returnedQtyLitres)),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 🔴 THE PRE-SUBMIT SUMMARY — DERIVED, NEVER ACCUMULATED (step 13)
// ═══════════════════════════════════════════════════════════════════════════
//
// What the supervisor reads directly above Submit must be what the SERVER will
// store, and the only way to guarantee that is to compute it from the SAME
// inputs the server uses and by the same rules.
//
// app/api/ci/[ciId]/lines/route.ts builds its rows like this:
//   • full → EVERY active line at its delivered quantity (`unitQty`), computed
//     server-side and never accepted from the client
//   • part → the {rawLineItemId, returnedQty} pairs the client sent
//   • litres → ALWAYS litresPerTin × returnedQty, re-derived from SAP's
//     volumeLine ÷ unitQty; a posted litres figure is ignored
//
// This function mirrors exactly that, off `CiBillLine.deliveryQty` (which IS
// SAP's unitQty) and `litresPerTin` (which the bill route already derived with
// the same guard). So the summary cannot claim a quantity, a volume or a pack
// the submitted CI does not contain.
//
// ⚠ NOT A RUNNING TOTAL. Nothing increments as he taps; the whole thing is
// recomputed from the current selection every render. A tally that is added to
// and subtracted from drifts the first time an edit path forgets to subtract —
// and this number is the last thing he checks before signing the return.
export interface CiReturnSummary {
  lineCount: number;
  totalTins: number;
  totalLitres: number;
  /** Ordered SMALLEST PACK FIRST — see the note in the function body. */
  packs: { label: string; tins: number }[];
}

/** Lines with no resolved pack. Same wording the chip strip already uses
 *  (components/ci/line-list.tsx), so one bill never calls it two things. */
const NO_PACK_LABEL = "No pack";

export function summariseCiReturn(
  lines: readonly CiBillLine[],
  mode: "full" | "part",
  /** rawLineItemId → tins. Ignored entirely on a full return, exactly as the
   *  lines route ignores the posted body there. */
  returned: ReadonlyMap<number, number>,
): CiReturnSummary {
  const chosen: { line: CiBillLine; qty: number }[] = [];
  for (const l of lines) {
    // 🔴 FULL IS COMPUTED, NOT READ FROM THE SELECTION. "Full bill" means every
    // active line at its delivered quantity — the route's own rule — so a stale
    // `returned` map left over from a Part session can never leak into it.
    const qty = mode === "full" ? l.deliveryQty : (returned.get(l.rawLineItemId) ?? 0);
    // ⚠ > 0. A zero-tin line is not "nothing came back on this line", it is a
    // line that should not be on the return at all — the lines route rejects
    // one, so the summary must not count one.
    if (qty > 0) chosen.push({ line: l, qty });
  }

  const byPack = new Map<string, number>();
  for (const { line, qty } of chosen) {
    const key = line.pack ?? NO_PACK_LABEL;
    byPack.set(key, (byPack.get(key) ?? 0) + qty);
  }

  // 🔴 SMALLEST PACK FIRST, via the SHARED sorter — never alphabetically, which
  // puts "100ML" before "1L" ("0" < "L") and "20L" before "4L". sortPackLabels
  // is a RULE, not a token, which is why it is imported rather than copied —
  // components/ci/line-list.tsx imports the same function for the chip strip on
  // the previous screen, so the two screens cannot disagree about pack order.
  const real = sortPackLabels(Array.from(byPack.keys()).filter((k) => k !== NO_PACK_LABEL));
  const ordered = byPack.has(NO_PACK_LABEL) ? [...real, NO_PACK_LABEL] : real;

  return {
    lineCount: chosen.length,
    totalTins: chosen.reduce((s, c) => s + c.qty, 0),
    totalLitres: sumLitres(chosen.map((c) => returnedLitres(c.line.litresPerTin, c.qty))),
    packs: ordered.map((label) => ({ label, tins: byPack.get(label) ?? 0 })),
  };
}

/** Bill totals for the supervisor's header strip — the mockup's "212 L". */
export function billTotals(lines: readonly CiBillLine[]): {
  lineCount: number;
  totalLitres: number;
} {
  return {
    lineCount: lines.length,
    totalLitres: sumLitres(lines.map((l) => l.lineLitres)),
  };
}

// ── Dates ────────────────────────────────────────────────────────────────────

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse a `YYYY-MM-DD` body field into the UTC-midnight `Date` a `@db.Date`
 * column expects. Used by the two write routes that take a date from an
 * operator: `materialReceivedDate` (draft) and `ciDate` (close).
 *
 * ⚠ NEVER `new Date(str)` AND NEVER `Date.parse(str)`. CORE §3: an offset-less
 * date-TIME string is read in the HOST's timezone, so the same input lands on a
 * different calendar day depending on whether Vercel (UTC) or a depot phone
 * (IST) evaluated it — and only near midnight, so it passes every daytime test.
 * `Date.UTC(y, m-1, d)` is explicit and host-independent.
 *
 * THROWS on a malformed shape and on a shape-valid-but-impossible date
 * ("2026-02-30", which Date.UTC would silently roll into March) — caught by
 * round-tripping back to a string. Throwing rather than defaulting is the point:
 * a received-on date that quietly became a different day is a wrong fact on a
 * signed return.
 */
export function parseCiDateOnly(value: string): Date {
  if (!DATE_ONLY_RE.test(value)) {
    throw new Error(`Invalid date "${value}" — expected YYYY-MM-DD`);
  }
  const [y, m, d] = value.split("-").map(Number);
  const out = new Date(Date.UTC(y, m - 1, d));
  if (out.toISOString().slice(0, 10) !== value) {
    throw new Error(`Invalid calendar date "${value}"`);
  }
  return out;
}

// ── Dealer ───────────────────────────────────────────────────────────────────

/** The narrow shape resolveCiDealer needs — not a whole `orders` row, so a
 *  caller with any select shape satisfies it without a cast. */
export interface CiDealerSource {
  shipToOverrideCustomer: { customerName: string } | null;
  customer: { customerName: string } | null;
  /** SAP's own name for the bill. THE COMMON FALLBACK — see below. */
  shipToCustomerName: string | null;
}

/**
 * Which dealer name a CI shows.
 *
 * 🔴 MIRRORS lib/picking/queue.ts, WHICH IS THE OWNER OF THIS RULE — its
 * effective-dealer block (`overrideDealer ?? plainDealer`, then
 * `nonBlank(effectiveDealer?.customerName) ?? nonBlank(order.shipToCustomerName)
 * ?? "(Unmatched)"`). Picking resolves through a batched id→row Map for its own
 * N+1 reasons and does not export the rule, so this is a mirror rather than an
 * import — the same relationship lib/mrn/line-list.tsx has to picking's card.
 * If Picking's rule changes, this changes with it; they must not drift.
 *
 * ⚠ OVERRIDE FIRST, and that ordering is the point for CI specifically: goods
 * come back from wherever they were DELIVERED, which on a redirected bill is
 * the override, not the bill-to.
 *
 * 🔴 THE `shipToCustomerName` FALLBACK IS THE COMMON PATH, NOT A SEATBELT, and
 * it is written as the main line for that reason. Measured 2026-08-31 over
 * 12,362 dispatched-or-later orders: 346 carry the legacy `shipToOverride`
 * boolean, but only 98 carry a resolvable `shipToOverrideCustomerId` — **248 of
 * them (72%) are flag-true / id-null**, free-text redirects with no master row
 * to resolve. On every one of those the master name is absent and SAP's name is
 * the only name there is.
 *
 * A whitespace-only name is not a name: it would render a blank header, which
 * reads as a broken screen rather than as missing data.
 */
export function resolveCiDealer(order: CiDealerSource): string {
  return (
    nonBlank(order.shipToOverrideCustomer?.customerName) ??
    nonBlank(order.customer?.customerName) ??
    nonBlank(order.shipToCustomerName) ??
    "(Unmatched)"
  );
}

/** Returns the ORIGINAL string when it survives, never a trimmed copy — so a
 *  name renders byte-identically to how SAP or the master holds it. */
function nonBlank(value: string | null | undefined): string | null {
  return value != null && value.trim() !== "" ? value : null;
}
