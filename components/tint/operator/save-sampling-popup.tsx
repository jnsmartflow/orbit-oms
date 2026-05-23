"use client";

import { useEffect } from "react";

// ── Types ───────────────────────────────────────────────────────────────────

export interface SaveSamplingResult {
  scenario:   "new_sampling" | "new_variant";
  samplingNo: string;
  // Used by the "new_variant" copy (e.g. "20 LT"). Null when unknown — the
  // copy falls back to "new variant" without a pack qualifier.
  packCode:   string | null;
}

export interface SaveSamplingPopupProps {
  result:  SaveSamplingResult | null;
  onClose: () => void;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function packCodeToLabel(code: string): string {
  if (code === "ml_500") return "500 ML";
  const m = code.match(/^L_(\d+)(?:_(\d+))?$/);
  if (!m) return code;
  return `${m[2] !== undefined ? `${m[1]}.${m[2]}` : m[1]} LT`;
}

// ── Component ───────────────────────────────────────────────────────────────
// Modal per CLAUDE_UI §13: bg-black/40 backdrop, bg-white rounded-lg shadow-xl
// panel, gray-900 confirm button. Backdrop click does NOT dismiss — operator
// must explicitly acknowledge with OK (or Esc). Tab cycling is implicit since
// the OK button is the only focusable element in the modal.

export function SaveSamplingPopup({ result, onClose }: SaveSamplingPopupProps) {
  useEffect(() => {
    if (!result) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [result, onClose]);

  if (!result) return null;

  const isNewSampling = result.scenario === "new_sampling";
  const packLabel = result.packCode ? packCodeToLabel(result.packCode) : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-labelledby="save-sampling-popup-title"
    >
      <div className="bg-white rounded-lg shadow-xl w-[400px] p-6">
        <h2
          id="save-sampling-popup-title"
          className="text-[15px] font-semibold text-gray-900 mb-3"
        >
          {isNewSampling ? "New shade saved" : "New variant saved"}
        </h2>

        {isNewSampling ? (
          <>
            <div className="font-mono text-[30px] font-semibold text-gray-900 leading-none mb-2">
              #{result.samplingNo}
            </div>
            <p className="text-[13px] text-gray-600">
              Write this in your paper register.
            </p>
          </>
        ) : (
          <>
            <p className="text-[14px] text-gray-700 mb-2">
              {packLabel
                ? `Saved as new ${packLabel} variant under sampling`
                : "Saved as new variant under sampling"}
            </p>
            <div className="font-mono text-[24px] font-semibold text-gray-900 leading-none">
              #{result.samplingNo}
            </div>
          </>
        )}

        <div className="mt-5 flex justify-end">
          <button
            type="button"
            autoFocus
            onClick={onClose}
            className="bg-gray-900 hover:bg-gray-800 text-white text-[13px] font-medium px-4 py-2 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-1"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
