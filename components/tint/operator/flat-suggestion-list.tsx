"use client";

import { Fragment, useState } from "react";
import { cn } from "@/lib/utils";
import type { PackCode } from "@prisma/client";
import type { SuggestFlatRow } from "@/app/api/sampling-library/_lib/suggest";
import { packDoseLitres, canScale } from "@/lib/sampling/pack-litres";

// Search-first flat suggestion list for the Tint Operator TI form. Pure list:
// the search box + "Add shade" live in the parent so they stay mounted as the
// view toggles between this list and the new-shade form.
// - empty query  → this-site flatSuggestions (exact pinned → recent).
// - typed query  → global operator-search results (all sites).
// Rows are SuggestFlatRow so the parent's applySuggestionToEntry consumes them
// unchanged. Stays inside the §34 colour budget — gray family only, no teal:
// exact rows get a grey "EXACT" chip + grey wash + gray-900 left accent (the
// selected-card idiom); "Use" is soft grey.

export interface FlatSuggestionListProps {
  rows:        SuggestFlatRow[];
  isLoading:   boolean;
  isSearching: boolean;
  // Current tinting line's pack — locks the displayed formula to this pack's
  // dose. Stored rows in other packs are scaled to it (display only). null →
  // no scaling (raw stored values shown).
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
      {/* Scope line + locked pack pill (formula values are shown at this pack) */}
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <p className="text-[11px] font-medium tracking-wide text-gray-500">{scopeLabel}</p>
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-gray-600 bg-gray-100 border border-gray-200 rounded px-2 py-0.5 flex-shrink-0">
          PACK · {linePack ? packCodeToLabel(linePack) : "—"}
          {linePack && <span aria-hidden>🔒</span>}
        </span>
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
                <col style={{ width: "20%" }} />
                <col style={{ width: "22%" }} />
                <col style={{ width: "20%" }} />
                <col style={{ width: "26%" }} />
                <col style={{ width: "12%" }} />
              </colgroup>
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left text-[10px] font-medium text-gray-400 uppercase tracking-wider px-2.5 py-1.5">Sampling</th>
                  <th className="text-left text-[10px] font-medium text-gray-400 uppercase tracking-wider px-2.5 py-1.5">Shade</th>
                  <th className="text-left text-[10px] font-medium text-gray-400 uppercase tracking-wider px-2.5 py-1.5">Site</th>
                  <th className="text-left text-[10px] font-medium text-gray-400 uppercase tracking-wider px-2.5 py-1.5">Formula</th>
                  <th className="px-2.5 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const key    = `${row.samplingNo}-${row.recipeId}`;
                  const isOpen = expanded.has(key);
                  // Display scaling: lock the formula to the current line's pack.
                  const isReal   = linePack != null && row.packCode === linePack;
                  const scalable = linePack != null && !isReal && canScale(row.packCode, linePack);
                  let ratio: number | null = null;
                  let displayPigments = row.activePigments;
                  if (scalable) {
                    const fromL = packDoseLitres(row.packCode)!;
                    const toL   = packDoseLitres(linePack)!;
                    ratio = parseFloat((toL / fromL).toFixed(2));
                    displayPigments = row.activePigments.map((p) => ({
                      code:  p.code,
                      value: parseFloat((p.value * (toL / fromL)).toFixed(2)),
                    }));
                  }
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
                        {/* Formula (scaled to the line pack for display) */}
                        <td className="px-2.5 py-2">
                          <PigmentChips pigments={displayPigments} onWash={row.isExactMatch} />
                          <div className="flex items-center gap-1.5 mt-1 text-[10px]">
                            {isReal ? (
                              <>
                                <span className="bg-gray-100 text-gray-700 rounded px-1.5 py-px font-medium">{packCodeToLabel(row.packCode)}</span>
                                <span className="text-green-600 font-bold">✓</span>
                              </>
                            ) : scalable ? (
                              <>
                                <span className="bg-gray-100 text-gray-400 rounded px-1.5 py-px">{packCodeToLabel(row.packCode)}</span>
                                <span className="text-teal-700 font-semibold">×{ratio}</span>
                              </>
                            ) : (
                              <>
                                <span className="bg-gray-100 text-gray-400 rounded px-1.5 py-px">{packCodeToLabel(row.packCode)}</span>
                                <span className="text-gray-400">stored</span>
                              </>
                            )}
                            <span className="text-gray-300">·</span>
                            <span className="text-gray-400">{formatDayMonth(row.lastUsedAt)}</span>
                          </div>
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
                          <td colSpan={4} className="px-2.5 py-1.5">
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
