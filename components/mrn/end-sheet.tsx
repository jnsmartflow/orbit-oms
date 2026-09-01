"use client";

import { useState } from "react";
import { AlertTriangle, Camera, Check, X } from "lucide-react";
import type { MrnDetail } from "@/lib/mrn/types";
import { MrnPhotoCapture } from "./photo-capture";
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
  /**
   * The LR blob, or null when he skipped or never took one. The BOARD uploads
   * it immediately before calling /end (design §5.2) — a failed upload must
   * abort that END attempt, so the upload cannot live here, where the sheet has
   * already handed control back.
   */
  onConfirm: (lrPhoto: Blob | null) => void;
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

  // ── The LR photo ──────────────────────────────────────────────────────────
  //
  // 🔴 OPTIONAL, AND /end GETS NO NEW GUARD (design §5.2 — an owner reversal
  // from an earlier "mandatory"). The route keeps exactly its two server-side
  // checks: status === 'checking' and uncheckedCount === 0. Do not add a third
  // there or here. A future session finding "mandatory" in an older copy of the
  // draft is reading a decision that was reversed the same day.
  //
  // 🔴 THE BLOB IS HELD, NOT UPLOADED HERE. It goes up in supervisor-board's
  // confirmEnd, immediately before POST /end, so a failed upload aborts the
  // whole END. An MRN must never reach 'done' believing it holds an LR it does
  // not.
  const [lrShot, setLrShot] = useState<{ blob: Blob; dataUrl: string } | null>(null);
  const [capturing, setCapturing] = useState(false);
  // Distinct from "no photo yet": he has been asked and said no. Only this
  // makes the "Skipped" copy honest rather than a guess about his intent.
  const [skipped, setSkipped] = useState(false);

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

        {/* ── LR photo ─────────────────────────────────────────────────────
            Directly above the stamp line: it is the last thing he does before
            the truck leaves. */}
        <div className="mt-4 rounded-[13px] border border-gray-200 p-3">
          <div className="flex items-center gap-3">
            <Camera size={18} className="shrink-0 text-[#667085]" />
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold text-[#1d2939]">LR photo</div>
              <div className="mt-0.5 text-[12px] text-[#98a2b3]">
                {lrShot
                  ? "Will be uploaded when you finish"
                  : skipped
                    ? "Skipped — billing will see this MRN has no LR"
                    : "The lorry receipt for the whole truck. Optional."}
              </div>
            </div>
            {lrShot && (
              <span className="flex shrink-0 items-center gap-1 rounded-[6px] bg-teal-50 px-[7px] py-[3px] text-[12px] font-bold text-teal-700">
                <Check size={12} />
                Ready
              </span>
            )}
          </div>

          {lrShot ? (
            <div className="mt-2.5 flex items-center gap-2.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={lrShot.dataUrl}
                alt="LR photo about to be uploaded"
                className="h-[52px] w-[52px] shrink-0 rounded-[9px] object-cover"
              />
              <button
                type="button"
                onClick={() => setCapturing(true)}
                disabled={busy}
                className="h-[40px] flex-1 rounded-[11px] bg-gray-100 text-[13.5px] font-semibold text-[#475467] disabled:opacity-60"
              >
                Retake
              </button>
              <button
                type="button"
                onClick={() => setLrShot(null)}
                disabled={busy}
                aria-label="Remove the LR photo"
                className="flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-[11px] bg-gray-100 text-[#475467] disabled:opacity-60"
              >
                <X size={16} />
              </button>
            </div>
          ) : (
            <div className="mt-2.5 flex gap-2.5">
              <button
                type="button"
                onClick={() => setCapturing(true)}
                disabled={busy}
                className="flex h-[42px] flex-1 items-center justify-center gap-2 rounded-[11px] bg-gray-900 text-[13.5px] font-semibold text-white active:bg-gray-800 disabled:opacity-60"
              >
                <Camera size={15} />
                Take LR photo
              </button>
              {/* 🔴 SKIP IS AS PROMINENT AS THE CAMERA. The LR is optional, and
                  a buried skip would make it feel required — which is precisely
                  the decision that was reversed on 2026-08-31. */}
              <button
                type="button"
                onClick={() => {
                  setSkipped(true);
                  setLrShot(null);
                }}
                disabled={busy}
                className={
                  "h-[42px] flex-1 rounded-[11px] text-[13.5px] font-semibold disabled:opacity-60 " +
                  (skipped
                    ? "bg-gray-200 text-[#475467]"
                    : "bg-gray-100 text-[#475467] active:bg-gray-200")
                }
              >
                {skipped ? "Skipped" : "Skip"}
              </button>
            </div>
          )}
        </div>

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
            onClick={() => onConfirm(lrShot?.blob ?? null)}
            disabled={busy}
            className="h-[50px] flex-1 rounded-[13px] bg-green-600 text-[15px] font-bold text-white active:bg-green-700 disabled:bg-gray-100 disabled:text-gray-400"
          >
            {busy ? "Finishing…" : "Yes, finish"}
          </button>
        </div>
      </div>

      {capturing && (
        <MrnPhotoCapture
          mrnId={detail.id}
          // 🔴 null, ALWAYS. An LR is a TRUCK-level document: the live CHECK
          // chk_mrn_photo_lr_truck_level refuses an 'lr' row carrying a lineId,
          // and the upload route refuses it first, with a sentence.
          lineId={null}
          kind="lr"
          title="LR photo"
          // Held, not uploaded — see the state block at the top of this file.
          deferUpload
          onCaptured={(blob, dataUrl) => {
            setLrShot({ blob, dataUrl });
            setSkipped(false);
            setCapturing(false);
          }}
          onCancel={() => setCapturing(false)}
        />
      )}
    </div>
  );
}
