"use client";

// components/import/import-progress-pill.tsx
//
// The header's view of ImportProgressProvider. Rendered by UniversalHeader,
// immediately LEFT of the Import button.
//
// 🔴 THE HEADER RENDERS ON NEARLY EVERY SCREEN, so this must cost nothing when
// there is nothing to say: when the provider is idle it returns null — no
// wrapper, no listener, no element. Everything it draws is a pure function of
// provider state; the only local state is whether its panel is open.
//
//   running → grey, spinner, "Importing N OBDs…", a crawling bar
//   done    → green, "N OBDs imported", ▾ and ✕
//   failed  → red, "Import failed", ▾   (no ✕ — the panel must be opened)
//
// 🔴 NO PROGRESS PERCENTAGE. The server answers once, at the end, and reports
// nothing along the way; the bar shows movement, never a position.
// 🔴 NOTHING AUTO-HIDES. The operator has walked away; the result must still be
// here when they come back.

import { useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, ChevronDown, ChevronUp, Loader2, X } from "lucide-react";
import { useImportProgress } from "@/components/import/import-progress-provider";

interface ImportProgressPillProps {
  /**
   * Open the Import window — the panel's "Import another". OMITTED on a screen
   * whose header does not mount the Import window (showImport false); the link
   * is then not rendered, rather than rendered and dead.
   */
  onImportAnother?: () => void;
}

export function ImportProgressPill({ onImportAnother }: ImportProgressPillProps): React.JSX.Element | null {
  const { state, dismiss } = useImportProgress();
  const [panelOpen, setPanelOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close the panel on an outside click. Bound only while it is open.
  useEffect(() => {
    if (!panelOpen) return;
    function onMouseDown(e: MouseEvent): void {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setPanelOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [panelOpen]);

  // A new run (or a dismiss) closes any panel left open from the last result.
  useEffect(() => {
    if (state.status === "idle" || state.status === "running") setPanelOpen(false);
  }, [state.status]);

  if (state.status === "idle") return null;

  if (state.status === "running") {
    const n = state.job.obdCount;
    return (
      <div
        className="inline-flex h-[26px] flex-shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-gray-200 bg-gray-100 px-3 text-[11px] text-gray-600"
        role="status"
        aria-live="polite"
      >
        <Loader2 size={12} className="animate-spin text-gray-900" />
        <span>
          Importing{" "}
          {n !== null ? <b className="font-semibold text-gray-900">{n.toLocaleString("en-IN")} OBD{n === 1 ? "" : "s"}</b> : "OBDs"}…
        </span>
        {/* Movement only — see the header note. Keyframes scoped to this
            element so no global stylesheet is touched. */}
        <style>{"@keyframes import-pill-crawl{0%{transform:translateX(-100%)}100%{transform:translateX(240%)}}"}</style>
        <span className="relative h-[3px] w-[40px] overflow-hidden rounded-full bg-gray-200" aria-hidden="true">
          <span
            className="absolute inset-y-0 left-0 w-[42%] rounded-full bg-gray-900"
            style={{ animation: "import-pill-crawl 2.2s ease-in-out infinite" }}
          />
        </span>
      </div>
    );
  }

  const done = state.status === "done";
  const imported = done ? state.result.created + state.result.patched + state.result.unchanged : 0;
  const Chevron = panelOpen ? ChevronUp : ChevronDown;

  function handleDismiss(): void {
    setPanelOpen(false);
    dismiss();
  }

  function handleImportAnother(): void {
    setPanelOpen(false);
    dismiss();
    onImportAnother?.();
  }

  return (
    <div ref={wrapRef} className="relative flex-shrink-0">
      <div
        className={`inline-flex h-[26px] items-center whitespace-nowrap rounded-full border text-[11px] font-semibold ${
          done
            ? "border-green-200 bg-green-50 text-green-700"
            : "border-red-200 bg-red-50 text-red-700"
        }`}
      >
        <button
          type="button"
          onClick={() => setPanelOpen((v) => !v)}
          aria-expanded={panelOpen}
          className={`inline-flex h-full items-center gap-1.5 rounded-full cursor-pointer ${done ? "pl-2.5 pr-1.5" : "px-2.5"}`}
        >
          {done
            ? <CheckCircle2 size={13} className="text-green-600" />
            : <AlertCircle size={13} className="text-red-600" />}
          <span>
            {done ? `${imported.toLocaleString("en-IN")} OBD${imported === 1 ? "" : "s"} imported` : "Import failed"}
          </span>
          <Chevron size={12} className="opacity-60" />
        </button>
        {done && (
          <button
            type="button"
            onClick={handleDismiss}
            title="Dismiss"
            aria-label="Dismiss import result"
            className="mr-1.5 inline-flex h-[18px] w-[18px] items-center justify-center rounded-full opacity-60 hover:bg-green-100 hover:opacity-100 cursor-pointer"
          >
            <X size={11} />
          </button>
        )}
      </div>

      {panelOpen && (
        <div className="absolute right-0 top-full z-50 mt-2 w-[300px] rounded-lg border border-gray-200 bg-white p-4 text-left shadow-xl">
          <p className="text-[13px] font-semibold text-gray-900">{done ? "Import complete" : "Import failed"}</p>
          <p className="mb-3 mt-0.5 truncate font-mono text-[10.5px] text-gray-400">
            {done ? `${state.result.batchRef} · ` : ""}{state.job.sourceLabel}
          </p>

          {done ? (
            <>
              <div className="grid grid-cols-2 gap-1.5">
                {([
                  ["Created",   state.result.created],
                  ["Patched",   state.result.patched],
                  ["Unchanged", state.result.unchanged],
                  ["Errored",   state.result.errored],
                ] as const).map(([label, value]) => {
                  const warn = label === "Errored" && value > 0;
                  return (
                    <div
                      key={label}
                      className={`rounded-[5px] border px-2.5 py-2 ${warn ? "border-amber-200 bg-amber-50" : "border-gray-200 bg-gray-50"}`}
                    >
                      <div className={`text-[9px] font-medium uppercase tracking-wider ${warn ? "text-amber-700" : "text-gray-400"}`}>{label}</div>
                      <div className={`text-[16px] font-semibold tabular-nums ${warn ? "text-amber-700" : "text-gray-900"}`}>
                        {value.toLocaleString("en-IN")}
                      </div>
                    </div>
                  );
                })}
              </div>
              {state.result.unresolvedCustomers.length > 0 && (() => {
                const codes = state.result.unresolvedCustomers.map((u) => u.code);
                return (
                  <p className="mt-3 rounded-[5px] border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] leading-snug text-amber-800">
                    {codes.length} customer name{codes.length === 1 ? "" : "s"} couldn&apos;t be completed — code{codes.length === 1 ? "" : "s"}{" "}
                    <span className="font-mono">{codes.join(", ")}</span>{" "}
                    {codes.length === 1 ? "isn't" : "aren't"} in your customer list.
                  </p>
                );
              })()}
            </>
          ) : (
            <p className="rounded-[5px] border border-red-200 bg-red-50 px-2.5 py-2 text-[11px] leading-snug text-red-700">
              {state.error}
            </p>
          )}

          <div className="mt-3 flex items-center gap-3 border-t border-gray-100 pt-3 text-[11px]">
            {/* No "View audit" here on purpose: there is no batch-level audit
                page, and dead UI is not carried forward. Add the link when the
                page exists. */}
            {onImportAnother && (
              <button type="button" onClick={handleImportAnother} className="text-gray-600 underline-offset-2 hover:text-gray-900 hover:underline cursor-pointer">
                Import another
              </button>
            )}
            <button type="button" onClick={handleDismiss} className="text-gray-600 underline-offset-2 hover:text-gray-900 hover:underline cursor-pointer">
              Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
