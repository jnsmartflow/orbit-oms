// lib/trip-sheet/totals.ts
//
// THE ONE PLACE a trip sheet's stop numbers, totals, caption areas and SO line
// are computed (2026-10-17) — moved out of loadSheetCore so the loader and
// filterSheet (./share-groups.ts, one group's sheet) can never disagree.
//
// PURE — client-safe (lib/orders/gift.ts has no imports).

import { loadKg, loadLitres } from "@/lib/orders/gift";
import type { TripSheetStop, TripSheetTotals } from "./types";

export interface SheetSummary {
  stops: TripSheetStop[];
  totals: TripSheetTotals;
  /** Unique stop areas in printed order — the caption's last line. */
  captionAreas: string[];
  /** Unique SO names over the bills, in printed order — phone only. */
  soNames: string[];
}

/**
 * `stops` must already be in PRINTED order. Numbers them 1..N, sorts each
 * stop's bills by OBD, and sums: gifts add 0 litres / kg, a bill with no
 * litres adds 0, an unknown kg adds nothing and is counted. SO names are one
 * entry per PERSON — the master id when known, else the shown name.
 */
export function summariseStops(stops: TripSheetStop[]): SheetSummary {
  const totals: TripSheetTotals = { stops: stops.length, bills: 0, articles: 0, litres: 0, kg: 0, kgUnknownCount: 0 };
  const captionAreas: string[] = [];
  const soNames: string[] = [];
  const soSeen = new Set<string>();
  stops.forEach((s, i) => {
    s.no = i + 1;
    s.bills.sort((a, b) => a.obd.localeCompare(b.obd));
    if (s.area !== null && !captionAreas.includes(s.area)) captionAreas.push(s.area);
    for (const b of s.bills) {
      totals.bills += 1;
      totals.articles += b.articles ?? 0;
      totals.litres += loadLitres(b.litres, b.gift);
      const kg = loadKg(b.kg, b.gift);
      if (kg === null) totals.kgUnknownCount += 1;
      else totals.kg += kg;
      if (b.soName !== null) {
        const key = b.soId !== null ? `id:${b.soId}` : `name:${b.soName.toLowerCase()}`;
        if (!soSeen.has(key)) {
          soSeen.add(key);
          soNames.push(b.soName);
        }
      }
    }
  });
  // A split-load part's share is one decimal (lib/floor/invoice-rows.ts
  // loadRowArticles) — keep the sum to one decimal too. Whole counts are unchanged.
  totals.articles = Math.round(totals.articles * 10) / 10;
  return { stops, totals, captionAreas, soNames };
}
