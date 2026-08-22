"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import type { MrnDetail } from "@/lib/mrn/types";
import { formatCount, formatIstTime } from "./format";

// S10 — End unloading.
//
// This is the moment everything lands in billing AT ONCE (design §5). Billing
// has seen nothing since Start — no progress, no partial values — so this sheet
// is the last chance to look at what is about to arrive there, which is why it
// summarises rather than just confirming.
//
// ⚠ CONFIRM IS GREEN, NOT TEAL. It matches the picking board's Approve: a
// completion, not a primary action. The distinction is worth keeping — teal on
// this module means "the job", and finishing is the end of the job.

interface EndSheetProps {
  detail: MrnDetail;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export function EndSheet({
  detail,
  busy,
  error,
  onCancel,
  onConfirm,
}: EndSheetProps): React.JSX.Element {
  // Read once on open so the stamp does not tick while he reads it. The server
  // stamps its own clock, which is why the copy says "will be stamped".
  const [now] = useState(() => new Date());

  const shortfall = detail.totalQtySti - detail.totalPhysicalQty;

  const parts: string[] = [];
  if (detail.totalShort > 0) parts.push(`${detail.totalShort} short`);
  if (detail.totalExcess > 0) parts.push(`${detail.totalExcess} excess`);
  if (detail.totalLeaky > 0) parts.push(`${detail.totalLeaky} leaky`);
  if (detail.totalDamage > 0) parts.push(`${detail.totalDamage} damaged`);
  if (detail.totalEmpty > 0) parts.push(`${detail.totalEmpty} empty`);

  return (
    <div className="fixed inset-0 z-[60] flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={busy ? undefined : onCancel} />
      <div
        role="dialog"
        aria-modal="true"
        className="relative max-h-[92vh] overflow-y-auto rounded-t-[22px] bg-white px-4 pt-2.5"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 16px)" }}
      >
        <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-gray-200" />
        <div className="text-[17px] font-bold text-gray-900">Finish this MRN?</div>
        <div className="mt-1 text-[13px] text-[#667085]">
          <span className="font-mono">{detail.mrnNumber}</span> · {detail.receivedFrom} · all{" "}
          {detail.lineCount} lines checked
        </div>

        {/* Side by side, because the only question billing will ask is whether
            what arrived matches what was sent. */}
        <div className="mt-4 grid grid-cols-2 gap-2.5">
          <div className="rounded-[11px] border border-gray-200 p-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.05em] text-gray-400">
              Qty as per STI
            </div>
            <div className="mt-0.5 text-[19px] font-bold tabular-nums text-[#1d2939]">
              {formatCount(detail.totalQtySti)}
            </div>
          </div>
          <div
            className={
              "rounded-[11px] border p-3 " +
              (shortfall !== 0 ? "border-red-200 bg-red-50" : "border-gray-200")
            }
          >
            <div
              className={
                "text-[10px] font-semibold uppercase tracking-[0.05em] " +
                (shortfall !== 0 ? "text-[#b42318]" : "text-gray-400")
              }
            >
              Physically received
            </div>
            <div
              className={
                "mt-0.5 text-[19px] font-bold tabular-nums " +
                (shortfall !== 0 ? "text-[#b42318]" : "text-[#1d2939]")
              }
            >
              {formatCount(detail.totalPhysicalQty)}
            </div>
          </div>
        </div>

        {detail.issueLineCount > 0 && (
          <div className="mt-3 flex gap-2.5 rounded-[11px] border border-amber-200 bg-amber-50 px-3 py-2.5 text-[13px] leading-[1.55] text-amber-900">
            <AlertTriangle size={15} className="mt-px shrink-0" />
            <div>
              <b>
                {detail.issueLineCount} line{detail.issueLineCount === 1 ? "" : "s"} have issues
              </b>
              {parts.length > 0 && ` — ${parts.join(", ")}`}. Billing will see them flagged.
            </div>
          </div>
        )}

        <p className="mt-3 text-[12px] leading-[1.55] text-[#98a2b3]">
          Unloading end will be stamped <b className="text-[#475467]">{formatIstTime(now)}</b>.
          After this you cannot change any line.
        </p>

        {error && (
          <div className="mt-3 rounded-[11px] border border-red-200 bg-red-50 px-3 py-2.5 text-[13px] leading-[1.55] text-[#b42318]">
            {error}
          </div>
        )}

        <div className="mt-4 flex gap-2.5">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="h-[50px] flex-1 rounded-[13px] bg-gray-100 text-[15px] font-semibold text-[#475467] disabled:opacity-60"
          >
            Back
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="h-[50px] flex-1 rounded-[13px] bg-green-600 text-[15px] font-bold text-white active:bg-green-700 disabled:bg-gray-100 disabled:text-gray-400"
          >
            {busy ? "Finishing…" : "Yes, finish"}
          </button>
        </div>
      </div>
    </div>
  );
}
