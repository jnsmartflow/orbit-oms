"use client";

// Floor Control — the CANCEL & CI tab (2026-09-22; was "Cancelled", design §9;
// floor-bulk-actions v5 state 7 is the layout reference). TODAY only, IST —
// the feed (getFloorCancelled) fences it in SQL.
//
// Two kinds of row in one list, newest first:
//   Cancel — a bill cancelled today (reason and remark split out of the log
//            note by parseCancelNote). Tickable → Restore.
//   CI     — a CI the Floor raised today (POST /api/floor/ci). NOT tickable:
//            its return is on billing's desk, and the actions route refuses to
//            restore it anyway. "With billing" / "Closed by billing" under the
//            CI number, from the CI's own status.
//
// Columns (owner order): ☐ · Action · OBD (+date) · Invoice · Ship to · Area ·
// Vol / KG · Reason · Remarks · CI no. (+status) · By · when. No vertical rules.
//
// The bar is the shared FloorActionBar (floor-action-bar.tsx) — Restore is its
// one brand button, and there is no ··· More here.
//
// Live: the 30 s desk poll (useFloorRailPoll → load()) refetches this feed with
// the board, so a CI billing closes flips to "Closed by billing" within ~30 s
// while nothing is ticked. No marker of its own (FLOOR §5).

import { useState } from "react";
import { Building2 } from "lucide-react";
import { FloorSkeleton } from "./floor-skeleton";
// TINT / BASE — one owner for the word (components/picking/card-atoms.tsx).
import { ColourWorkBadge } from "@/components/picking/card-atoms";
import { shipMarkers } from "./floor-table";
import { formatLitres, formatWeightKg } from "./status-pill";
import { FloorActionBar, BAR_PRIMARY, type BarFigure } from "./floor-action-bar";
import { countArticles } from "@/lib/floor/format";
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

const HEAD_TH = "h-[31px] border-b border-[#ebebeb] px-3 text-left text-[10px] font-medium uppercase tracking-[0.05em] text-[#9ca3af]";
const HEAD_TH_R = `${HEAD_TH} text-right`;
const HEAD_TH_C = "h-[31px] border-b border-[#ebebeb] px-1 text-center text-[10px] font-medium uppercase tracking-[0.05em] text-[#9ca3af]";
const TD = "border-b border-[#f0f0f0] px-3 py-2 align-top text-[11px] text-[#4b5563] whitespace-nowrap overflow-hidden text-ellipsis";
const TD_C = "border-b border-[#f0f0f0] px-1 py-2 align-top text-center text-[11px]";

// ☐ 3 · Action 6 · OBD 11 · Invoice 9 · Ship to 16 · Area 8 · Vol/KG 7 ·
// Reason 10 · Remarks 13 · CI no. 9 · By·when 8 (sums to 100).
const WIDTHS = [3, 6, 11, 9, 16, 8, 7, 10, 13, 9, 8];

type Filter = "all" | "cancel" | "ci";

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
  const [filter, setFilter] = useState<Filter>("all");

  const all = rows ?? [];
  const cancelCount = all.filter((r) => r.action === "cancel").length;
  const ciCount = all.length - cancelCount;
  const list = filter === "all" ? all : all.filter((r) => r.action === filter);

  // 🔴 ONLY CANCEL ROWS ARE TICKABLE — a CI row has no box at all, and the
  // header's select-all reaches only the Cancel rows on screen.
  const tickable = list.filter((r) => r.action === "cancel");
  const selectedRows = all.filter((r) => r.action === "cancel" && selection.has(r.orderId));
  const selectedIds = selectedRows.map((r) => r.orderId);
  const clear = () => setSelection(new Set());
  const allOn = tickable.length > 0 && isAllIdsSelected(selection, tickable);

  // Articles and routes only on the bar — same reason as the Hold bar: this
  // row carries no `isGift`, and a litre total that counted GIFT bills would
  // disagree with the Floor tab's.
  const figures: BarFigure[] = [];
  const articles = countArticles(selectedRows.map((r) => r.articleTag)).pieces;
  const routes = new Set(selectedRows.map((r) => r.route ?? "\u0000unrouted")).size;
  if (articles > 0) figures.push({ key: "art", value: String(articles), unit: articles === 1 ? "article" : "articles" });
  if (routes > 0) figures.push({ key: "rt", value: String(routes), unit: routes === 1 ? "route" : "routes" });

  const doRestore = async () => {
    if (selectedIds.length === 0) return;
    setBusy(true);
    try {
      // floor-page's cancelledRestore posts the actions "restore" and reports a
      // partial result through reportWrite (a toast naming the first refusal).
      await onRestore(selectedIds);
      clear();
    } finally {
      setBusy(false);
    }
  };

  const chip = (f: Filter, label: string) => (
    <button
      type="button"
      onClick={() => setFilter(f)}
      className={`px-[11px] text-[11px] ${filter === f ? "bg-white font-semibold text-gray-900" : "text-gray-500"}`}
    >
      {label}
    </button>
  );

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {/* Header line — what today holds, and the Action filter. */}
      <div className="flex items-center gap-2 border-b border-gray-200 bg-[#fcfcfd] px-3.5 py-[7px]">
        {!loading && !error && (
          <span className="text-[11px] text-gray-400">
            <span className="font-semibold text-gray-700">Cancel &amp; CI</span> today · {cancelCount} cancelled ·{" "}
            {ciCount} CI raised{scope !== "All" ? ` · ${scope}` : ""}
          </span>
        )}
        <span className="ml-auto flex h-[27px] overflow-hidden rounded-[6px] border border-gray-200 bg-gray-50">
          {chip("all", "All")}
          {chip("cancel", "Cancel")}
          {chip("ci", "CI")}
        </span>
      </div>

      <div className={`min-h-0 flex-1 overflow-y-auto ${selectedIds.length > 0 ? "pb-[84px]" : ""}`}>
        {loading ? (
          <FloorSkeleton variant="floor" />
        ) : error ? (
          <div className="px-5 py-14 text-center text-[11.5px] text-gray-400">Couldn&rsquo;t load the Cancel &amp; CI list. {error}</div>
        ) : list.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <div className="text-[28px] leading-none text-[#22c55e]">✓</div>
            <h4 className="mt-2 text-[13px] font-semibold text-gray-900">
              {filter === "cancel"
                ? "Nothing cancelled today"
                : filter === "ci"
                  ? "No CI raised from the floor today"
                  : scope !== "All"
                    ? `Nothing cancelled or returned for ${scope} today`
                    : "Nothing cancelled or returned today"}
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
                  {tickable.length > 0 && (
                    <input
                      type="checkbox"
                      aria-label="Select all cancelled bills"
                      className="h-[13px] w-[13px] cursor-pointer align-middle accent-brand-600"
                      checked={allOn}
                      onChange={() => setSelection((s) => toggleAllIds(s, tickable))}
                    />
                  )}
                </th>
                <th className={HEAD_TH}>Action</th>
                <th className={HEAD_TH}>OBD</th>
                <th className={HEAD_TH}>Invoice</th>
                <th className={HEAD_TH}>Ship to</th>
                <th className={HEAD_TH}>Area</th>
                <th className={HEAD_TH_R}>Vol / KG</th>
                <th className={HEAD_TH}>Reason</th>
                <th className={HEAD_TH}>Remarks</th>
                <th className={HEAD_TH}>CI no.</th>
                <th className={HEAD_TH}>By · when</th>
              </tr>
            </thead>
            <tbody>
              {list.map((row) => {
                const { isSite, isRedirect } = shipMarkers(row);
                const weightStr = formatWeightKg(row.weightKg);
                return (
                  <tr key={row.orderId} className="cursor-pointer hover:bg-[#fafafa]" onClick={() => onOpenDetail(row.orderId)}>
                    <td className={TD_C} onClick={(e) => row.action === "cancel" && e.stopPropagation()}>
                      {row.action === "cancel" && (
                        <input
                          type="checkbox"
                          aria-label={`Select ${row.obdNumber}`}
                          className="h-[13px] w-[13px] cursor-pointer align-middle accent-brand-600"
                          checked={selection.has(row.orderId)}
                          onChange={() => setSelection((s) => toggleOne(s, row.orderId))}
                        />
                      )}
                    </td>
                    <td className={TD}>
                      {/* Cancel = danger (destructive, CLAUDE_UI §2). CI = the NEUTRAL
                          ink tone — the same quiet grey the /ci screens give their
                          source tags (ciSourceTag), never tint (tint only). */}
                      {row.action === "cancel" ? (
                        <span className="rounded-full bg-danger-bg px-[7px] py-[2px] text-[9.5px] font-bold uppercase tracking-[0.05em] text-danger-text">
                          Cancel
                        </span>
                      ) : (
                        <span className="rounded-full bg-ink-100 px-[7px] py-[2px] text-[9.5px] font-bold uppercase tracking-[0.05em] text-ink-700">
                          CI
                        </span>
                      )}
                    </td>
                    <td className={TD}>
                      <span className="font-mono text-[11.5px] font-medium text-[#111827]">{row.obdNumber}</span>
                      <div className="text-[10px] text-[#9ca3af]">{fmtDateTime(row.obdDateTime)}</div>
                    </td>
                    <td className={TD}>
                      {row.invoiceNo ? (
                        <span className="font-mono text-[11.5px] text-[#111827]">{row.invoiceNo}</span>
                      ) : (
                        <span className="text-[#9ca3af]">—</span>
                      )}
                    </td>
                    <td className={TD}>
                      <span className="text-[11.5px] font-medium text-[#111827]">{row.dealerName}</span>
                      {row.isKeyCustomer && <span className="ml-1.5 text-[#f59e0b]">★</span>}
                      {isSite && <Building2 size={12} className="ml-1 inline-block align-[-1px] text-[#475569]" />}
                      {row.colourWork !== null && (
                        <span className="ml-1 inline-block align-[-1px]">
                          <ColourWorkBadge work={row.colourWork} />
                        </span>
                      )}
                      {isSite && <div className="text-[10.5px] text-[#9ca3af]">billed to {row.billToName ?? "—"}</div>}
                      {/* The ORIGINAL → REDIRECT pair, as the board's table draws it. */}
                      {isRedirect && (
                        <div
                          className="overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-brand-800"
                          title={
                            row.customerName && row.shipToOverrideName
                              ? `${row.customerName} → ship to ${row.shipToOverrideName}`
                              : undefined
                          }
                        >
                          {row.customerName && row.shipToOverrideName ? (
                            <>
                              {row.customerName}
                              <span className="mx-1 opacity-60">→</span>
                              <b className="font-semibold">{row.shipToOverrideName}</b>
                            </>
                          ) : (
                            "→ ship-to changed"
                          )}
                        </div>
                      )}
                    </td>
                    <td className={TD}>{row.area ?? "—"}</td>
                    <td className={`${TD} text-right tabular-nums`}>
                      <div>{formatLitres(row.volumeLitres ?? 0)} L</div>
                      <div className="text-[10px] text-[#9ca3af]">
                        {weightStr !== null ? `${weightStr} kg` : <span title="No weight recorded for this bill">&mdash;</span>}
                      </div>
                    </td>
                    <td className={`${TD} font-semibold text-[#111827]`} title={row.reason ?? undefined}>
                      {row.reason ?? "—"}
                    </td>
                    <td className={`${TD} whitespace-normal`}>
                      {row.remark ? (
                        <span className="line-clamp-2 text-[#9ca3af]" title={row.remark}>
                          {row.remark}
                        </span>
                      ) : (
                        <span className="text-[#d1d5db]">—</span>
                      )}
                    </td>
                    <td className={TD}>
                      {row.ciNumber ? (
                        <>
                          <span className="font-mono text-[11.5px] text-[#111827]">{row.ciNumber}</span>
                          <div className={`text-[10px] ${row.ciStatus === "closed" ? "text-ok-text" : "text-[#9ca3af]"}`}>
                            {row.ciStatus === "closed" ? "Closed by billing" : "With billing"}
                          </div>
                        </>
                      ) : (
                        <span className="text-[#9ca3af]">—</span>
                      )}
                    </td>
                    <td className={`${TD} text-[#6b7280]`}>
                      {row.byName ?? "—"}
                      <div className="text-[10px] text-[#9ca3af]">{hhmm(row.at)}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <FloorActionBar count={selectedIds.length} figures={figures} onClear={clear} clearDisabled={busy}>
        <button type="button" onClick={() => void doRestore()} disabled={busy} className={BAR_PRIMARY}>
          {busy ? "Restoring…" : "Restore"}
        </button>
      </FloorActionBar>
    </div>
  );
}
