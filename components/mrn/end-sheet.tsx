"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Camera } from "lucide-react";
import type { MrnDetail } from "@/lib/mrn/types";
import { MAX_PHOTOS_PER_GROUP } from "@/lib/mrn/photo";
import {
  MrnPhotoCamera,
  PhotoStrip,
  partialUploadMessage,
  stagePhoto,
  uploadStagedPhotos,
  type StagedPhoto,
} from "./photo-capture";
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
   * Called ONLY once every staged LR photo is on the server, or none was taken.
   *
   * 🔴 THE UPLOAD HAPPENS HERE, NOT IN THE BOARD, and finishing is downstream
   * of it (design §5.2). The per-photo state belongs beside the strip that
   * renders it, and hoisting five upload statuses into the board just to hand
   * them back down would put the truth about each photo one component away from
   * the thumbnail showing it. A failed upload never reaches this callback, so
   * /end is never called and the MRN cannot land at 'done' believing it holds
   * an LR it does not.
   */
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
  const [staged, setStaged] = useState<StagedPhoto[]>([]);
  const [capturing, setCapturing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  // Distinct from "no photo yet": he has been asked and said no. Only this
  // makes the "Skipped" copy honest rather than a guess about his intent.
  const [skipped, setSkipped] = useState(false);

  // LR rows already on the server — normally none, but a PREVIOUS END ATTEMPT
  // that partly failed leaves some, and they count against the cap. Without
  // this the retry would offer five fresh slots on top of the two that landed.
  const [serverLr, setServerLr] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/mrn/${detail.id}/photos`, { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { photos: { kind: string }[] };
        if (!cancelled) setServerLr(json.photos.filter((ph) => ph.kind === "lr").length);
      } catch {
        // Leave it at 0 — the server cap is the real one.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [detail.id]);

  const busyAll = busy || uploading;

  /**
   * Upload every staged LR photo, then finish.
   *
   * 🔴 PARTIAL SUCCESS IS REPORTED AS PARTIAL, AND NOTHING IS ROLLED BACK.
   * Photos that landed are independently valid rows; deleting them because a
   * later one failed would destroy real evidence to make a message tidy. They
   * are also never re-sent — uploadStagedPhotos() skips 'saved' — because the
   * route has no idempotency key and a re-post would duplicate the page.
   */
  async function finish(): Promise<void> {
    setPhotoError(null);
    if (staged.some((ph) => ph.status !== "saved")) {
      setUploading(true);
      const outcome = await uploadStagedPhotos(detail.id, null, "lr", staged, setStaged);
      setUploading(false);
      if (!outcome.ok) {
        setPhotoError(
          partialUploadMessage(
            outcome.uploaded,
            outcome.attempted,
            outcome.attempted === 1 ? "LR photo" : "LR photos",
            "Nothing was finished; the truck is still open.",
          ),
        );
        return;
      }
    }
    onConfirm();
  }

  const shortfall = detail.totalQtySti - detail.totalPhysicalQty;

  const parts: string[] = [];
  if (detail.totalShort > 0) parts.push(`${detail.totalShort} short`);
  if (detail.totalExcess > 0) parts.push(`${detail.totalExcess} excess`);
  if (detail.totalLeaky > 0) parts.push(`${detail.totalLeaky} leaky`);
  if (detail.totalDamage > 0) parts.push(`${detail.totalDamage} damaged`);
  if (detail.totalEmpty > 0) parts.push(`${detail.totalEmpty} empty`);

  return (
    <div className="fixed inset-0 z-[60] flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={busyAll ? undefined : onCancel} />
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

        {/* ── LR photos ────────────────────────────────────────────────────
            Directly above the stamp line: the last thing he does before the
            truck leaves.

            🔴 OPTIONAL, AND /end GETS NO NEW GUARD. Up to
            MAX_PHOTOS_PER_GROUP pages — a lorry receipt runs to more than one
            sheet often enough that a single slot was the wrong shape. */}
        <div className="mt-4 rounded-[13px] border border-gray-200 p-3">
          <div className="flex items-center gap-3">
            <Camera size={18} className="shrink-0 text-[#667085]" />
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold text-[#1d2939]">LR photos</div>
              <div className="mt-0.5 text-[12px] text-[#98a2b3]">
                {staged.length + serverLr > 0
                  ? `${staged.length + serverLr} of ${MAX_PHOTOS_PER_GROUP} · uploaded when you finish`
                  : skipped
                    ? "Skipped — billing will see this MRN has no LR"
                    : "The lorry receipt for the whole truck. Optional."}
              </div>
            </div>
          </div>

          <div className="mt-2.5">
            <PhotoStrip
              photos={staged}
              serverCount={serverLr}
              busy={busyAll}
              addLabel="Take LR photo"
              onAdd={() => setCapturing(true)}
              onRemove={(key) => setStaged((prev) => prev.filter((x) => x.key !== key))}
            />
          </div>

          {/* 🔴 SKIP DISAPPEARS ONCE A PHOTO IS STAGED, and comes back when the
              last one is removed. "Skip" beside a photo he has just taken is a
              contradiction — there is nothing left to skip. Removing them all
              is what puts the choice back in front of him. */}
          {staged.length === 0 && serverLr === 0 && (
            <button
              type="button"
              onClick={() => setSkipped(true)}
              disabled={busyAll}
              className={
                "mt-2 h-[38px] w-full rounded-[11px] text-[13px] font-semibold disabled:opacity-60 " +
                (skipped ? "bg-gray-200 text-[#475467]" : "bg-gray-100 text-[#475467] active:bg-gray-200")
              }
            >
              {skipped ? "Skipped — finish without an LR photo" : "Skip the LR photo"}
            </button>
          )}

          {photoError && (
            <div className="mt-2.5 flex gap-2.5 rounded-[11px] border border-red-200 bg-red-50 px-3 py-2.5 text-[13px] leading-[1.55] text-[#b42318]">
              <AlertTriangle size={15} className="mt-px shrink-0" />
              <div>{photoError}</div>
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
            disabled={busyAll}
            className="h-[50px] flex-1 rounded-[13px] bg-gray-100 text-[15px] font-semibold text-[#475467] disabled:opacity-60"
          >
            Back
          </button>
          <button
            type="button"
            onClick={() => void finish()}
            disabled={busyAll}
            className="h-[50px] flex-1 rounded-[13px] bg-green-600 text-[15px] font-bold text-white active:bg-green-700 disabled:bg-gray-100 disabled:text-gray-400"
          >
            {uploading ? "Uploading photos…" : busy ? "Finishing…" : "Yes, finish"}
          </button>
        </div>
      </div>

      {capturing && (
        <MrnPhotoCamera
          title="LR photo"
          onCaptured={(blob, dataUrl) => {
            setStaged((prev) =>
              prev.length + serverLr >= MAX_PHOTOS_PER_GROUP ? prev : [...prev, stagePhoto(blob, dataUrl)],
            );
            // Taking one un-answers the skip question.
            setSkipped(false);
            setCapturing(false);
          }}
          onCancel={() => setCapturing(false)}
        />
      )}
    </div>
  );
}
