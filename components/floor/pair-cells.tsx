"use client";

// Floor Control — INVOICE PAIRS in the bill table (2026-10-08, owner design).
//
// SAP can cover two or more OBDs with one invoice. Every board row carries
// `invoicePartners` (lib/floor/invoice-pairs.ts, kept fresh by the live feed)
// and every Floor list keeps a pair adjacent (lib/floor/sort.ts
// keepPairsAdjacent). This file decides, for ONE rendered list, which rows draw
// as a merged block and what each split row says about its missing members.
// floor-table.tsx draws it.
//
//   TOGETHER  every member is in this list, consecutively → one <tbody>, tick
//             and Invoice cells rowspan'd, "k of n" per row (k = block order).
//   SPLIT     a member is elsewhere → the row draws alone, "k of n" (k = OBD
//             order across the invoice, so both halves number alike) plus a
//             chip naming each missing member by k and where it is.
//
// ⚠ NOTHING HARDCODES 2 — n is the invoice's size, k its position.
// ⚠ No key listener here — floor-page.tsx owns the floor's only one.

import { createContext, useContext } from "react";
import { rowStatus, isTintRoomRow } from "./status-pill";
import type { FloorBoardRow } from "@/lib/floor/types";
import type { InvoicePartner } from "@/lib/floor/invoice-pairs";

/**
 * Every loaded board row by orderId — the UNFILTERED, unscoped board
 * (trip-desk.tsx provides it). A split row resolves a "live" partner against
 * it: which tab, which trip. Null outside the desk → "elsewhere".
 */
export const FloorPairRowsContext = createContext<ReadonlyMap<number, FloorBoardRow> | null>(null);
export const useFloorPairRows = () => useContext(FloorPairRowsContext);

/**
 * The pair bar's two colours, as inline box-shadow values — they compose with
 * the duplicate-SO bar on the same cell, which is itself an inline shadow
 * (DUP_SO_SOFT_BAR), so a class cannot be used. Token VALUES, copied from
 * tailwind.config.ts the way the sidebar accent spells brand-600
 * (CLAUDE_UI §2.2): keep them in step with the config.
 */
const PAIR_BAR_OK = "#7C3AED"; // brand-600
const PAIR_BAR_WARN = "#D97706"; // warn.DEFAULT

export type PairBar = "ok" | "warn";

export function pairBarShadow(bar: PairBar | null): string | null {
  if (bar === null) return null;
  return `inset 3px 0 0 ${bar === "warn" ? PAIR_BAR_WARN : PAIR_BAR_OK}`;
}

/** What one row needs to draw its pair facts. Null = not paired. */
export interface PairRender {
  /** Merged block (every member here, consecutive). */
  together: boolean;
  /** Merged only: first row of the block (draws the rowspan'd cells). */
  first: boolean;
  /** Merged only: rows in the block (the rowspan). */
  size: number;
  /** Merged only: every member's orderId, block order. */
  memberIds: number[];
  k: number;
  n: number;
  bar: PairBar | null;
  /** The Invoice cell's chip (or the OBD date line's, where there is no Invoice cell). */
  chip: { text: string; warn: boolean; title?: string } | null;
}

function pairable(r: FloorBoardRow): boolean {
  return !r.redelivery && r.invoiceNo !== null && (r.invoicePartners?.length ?? 0) > 0;
}

/** Still with the tint room: waiting, with an operator, or on the mixer. */
function stillTinting(r: FloorBoardRow): boolean {
  const st = rowStatus(r);
  return st === "tintPending" || st === "tintAssigned" || st === "tinting";
}

/** Where a missing member is, in short words, and whether it needs attention. */
function partnerWhere(
  p: InvoicePartner,
  self: FloorBoardRow,
  rowById: ReadonlyMap<number, FloorBoardRow> | null,
): { word: string; warn: boolean; title?: string } {
  switch (p.place) {
    case "removed":
      return { word: "removed", warn: true };
    case "cancelled":
      return { word: "cancelled", warn: true };
    case "challan":
      return { word: "on challan", warn: false };
    case "hold":
      return { word: "on hold", warn: true };
    case "dispatched":
      return { word: "dispatched", warn: false };
    case "live": {
      if (rowById === null) return { word: "elsewhere", warn: true };
      const row = rowById.get(p.orderId);
      if (!row) return { word: "not on board", warn: true };
      const selfTint = isTintRoomRow(self);
      // The tabs' own split (isTintRoomRow), plus a bill on the mixer.
      if (!selfTint && (isTintRoomRow(row) || stillTinting(row))) return { word: "at tint", warn: true };
      if (selfTint && !isTintRoomRow(row)) return { word: "on Floor", warn: true };
      if (row.tripNumber && row.tripNumber !== self.tripNumber) {
        return { word: "on another trip", warn: true, title: `On ${row.tripNumber}` };
      }
      if (!row.tripNumber && self.tripNumber) return { word: "to plan", warn: true };
      if (row.tripNumber && row.tripNumber === self.tripNumber) return { word: "on this trip", warn: false };
      if (row.zone !== self.zone) return { word: row.zone === "upcoming" ? "upcoming" : "due now", warn: true };
      // Same tab, same zone, another group (route, ship-to block, truck card).
      return { word: "elsewhere", warn: false };
    }
  }
}

/** k of n by OBD number across the whole invoice — both halves of a split agree. */
function obdOrder(self: FloorBoardRow): string[] {
  return [self.obdNumber, ...self.invoicePartners.map((p) => p.obdNumber)].sort((a, b) => a.localeCompare(b));
}

/**
 * The pair facts for every row of ONE rendered list, keyed by orderId. Rows
 * absent from the map are not paired (no invoice, no partner, a re-delivery).
 * `live` false (History / upcoming variants): "k of n" and the merge only — no
 * place chips, no amber.
 */
export function buildPairRenders(
  list: FloorBoardRow[],
  live: boolean,
  rowById: ReadonlyMap<number, FloorBoardRow> | null,
): Map<number, PairRender> {
  const out = new Map<number, PairRender>();
  let i = 0;
  while (i < list.length) {
    const r = list[i];
    if (!pairable(r)) {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < list.length && pairable(list[j]) && list[j].invoiceNo === r.invoiceNo) j++;
    const run = list.slice(i, j);
    const ids = new Set(run.map((x) => x.orderId));
    const together =
      run.length > 1 &&
      run.every((x) => x.invoicePartners.length === run.length - 1 && x.invoicePartners.every((p) => ids.has(p.orderId)));

    if (together) {
      const tinting = live ? run.filter(stillTinting).length : 0;
      run.forEach((x, idx) =>
        out.set(x.orderId, {
          together: true,
          first: idx === 0,
          size: run.length,
          memberIds: run.map((m) => m.orderId),
          k: idx + 1,
          n: run.length,
          bar: tinting > 0 ? "warn" : "ok",
          chip: tinting > 0 ? { text: `${tinting} at tint`, warn: true } : null,
        }),
      );
    } else {
      for (const x of run) {
        const order = obdOrder(x);
        const n = order.length;
        const k = order.indexOf(x.obdNumber) + 1;
        let chip: PairRender["chip"] = null;
        let bar: PairBar | null = null;
        if (live) {
          // Missing = every partner not drawn in THIS run (a 3-OBD invoice with
          // two here draws them as split rows naming only the third).
          const missing = x.invoicePartners.filter((p) => !ids.has(p.orderId));
          const byWord = new Map<string, { ks: number[]; warn: boolean; titles: string[] }>();
          for (const p of missing) {
            const w = partnerWhere(p, x, rowById);
            const e = byWord.get(w.word) ?? { ks: [], warn: w.warn, titles: [] };
            e.ks.push(order.indexOf(p.obdNumber) + 1);
            e.titles.push(`${p.obdNumber}${w.title ? ` — ${w.title}` : ""}`);
            byWord.set(w.word, e);
          }
          const parts = Array.from(byWord.entries()).map(([word, e]) => `${e.ks.sort((a, b) => a - b).join(", ")} ${word}`);
          const warn = Array.from(byWord.values()).some((e) => e.warn);
          if (parts.length > 0) {
            chip = {
              text: parts.join(" · "),
              warn,
              title: `Same invoice ${x.invoiceNo}: ${Array.from(byWord.entries())
                .map(([word, e]) => `${e.titles.join(", ")} ${word}`)
                .join("; ")}`,
            };
          }
          bar = warn ? "warn" : "ok";
        }
        out.set(x.orderId, { together: false, first: true, size: 1, memberIds: [x.orderId], k, n, bar, chip });
      }
    }
    i = j;
  }
  return out;
}

/** "1 of 2" — on the OBD cell of every paired row. No word "OBD". */
export function KOfNChip({ k, n, invoiceNo }: { k: number; n: number; invoiceNo: string | null }) {
  return (
    <span
      title={`${k} of ${n} OBDs on invoice ${invoiceNo ?? ""}`}
      className="ml-1.5 rounded-[3px] bg-ink-50 px-[5px] py-px align-[1px] text-[9.5px] font-semibold tabular-nums text-ink-600"
    >
      {k} of {n}
    </span>
  );
}

/** A pair place chip: amber (warn tokens) when it needs attention, ink otherwise. */
export function PairPlaceChip({ chip }: { chip: NonNullable<PairRender["chip"]> }) {
  return (
    <span
      title={chip.title}
      className={`inline-block rounded-[3px] px-[5px] py-px text-[9.5px] font-semibold ${
        chip.warn ? "bg-warn-bg text-warn-text" : "bg-ink-50 text-ink-600"
      }`}
    >
      {chip.text}
    </span>
  );
}
