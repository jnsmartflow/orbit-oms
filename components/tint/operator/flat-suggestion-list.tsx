"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { PackCode, TinterType } from "@prisma/client";
import type { SuggestFlatRow, SuggestLine } from "@/app/api/sampling-library/_lib/suggest";
import { packDoseLitres } from "@/lib/sampling/pack-litres";

// Search-first suggestion list for the Tint Operator TI form, GROUPED by
// sampling no (mockup: docs/mockups/tint/operator-shades-grouped.html). Pure
// list: the PACK FILTER + search box + "Add shade" live in the parent so they
// stay mounted as the view toggles between this list and the new-shade form.
// - empty query  → this-site flatSuggestions (exact pinned → recent).
// - typed query  → global operator-search results (all sites).
// One card per row (= one sampling); in it ONE line per recipe (SKU × pack)
// from row.lines, nothing merged. Each line has its own Use, which hands the
// parent a SuggestFlatRow rebuilt around THAT recipe (lineAsRow), so the
// parent's apply path (pack scaling included) runs unchanged on the recipe the
// operator picked. FORMULA shows each recipe's RAW stored pigments.
// The parent passes rows UNFILTERED by type and pack, plus the toggle's type
// and the pack filter. Only groups of the selected TINTER / ACOTONE type show
// (owner rule); a group stays when ANY of its lines is in the pack bucket, and
// its other lines are dimmed, not hidden. When the OTHER type holds an exact
// match for the tinting line, a one-line hint offers to switch.
//
// Owner rule: NOTHING in this list is truncated — no ellipsis, no clipping, no
// inner scroll box. Long names, headers and formulas wrap and the row grows.
// Colour: the matching line's ok tint and the tinter-type tag's dot (CLAUDE_UI
// §3) — the formula and everything else is ink.

export interface FlatSuggestionListProps {
  rows:        SuggestFlatRow[];
  isLoading:   boolean;
  isSearching: boolean;
  // Current tinting line's pack — marks the line's pack bucket on the PACK chip
  // and (with lineSkuCode) the matching line.
  linePack:    PackCode | null;
  // Current tinting line's SKU. A line whose skuCode AND packCode equal the
  // tinting line's gets the ✓ match treatment and its group sorts first.
  lineSkuCode: string | null;
  // Current tinting line's SAP description — the last-resort name for any
  // recipe line carrying the same SKU code that the server could not name.
  lineDescription: string | null;
  // Nominal pack bucket (1/4/10/20) or "ALL". Filters groups, dims lines.
  packFilter:  number | "ALL";
  // The TINTER / ACOTONE toggle. Only groups of this type are listed.
  tinterType:  TinterType;
  // Flip the toggle through the parent's normal change handler (the hint).
  onSwitchType: (type: TinterType) => void;
  onUse:       (row: SuggestFlatRow) => void;
}

/**
 * The recipe lines of a row. A producer that does not fill `lines`
 * (formula-match) falls back to the single representative the row describes.
 */
export function rowLines(row: SuggestFlatRow): SuggestLine[] {
  if (row.lines && row.lines.length > 0) return row.lines;
  return [{
    recipeId:       row.recipeId,
    skuCode:        row.skuCode,
    packCode:       row.packCode,
    productName:    null,
    pigments:       row.pigments,
    activePigments: row.activePigments,
    lastUsedAt:     row.lastUsedAt,
  }];
}

/**
 * The rows of one TINTER / ACOTONE type. The parent counts its pack-select
 * options over this same set, so the counts and the list always agree.
 */
export function rowsOfType(rows: SuggestFlatRow[], type: TinterType): SuggestFlatRow[] {
  return rows.filter((r) => r.tinterType === type);
}

/** True when any line of the row sits in this nominal pack bucket. */
export function rowHasPackBucket(row: SuggestFlatRow, bucket: number): boolean {
  return rowLines(row).some((l) => packDoseLitres(l.packCode) === bucket);
}

// The row handed to onUse for one line: the group's identity (sampling no,
// shade, tinter type, sites) with THAT recipe's id, SKU, pack and pigments.
function lineAsRow(row: SuggestFlatRow, line: SuggestLine, isMatch: boolean): SuggestFlatRow {
  return {
    ...row,
    recipeId:       line.recipeId,
    skuCode:        line.skuCode,
    packCode:       line.packCode,
    pigments:       line.pigments,
    activePigments: line.activePigments,
    lastUsedAt:     line.lastUsedAt ?? row.lastUsedAt,
    isExactMatch:   isMatch,
  };
}

// "21-10-2026" — DD-MM-YYYY, the viewer's local date.
function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime()) || d.getTime() === 0) return "—";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${d.getFullYear()}`;
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

// Formula: one fixed-width slot per tinter — code small on top (secondary ink,
// readable but never louder than the value), value big below, tabular figures
// so the columns of numbers line up across lines. No pigment colour. Slots
// wrap inside the row; every tinter is always shown.
function FormulaSlots({ pigments }: { pigments: Array<{ code: string; value: number }> }) {
  if (pigments.length === 0) {
    return <span className="text-[12px] text-ink-400 italic">No pigments</span>;
  }
  return (
    <div className="flex flex-wrap gap-x-1 gap-y-2">
      {pigments.map((p) => (
        <div key={p.code} className="w-[60px] flex flex-col">
          <span className="font-mono text-[12px] font-medium leading-tight text-ink-600">{p.code}</span>
          <span className="font-mono tabular-nums text-[17px] leading-tight text-ink-900">{p.value}</span>
        </div>
      ))}
    </div>
  );
}

const STANDARD_BUCKETS: readonly number[] = [1, 4, 10, 20];

// The PACK chip's label: the NOMINAL bucket ({n} LT) for a standard pack, so a
// 3.7 L recipe reads "4 LT"; the raw label otherwise.
function nominalPackLabel(code: string | null | undefined): string {
  const dose = packDoseLitres((code ?? null) as PackCode | null);
  return dose != null && STANDARD_BUCKETS.includes(dose) ? `${dose} LT` : packCodeToLabel(code);
}

// One grid for the label row and every recipe line, so the columns line up
// across cards. minmax(0, …) lets the flexible columns shrink and wrap their
// content instead of pushing the row wider than the panel.
const LINE_GRID = "grid grid-cols-[minmax(0,2fr)_76px_minmax(132px,3fr)_100px_80px] gap-x-3";

export function FlatSuggestionList({
  rows, isLoading, isSearching, linePack, lineSkuCode, lineDescription, packFilter,
  tinterType, onSwitchType, onUse,
}: FlatSuggestionListProps) {
  const [sitesOpen, setSitesOpen] = useState<Set<string>>(new Set());
  // Line's NOMINAL bucket (1/4/10/20) — marks same-bucket PACK chips. null when
  // the line pack is null/unknown/non-standard, so nothing matches it.
  const lineDose = packDoseLitres(linePack);
  const lineNominal = lineDose != null && STANDARD_BUCKETS.includes(lineDose) ? lineDose : null;
  const isMatchLine = (l: SuggestLine) =>
    lineSkuCode != null && linePack != null && l.skuCode === lineSkuCode && l.packCode === linePack;
  // Name step (c): the server could not name this code, but it IS the tinting
  // line's code — the line's own description is the right name for it.
  const lineName = lineDescription?.trim() || null;
  const nameFor = (l: SuggestLine) =>
    l.productName ?? (lineName && l.skuCode === lineSkuCode ? lineName : null);

  // The hidden type's exact matches (same SKU + pack) — counted in samplings.
  // Typed search is type-filtered on the server, so this is 0 while searching.
  const otherType: TinterType = tinterType === "TINTER" ? "ACOTONE" : "TINTER";
  const hiddenMatches = rowsOfType(rows, otherType)
    .filter((row) => rowLines(row).some(isMatchLine)).length;

  // Groups: the selected type only, filtered by pack bucket (any line in it),
  // then the group holding the tinting line's SKU + pack first; otherwise the
  // order the API sent.
  const typedRows = rowsOfType(rows, tinterType);
  const groups = typedRows
    .filter((row) => packFilter === "ALL" || rowHasPackBucket(row, packFilter))
    .map((row, i) => {
      const lines = rowLines(row);
      const hasMatch = lines.some(isMatchLine);
      // The matching line leads its group; the rest keep most-recent order.
      const ordered = hasMatch
        ? [...lines.filter(isMatchLine), ...lines.filter((l) => !isMatchLine(l))]
        : lines;
      return { row, lines: ordered, hasMatch, i };
    })
    .sort((a, b) => (a.hasMatch === b.hasMatch ? a.i - b.i : a.hasMatch ? -1 : 1));
  const recipeCount = groups.reduce((n, g) => n + g.lines.length, 0);
  const scopeLabel = isSearching
    ? `Searching all sites · ${groups.length}`
    : `Shades at this site · ${groups.length}`;

  function toggleSites(key: string) {
    setSitesOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  return (
    <div className="mb-3">
      {/* Scope line (pack is chosen via the parent's PACK FILTER dropdown) */}
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 mb-2">
        <p className="text-[12px] font-medium tracking-wide text-ink-500">{scopeLabel}</p>
        {groups.length > 0 && (
          <p className="text-[12px] text-ink-400">{recipeCount} recipe{recipeCount === 1 ? "" : "s"}</p>
        )}
      </div>

      {!isLoading && hiddenMatches > 0 && (
        <p className="text-[12px] text-ink-500 mb-2">
          {hiddenMatches} {otherType} match{hiddenMatches === 1 ? "" : "es"} —{" "}
          <button
            type="button"
            onClick={() => onSwitchType(otherType)}
            className="font-semibold text-brand-700 underline underline-offset-2 hover:text-brand-800"
          >
            switch
          </button>
        </p>
      )}

      {isLoading ? (
        <div className="border border-ink-200 rounded-lg p-4"><div className="h-16 bg-ink-100 rounded animate-pulse" /></div>
      ) : groups.length === 0 ? (
        <div className="border border-ink-200 rounded-lg px-3 py-6 text-center">
          <p className="text-[12px] text-ink-400 font-medium">
            {/* None of this type at the site → say so; otherwise (pack filter
                or a search found nothing) the generic line. */}
            {!isSearching && typedRows.length === 0
              ? `No ${tinterType} shades at this site. Search all sites or add a shade.`
              : <>No match. Tap &ldquo;+ Add shade&rdquo; to create one.</>}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {/* Column labels — once, on the same grid as the lines (inset by the
              card's 1px border + px-4 so the columns sit over their values). */}
          <div className={cn(LINE_GRID, "px-[17px] -mb-2")}>
            {["SKU · Product", "Pack", "Formula", "Last used"].map((h) => (
              <span key={h} className="text-[10px] font-medium text-ink-400 uppercase tracking-wider">{h}</span>
            ))}
            <span />
          </div>

          {groups.map(({ row, lines, hasMatch }) => {
            const key = row.samplingNo;
            const open = sitesOpen.has(key);
            return (
              <div key={key} className="border border-ink-200 rounded-lg bg-white">
                {/* Header strip — wraps onto a second line when it must */}
                <div className="bg-ink-50 border-b border-ink-200 rounded-t-[7px] px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <span className="font-mono text-[14px] font-semibold text-ink-900">#{row.samplingNo}</span>
                  <span className="text-[15px] font-semibold text-ink-900 break-words min-w-0">{row.shadeName}</span>
                  {/* Tinter-type tag keeps the app-wide dot colours (CLAUDE_UI §3:
                      TINTER blue-600, ACOTONE orange-500) — the owner's
                      "no colour" rule covers the formula, not this tag. */}
                  <span className={cn(
                    "inline-flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider bg-white border border-ink-200 rounded px-1.5 py-0.5 leading-none",
                    row.tinterType === "TINTER" ? "text-ink-600" : "text-orange-700",
                  )}>
                    <span className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      row.tinterType === "TINTER" ? "bg-blue-600" : "bg-orange-500",
                    )} />
                    {row.tinterType}
                  </span>
                  <span className="text-[12px] text-ink-600 break-words min-w-0">{row.primarySiteName || "—"}</span>
                  {row.otherSites.length > 0 && (
                    <button
                      type="button"
                      onClick={() => toggleSites(key)}
                      className="text-[12px] font-semibold text-ink-700 underline underline-offset-2 hover:text-ink-900"
                    >
                      +{row.otherSites.length} site{row.otherSites.length > 1 ? "s" : ""}
                    </button>
                  )}
                  {hasMatch && (
                    <span className="text-[10.5px] font-bold uppercase tracking-wider text-ok-text bg-ok-bg border border-ok/30 rounded px-1.5 py-0.5 leading-none">
                      ✓ Matches this line
                    </span>
                  )}
                  <span className="ml-auto text-[12px] text-ink-500 whitespace-nowrap">
                    {lines.length} recipe{lines.length === 1 ? "" : "s"}
                  </span>
                </div>

                {open && row.otherSites.length > 0 && (
                  <div className="border-b border-ink-100 bg-ink-25 px-4 py-2 flex flex-col gap-1">
                    {row.otherSites.map((s, i) => (
                      <div key={i} className="flex items-start justify-between gap-3 text-[12px]">
                        <span className="text-ink-600 break-words min-w-0">{s.siteName}</span>
                        <span className="font-mono text-ink-400 flex-shrink-0">{formatDate(s.lastUsed)}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* One line per recipe (SKU × pack) — nothing merged */}
                {lines.map((line, li) => {
                  const isMatch = isMatchLine(line);
                  const dose    = packDoseLitres(line.packCode);
                  const nominal = dose != null && STANDARD_BUCKETS.includes(dose) ? dose : null;
                  const isLinePack = nominal != null && nominal === lineNominal;
                  // Outside the pack filter: dimmed, still usable (hover lifts it).
                  const dimmed = packFilter !== "ALL" && dose !== packFilter;
                  const name   = nameFor(line);
                  return (
                    <div
                      key={line.recipeId}
                      className={cn(
                        LINE_GRID,
                        "items-center px-4 py-3.5 last:rounded-b-[7px]",
                        li > 0 && "border-t border-ink-100",
                        isMatch && "bg-ok-bg shadow-[inset_3px_0_0_theme(colors.ok.DEFAULT)]",
                        dimmed && "opacity-40 hover:opacity-100 transition-opacity",
                      )}
                    >
                      {/* SKU code on top, product name below — wraps, never cut */}
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <span className="flex flex-wrap items-center gap-1.5 font-mono font-semibold text-[15px] text-ink-900 break-all">
                          {line.skuCode}
                          {isMatch && <span className="font-sans text-[14px] text-ok">✓</span>}
                        </span>
                        {name ? (
                          <span className="text-[13px] leading-snug text-ink-500 break-words">{name}</span>
                        ) : (
                          <span className="text-[13px] leading-snug text-ink-400 italic">Name not in Orbit yet</span>
                        )}
                      </div>
                      {/* Pack — the tinting line's bucket reads darker; no colour */}
                      <div>
                        <span className={cn(
                          "inline-flex items-center text-[13px] rounded-md px-2 py-0.5 whitespace-nowrap border bg-white",
                          isLinePack ? "text-ink-900 font-semibold border-ink-400" : "text-ink-500 border-ink-200",
                        )}>
                          {nominalPackLabel(line.packCode)}
                        </span>
                      </div>
                      {/* Formula — RAW stored pigments (no scaling) */}
                      <FormulaSlots pigments={line.activePigments} />
                      {/* Last used — the recipe's own date, any site */}
                      <span className="font-mono text-[13px] text-ink-600 whitespace-nowrap">{formatDate(line.lastUsedAt)}</span>
                      {/* Use — applies THIS recipe */}
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => onUse(lineAsRow(row, line, isMatch))}
                          className={cn(
                            "h-10 min-w-[68px] px-4 rounded-md text-[13px] font-semibold transition-colors whitespace-nowrap",
                            isMatch
                              ? "bg-ink-900 text-white hover:bg-ink-700"
                              : "bg-ink-100 text-ink-700 hover:bg-ink-200",
                          )}
                        >
                          Use
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
