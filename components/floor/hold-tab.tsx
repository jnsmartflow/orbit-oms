"use client";

// Floor Control — the On-hold tab (design §8, mockup 01-board.html `holdTbl` +
// the hold-pane branch of render()). A TABLE in the main area, not cards in the
// rail: "the list can reach 100+, which is why it is a table … the rail only ever
// holds work he will finish today." (design §8)
//
// The rows are drawn by the SHARED held-bills table, components/floor/hold-table.tsx
// (2026-10-02: ☐ · OBD · Invoice · Ship to · Route · Type · L · Kg · Article ·
// Held since · Held by) — one <HoldTable> per age band. Everything
// Floor-only stays HERE: the bands, the Recent-first / Oldest-first toggle, the
// release bar (bulk selection), row click → detail panel, and Export PDF
// (components/floor/pdf-preview.tsx, its own five columns, unchanged).
//
// "Held since" reads FloorHoldRow.heldSince — the real wall-clock hold moment,
// derived on the read side (lib/floor/queries.ts getFloorHold + hold-log.ts), NOT
// orders.heldAt (the arrival date). An approximated value carries a "~" so it can
// never read as a recorded one.

import { useEffect, useMemo, useState } from "react";
import { FileText } from "lucide-react";
import { FloorSkeleton } from "./floor-skeleton";
import { HoldBar } from "./hold-bar";
import { HoldTable } from "./hold-table";
import { PdfPreview } from "./pdf-preview";
import { toggleOne, toggleAllIds, type FloorSelection } from "@/lib/floor/selection";
import { groupByHoldBand } from "@/lib/floor/hold-log";
import { countArticles } from "@/lib/floor/format";
import type { FloorHoldRow } from "@/lib/floor/types";
import type { DispatchWindow } from "@/components/floor/dispatch-slot-picker";

export function HoldTab({
  rows,
  loading,
  error,
  scope,
  windows,
  onRelease,
  onOpenDetail,
  menuOpen,
  onMenuOpenChange,
  onOpenOffFloor,
}: {
  rows: FloorHoldRow[] | null;
  loading: boolean;
  error: string | null;
  scope: string;
  windows: DispatchWindow[];
  onRelease: (orderIds: number[], date: string, windowId: number) => Promise<void>;
  onOpenDetail: (id: number) => void;
  /** The bar's ··· More — owned by floor-page, the single Esc owner. */
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  /**
   * Open the Cancel / Raise CI form on these held bills. `keepTicked` is called
   * once a request goes through, with the bills that did NOT go — the only ones
   * left ticked. The selection is this tab's own, which is why it is handed in.
   */
  onOpenOffFloor: (rows: FloorHoldRow[], keepTicked: (orderIds: number[]) => void) => void;
}) {
  const [oldestFirst, setOldestFirst] = useState(false);
  const [selection, setSelection] = useState<FloorSelection>(new Set());
  const [busy, setBusy] = useState(false);
  const [pdfOpen, setPdfOpen] = useState(false);

  // A stable clock for this render pass — every age computation on screen agrees.
  const now = useMemo(() => new Date(), [rows]);
  const list = rows ?? [];
  const bands = useMemo(() => groupByHoldBand(list, now, oldestFirst), [list, now, oldestFirst]);

  const selectedRows = list.filter((r) => selection.has(r.orderId));
  const selectedIds = selectedRows.map((r) => r.orderId);
  // The bar's figures — the same two helpers' meaning as the Floor tab's bar.
  const selectedArticles = countArticles(selectedRows.map((r) => r.articleTag)).pieces;
  const selectedRoutes = new Set(selectedRows.map((r) => r.route ?? "\u0000unrouted")).size;
  const clear = () => setSelection(new Set());
  // The menu lives on the bar; when the ticks go, the bar goes, and the menu
  // must not come back "open" with the next tick.
  useEffect(() => {
    if (selectedIds.length === 0 && menuOpen) onMenuOpenChange(false);
  }, [selectedIds.length, menuOpen, onMenuOpenChange]);

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

      {/* Body. Room at the bottom while the bar is up, so it never covers the
          last rows. */}
      <div className={`min-h-0 flex-1 overflow-y-auto ${selectedIds.length > 0 ? "pb-[84px]" : ""}`}>
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
              <HoldTable
                rows={bandRows}
                now={now}
                selection={selection}
                onToggleRow={(id) => setSelection((s) => toggleOne(s, id))}
                onToggleAll={(rs) => setSelection((s) => toggleAllIds(s, rs))}
                onOpenRow={onOpenDetail}
              />
            </div>
          ))
        )}
      </div>

      {selectedIds.length > 0 && (
        <HoldBar
          count={selectedIds.length}
          articles={selectedArticles}
          routes={selectedRoutes}
          windows={windows}
          busy={busy}
          onRelease={doRelease}
          onClear={clear}
          menuOpen={menuOpen}
          onMenuOpenChange={onMenuOpenChange}
          onOffFloor={() => onOpenOffFloor(selectedRows, (ids) => setSelection(new Set(ids)))}
        />
      )}

      {pdfOpen && <PdfPreview rows={list} scope={scope} onClose={() => setPdfOpen(false)} />}
    </div>
  );
}
