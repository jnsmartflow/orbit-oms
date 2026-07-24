// Floor Control — Hold report (PDF) data model. Pure: the clock is passed in,
// never Date.now(); no DB, no React. The same builder feeds the on-screen preview
// AND the printed sheet, so the two can never show different counts (design §8,
// mockup 01-board.html `openSheet`).

import {
  countByBand,
  groupByHoldBand,
  heldSinceLabel,
  holdAgeDays,
  HOLD_BANDS,
  type HoldBandKey,
} from "./hold-log";
import type { FloorHoldRow } from "./types";

export interface HoldPdfRow {
  obdNumber: string;
  orderDate: string; // "DD Mon HH:mm" IST — the OBD arrival
  shipTo: string;
  route: string;
  heldSince: string; // "today" / "N days ago" / "~ …" (approx) / "—"
}

export interface HoldPdfBand {
  key: HoldBandKey;
  label: string;
  rows: HoldPdfRow[];
}

export interface HoldPdfDoc {
  asOn: string; // "22 Jul 2026, 10:14" — the header stamp
  total: number;
  counts: Record<HoldBandKey, number>;
  bands: HoldPdfBand[];
  scopeLabel: string; // "All delivery types" | "Local" | …
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso)
    .toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" })
    .replace(",", "");
}

function fmtAsOn(now: Date): string {
  const date = now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
  const time = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });
  return `${date}, ${time}`;
}

/** Build the whole document — recent-first bands, counts, header stamp. Rows are
 *  taken as-is (the caller has already applied the header delivery-type scope). */
export function buildHoldPdf(rows: FloorHoldRow[], scope: string, now: Date): HoldPdfDoc {
  const banded = groupByHoldBand(rows, now, false);
  const bands: HoldPdfBand[] = banded.map(({ band, rows: bandRows }) => ({
    key: band.key,
    label: band.label,
    rows: bandRows.map((r) => {
      const days = holdAgeDays(r.heldSince, now);
      const label = heldSinceLabel(days);
      return {
        obdNumber: r.obdNumber,
        orderDate: fmtDateTime(r.obdDateTime),
        shipTo: r.dealerName,
        route: r.route ?? "—",
        heldSince: r.heldSinceSource === "approx" ? `~ ${label}` : label,
      };
    }),
  }));

  return {
    asOn: fmtAsOn(now),
    total: rows.length,
    counts: countByBand(rows, now),
    bands,
    scopeLabel: scope === "All" ? "All delivery types" : scope,
  };
}

/** Ordered (label, count) pairs for the header strip — always all five bands so a
 *  zero prints as 0 rather than vanishing. The "unknown" band is only shown when
 *  it actually has rows (an all-known list should not carry a noisy "0 unknown"). */
export function bandSummary(doc: HoldPdfDoc): Array<{ label: string; count: number }> {
  return HOLD_BANDS.filter((b) => b.key !== "unknown" || doc.counts.unknown > 0).map((b) => ({
    label: b.label,
    count: doc.counts[b.key],
  }));
}
