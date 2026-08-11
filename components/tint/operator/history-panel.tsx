"use client";

import { useEffect, useState } from "react";
import { Loader2, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import { smartTitleCase } from "@/lib/mail-orders/utils";
import { OperatorPartyCards, deliveryDotClass } from "@/components/tint/operator/party-cards";

// Tint Operator — History body.
//
// 340px left list of the operator's COMPLETED jobs for one IST day + a right
// detail pane (Bill To / Ship To cards, reused via OperatorPartyCards, plus the
// job's TI lines).
//
// Data comes from GET /api/tint/operator/history — that route owns every rule
// about which jobs qualify (tinting-done only, submittedById, the IST day
// window). Nothing here re-derives them.
//
// ⚠ SELECTION IS GRAY-900, NOT TEAL. This screen's single teal is spent on the
// job pill in Row 2 (UI §1's one-teal rule, UI §34's colour budget), and the
// left-panel convention already in tint-operator-content is
// `bg-gray-100 border-l-[3px] border-l-gray-900`. Review View's teal selection
// belongs to a different screen — do not copy it here.

// ── Types (mirror of the route's response) ──────────────────────────────────

export interface HistoryLine {
  id:             number;
  table:          "TINTER" | "ACOTONE";
  skuCode:        string | null;
  skuDescription: string | null;
  baseSku:        string;
  packCode:       string | null;
  shadeName:      string | null;
  samplingNo:     string | null;
  tinQty:         number;
  createdAt:      string;
}

export interface HistoryJob {
  key:              string;
  kind:             "order" | "split";
  jobId:            number;
  orderId:          number;
  obdNumber:        string;
  splitNumber:      number | null;
  completedAt:      string | null;
  siteName:         string | null;
  shipToCustomerId: string | null;
  dealerName:       string | null;
  billToCustomerId: string | null;
  areaName:         string | null;
  routeName:        string | null;
  deliveryTypeName: string;
  totalVolume:      number | null;
  lines:            HistoryLine[];
  totalTins:        number;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

// Same label map the TI Report and Shade Master use. The TI tables store the
// PackCode ENUM ("L_20"), not the bare-numeric TEXT the SKU catalogs use — the
// two are not interchangeable, so never feed a catalog packCode through this.
const PACK_CODE_LABELS: Record<string, string> = {
  ml_500:  "500ml",
  L_0_9:   "0.9L",
  L_0_925: "0.925L",
  L_1:     "1L",
  L_3_6:   "3.6L",
  L_3_7:   "3.7L",
  L_4:     "4L",
  L_9:     "9L",
  L_9_25:  "9.25L",
  L_10:    "10L",
  L_15:    "15L",
  L_18:    "18L",
  L_18_5:  "18.5L",
  L_20:    "20L",
  L_22:    "22L",
  L_30:    "30L",
  L_40:    "40L",
};

function packLabel(code: string | null): string {
  if (!code) return "—";
  return PACK_CODE_LABELS[code] ?? code;
}

/** ISO UTC instant → IST HH:MM. The payload is a JSON string, never a Date. */
function istClock(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-IN", {
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata",
  });
}

function tins(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

/**
 * smartTitleCase for a nullable name, PRESERVING null.
 *
 * `smartTitleCase(null)` returns `""`, which would render as a blank cell
 * instead of the "—" placeholder — so the null has to survive the call.
 */
function titleOrNull(name: string | null): string | null {
  return name ? smartTitleCase(name) : null;
}

// ⚠ smartTitleCase is applied to SITE / DEALER NAMES ONLY (CLAUDE_UI.md §15's
// apply-list: customer name, SO name, remarks, area, route). It is deliberately
// NOT applied to two neighbouring fields, because §15's own exclusion list
// ("do NOT apply to: codes") covers them and live data degrades visibly:
//
//   shadeName       "30GY 83/021" → "30gy 83/021"   ← shade codes, mangled
//                   "SPL 0N17"    → "Spl 0n17"
//   skuDescription  "Promise SmartChoice … 20L" → "… Smartchoice … 20l"
//                   "DN WS Max Gen 10yr 90 Base 20L" → "Dn Ws Max Gen … 20l"
//
// Both are SAP-issued codes/specs, not prose. Leave them as stored.

// ── Component ───────────────────────────────────────────────────────────────

export function HistoryPanel({
  jobs,
  loading,
  error,
  dateLabel,
}: {
  jobs: HistoryJob[];
  loading: boolean;
  error: string | null;
  dateLabel: string;
}) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // Keep the selection valid across day changes: fall back to the first job
  // whenever the current key is no longer in the list (including empty days).
  useEffect(() => {
    if (jobs.length === 0) { setSelectedKey(null); return; }
    setSelectedKey((prev) => (prev && jobs.some((j) => j.key === prev) ? prev : jobs[0].key));
  }, [jobs]);

  const selected = jobs.find((j) => j.key === selectedKey) ?? null;

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center bg-gray-50">
        <Loader2 className="animate-spin text-gray-400" size={22} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center bg-gray-50 px-6">
        <p className="text-[13px] text-red-600">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 overflow-hidden">

      {/* ── LEFT — completed jobs for the day (340px) ─────────────────────── */}
      <div className="hidden md:flex w-[340px] flex-shrink-0 border-r border-gray-200 flex-col bg-white overflow-hidden">
        <div className="px-3 py-2 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
          <span className="text-[10px] font-extrabold uppercase tracking-[.6px] text-gray-400">Completed</span>
          <span className="text-[10px] text-gray-400">{dateLabel}</span>
        </div>

        {jobs.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-4">
            <Inbox className="text-gray-400" size={20} />
            <p className="text-[13px] font-semibold text-gray-500">Nothing tinted</p>
            <p className="text-[11px] text-gray-400">No completed jobs on this day.</p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            {jobs.map((job) => {
              const isSelected = job.key === selectedKey;
              return (
                <div
                  key={job.key}
                  onClick={() => setSelectedKey(job.key)}
                  className={cn(
                    "px-3 py-2.5 border-b border-gray-100 cursor-pointer transition-colors",
                    isSelected
                      ? "bg-gray-100 border-l-[3px] border-l-gray-900"
                      : "bg-white hover:bg-gray-50",
                  )}
                >
                  {/* Row 1: delivery dot + SITE NAME (the primary line) + clock.
                      Site name leads and carries the weight, matching every
                      other job list in the app; the OBD demotes to line 2. */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className={cn("w-[5px] h-[5px] rounded-full flex-shrink-0", deliveryDotClass(job.deliveryTypeName))} />
                      <span className="text-[12.5px] font-semibold text-gray-900 truncate">
                        {titleOrNull(job.siteName) ?? "—"}
                      </span>
                    </div>
                    <span className="text-[11px] text-gray-400 flex-shrink-0" style={{ fontVariantNumeric: "tabular-nums" }}>
                      {istClock(job.completedAt)}
                    </span>
                  </div>

                  {/* Row 2: OBD (mono gray-800 per UI §2/§4) + split badge */}
                  <div className="flex items-center gap-1.5 min-w-0 mt-0.5">
                    <span className="font-mono text-[11px] text-gray-800 truncate">{job.obdNumber}</span>
                    {job.kind === "split" && (
                      <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded border bg-purple-50 border-purple-200 text-purple-700 flex-shrink-0">
                        Split {job.splitNumber ?? "—"}
                      </span>
                    )}
                  </div>

                  {/* Row 3: lines · tins · volume */}
                  <div className="text-[11px] text-gray-400 mt-0.5">
                    {job.lines.length} {job.lines.length === 1 ? "line" : "lines"}
                    {" · "}{tins(job.totalTins)} {job.totalTins === 1 ? "tin" : "tins"}
                    {job.totalVolume != null && ` · ${Math.round(job.totalVolume)} L`}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── RIGHT — detail ────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden bg-gray-50">
        {!selected ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-6">
            <Inbox className="text-gray-400" size={22} />
            <p className="text-[13px] font-semibold text-gray-500">Nothing tinted on {dateLabel}</p>
            <p className="text-[11px] text-gray-400">Step back a day to see earlier work.</p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">

            {/* Bill To / Ship To — the SAME cards the Jobs face renders */}
            <div className="bg-white border-b border-gray-200 px-5 py-2 grid grid-cols-2 gap-3">
              {/* Names title-cased at the CALL SITE, not inside the component —
                  the Jobs face shares OperatorPartyCards and is left untouched. */}
              <OperatorPartyCards
                billToCustomerName={titleOrNull(selected.dealerName)}
                billToCustomerId={selected.billToCustomerId}
                shipToName={titleOrNull(selected.siteName)}
                deliveryTypeName={selected.deliveryTypeName}
                areaName={selected.areaName}
                routeName={selected.routeName}
              />
            </div>

            {/* Job identity strip */}
            <div className="px-5 py-2.5 flex items-center gap-2.5 flex-wrap">
              <span className="font-mono text-[12px] text-gray-800">{selected.obdNumber}</span>
              {selected.kind === "split" && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border bg-purple-50 border-purple-200 text-purple-700">
                  Split {selected.splitNumber ?? "—"}
                </span>
              )}
              <span className="text-[11px] text-gray-400">
                Completed {istClock(selected.completedAt)} IST
              </span>
              <span className="text-[11px] text-gray-400">
                · {selected.lines.length} {selected.lines.length === 1 ? "line" : "lines"}
                {" · "}{tins(selected.totalTins)} {selected.totalTins === 1 ? "tin" : "tins"}
              </span>
            </div>

            {/* Line table — fixed layout + colgroup percentages (UI §27) */}
            <div className="px-5 pb-5">
              <div className="rounded-lg border border-gray-200 overflow-hidden bg-white">
                <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
                  {/* Order: SKU · Pack · Qty · Type · Formula No. · Shade
                      ────────────────────────────────────────────────────────
                      Widths measured against 999 live TI rows across many jobs
                      (both tables), not eyeballed. Character lengths observed:

                        sku code         p50  7 · max 10  ("IN36819081")
                        sku description  p50 37 · max 40  ← the size driver
                        pack label       p50  3 · max  6  ("0.925L", 8 labels total)
                        qty              p50  1 · max  3  ("220")
                        samplingNo       p50  7 · max  7  ← NEVER longer than 7
                        shadeName        p50 11 · p99 22 · max 30
                                         ("8296" … "SPL 45YY 75/110 10LITR FORMULA")

                      Two of these do NOT shrink as far as they look like they
                      should, and the reason is not the data:

                      · TYPE is sized by "ACOTONE" — 7 chars of 10px MONO with
                        tracking-wider (~6.5px/char) ≈ 46px + 28px padding.
                      · FORMULA NO. is sized by its own HEADER, not its values:
                        7-char values need ~74px, but "FORMULA NO." at 10px
                        uppercase tracking-wider needs ~103px. Shortening that
                        header to "Formula" would free ~4 more points for SKU.

                      Everything reclaimed went to SKU (26% → 39%), which is the
                      only two-line cell and carries the 40-char description. */}
                  <colgroup>
                    <col style={{ width: "39%" }} />
                    <col style={{ width: "8%" }} />
                    <col style={{ width: "6%" }} />
                    <col style={{ width: "9%" }} />
                    <col style={{ width: "13%" }} />
                    <col style={{ width: "25%" }} />
                  </colgroup>
                  <thead>
                    {/* whitespace-nowrap on every header: the row is a fixed
                        32px, so a header that wrapped to two lines would be
                        clipped. "Formula No." is the one at risk. */}
                    <tr style={{ height: 32, borderBottom: "1px solid #ebebeb" }}>
                      <th className="text-left px-3.5 text-[10px] font-medium uppercase tracking-wider text-gray-400 whitespace-nowrap">SKU</th>
                      <th className="text-left px-3.5 text-[10px] font-medium uppercase tracking-wider text-gray-400 whitespace-nowrap">Pack</th>
                      <th className="text-right px-3 text-[10px] font-medium uppercase tracking-wider text-gray-400 whitespace-nowrap">Qty</th>
                      <th className="text-left px-3.5 text-[10px] font-medium uppercase tracking-wider text-gray-400 whitespace-nowrap">Type</th>
                      <th className="text-left px-3.5 text-[10px] font-medium uppercase tracking-wider text-gray-400 whitespace-nowrap">Formula No.</th>
                      <th className="text-left px-3.5 text-[10px] font-medium uppercase tracking-wider text-gray-400 whitespace-nowrap">Shade</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.lines.map((line) => (
                      <tr key={`${line.table}-${line.id}`} style={{ height: 36, borderBottom: "1px solid #f0f0f0" }}>
                        <td className="px-3.5 overflow-hidden">
                          <div className="font-mono text-[11px] text-gray-800 truncate">{line.skuCode ?? "—"}</div>
                          {line.skuDescription && (
                            <div className="text-[10.5px] text-gray-400 truncate">{line.skuDescription}</div>
                          )}
                        </td>
                        <td className="px-3.5 text-[11px] text-gray-600 whitespace-nowrap overflow-hidden text-ellipsis">
                          {packLabel(line.packCode)}
                        </td>
                        <td className="px-3 text-right text-[11px] text-gray-900 font-medium" style={{ fontVariantNumeric: "tabular-nums" }}>
                          {tins(line.tinQty)}
                        </td>
                        {/* Tinter-type tag — the SAME treatment this screen's
                            shade-reuse list already uses (suggestion-card.tsx /
                            flat-suggestion-list.tsx, themselves copied from the
                            Sampling Library list pane): bare mono text, grey
                            TINTER / orange ACOTONE. Never teal, never a box. */}
                        <td className="px-3.5">
                          <span className={cn(
                            "font-mono text-[10px] font-medium uppercase tracking-wider leading-none",
                            line.table === "ACOTONE" ? "text-orange-700" : "text-gray-400",
                          )}>
                            {line.table}
                          </span>
                        </td>
                        <td className="px-3.5 font-mono text-[11px] text-gray-600 whitespace-nowrap overflow-hidden text-ellipsis">
                          {line.samplingNo || <span className="font-sans text-gray-300">—</span>}
                        </td>
                        <td className="px-3.5 text-[11px] text-gray-900 font-medium whitespace-nowrap overflow-hidden text-ellipsis">
                          {line.shadeName || <span className="text-gray-300">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
