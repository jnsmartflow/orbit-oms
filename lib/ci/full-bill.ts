// lib/ci/full-bill.ts
//
// ═══════════════════════════════════════════════════════════════════════════
// 🔴 "FULL BILL" = EVERY ACTIVE LINE AT ITS DELIVERED QUANTITY — ONE OWNER
// ═══════════════════════════════════════════════════════════════════════════
//
// Lifted out of app/api/ci/[ciId]/lines/route.ts (2026-09-22) so a server job
// with no request and no session can compute the same set the manual path
// stores. Two callers:
//   • PUT /api/ci/[ciId]/lines — a supervisor's 'full' return. It maps a
//     refusal below back to the exact 409 it has always returned.
//   • lib/ci/bill-only.ts      — the bill-only auto-CI.
// Both must write IDENTICAL rows for the same bill, which is why the per-line
// derivation (deriveCiLineRows) lives here too and the route's PART branch
// calls it as well.
//
// SERVER-ONLY (Prisma). Session-free: no request, no auth, no permission check
// — the caller owns all of that. Never throws for a DATA problem; a refusal is
// a result. (A database error still throws; callers that must not throw wrap
// it, as bill-only.ts does.)
//
// Sequential awaits, never prisma.$transaction (CORE §3).

import { prisma } from "@/lib/prisma";
import { litresPerTin, returnedLitres } from "@/lib/ci/derive";
import { applyCiCatalog, resolveCiSkus } from "@/lib/ci/resolve-lines";

/** One active raw line — the only source a CI line may be derived from. */
export interface ActiveBillLine {
  id: number;
  skuCodeRaw: string | null;
  unitQty: number | null;
  volumeLine: number | null;
}

/**
 * One CI line, fully derived and ready to insert — everything except the
 * parent id (`ciReturnId`), which the caller adds or a nested create supplies.
 */
export interface DerivedCiLine {
  /** 1..N in bill order. Not the SAP item number — that can be sparse. */
  lineNumber: number;
  rawLineItemId: number;
  skuCode: string;
  skuDescription: string | null;
  packCode: string | null;
  deliveryQty: number | null;
  returnedQty: number;
  litresPerTin: number | null;
  returnedQtyLitres: number | null;
}

export type FullBillResult =
  | { ok: true; lines: DerivedCiLine[] }
  /** At least one active line has a delivered quantity of 0 or null — a full
   *  return cannot be filed; the manual path tells him to use Part. */
  | { ok: false; reason: "zero_qty"; lineIds: number[] }
  /** The bill has no active lines at all. */
  | { ok: false; reason: "no_lines" };

/**
 * The bill's ACTIVE lines, in bill order.
 *
 * 🔴 lineStatus 'active' ONLY. 113 rows across 100 OBDs are
 * 'removed_by_import'; offering one would return a line SAP has withdrawn.
 * Joined on the obdNumber TEXT column — there is no FK from `orders` to its
 * line items (Picking and Floor both join on the string).
 * ⚠ `orderBy: { lineId: "asc" }` — lineNumber must mean the same thing on
 * every CI, manual or auto.
 */
export async function readActiveBillLines(obdNumber: string): Promise<ActiveBillLine[]> {
  return prisma.import_raw_line_items.findMany({
    where: { obdNumber, lineStatus: "active" },
    select: { id: true, skuCodeRaw: true, unitQty: true, volumeLine: true },
    orderBy: { lineId: "asc" },
  });
}

/**
 * Derive the stored CI line rows from (source line, tins returned) pairs, in
 * the order given. ONE catalog read for the whole set.
 *
 * DERIVED, re-read from the raw line + sku_master_v2 every time — nothing here
 * comes off the wire except the pairing and the quantity:
 *   skuDescription / packCode ← applyCiCatalog over resolveCiSkus (by
 *                               `material` only — CORE §13's id-space landmine)
 *   litresPerTin              ← litresPerTin(volumeLine, unitQty)
 *   returnedQtyLitres         ← returnedLitres(perTin, qty)
 *   deliveryQty               ← the raw line's unitQty
 * Unmastered codes are stored AS-IS (~5.9% of active lines) and never reject.
 */
export async function deriveCiLineRows(
  picked: readonly { src: ActiveBillLine; returnedQty: number }[],
): Promise<DerivedCiLine[]> {
  const catalog = await resolveCiSkus(picked.map((p) => p.src.skuCodeRaw));
  return picked.map((p, i) => {
    const code = p.src.skuCodeRaw ?? "";
    const resolved = applyCiCatalog(code, catalog);
    // 🔴 Guarded on unitQty ONLY. volumeLine = 0 is a REAL value — brushes and
    // rollers — and must snapshot as 0, never as null (CLAUDE_CI.md §13 CI-8).
    const perTin = litresPerTin(p.src.volumeLine, p.src.unitQty);
    return {
      lineNumber: i + 1,
      rawLineItemId: p.src.id,
      skuCode: code,
      skuDescription: resolved.description,
      packCode: resolved.pack,
      deliveryQty: p.src.unitQty,
      returnedQty: p.returnedQty,
      litresPerTin: perTin,
      returnedQtyLitres: returnedLitres(perTin, p.returnedQty),
    };
  });
}

/**
 * Every active line of the bill at its delivered quantity, fully derived.
 *
 * 🔴 COMPUTED, NEVER ACCEPTED. "Full bill" must mean the bill as it stands
 * NOW — a list supplied by a client (or copied from an earlier read) could
 * silently omit a line added by a re-import.
 *
 * A delivered quantity of 0 or null cannot be returned, so such a bill cannot
 * be returned in full: refused with the offending raw line ids rather than a
 * CI that quietly drops or zeroes a line.
 */
export async function computeFullBillLines(obdNumber: string): Promise<FullBillResult> {
  const active = await readActiveBillLines(obdNumber);
  if (active.length === 0) return { ok: false, reason: "no_lines" };

  const picked = active.map((src) => ({ src, returnedQty: src.unitQty ?? 0 }));
  const zero = picked.filter((p) => p.returnedQty < 1);
  if (zero.length > 0) {
    return { ok: false, reason: "zero_qty", lineIds: zero.map((p) => p.src.id) };
  }

  return { ok: true, lines: await deriveCiLineRows(picked) };
}
