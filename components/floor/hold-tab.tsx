"use client";

// Floor Control — the On-hold tab (design §8, mockup 01-board.html `holdTbl` +
// the hold-pane branch of render()). A TABLE in the main area, not cards in the
// rail: "the list can reach 100+, which is why it is a table … the rail only ever
// holds work he will finish today." (design §8)
//
// Five columns only: ☐ · OBD + date · Ship to · Route · Held since. No reason
// column — it lives in the detail panel (a later step). Grouped by hold age, with
// a Recent-first / Oldest-first toggle. Bulk selection lifts the release bar.
// Export PDF opens a preview (components/floor/pdf-preview.tsx).
//
// "Held since" reads FloorHoldRow.heldSince — the real wall-clock hold moment,
// derived on the read side (lib/floor/queries.ts getFloorHold + hold-log.ts), NOT
// orders.heldAt (the arrival date). An approximated value carries a "~" so it can
// never read as a recorded one.

import { useMemo, useState } from "react";
import { Building2, Droplet, FileText } from "lucide-react";
import { FloorSkeleton } from "./floor-skeleton";
import { HoldBar } from "./hold-bar";
import { PdfPreview } from "./pdf-preview";
import { shipMarkers } from "./floor-table";
import { toggleOne, toggleAllIds, isAllIdsSelected, type FloorSelection } from "@/lib/floor/selection";
import { groupByHoldBand, heldSinceLabel, holdAgeDays } from "@/lib/floor/hold-log";
import type { FloorHoldRow } from "@/lib/floor/types";
import type { DispatchWindow } from "@/components/support/dispatch-slot-picker";

function fmtDateTime(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso)
    .toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" })
    .replace(",", "");
}

const HEAD_TH = "h-[31px] border-b border-[#ebebeb] px-3.5 text-left text-[10px] font-medium uppercase tracking-[0.05em] text-[#9ca3af]";
const HEAD_TH_C = "h-[31px] border-b border-[#ebebeb] px-1 text-center text-[10px] font-medium uppercase tracking-[0.05em] text-[#9ca3af]";
const TD = "border-b border-[#f0f0f0] px-3.5 py-2 text-[11px] text-[#4b5563] whitespace-nowrap overflow-hidden text-ellipsis";
const TD_C = "border-b border-[#f0f0f0] px-1 py-2 text-center text-[11px]";

// ☐ 4 · OBD 20 · Ship to 39 · Route 22 · Held since 15 (sums to 100).
const WIDTHS = [4, 20, 39, 22, 15];

function HoldRows({
  rows,
  now,
  selection,
  onToggleRow,
  onToggleAll,
  onOpenDetail,
}: {
  rows: FloorHoldRow[];
  now: Date;
  selection: FloorSelection;
  onToggleRow: (id: number) => void;
  onToggleAll: (rows: FloorHoldRow[]) => void;
  onOpenDetail: (id: number) => void;
}) {
  const allOn = isAllIdsSelected(selection, rows);
  return (
    <table className="w-full table-fixed border-collapse">
      <colgroup>
        {WIDTHS.map((w, i) => (
          <col key={i} style={{ width: `${w}%` }} />
        ))}
      </colgroup>
      <thead>
        <tr>
          <th className={HEAD_TH_C}>
            <input
              type="checkbox"
              aria-label="Select all held bills in this band"
              className="h-[13px] w-[13px] cursor-pointer align-middle accent-teal-600"
              checked={allOn}
              onChange={() => onToggleAll(rows)}
            />
          </th>
          <th className={HEAD_TH}>OBD</th>
          <th className={HEAD_TH}>Ship to</th>
          <th className={HEAD_TH}>Route</th>
          <th className={HEAD_TH}>Held since</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const { isSite, isRedirect } = shipMarkers(row);
          const days = holdAgeDays(row.heldSince, now);
          const approx = row.heldSinceSource === "approx";
          const unknown = row.heldSinceSource === "unknown";
          return (
            <tr key={row.orderId} className="cursor-pointer hover:bg-[#fafafa]" onClick={() => onOpenDetail(row.orderId)}>
              <td className={TD_C} onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  aria-label={`Select ${row.obdNumber}`}
                  className="h-[13px] w-[13px] cursor-pointer align-middle accent-teal-600"
                  checked={selection.has(row.orderId)}
                  onChange={() => onToggleRow(row.orderId)}
                />
              </td>
              <td className={TD}>
                <span className="font-mono text-[11.5px] font-medium text-[#111827]">{row.obdNumber}</span>
                <div className="text-[10px] text-[#9ca3af]">{fmtDateTime(row.obdDateTime)}</div>
              </td>
              <td className={TD}>
                <span className="text-[11.5px] font-medium text-[#111827]">{row.dealerName}</span>
                {row.isKeyCustomer && <span className="ml-1.5 text-[#f59e0b]">★</span>}
                {row.priorityLevel === 1 && <span className="ml-1 text-[#ef4444]">⚡</span>}
                {isSite && <Building2 size={12} className="ml-1 inline-block align-[-1px] text-[#475569]" />}
                {row.isTint && <Droplet size={12} className="ml-1 inline-block align-[-1px] text-[#7c3aed]" />}
                {isSite && <div className="text-[10.5px] text-[#9ca3af]">billed to {row.billToName ?? "—"}</div>}
                {isRedirect && <div className="text-[11px] text-[#6d28d9]">→ ship-to changed</div>}
              </td>
              <td className={TD}>{row.route ?? "—"}</td>
              <td
                className={`${TD} text-[10.5px] ${unknown ? "text-[#9ca3af]" : "text-[#6b7280]"}`}
                title={approx ? "Approximate — no hold event recorded; showing arrival date" : undefined}
              >
                {approx ? "~ " : ""}
                {heldSinceLabel(days)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function HoldTab({
  rows,
  loading,
  error,
  scope,
  windows,
  onRelease,
  onOpenDetail,
}: {
  rows: FloorHoldRow[] | null;
  loading: boolean;
  error: string | null;
  scope: string;
  windows: DispatchWindow[];
  onRelease: (orderIds: number[], date: string, windowId: number) => Promise<void>;
  onOpenDetail: (id: number) => void;
}) {
  const [oldestFirst, setOldestFirst] = useState(false);
  const [selection, setSelection] = useState<FloorSelection>(new Set());
  const [busy, setBusy] = useState(false);
  const [pdfOpen, setPdfOpen] = useState(false);

  // A stable clock for this render pass — every age computation on screen agrees.
  const now = useMemo(() => new Date(), [rows]);
  const list = rows ?? [];
  const bands = useMemo(() => groupByHoldBand(list, now, oldestFirst), [list, now, oldestFirst]);

  const selectedIds = list.filter((r) => selection.has(r.orderId)).map((r) => r.orderId);
  const clear = () => setSelection(new Set());

  const doRelease = async (date: string, windowId: number) => {
    if (selectedIds.length === 0) return;
    setBusy(true);
    try {
      await onRelease(selectedIds, date, windowId);
      clear();
    } finally {
      setBusy(false);
    }
  };

  const segBtn = (on: boolean) => `px-[11px] text-[11px] ${on ? "bg-white font-semibold text-gray-900" : "text-gray-500"}`;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {/* Toolbar — sort toggle + Export PDF (mockup vtools on the hold pane). */}
      <div className="flex items-center gap-2 border-b border-gray-200 bg-[#fcfcfd] px-3.5 py-[7px]">
        {!loading && !error && (
          <span className="text-[11px] text-gray-400">
            {list.length} on hold{scope !== "All" ? ` · ${scope}` : ""}
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          <span className="flex h-[27px] overflow-hidden rounded-[6px] border border-gray-200 bg-gray-50">
            <button type="button" onClick={() => setOldestFirst(false)} className={segBtn(!oldestFirst)}>
              Recent first
            </button>
            <button type="button" onClick={() => setOldestFirst(true)} className={segBtn(oldestFirst)}>
              Oldest first
            </button>
          </span>
          <button
            type="button"
            onClick={() => setPdfOpen(true)}
            disabled={list.length === 0}
            className="flex h-[27px] items-center gap-1.5 rounded-[6px] border border-gray-200 bg-white px-[10px] text-[11px] text-gray-500 hover:border-gray-300 hover:text-gray-700 disabled:opacity-40"
          >
            <FileText size={12} />
            Export PDF
          </button>
        </span>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <FloorSkeleton variant="floor" />
        ) : error ? (
          <div className="px-5 py-14 text-center text-[11.5px] text-gray-400">Couldn&rsquo;t load the hold list. {error}</div>
        ) : list.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <div className="text-[28px] leading-none text-[#22c55e]">✓</div>
            <h4 className="mt-2 text-[13px] font-semibold text-gray-900">
              {scope !== "All" ? `Nothing on hold for ${scope}` : "Nothing on hold"}
            </h4>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-gray-400">Everything is either on the floor or waiting for you.</p>
          </div>
        ) : (
          bands.map(({ band, rows: bandRows }) => (
            <div key={band.key}>
              <div className="flex gap-2 border-b border-[#f0f0f0] bg-[#fafafa] px-3.5 py-[7px] text-[10px] font-semibold uppercase tracking-[0.05em] text-[#6b7280]">
                {band.label}
                <span className="font-normal normal-case tracking-normal text-[#9ca3af]">· {bandRows.length} bills</span>
              </div>
              <HoldRows
                rows={bandRows}
                now={now}
                selection={selection}
                onToggleRow={(id) => setSelection((s) => toggleOne(s, id))}
                onToggleAll={(rs) => setSelection((s) => toggleAllIds(s, rs))}
                onOpenDetail={onOpenDetail}
              />
            </div>
          ))
        )}
      </div>

      {selectedIds.length > 0 && (
        <HoldBar count={selectedIds.length} windows={windows} busy={busy} onRelease={doRelease} onClear={clear} />
      )}

      {pdfOpen && <PdfPreview rows={list} scope={scope} onClose={() => setPdfOpen(false)} />}
    </div>
  );
}
