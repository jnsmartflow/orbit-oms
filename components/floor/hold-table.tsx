"use client";

// The held-bills TABLE — ONE component for every screen that lists held bills
// (2026-10-02). Floor-owned (CLAUDE_FLOOR §4.9 family). Floor's On hold tab
// renders it once per age band (components/floor/hold-tab.tsx); the Freight Trips
// pool will import it as-is (owner decision: same table, built once).
//
// 🔴 NOTHING FLOOR-ONLY LIVES HERE — no Release, no ··· More, no PDF, no bands,
// no toolbar. Those belong to the caller. A caller that passes no `onOpenRow`
// gets rows that do nothing on click; `selectable={false}` drops the tick column.
//
// Columns (fixed table standard, CLAUDE_UI §27), default:
//   ☐ · OBD · Invoice · Ship to · Route · Type · L · Kg · Article · Held since · Held by
// "Held from" is available on request (`columns`), not shown by default.
// Rows are `FloorHoldRow` (lib/floor/queries.ts getFloorHold). "Held since" reads
// heldSince — the real hold moment, "~" when approximated from the arrival date.

import { Building2 } from "lucide-react";
import { ColourWorkBadge } from "@/components/picking/card-atoms";
import { HandBadge } from "@/components/shared/hand-badge";
import { SampleBadge } from "@/components/shared/sample-badge";
import { ChallanBadge } from "@/components/shared/challan-badge";
import { ObdBadge } from "@/components/shared/obd-badge";
import { shipMarkers, shortTripNumber, SEARCH_HIT_ROW_CLS } from "./floor-table";
import { InvoiceLines, LoadPartChip, ObdDateLine } from "./bill-ref-cells";
import { PairPlaceChip, pairBarBorderCls, type PairBarKind } from "./pair-cells";
import { awayChipOf, drawRowsOf, type FloorInvoiceRow } from "@/lib/floor/invoice-rows";
import { formatLitres, formatWeightKg } from "./status-pill";
import { formatArticleTag } from "@/lib/floor/format";
import { loadKg, loadLitres } from "@/lib/orders/gift";
import { heldSinceLabel, holdAgeDays } from "@/lib/floor/hold-log";
import {
  holdKeysOf,
  invKey,
  isAllHoldKeysSelected,
  isAllIdsSelected,
  type FloorDeskKey,
  type FloorSelection,
} from "@/lib/floor/selection";
import type { FloorHoldRow } from "@/lib/floor/types";

export type HoldColumn =
  | "obd"
  | "invoice"
  | "shipTo"
  | "route"
  | "type"
  | "litres"
  | "kg"
  | "article"
  | "heldSince"
  | "heldFrom"
  | "heldBy";

/** Each data column's share of the row. The DEFAULT set below sums to 97 (the tick
 *  column takes 3 → 100); any `columns` choice is re-scaled to fill the row. */
const COLUMN_WIDTH: Record<HoldColumn, number> = {
  obd: 12,
  invoice: 10,
  shipTo: 24,
  route: 10,
  type: 7,
  litres: 5,
  kg: 5,
  article: 8,
  heldSince: 8,
  heldFrom: 9,
  heldBy: 8,
};

/** The default columns, in display order. "Held from" is NOT shown by default
 *  (owner 2026-10-02) — row.heldFrom stays in the data, and a caller that wants
 *  the column passes it in `columns`. */
export const HOLD_COLUMNS: HoldColumn[] = [
  "obd", "invoice", "shipTo", "route", "type", "litres", "kg", "article", "heldSince", "heldBy",
];
const TICK_WIDTH = 3;

const HEADER: Record<HoldColumn, string> = {
  obd: "OBD",
  invoice: "Invoice",
  shipTo: "Ship to",
  route: "Route",
  type: "Type",
  litres: "L",
  kg: "Kg",
  article: "Article",
  heldSince: "Held since",
  heldFrom: "Held from",
  heldBy: "Held by",
};
const NUMERIC: ReadonlySet<HoldColumn> = new Set<HoldColumn>(["litres", "kg"]);

// §27 sizing — header 32px, cells px-3.5, first column centred and narrow.
const HEAD_TH = "h-[32px] border-b border-[#ebebeb] px-3.5 text-left text-[10px] font-medium uppercase tracking-[0.05em] text-[#9ca3af]";
const HEAD_TH_R = HEAD_TH.replace("text-left", "text-right");
const HEAD_TH_C = "h-[32px] border-b border-[#ebebeb] pl-[10px] pr-[4px] text-center text-[10px] font-medium uppercase tracking-[0.05em] text-[#9ca3af]";
const TD = "border-b border-[#f0f0f0] px-3.5 py-2 text-[11px] text-[#4b5563] whitespace-nowrap overflow-hidden text-ellipsis";
const TD_R = `${TD} text-right tabular-nums`;
const TD_C = "border-b border-[#f0f0f0] pl-[10px] pr-[4px] py-2 text-center text-[11px]";
const DASH = <span className="text-ink-400">—</span>;

/** One drawn invoice row of a split OBD (6.1): "k/n" and, on the first drawn
 *  row, where the OBD's other invoices are ("2 in To plan"). */
type InvoicePart = {
  k: number;
  n: number;
  /** The "k/n" chip to draw (papers) and the Split load "part k of n" — drawRowsOf. */
  chip: { k: number; n: number } | null;
  load: { k: number; n: number } | null;
  away: { text: string; title: string } | null;
  first: boolean;
};

function Cell({ col, row, now, part = null }: { col: HoldColumn; row: FloorHoldRow; now: Date; part?: InvoicePart | null }) {
  switch (col) {
    case "obd":
      return (
        <td className={TD}>
          <span className="font-mono text-[11.5px] font-medium text-[#111827]">{row.obdNumber}</span>
          {/* A truck part with no SAP number yet: its tag sits by the OBD number. */}
          {part?.load && row.invoiceNo === null && <LoadPartChip k={part.load.k} n={part.load.n} className="ml-1.5" />}
          <ObdDateLine iso={row.obdDateTime} isEmailTime={false} />
        </td>
      );
    case "invoice":
      return (
        <td className={TD}>
          {row.invoiceNo || row.invoiceDate ? (
            part ? (
              <InvoiceLines invoiceNo={row.invoiceNo} invoiceDate={row.invoiceDate} part={part.chip} load={part.load} />
            ) : (
              <InvoiceLines invoiceNo={row.invoiceNo} invoiceDate={row.invoiceDate} invoiceCount={row.invoiceCount} />
            )
          ) : (
            DASH
          )}
          {part?.away && part.first && (
            <div className="mt-0.5 overflow-hidden text-ellipsis">
              <PairPlaceChip chip={{ text: part.away.text, warn: true, title: part.away.title }} />
            </div>
          )}
        </td>
      );
    case "shipTo": {
      const { isSite, isRedirect } = shipMarkers(row);
      return (
        <td className={TD}>
          {/* CHALLAN (2026-10-07) — before the dealer name, as on the board (M2). */}
          {row.isChallanOrder && (
            <span className="mr-1.5 inline-block align-[-1px]">
              <ChallanBadge />
            </span>
          )}
          {/* OBD (2026-10-16) — after CHALLAN, same slot and shape. */}
          {row.isObdImport && (
            <span className="mr-1.5 inline-block align-[-1px]">
              <ObdBadge />
            </span>
          )}
          <span className="text-[11.5px] font-medium text-[#111827]">{row.dealerName}</span>
          {row.isKeyCustomer && <span className="ml-1.5 text-[#f59e0b]">★</span>}
          {row.priorityLevel === 1 && <span className="ml-1 text-[#ef4444]">⚡</span>}
          {isSite && <Building2 size={12} className="ml-1 inline-block align-[-1px] text-[#475569]" />}
          {row.colourWork !== null && (
            <span className="ml-1 inline-block align-[-1px]">
              <ColourWorkBadge work={row.colourWork} />
            </span>
          )}
          {row.isHand && (
            <span className="ml-1 inline-block align-[-1px]">
              <HandBadge />
            </span>
          )}
          {row.isSample && (
            <span className="ml-1 inline-block align-[-1px]">
              <SampleBadge />
            </span>
          )}
          {isSite && <div className="text-[10.5px] text-[#9ca3af]">billed to {row.billToName ?? "—"}</div>}
          {isRedirect && <div className="text-[11px] text-brand-800">→ ship-to changed</div>}
        </td>
      );
    }
    case "route":
      return <td className={TD}>{row.route ?? DASH}</td>;
    case "type":
      return <td className={TD}>{row.deliveryType ?? DASH}</td>;
    case "litres":
      // Gift = 0 L by rule (lib/orders/gift.ts); a missing volume is also 0 for a load.
      return (
        <td className={TD_R} title={row.isGift ? "Gift — not counted in load totals" : undefined}>
          {formatLitres(loadLitres(row.volumeLitres, row.isGift))}
        </td>
      );
    case "kg": {
      const kg = loadKg(row.weightKg, row.isGift);
      const text = row.isGift ? "0" : formatWeightKg(kg);
      return (
        <td className={TD_R} title={row.isGift ? "Gift — not counted in load totals" : undefined}>
          {text ?? DASH}
        </td>
      );
    }
    case "article":
      return <td className={TD}>{row.articleTag ? formatArticleTag(row.articleTag) : DASH}</td>;
    case "heldSince": {
      const days = holdAgeDays(row.heldSince, now);
      const approx = row.heldSinceSource === "approx";
      const unknown = row.heldSinceSource === "unknown";
      return (
        <td
          className={`${TD} text-[10.5px] ${unknown ? "text-[#9ca3af]" : "text-[#6b7280]"}`}
          title={approx ? "Approximate — no hold event recorded; showing arrival date" : undefined}
        >
          {approx ? "~ " : ""}
          {heldSinceLabel(days)}
        </td>
      );
    }
    case "heldFrom":
      // A source label, not a status — ink, never brand or a status colour (UI §1).
      return (
        <td className={TD}>
          <span
            className={`inline-block max-w-full truncate rounded-[4px] border border-ink-100 bg-ink-50 px-1.5 py-[1px] text-[10px] font-medium ${
              row.heldFrom === "Unknown" ? "text-ink-400" : "text-ink-700"
            }`}
          >
            {row.heldFrom}
          </span>
        </td>
      );
    case "heldBy":
      // getFloorHold decides the text (name / "System" / null) — rendered as-is.
      return (
        <td className={`${TD} ${row.heldByName === "System" ? "text-ink-400" : ""}`}>
          {row.heldByName ?? DASH}
        </td>
      );
  }
}

/** A drawn invoice row's cells read the INVOICE's own number, date, litres,
 *  kg and hold (6.1) — everything else is the OBD's. */
function invoiceCellRow(row: FloorHoldRow, inv: FloorInvoiceRow): FloorHoldRow {
  return {
    ...row,
    invoiceNo: inv.invoiceNo,
    invoiceDate: inv.invoiceDate,
    volumeLitres: inv.litres,
    weightKg: inv.kg,
    heldSince: inv.heldAt ?? row.heldSince,
    heldSinceSource: inv.heldAt ? "log" : row.heldSinceSource,
    heldByName: inv.heldAt ? (inv.heldByName ?? null) : row.heldByName,
  };
}

type DrawnHoldRow = {
  key: string;
  tick: FloorDeskKey;
  row: FloorHoldRow;
  cellRow: FloorHoldRow;
  part: InvoicePart | null;
  seq: number | undefined;
  last: boolean;
};

export function HoldTable({
  rows,
  now,
  selection,
  onToggleRow,
  onToggleAll,
  onOpenRow,
  selectable = true,
  columns = HOLD_COLUMNS,
  perInvoice = false,
  onToggleKey,
}: {
  rows: FloorHoldRow[];
  /** One clock per render pass, so every age on screen agrees. */
  now: Date;
  /** orderIds — plus `inv:` keys when `perInvoice`. */
  selection?: FloorSelection | ReadonlySet<FloorDeskKey>;
  onToggleRow?: (orderId: number) => void;
  onToggleAll?: (rows: FloorHoldRow[]) => void;
  /** Row click — with the invoice's seq on a drawn invoice row. Omit and rows are inert. */
  onOpenRow?: (orderId: number, invoiceSeq?: number) => void;
  /** Draw the tick column (default true). */
  selectable?: boolean;
  /** Which data columns, in display order (default all). */
  columns?: HoldColumn[];
  /**
   * 6.1 (2026-10-19) — FLOOR'S On hold tab only: a split OBD with held invoices
   * draws ONE ROW PER HELD INVOICE (Floor's rules: OBD repeated, "k/n", the
   * invoice's litres / kg / held since / held by, its own tick by `inv:<id>`,
   * an amber bar + chip when its other invoices are elsewhere). Off (Freight
   * Trips, the Tint Manager) = one row per OBD, exactly as before.
   */
  perInvoice?: boolean;
  /** perInvoice: a tick by key (orderId or `inv:<id>`). */
  onToggleKey?: (key: FloorDeskKey) => void;
}) {
  const sel: ReadonlySet<FloorDeskKey> = selection ?? new Set<number>();
  const allOn = perInvoice ? isAllHoldKeysSelected(sel, rows) : isAllIdsSelected(sel as FloorSelection, rows);
  // The rows as DRAWN: per invoice where it applies, else one per OBD.
  const drawn: DrawnHoldRow[] = rows.flatMap((row): DrawnHoldRow[] => {
    const keys = perInvoice ? holdKeysOf(row) : [row.orderId];
    if (typeof keys[0] === "number") {
      return [{ key: String(row.orderId), tick: row.orderId, row, cellRow: row, part: null, seq: undefined, last: true }];
    }
    const away = awayChipOf(row.invoiceRowsAll ?? row.invoiceRows, row.invoiceRows, shortTripNumber);
    return drawRowsOf(row).map((d) => ({
      key: d.key,
      tick: invKey(d.invoice!.id),
      row,
      cellRow: invoiceCellRow(row, d.invoice!),
      part: { k: d.k, n: d.n, chip: d.chip, load: d.load, away, first: d.first },
      seq: d.invoice!.seq,
      last: d.last,
    }));
  });
  // Re-scale the chosen columns so the row always fills 100%.
  const dataShare = 100 - (selectable ? TICK_WIDTH : 0);
  const chosenTotal = columns.reduce((s, c) => s + COLUMN_WIDTH[c], 0) || 1;
  const width = (c: HoldColumn) => `${((COLUMN_WIDTH[c] / chosenTotal) * dataShare).toFixed(3)}%`;

  return (
    <table className="w-full table-fixed border-collapse">
      <colgroup>
        {selectable && <col style={{ width: `${TICK_WIDTH}%` }} />}
        {columns.map((c) => (
          <col key={c} style={{ width: width(c) }} />
        ))}
      </colgroup>
      <thead>
        <tr>
          {selectable && (
            <th className={HEAD_TH_C}>
              <input
                type="checkbox"
                aria-label="Select all held bills in this group"
                className="h-[13px] w-[13px] cursor-pointer align-middle accent-brand-600"
                checked={allOn}
                onChange={() => onToggleAll?.(rows)}
              />
            </th>
          )}
          {columns.map((c) => (
            <th key={c} className={NUMERIC.has(c) ? HEAD_TH_R : HEAD_TH}>
              {HEADER[c]}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {drawn.map(({ key, tick, row, cellRow, part, seq, last }) => {
          // 6.1 — a drawn invoice row: the bar (violet ticked, amber when its
          // other invoices are elsewhere, else the pair token) and a faint
          // dashed line between the OBD's invoices.
          const bar: PairBarKind | null = part ? (sel.has(tick) ? "selected" : part.away ? "warn" : "ok") : null;
          const dashed = part && !last ? " [&>td]:border-ink-100 [&>td]:[border-bottom-style:dashed]" : "";
          return (
            <tr
              key={key}
              // data-order-id + SEARCH_HIT_ROW_CLS: Floor search's row light
              // (floor-table.tsx). Inert for Freight Trips, which never sets it.
              data-order-id={row.orderId}
              className={`${onOpenRow ? "cursor-pointer hover:bg-[#fafafa]" : "hover:bg-[#fafafa]"} ${SEARCH_HIT_ROW_CLS}${dashed}`}
              onClick={onOpenRow ? () => (seq !== undefined ? onOpenRow(row.orderId, seq) : onOpenRow(row.orderId)) : undefined}
            >
              {selectable && (
                <td className={`${TD_C}${pairBarBorderCls(bar)}`} onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    aria-label={
                      part
                        ? `Select invoice ${part.k} of ${part.n} of ${row.obdNumber}${cellRow.invoiceNo ? ` (${cellRow.invoiceNo})` : ""}`
                        : `Select ${row.obdNumber}`
                    }
                    className="h-[13px] w-[13px] cursor-pointer align-middle accent-brand-600"
                    checked={sel.has(tick)}
                    onChange={() => (perInvoice && onToggleKey ? onToggleKey(tick) : onToggleRow?.(row.orderId))}
                  />
                </td>
              )}
              {columns.map((c) => (
                <Cell key={c} col={c} row={cellRow} now={now} part={part} />
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
