"use client";

// components/stock-audit/count-submitted.tsx — the Submitted tab: MY live
// lines in this audit, newest first, each with Edit and Remove.
//
// Follows docs/mockups/stock-audit/stock-audit-mobile.html submitted():
// "Your entries in SA-…", rows "{code} · {qty} pcs" / description · pack /
// time, the Edit icon, and "Nothing submitted yet." Remove is NOT in the
// mockup — it is Smart Flow's soft-delete decision (2026-11-02) and sits
// beside Edit behind a confirm sheet. v27.79 (2026-11-03): no working line —
// a line is ONE qty, always pieces; Edit changes the qty only.
//
// BLIND: these are the session user's own lines only (the API never returns
// anyone else's).

import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { MOBILE_NAV_CLEARANCE } from "@/components/shared/mobile-shell";
import type { CountLine } from "@/lib/stock-audit/types";
import { fmtPcs, fmtTime } from "./count-api";

interface Props {
  auditNumber: string;
  lines: CountLine[] | null;
  loadError: string | null;
  flash: string | null;
  readOnly: boolean;
  removing: boolean;
  removeError: string | null;
  onEdit: (line: CountLine) => void;
  /** Resolves true when the line was removed (the sheet then closes). */
  onRemove: (line: CountLine) => Promise<boolean>;
  onRetry: () => void;
}

export function CountSubmitted({
  auditNumber,
  lines,
  loadError,
  flash,
  readOnly,
  removing,
  removeError,
  onEdit,
  onRemove,
  onRetry,
}: Props): React.JSX.Element {
  const [confirm, setConfirm] = useState<CountLine | null>(null);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-4" style={{ paddingBottom: MOBILE_NAV_CLEARANCE }}>
      {flash && (
        <div role="status" className="mb-3 rounded-[10px] bg-ok-bg px-3 py-2.5 text-[14px] text-ok-text">
          {flash}
        </div>
      )}
      <div className="mb-1 text-[13px] text-ink-500">Your entries in {auditNumber}</div>

      {loadError && (
        <div className="py-6 text-center">
          <p className="text-[14px] text-danger-text">{loadError}</p>
          <button type="button" onClick={onRetry} className="mt-2 text-[14px] font-semibold text-brand-700">
            Try again
          </button>
        </div>
      )}

      {!loadError && lines === null && <p className="py-6 text-center text-[14px] text-ink-400">Loading…</p>}

      {!loadError && lines !== null && lines.length === 0 && (
        <p className="py-6 text-center text-[14px] text-ink-500">Nothing submitted yet.</p>
      )}

      {lines !== null && lines.length > 0 && (
        <ul>
          {lines.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-2.5 border-b border-ink-100 py-3.5">
              <div className="min-w-0">
                <div className="text-[15px] font-semibold tabular-nums text-ink-900">
                  {l.material} · {fmtPcs(l.qty)} pcs
                </div>
                <div className="truncate text-[12.5px] text-ink-500">
                  {l.inCatalog ? `${l.skuDescription ?? ""}${l.skuPack ? ` · ${l.skuPack}` : ""}` : "Not in catalog"}
                </div>
                <div className="text-[12px] tabular-nums text-ink-400">{fmtTime(l.updatedAt)}</div>
              </div>
              {!readOnly && (
                <div className="flex flex-none gap-1">
                  <button
                    type="button"
                    aria-label={`Edit ${l.material}`}
                    onClick={() => onEdit(l)}
                    className="flex h-11 w-11 items-center justify-center rounded-[10px] border border-ink-100 text-ink-600 active:bg-ink-50"
                  >
                    <Pencil className="h-[18px] w-[18px]" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${l.material}`}
                    onClick={() => setConfirm(l)}
                    className="flex h-11 w-11 items-center justify-center rounded-[10px] border border-ink-100 text-ink-500 active:bg-ink-50"
                  >
                    <Trash2 className="h-[18px] w-[18px]" />
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {confirm !== null && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
          onClick={() => !removing && setConfirm(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="sc-rm-title"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[480px] rounded-t-[18px] bg-white p-5"
            style={{ paddingBottom: `calc(${MOBILE_NAV_CLEARANCE} + 12px)` }}
          >
            <h2 id="sc-rm-title" className="text-[17px] font-bold text-ink-900">
              Remove this count?
            </h2>
            <p className="mt-1.5 text-[14px] tabular-nums text-ink-600">
              {confirm.material} · {fmtPcs(confirm.qty)} pcs
            </p>
            {removeError && <p className="mt-2 text-[14px] text-danger-text">{removeError}</p>}
            <div className="mt-4 flex gap-2.5">
              <button
                type="button"
                disabled={removing}
                onClick={() => setConfirm(null)}
                className="h-12 flex-1 rounded-[12px] bg-ink-50 text-[15px] font-semibold text-ink-700"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={removing}
                onClick={async () => {
                  if (await onRemove(confirm)) setConfirm(null);
                }}
                className="h-12 flex-1 rounded-[12px] bg-danger text-[15px] font-semibold text-white disabled:opacity-60"
              >
                {removing ? "Removing…" : "Remove"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
