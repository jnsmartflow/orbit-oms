"use client";

import { useState } from "react";
import { AlertTriangle, Camera, Check, X } from "lucide-react";
import { CameraView } from "@/components/attendance/camera-view";
import {
  JPEG_QUALITY_PERCENT,
  MAX_PHOTO_BYTES,
  MAX_WIDTH,
  MRN_PHOTO_KIND_LABEL,
  type MrnPhotoKind,
} from "@/lib/mrn/photo";

// The supervisor's photo capture — camera, review, upload. ONE component, both
// callers: the per-line issue photo (line-sheet.tsx) and the LR at End
// (end-sheet.tsx, via supervisor-board.tsx).
//
// 🔴 THE QUALITY CONSTANT IS THE TRAP IN THIS FILE.
// captureFromVideo takes 0–100 (lib/attendance/photo.ts:45 divides by 100), so
// JPEG_QUALITY_PERCENT (80) goes to CameraView and JPEG_QUALITY (0.8) must
// never come near it. 0.8 there encodes at quality 0.008 — a near-black image
// that compresses tiny, uploads cleanly, passes every server check and is only
// ever caught by a human looking at it. There is no test that fails.
//
// ⚠ NO OFFLINE QUEUE, AND NONE CAN BE BUILT. public/sw.js handles push and
// notificationclick only and has NO fetch handler, by hard rule — a caching
// worker would serve stale live-sync markers. So a photo cannot be held for
// later: if the upload fails, it failed, and this component says so rather than
// showing a tick. Never let a photo that is not on the server look saved.
//
// ⚠ CameraView IS A LIVE ATTENDANCE COMPONENT. It is reused here through three
// OPTIONAL props that all default to attendance's exact behaviour —
// facingMode="user", showFaceGuide=true, locationStatus=null hides the pill.
// MRN opts out of all three. Do not change those defaults.

/** What the caller gets back once the row exists on the server. */
export interface UploadedMrnPhoto {
  id: number;
  kind: string;
  lineId: number | null;
  bytes: number;
}

interface PhotoCaptureProps {
  mrnId: number;
  /** null = truck-level. Set = this line. Never set for kind 'lr'. */
  lineId: number | null;
  kind: MrnPhotoKind;
  /** Sheet title — "Damage photo", "LR photo". */
  title: string;
  /**
   * DEFER MODE. When true the photo is NOT uploaded here; the blob is handed
   * back and the caller uploads it at its own moment. The LR uses this: design
   * §5.2 requires it to upload immediately BEFORE /end, so that a failed upload
   * stops that END attempt rather than leaving an MRN 'done' believing it holds
   * an LR it does not.
   */
  deferUpload?: boolean;
  onUploaded?: (photo: UploadedMrnPhoto) => void;
  onCaptured?: (blob: Blob, dataUrl: string) => void;
  onCancel: () => void;
}

export function MrnPhotoCapture({
  mrnId,
  lineId,
  kind,
  title,
  deferUpload = false,
  onUploaded,
  onCaptured,
  onCancel,
}: PhotoCaptureProps): React.JSX.Element {
  const [shot, setShot] = useState<{ blob: Blob; dataUrl: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Camera ────────────────────────────────────────────────────────────────
  if (!shot) {
    return (
      <CameraView
        onCapture={(blob, dataUrl) => setShot({ blob, dataUrl })}
        onClose={onCancel}
        photoMaxWidth={MAX_WIDTH}
        // 🔴 PERCENT. See the header. Never JPEG_QUALITY.
        photoJpegQuality={JPEG_QUALITY_PERCENT}
        // The tin is in front of the phone, not behind it.
        facingMode="environment"
        // A face oval over a pallet reads as "put your face here".
        showFaceGuide={false}
      />
    );
  }

  async function save(): Promise<void> {
    if (!shot) return;

    // The server enforces this too (413) — checked here so he is told before
    // spending a slow upload on a photo that will be refused at the far end.
    if (shot.blob.size > MAX_PHOTO_BYTES) {
      setError(
        `This photo is ${Math.round(shot.blob.size / 1000)}KB, over the ${Math.round(
          MAX_PHOTO_BYTES / 1000,
        )}KB limit. Retake it a little further back.`,
      );
      return;
    }

    if (deferUpload) {
      onCaptured?.(shot.blob, shot.dataUrl);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("photo", shot.blob, "photo.jpg");
      form.append("kind", kind);
      if (lineId !== null) form.append("lineId", String(lineId));

      const res = await fetch(`/api/mrn/${mrnId}/photo`, { method: "POST", body: form });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        // The route's own sentence wherever it has one — it names the real
        // reason (wrong state, wrong line, too large) far better than anything
        // generic here could.
        setError(json.error ?? "The photo could not be saved. Try again.");
        setBusy(false);
        return;
      }
      const created = (await res.json()) as UploadedMrnPhoto;
      onUploaded?.(created);
    } catch {
      // ⚠ THE NO-SIGNAL CASE, AND IT MUST NOT LOOK LIKE ANYTHING ELSE. There is
      // no queue and no retry — the photo is still only on this phone.
      setError("No connection. The photo was NOT saved — try again once you have signal.");
      setBusy(false);
    }
  }

  // ── Review ────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-black">
      <div className="flex items-center justify-between px-3 py-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          aria-label="Cancel"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white disabled:opacity-50"
        >
          <X className="h-5 w-5" />
        </button>
        <div className="text-[15px] font-semibold text-white">{title}</div>
        {/* Balances the row so the title stays optically centred. */}
        <div className="h-10 w-10" />
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center px-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={shot.dataUrl}
          alt={`${MRN_PHOTO_KIND_LABEL[kind]} photo, just captured`}
          className="max-h-full max-w-full rounded-[14px] object-contain"
        />
      </div>

      <div
        className="px-3 pt-3"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 14px)" }}
      >
        {error && (
          <div className="mb-3 flex gap-2.5 rounded-[11px] border border-red-300 bg-red-50 px-3 py-2.5 text-[13px] leading-[1.55] text-[#b42318]">
            <AlertTriangle size={15} className="mt-px shrink-0" />
            <div>{error}</div>
          </div>
        )}

        <div className="flex gap-2.5">
          <button
            type="button"
            onClick={() => {
              setShot(null);
              setError(null);
            }}
            disabled={busy}
            className="flex h-[50px] flex-1 items-center justify-center gap-2 rounded-[13px] bg-white/15 text-[15px] font-semibold text-white disabled:opacity-50"
          >
            <Camera className="h-4 w-4" />
            Retake
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy}
            className="flex h-[50px] flex-1 items-center justify-center gap-2 rounded-[13px] bg-teal-600 text-[15px] font-bold text-white active:bg-teal-700 disabled:bg-white/20 disabled:text-white/50"
          >
            {busy ? (
              "Saving…"
            ) : (
              <>
                <Check className="h-4 w-4" />
                Use photo
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Kind chooser ────────────────────────────────────────────────────────────

/**
 * Which kind of issue photo — Leaky · Damage · Other.
 *
 * 🔴 'lr' IS NOT OFFERED HERE AND MUST NEVER BE. An LR is a TRUCK-level
 * document; the live CHECK chk_mrn_photo_lr_truck_level refuses an 'lr' row
 * carrying a lineId, and the upload route refuses it first with a sentence. The
 * LR is captured once, at End unloading, from end-sheet.tsx.
 *
 * ⚠ DO NOT CALL ANYTHING IN THIS FILE "Batch". line-sheet.tsx already says
 * "Batch 1 / Batch 2" for the 1st and 2nd MANUFACTURING group on the same
 * screen, and a second meaning for that word on the same sheet would be read as
 * the first one.
 */
const ISSUE_KINDS: MrnPhotoKind[] = ["leaky", "damage", "other"];

export function PhotoKindSheet({
  onPick,
  onCancel,
}: {
  onPick: (kind: MrnPhotoKind) => void;
  onCancel: () => void;
}): React.JSX.Element {
  return (
    <div className="fixed inset-0 z-[75] flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div
        role="dialog"
        aria-modal="true"
        className="relative rounded-t-[22px] bg-white px-4 pt-2.5"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 16px)" }}
      >
        <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-gray-200" />
        <div className="text-[17px] font-bold text-gray-900">What are you photographing?</div>
        <div className="mt-1 text-[13px] text-[#667085]">
          The photo is attached to this line.
        </div>

        <div className="mt-4 space-y-2">
          {ISSUE_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => onPick(k)}
              className="flex h-[52px] w-full items-center gap-3 rounded-[13px] border border-gray-200 px-3.5 text-left text-[15px] font-semibold text-[#1d2939] active:bg-gray-50"
            >
              <Camera className="h-[18px] w-[18px] shrink-0 text-[#667085]" />
              {MRN_PHOTO_KIND_LABEL[k]}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={onCancel}
          className="mt-3 h-[50px] w-full rounded-[13px] bg-gray-100 text-[15px] font-semibold text-[#475467]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
