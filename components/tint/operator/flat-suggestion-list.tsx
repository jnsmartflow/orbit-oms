"use client";

import { Fragment, useState } from "react";
import { cn } from "@/lib/utils";
import type { PackCode } from "@prisma/client";
import type { SuggestFlatRow } from "@/app/api/sampling-library/_lib/suggest";

// Search-first flat suggestion list for the Tint Operator TI form. Pure list:
// the PACK FILTER + search box + "Add shade" live in the parent so they stay
// mounted as the view toggles between this list and the new-shade form, and so
// the parent owns the filtering (rows arrive already filtered to one pack).
// - empty query  → this-site flatSuggestions (exact pinned → recent).
// - typed query  → global operator-search results (all sites).
// Rows are SuggestFlatRow so the parent's applySuggestionToEntry consumes them
// unchanged. Stays inside the §34 colour budget — gray family only, no teal:
// exact rows get a grey "EXACT" chip + grey wash + gray-900 left accent (the
// selected-card idiom); "Use" is soft grey. FORMULA shows the shade's RAW
// stored pigments (no scaling) — applySuggestionToEntry scales on Use.

export interface FlatSuggestionListProps {
  rows:        SuggestFlatRow[];
  isLoading:   boolean;
  isSearching: boolean;
  // Current tinting line's pack — only used to colour the PACK pill green when a
  // row's stored pack matches the line. null → every pill renders gray.
  linePack:    PackCode | null;
  onUse:       (row: SuggestFlatRow) => void;
}

function formatDayMonth(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

function packCodeToLabel(code: string | null | undefined): string {
  if (!code) return "—";
  if (code === "ml_500") return "500 ML";
  const m = code.match(/^L_(\d+)(?:_(\d+))?$/);
  if (!m) return code;
  const whole = m[1];
  const frac  = m[2];
  return `${frac !== undefined ? `${whole}.${frac}` : whole} LT`;
}

function PigmentChips({
  pigments,
  onWash,
}: {
  pigments: Array<{ code: string; value: number }>;
  onWash?:  boolean; // exact rows sit on a grey wash → white chips stay readable
}) {
  if (pigments.length === 0) {
    return <span className="text-[10px] text-gray-400 italic">No pigments</span>;
  }
  return (
    <div className="flex flex-wrap gap-[3px]">
      {pigments.map((p) => (
        <span
          key={p.code}
          className={cn(
            "inline-flex items-center gap-1 text-gray-700 rounded font-mono text-[10px] px-[5px] py-[1px] border",
            onWash ? "bg-white border-gray-300" : "bg-gray-100 border-gray-200",
          )}
        >
          <span>{p.code}</span>
          <span className="font-semibold text-gray-900">{p.value}</span>
        </span>
      ))}
    </div>
  );
}

export function FlatSuggestionList({ rows, isLoading, isSearching, linePack, onUse }: FlatSuggestionListProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const scopeLabel = isSearching
    ? `Searching all sites · ${rows.length}`
    : `Shades at this site · ${rows.length}`;

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  return (
    <div className="mb-3">
      {/* Scope line (pack is chosen via the parent's PACK FILTER dropdown) */}
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <p className="text-[11px] font-medium tracking-wide text-gray-500">{scopeLabel}</p>
      </div>

      {/* Table */}
      <div className="border border-gray-200 rounded-md overflow-hidden">
        {isLoading ? (
          <div className="p-4"><div className="h-16 bg-gray-100 rounded animate-pulse" /></div>
        ) : rows.length === 0 ? (
          <div className="px-3 py-6 text-center">
            <p className="text-[11px] text-gray-400 font-medium">
              No match. Tap &ldquo;+ Add shade&rdquo; to create one.
            </p>
          </div>
        ) : (
          <div className="max-h-[320px] overflow-y-auto">
            <table className="w-full" style={{ borderCollapse: "collapse", tableLayout: "fixed" }}>
              <colgroup>
                <col style={{ width: "13%" }} />
                <col style={{ width: "20%" }} />
                <col style={{ width: "17%" }} />
                <col style={{ width: "23%" }} />
                <col style={{ width: "11%" }} />
                <col style={{ width: "9%" }} />
                <col style={{ width: "7%" }} />
              </colgroup>
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left text-[10px] font-medium text-gray-400 uppercase tracking-wider px-2.5 py-1.5">Sampling</th>
                  <th className="text-left text-[10px] font-medium text-gray-400 uppercase tracking-wider px-2.5 py-1.5">Shade</th>
                  <th className="text-left text-[10px] font-medium text-gray-400 uppercase tracking-wider px-2.5 py-1.5">Site</th>
                  <th className="text-left text-[10px] font-medium text-gray-400 uppercase tracking-wider px-2.5 py-1.5">Formula</th>
                  <th className="text-left text-[10px] font-medium text-gray-400 uppercase tracking-wider px-2.5 py-1.5">Pack</th>
                  <th className="text-left text-[10px] font-medium text-gray-400 uppercase tracking-wider px-2.5 py-1.5">Last Used</th>
                  <th className="px-2.5 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const key    = `${row.samplingNo}-${row.recipeId}`;
                  const isOpen = expanded.has(key);
                  // Pack-FILTER model: rows arrive already filtered to one pack by
                  // the parent. The PACK pill is just green when the row's stored
                  // pack matches the line, gray otherwise. No scaling here —
                  // applySuggestionToEntry scales the picked recipe on Use.
                  const isLinePack = linePack != null && row.packCode === linePack;
                  return (
                    <Fragment key={key}>
                      <tr
                        className={cn(
                          "border-b border-gray-50 align-top border-l-[3px]",
                          row.isExactMatch
                            ? "bg-[#eef1f4] border-l-gray-900"
                            : "border-l-transparent",
                        )}
                      >
                        {/* Sampling */}
                        <td className="px-2.5 py-2">
                          <div className="flex flex-col gap-0.5 min-w-0">
                            <span className="font-mono font-medium text-[12px] text-gray-900 truncate">#{row.samplingNo}</span>
                            <div className="flex items-center gap-1.5">
                              <span className={cn(
                                "font-mono text-[10px] font-medium uppercase tracking-wider leading-none",
                                row.tinterType === "TINTER" ? "text-gray-400" : "text-orange-700",
                              )}>
                                {row.tinterType}
                              </span>
                              {row.isExactMatch && (
                                <span className="text-[9px] font-bold uppercase tracking-wider text-gray-700 bg-gray-200 border border-gray-300 rounded px-1 py-px leading-none">
                                  Exact
                                </span>
                              )}
                            </div>
                          </div>
                        </td>
                        {/* Shade */}
                        <td className="px-2.5 py-2">
                          <span className="text-[12px] font-semibold text-gray-900 break-words">{row.shadeName}</span>
                        </td>
                        {/* Site */}
                        <td className="px-2.5 py-2">
                          <div className="flex flex-col gap-0.5 min-w-0">
                            <span className="text-[11px] text-gray-600 truncate">{row.primarySiteName || "—"}</span>
                            {row.otherSites.length > 0 && (
                              <button
                                type="button"
                                onClick={() => toggle(key)}
                                className="text-[10px] font-semibold text-red-600 hover:text-red-700 text-left"
                              >
                                +{row.otherSites.length} site{row.otherSites.length > 1 ? "s" : ""}
                              </button>
                            )}
                          </div>
                        </td>
                        {/* Formula — RAW stored pigments (no scaling) */}
                        <td className="px-2.5 py-2">
                          <PigmentChips pigments={row.activePigments} onWash={row.isExactMatch} />
                        </td>
                        {/* Pack — plain pill; green when it equals the line pack */}
                        <td className="px-2.5 py-2">
                          <span className={cn(
                            "inline-flex items-center text-[10px] font-medium rounded px-1.5 py-px whitespace-nowrap border",
                            isLinePack
                              ? "text-green-700 bg-green-50 border-green-200"
                              : "text-gray-500 bg-gray-100 border-gray-200",
                          )}>
                            {packCodeToLabel(row.packCode)}
                          </span>
                        </td>
                        {/* Last Used */}
                        <td className="px-2.5 py-2">
                          <span className="text-[10px] text-gray-400 whitespace-nowrap">{formatDayMonth(row.lastUsedAt)}</span>
                        </td>
                        {/* Use */}
                        <td className="px-2.5 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => onUse(row)}
                            className="h-[28px] px-3 rounded-md bg-gray-200 text-gray-800 text-[11px] font-medium hover:bg-gray-300 transition-colors whitespace-nowrap"
                          >
                            Use
                          </button>
                        </td>
                      </tr>
                      {isOpen && row.otherSites.length > 0 && (
                        <tr className="border-b border-gray-50 bg-gray-50/40">
                          <td />
                          <td colSpan={6} className="px-2.5 py-1.5">
                            <div className="flex flex-col gap-0.5">
                              {row.otherSites.map((s, i) => (
                                <div key={i} className="flex items-center justify-between text-[10px]">
                                  <span className="text-gray-600 truncate">{s.siteName}</span>
                                  <span className="text-gray-400 ml-2 flex-shrink-0">{formatDayMonth(s.lastUsed)}</span>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
