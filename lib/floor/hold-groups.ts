// Floor Control — the On hold tab's DEALER GROUPS and its Today filter
// (2026-10-30, owner; mockup docs/mockups/floor-hold/hold-dealer-groups.html).
//
// PURE. No Prisma, no I/O, no React. It only regroups rows getFloorHold already
// returned (with its `floorExtras` option — stopKey rides each row).
//
// 🔴 THE GROUP KEY IS `stopKey` (computeDropKey, lib/trips/drop-key.ts) — the
// trip module's own stop identity, compared for EQUALITY ONLY. Never the dealer
// NAME: an unmatched bill and a matched one can share a name and are different
// stops. A row without a stopKey (only possible if a caller forgot floorExtras)
// is its own group, so nothing is merged by guesswork.
//
// ORDER (owner): the dealer whose newest held bill is the most recent on top,
// ties broken by the exact held-since timestamp; inside a dealer, newest held
// first. Both are compareHoldRows (lib/floor/sort.ts) — heldSince desc, unknown
// last — so a dealer with only unknown-date bills sinks to the bottom.

import { compareHoldRows } from "@/lib/floor/sort";
import { holdAgeDays } from "@/lib/floor/hold-log";
import { narrowToInvoiceIds, type FloorInvoiceRow } from "@/lib/floor/invoice-rows";
import type { FloorHoldRow } from "@/lib/floor/types";

/**
 * Held TODAY (IST) by a RECORDED hold event. `~approximate` rows (heldSince is
 * the arrival date) and unknown ones are never today — FLOOR §4.5: nothing may
 * silently read as "held today".
 */
export function isHeldToday(row: Pick<FloorHoldRow, "heldSince" | "heldSinceSource">, now: Date): boolean {
  return row.heldSinceSource === "log" && holdAgeDays(row.heldSince, now) === 0;
}

export interface HoldDealerGroup {
  /** `stopKey`, or `o:<orderId>` when a row carries none. Opaque. */
  key: string;
  /** The effective ship-to's display name (the first bill's dealerName). */
  name: string;
  /** Newest held first (compareHoldRows). */
  rows: FloorHoldRow[];
}

/**
 * PER-PART SHIP-TO (v27.81, owner rule 4) — the division-blocks rule
 * (lib/floor/division-blocks.ts expandByShop) for the On hold tab. A split OBD
 * whose HELD parts (its drawn invoiceRows) go to TWO OR MORE shops becomes one
 * row PER SHOP, narrowed to that shop's parts (narrowToInvoiceIds — its litres
 * / kg are theirs) and keyed / named by that part's ship-to, so it sits in
 * each shop's dealer group. Every other row comes back as the SAME object —
 * with every part inheriting (all live data) the list is exactly the input.
 * The OBD stays the unit of selection: each copy ticks only its own invoices
 * (holdKeysOf → inv:<id>), so no key repeats.
 */
export function expandHoldByShop(rows: readonly FloorHoldRow[]): FloorHoldRow[] {
  return rows.flatMap((r) => {
    const byShop = new Map<string, FloorInvoiceRow[]>();
    for (const inv of r.invoiceRows) {
      const list = byShop.get(inv.shipTo.stopKey) ?? [];
      list.push(inv);
      byShop.set(inv.shipTo.stopKey, list);
    }
    if (byShop.size < 2) return [r];
    return Array.from(byShop.values()).map((invs): FloorHoldRow => {
      const s = invs[0].shipTo;
      return {
        ...narrowToInvoiceIds(r, invs.map((i) => i.id)),
        stopKey: s.stopKey,
        dealerName: s.dealerName,
        isShipToOverride: s.isShipToOverride,
        area: s.area,
        deliveryType: s.deliveryType,
      };
    });
  });
}

export function groupHoldByDealer(rows: readonly FloorHoldRow[]): HoldDealerGroup[] {
  const byKey = new Map<string, FloorHoldRow[]>();
  // v27.81 — a held split OBD going to two shops sits in BOTH shops' groups.
  for (const row of expandHoldByShop(rows)) {
    const key = row.stopKey ?? `o:${row.orderId}`;
    const list = byKey.get(key);
    if (list) list.push(row);
    else byKey.set(key, [row]);
  }
  const groups = Array.from(byKey, ([key, list]): HoldDealerGroup => {
    const sorted = list.slice().sort(compareHoldRows);
    return { key, name: sorted[0].dealerName, rows: sorted };
  });
  // Each group's first row IS its newest — so comparing first rows orders the
  // dealers by their newest hold, exact timestamp, unknown-only last.
  return groups.sort((a, b) => compareHoldRows(a.rows[0], b.rows[0]));
}
