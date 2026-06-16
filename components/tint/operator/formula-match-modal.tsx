"use client";

import { Fragment, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PackCode, TinterType } from "@prisma/client";
import type { SuggestFlatRow } from "@/app/api/sampling-library/_lib/suggest";
import { canScale, packDoseLitres } from "@/lib/sampling/pack-litres";

// Same-formula reuse pop-up. Shown when an operator's entered formula already
// exists in the library — offers reuse instead of minting a new number. Looks
// like the operator search list (same row patterns, soft-grey Use). UI only;
// the parent wires open/matches/handlers.

export interface FormulaMatchModalProps {
  open:                  boolean;
  enteredShadeName:      string;
  enteredTinterType:     TinterType;
  enteredActivePigments: Array<{ code: string; value: number }>;
  matches:               SuggestFlatRow[];
  loading:               boolean;
  // Current line's pack — matched rows scale to it when scalingEnabled (TINTER).
  linePack:              PackCode | null;
  scalingEnabled:        boolean;
  onUse:                 (samplingNo: string) => void;
  onCreateNew:           () => void;
  onClose:               () => void;
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

function tinterTagClass(t: TinterType): string {
  return cn(
    "font-mono text-[10px] font-medium uppercase tracking-wider leading-none",
    t === "TINTER" ? "text-gray-400" : "text-orange-700",
  );
}

// White-bg chips (read on the white card), matching the mockup.
function Chips({ pigments }: { pigments: Array<{ code: string; value: number }> }) {
  if (pigments.length === 0) {
    return <span className="text-[10px] text-gray-400 italic">No pigments</span>;
  }
  return (
    <div className="flex flex-wrap gap-[5px]">
      {pigments.map((p) => (
        <span
          key={p.code}
          className="inline-flex items-center gap-1 bg-white text-gray-700 border border-gray-200 rounded-md font-mono text-[11.5px] px-[7px] py-[2px] tabular-nums"
        >
          <span>{p.code}</span>
          <span className="font-semibold text-gray-900">{p.value}</span>
        </span>
      ))}
    </div>
  );
}

const GRID = "118px 118px 150px 1fr 72px";

export function FormulaMatchModal({
  open,
  enteredShadeName,
  enteredTinterType,
  enteredActivePigments,
  matches,
  loading,
  linePack,
  scalingEnabled,
  onUse,
  onCreateNew,
  onClose,
}: FormulaMatchModalProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Esc closes.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-5"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[760px] bg-white rounded-2xl shadow-xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2.5 mb-1.5">
          <span className="w-[26px] h-[26px] rounded-full bg-red-50 text-red-600 flex items-center justify-center font-bold text-[15px] flex-shrink-0">!</span>
          <span className="text-[16px] font-bold text-gray-900">Same shade found</span>
        </div>
        <p className="text-[13.5px] leading-relaxed text-gray-500 mb-4">
          This exact formula already exists in the library. Use one of these numbers instead of creating a new one?
        </p>

        {/* YOU ENTERED */}
        <p className="text-[10.5px] font-bold tracking-[.06em] text-gray-400 mb-2">YOU ENTERED</p>
        <div className="flex items-center gap-2.5 flex-wrap mb-4">
          <span className="text-[14.5px] font-semibold text-gray-900">{enteredShadeName || "—"}</span>
          <span className={tinterTagClass(enteredTinterType)}>{enteredTinterType}</span>
          <Chips pigments={enteredActivePigments} />
        </div>

        {/* Matches */}
        {loading ? (
          <div className="border border-gray-200 rounded-xl py-10 flex items-center justify-center">
            <Loader2 className="h-5 w-5 text-gray-400 animate-spin" />
          </div>
        ) : matches.length === 0 ? (
          <div className="border border-gray-200 rounded-xl py-8 text-center">
            <p className="text-[12px] text-gray-400 font-medium">No existing samplings with this exact formula.</p>
          </div>
        ) : (
          <div className="border border-gray-200 rounded-xl overflow-hidden">
            {/* Header row */}
            <div
              className="grid gap-3.5 items-center px-4 py-2.5 bg-gray-50 border-b border-gray-200 text-[10.5px] font-bold tracking-[.05em] text-gray-400 uppercase"
              style={{ gridTemplateColumns: GRID }}
            >
              <div>Sampling</div><div>Shade</div><div>Site</div><div>Formula</div><div />
            </div>

            <div className="max-h-[340px] overflow-y-auto">
              {matches.map((row) => {
                const key    = `${row.samplingNo}-${row.recipeId}`;
                const isOpen = expanded.has(key);
                // Mirror the search list: scale matched rows to the line pack
                // (TINTER only — gated by scalingEnabled).
                const isReal   = scalingEnabled && linePack != null && row.packCode === linePack;
                const scalable = scalingEnabled && linePack != null && !isReal && canScale(row.packCode, linePack);
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
                    <div
                      className="grid gap-3.5 items-center px-4 py-3 border-b border-gray-50 last:border-b-0"
                      style={{ gridTemplateColumns: GRID }}
                    >
                      {/* Sampling */}
                      <div className="min-w-0">
                        <div className="font-mono font-bold text-[13.5px] text-gray-900 truncate">#{row.samplingNo}</div>
                        <div className={cn(tinterTagClass(row.tinterType), "mt-[3px]")}>{row.tinterType}</div>
                      </div>
                      {/* Shade */}
                      <div className="text-[13.5px] font-semibold text-gray-900 break-words">{row.shadeName}</div>
                      {/* Site */}
                      <div className="min-w-0">
                        <span className="text-[13px] text-gray-600 block truncate">{row.primarySiteName || "—"}</span>
                        {row.otherSites.length > 0 && (
                          <button
                            type="button"
                            onClick={() => toggle(key)}
                            className="block text-[11.5px] font-semibold text-red-600 hover:text-red-700 mt-[3px] text-left"
                          >
                            +{row.otherSites.length} site{row.otherSites.length > 1 ? "s" : ""}
                          </button>
                        )}
                      </div>
                      {/* Formula (scaled to the line pack when TINTER) */}
                      <div>
                        <Chips pigments={displayPigments} />
                        {scalingEnabled ? (
                          <div className="flex items-center gap-1.5 mt-1.5 text-[11.5px]">
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
                        ) : (
                          <div className="text-[11.5px] text-gray-400 mt-1.5">
                            {packCodeToLabel(row.packCode)} · {formatDayMonth(row.lastUsedAt)}
                          </div>
                        )}
                      </div>
                      {/* Use */}
                      <button
                        type="button"
                        onClick={() => onUse(row.samplingNo)}
                        className="w-full bg-gray-200 text-gray-800 hover:bg-gray-300 rounded-lg py-1.5 text-[13px] font-semibold transition-colors"
                      >
                        Use
                      </button>
                    </div>
                    {isOpen && row.otherSites.length > 0 && (
                      <div className="px-4 py-2 bg-gray-50/60 border-b border-gray-50">
                        <div className="flex flex-col gap-0.5 pl-[132px]">
                          {row.otherSites.map((s, i) => (
                            <div key={i} className="flex items-center justify-between text-[11.5px]">
                              <span className="text-gray-600 truncate">{s.siteName}</span>
                              <span className="text-gray-400 ml-2 flex-shrink-0">{formatDayMonth(s.lastUsed)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </Fragment>
                );
              })}
            </div>
          </div>
        )}

        {/* Footer — Cancel aborts (no mint); Create new explicitly mints. */}
        <div className="mt-3 flex justify-center items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            className="border border-gray-300 bg-white text-gray-700 font-medium rounded-lg px-4 py-2.5 text-[13.5px] hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onCreateNew}
            className="bg-gray-900 text-white font-medium rounded-lg px-4 py-2.5 text-[13.5px] hover:bg-gray-800 transition-colors"
          >
            Create new
          </button>
        </div>
      </div>
    </div>
  );
}
