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
// Columns (fixed table standard, CLAUDE_UI §27):
//   ☐ · OBD · Invoice · Ship to · Route · Type · L · Kg · Article · Held since · Held from · Held by
// Rows are `FloorHoldRow` (lib/floor/queries.ts getFloorHold). "Held since" reads
// heldSince — the real hold moment, "~" when approximated from the arrival date.

import { Building2 } from "lucide-react";
import { ColourWorkBadge } from "@/components/picking/card-atoms";
import { HandBadge } from "@/components/shared/hand-badge";
import { shipMarkers } from "./floor-table";
import { InvoiceLines, ObdDateLine } from "./bill-ref-cells";
import { formatLitres, formatWeightKg } from "./status-pill";
import { formatArticleTag } from "@/lib/floor/format";
import { loadKg, loadLitres } from "@/lib/orders/gift";
import { heldSinceLabel, holdAgeDays } from "@/lib/floor/hold-log";
import { isAllIdsSelected, type FloorSelection } from "@/lib/floor/selection";
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

/** Every data column, in display order, with its share of the row (sums to 97;
 *  the tick column takes 3 → 100). A `columns` subset is re-scaled to fill. */
const COLUMN_WIDTH: Record<HoldColumn, number> = {
  obd: 11,
  invoice: 9,
  shipTo: 21,
  route: 9,
  type: 7,
  litres: 5,
  kg: 5,
  article: 7,
  heldSince: 7,
  heldFrom: 9,
  heldBy: 7,
};
export const HOLD_COLUMNS: HoldColumn[] = Object.keys(COLUMN_WIDTH) as HoldColumn[];
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

function Cell({ col, row, now }: { col: HoldColumn; row: FloorHoldRow; now: Date }) {
  switch (col) {
    case "obd":
      return (
        <td className={TD}>
          <span className="font-mono text-[11.5px] font-medium text-[#111827]">{row.obdNumber}</span>
          <ObdDateLine iso={row.obdDateTime} isEmailTime={false} />
        </td>
      );
    case "invoice":
      return (
        <td className={TD}>
          {row.invoiceNo || row.invoiceDate ? (
            <InvoiceLines invoiceNo={row.invoiceNo} invoiceDate={row.invoiceDate} />
          ) : (
            DASH
          )}
        </td>
      );
    case "shipTo": {
      const { isSite, isRedirect } = shipMarkers(row);
      return (
        <td className={TD}>
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
      return (
        <td className={`${TD} ${row.heldByName === "System" ? "text-ink-400" : ""}`}>
          {row.heldByName ?? DASH}
        </td>
      );
  }
}

export function HoldTable({
  rows,
  now,
  selection,
  onToggleRow,
  onToggleAll,
  onOpenRow,
  selectable = true,
  columns = HOLD_COLUMNS,
}: {
  rows: FloorHoldRow[];
  /** One clock per render pass, so every age on screen agrees. */
  now: Date;
  selection?: FloorSelection;
  onToggleRow?: (orderId: number) => void;
  onToggleAll?: (rows: FloorHoldRow[]) => void;
  /** Row click. Omit and rows are inert. */
  onOpenRow?: (orderId: number) => void;
  /** Draw the tick column (default true). */
  selectable?: boolean;
  /** Which data columns, in display order (default all). */
  columns?: HoldColumn[];
}) {
  const sel = selection ?? new Set<number>();
  const allOn = isAllIdsSelected(sel, rows);
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
        {rows.map((row) => (
          <tr
            key={row.orderId}
            className={onOpenRow ? "cursor-pointer hover:bg-[#fafafa]" : "hover:bg-[#fafafa]"}
            onClick={onOpenRow ? () => onOpenRow(row.orderId) : undefined}
          >
            {selectable && (
              <td className={TD_C} onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  aria-label={`Select ${row.obdNumber}`}
                  className="h-[13px] w-[13px] cursor-pointer align-middle accent-brand-600"
                  checked={sel.has(row.orderId)}
                  onChange={() => onToggleRow?.(row.orderId)}
                />
              </td>
            )}
            {columns.map((c) => (
              <Cell key={c} col={c} row={row} now={now} />
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
