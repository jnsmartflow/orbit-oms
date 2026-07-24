"use client";

// Floor Control — the Cancelled tab (design §9, mockup 01-board.html `cancTbl` +
// `cancBar`). Today's cancelled bills only — anchored to the day they were
// cancelled (the feed, getFloorCancelled, already fences to today IST). Older
// ones live in History.
//
// Six columns: ☐ · OBD + date · Ship to · Route · Reason · Cancelled (time, with
// "by {user}" underneath). Bulk "Restore to decisions" sends each ticked bill
// back to the LEFT RAIL as an undecided card — through the Step-5 actions route
// ("restore"), no new write path.
//
// "Today only … No sort toggle, no PDF, no find box; it is a short list and none
// of that earns its place." (design §9)

import { useState } from "react";
import { Building2, Droplet } from "lucide-react";
import { FloorSkeleton } from "./floor-skeleton";
import { shipMarkers } from "./floor-table";
import { toggleOne, toggleAllIds, isAllIdsSelected, type FloorSelection } from "@/lib/floor/selection";
import type { FloorCancelledRow } from "@/lib/floor/types";

function fmtDateTime(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso)
    .toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" })
    .replace(",", "");
}
function hhmm(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });
}

const HEAD_TH = "h-[31px] border-b border-[#ebebeb] px-3.5 text-left text-[10px] font-medium uppercase tracking-[0.05em] text-[#9ca3af]";
const HEAD_TH_C = "h-[31px] border-b border-[#ebebeb] px-1 text-center text-[10px] font-medium uppercase tracking-[0.05em] text-[#9ca3af]";
const TD = "border-b border-[#f0f0f0] px-3.5 py-2 text-[11px] text-[#4b5563] whitespace-nowrap overflow-hidden text-ellipsis";
const TD_C = "border-b border-[#f0f0f0] px-1 py-2 text-center text-[11px]";

// ☐ 4 · OBD 19 · Ship to 29 · Route 16 · Reason 20 · Cancelled 12 (sums to 100).
const WIDTHS = [4, 19, 29, 16, 20, 12];

export function CancelledTab({
  rows,
  loading,
  error,
  scope,
  onRestore,
  onOpenDetail,
}: {
  rows: FloorCancelledRow[] | null;
  loading: boolean;
  error: string | null;
  scope: string;
  onRestore: (orderIds: number[]) => Promise<void>;
  onOpenDetail: (id: number) => void;
}) {
  const [selection, setSelection] = useState<FloorSelection>(new Set());
  const [busy, setBusy] = useState(false);

  const list = rows ?? [];
  const selectedIds = list.filter((r) => selection.has(r.orderId)).map((r) => r.orderId);
  const clear = () => setSelection(new Set());
  const allOn = isAllIdsSelected(selection, list);

  const doRestore = async () => {
    if (selectedIds.length === 0) return;
    setBusy(true);
    try {
      await onRestore(selectedIds);
      clear();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <FloorSkeleton variant="floor" />
        ) : error ? (
          <div className="px-5 py-14 text-center text-[11.5px] text-gray-400">Couldn&rsquo;t load the cancelled list. {error}</div>
        ) : list.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <div className="text-[28px] leading-none text-[#22c55e]">✓</div>
            <h4 className="mt-2 text-[13px] font-semibold text-gray-900">
              {scope !== "All" ? `Nothing cancelled for ${scope} today` : "Nothing cancelled today"}
            </h4>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-gray-400">A clean day.</p>
          </div>
        ) : (
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
                    aria-label="Select all cancelled bills"
                    className="h-[13px] w-[13px] cursor-pointer align-middle accent-teal-600"
                    checked={allOn}
                    onChange={() => setSelection((s) => toggleAllIds(s, list))}
                  />
                </th>
                <th className={HEAD_TH}>OBD</th>
                <th className={HEAD_TH}>Ship to</th>
                <th className={HEAD_TH}>Route</th>
                <th className={HEAD_TH}>Reason</th>
                <th className={HEAD_TH}>Cancelled</th>
              </tr>
            </thead>
            <tbody>
              {list.map((row) => {
                const { isSite, isRedirect } = shipMarkers(row);
                return (
                  <tr key={row.orderId} className="cursor-pointer hover:bg-[#fafafa]" onClick={() => onOpenDetail(row.orderId)}>
                    <td className={TD_C} onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={`Select ${row.obdNumber}`}
                        className="h-[13px] w-[13px] cursor-pointer align-middle accent-teal-600"
                        checked={selection.has(row.orderId)}
                        onChange={() => setSelection((s) => toggleOne(s, row.orderId))}
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
                    <td className={TD}>{row.reason ?? "—"}</td>
                    <td className={`${TD} text-[10.5px] text-[#6b7280]`}>
                      {hhmm(row.cancelledAt)}
                      <div className="text-[#9ca3af]">by {row.cancelledByName ?? "—"}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {selectedIds.length > 0 && (
        <div className="absolute inset-x-0 bottom-0 z-20 flex items-center gap-3 border-t border-gray-200 bg-white px-4 py-[11px] text-[12px] shadow-[0_-4px_16px_rgba(0,0,0,0.05)]">
          <span className="font-semibold text-gray-900">{selectedIds.length} selected</span>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              className="h-[30px] rounded-[6px] border border-gray-200 bg-white px-[13px] text-[11.5px] text-gray-500 hover:border-gray-300 hover:text-gray-700 disabled:opacity-40"
              onClick={clear}
              disabled={busy}
            >
              Clear
            </button>
            <button
              type="button"
              onClick={doRestore}
              disabled={busy}
              className="h-[30px] rounded-[6px] bg-teal-600 px-[13px] text-[11.5px] font-semibold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? "Restoring…" : "Restore to decisions"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
