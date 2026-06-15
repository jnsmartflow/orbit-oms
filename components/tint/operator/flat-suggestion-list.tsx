"use client";

import { Fragment, useState } from "react";
import { cn } from "@/lib/utils";
import type { SuggestFlatRow } from "@/app/api/sampling-library/_lib/suggest";

// Search-first flat suggestion list for the Tint Operator TI form.
// - Empty query  → this-site flatSuggestions (exact pinned → recent).
// - Typed query  → global operator-search results (all sites).
// Rows are SuggestFlatRow so the parent's applySuggestionToEntry consumes them
// unchanged. Styling reuses the operator card vocabulary: gray/orange tinter
// tag, gray pigment chips, gray-900 "Use". The teal "exact" badge + faint teal
// row tint are the explicit exact-match cue from the approved prototype.

export interface FlatSuggestionListProps {
  rows:           SuggestFlatRow[];
  isLoading:      boolean;
  searchValue:    string;
  onSearchChange: (v: string) => void;
  onUse:          (row: SuggestFlatRow) => void;
  onAddShade:     () => void;
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

function PigmentChips({ pigments }: { pigments: Array<{ code: string; value: number }> }) {
  if (pigments.length === 0) {
    return <span className="text-[10px] text-gray-400 italic">No pigments</span>;
  }
  return (
    <div className="flex flex-wrap gap-[3px]">
      {pigments.map((p) => (
        <span
          key={p.code}
          className="inline-flex items-center gap-1 bg-gray-100 text-gray-700 border border-gray-200 rounded font-mono text-[10px] px-[5px] py-[1px]"
        >
          <span>{p.code}</span>
          <span className="font-semibold text-gray-900">{p.value}</span>
        </span>
      ))}
    </div>
  );
}

export function FlatSuggestionList({
  rows,
  isLoading,
  searchValue,
  onSearchChange,
  onUse,
  onAddShade,
}: FlatSuggestionListProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const searching  = searchValue.trim() !== "";
  const scopeLabel = searching
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
      {/* Search row + Add shade */}
      <div className="flex items-center gap-2 mb-2">
        <div className="relative flex-1 min-w-0">
          <svg
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"
            width="13" height="13" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search any shade, sampling no or site — all sites"
            className="w-full h-[34px] pl-8 pr-2.5 text-[12px] border border-gray-200 rounded-md text-gray-900 placeholder:text-gray-300 focus:border-gray-900 focus:outline-none"
          />
        </div>
        <button
          type="button"
          onClick={onAddShade}
          className="h-[34px] px-3 rounded-md border border-gray-200 bg-white text-gray-700 text-[12px] font-medium hover:bg-gray-50 transition-colors flex-shrink-0 whitespace-nowrap"
        >
          + Add shade
        </button>
      </div>

      {/* Scope line */}
      <p className="text-[11px] font-medium tracking-wide text-gray-500 mb-1.5">{scopeLabel}</p>

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
                  return (
                    <Fragment key={key}>
                      <tr className={cn("border-b border-gray-50 align-top", row.isExactMatch && "bg-teal-50/40")}>
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
                                <span className="text-[9px] font-bold uppercase tracking-wider text-teal-700 bg-teal-50 border border-teal-200 rounded px-1 py-px leading-none">
                                  exact
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
                        {/* Formula */}
                        <td className="px-2.5 py-2">
                          <PigmentChips pigments={row.activePigments} />
                          <div className="text-[10px] text-gray-400 mt-1">
                            {packCodeToLabel(row.packCode)} · {formatDayMonth(row.lastUsedAt)}
                          </div>
                        </td>
                        {/* Use */}
                        <td className="px-2.5 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => onUse(row)}
                            className="h-[28px] px-3 rounded-md bg-gray-900 text-white text-[11px] font-medium hover:bg-gray-800 transition-colors whitespace-nowrap"
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
