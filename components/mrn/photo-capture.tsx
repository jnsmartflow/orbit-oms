"use client";

import { useState } from "react";
import { AlertTriangle, Camera, Check, Plus, X } from "lucide-react";
import { CameraView } from "@/components/attendance/camera-view";
import {
  JPEG_QUALITY_PERCENT,
  MAX_PHOTO_BYTES,
  MAX_PHOTOS_PER_GROUP,
  MAX_WIDTH,
  type MrnPhotoKind,
} from "@/lib/mrn/photo";

// The supervisor's photo capture — camera, review, staging strip, upload.
// Shared by both paths: per-line issue photos (line-sheet.tsx) and the LR at
// End (end-sheet.tsx, driven by supervisor-board.tsx).
//
// 🔴 THE QUALITY CONSTANT IS THE TRAP IN THIS FILE.
// captureFromVideo takes 0–100 (lib/attendance/photo.ts:45 divides by 100), so
// JPEG_QUALITY_PERCENT (80) goes to CameraView and JPEG_QUALITY (0.8) must
// never come near it. 0.8 there encodes at quality 0.008 — a near-black image
// that compresses tiny, uploads cleanly, passes every server check and is
// caught only by a human looking at it. No test fails.
//
// ⚠ NO KIND PICKER (removed 2026-09-01, owner, after live testing). Tapping
// "Add a photo" opens the camera immediately and every line photo stores
// 'other'. The picker asked a question the photograph itself answers, and it
// stood between the supervisor and the shutter at the one moment he is holding
// a phone in one hand and a leaking tin in the other. 'leaky' and 'damage'
// remain LEGAL in chk_mrn_photo_kind and must stay so — see lib/mrn/photo.ts.
//
// ⚠ NO OFFLINE QUEUE, AND NONE CAN BE BUILT. public/sw.js handles push and
// notificationclick only and has NO fetch handler, by hard rule. A photo cannot
// be held for later: if the upload fails, it failed, and this file says so
// rather than showing a tick. Never let a photo that is not on the server look
// saved.
//
// ⚠ CameraView IS A LIVE ATTENDANCE COMPONENT and is NOT touched again here. It
// is reused through three optional props that all default to attendance's exact
// behaviour; MRN opts out of all three.

/** The kind every line photo is stored as, now that the picker is gone. */
export const DEFAULT_LINE_PHOTO_KIND: MrnPhotoKind = "other";

// ── Staging ─────────────────────────────────────────────────────────────────

/**
 * One photo held on the phone, with its OWN upload state.
 *
 * 🔴 STATE IS PER PHOTO, NOT PER BATCH, and that is what makes a partial
 * failure honest. Three photos where two landed is not "failed" and not
 * "saved" — it is two rows on the server and one still only on this phone, and
 * the strip has to show exactly that or he will retry the wrong ones.
 */
export interface StagedPhoto {
  /** Local identity. Never the server id — a pending photo has no server id. */
  key: number;
  blob: Blob;
  dataUrl: string;
  status: "pending" | "uploading" | "saved" | "failed";
  /** Set once the row exists. Its presence is what stops a re-send. */
  serverId?: number;
  error?: string;
}

let nextKey = 1;

export function stagePhoto(blob: Blob, dataUrl: string): StagedPhoto {
  return { key: nextKey++, blob, dataUrl, status: "pending" };
}

export interface UploadOutcome {
  ok: boolean;
  /** Rows that now exist for this group, counting earlier successes. */
  uploaded: number;
  /** How many were attempted in this pass. */
  attempted: number;
  photos: StagedPhoto[];
}

/**
 * Upload every photo in the strip that has not already landed.
 *
 * 🔴 A PHOTO THAT UPLOADED STAYS UPLOADED. Each row is independently valid
 * evidence; there is no batch to roll back and nothing to compensate. Deleting
 * the two that worked because the third did not would destroy real photos of a
 * real problem to make a progress bar tidy.
 *
 * 🔴 AND IT IS NEVER RE-SENT. `status === "saved"` is skipped on every
 * subsequent pass, because the upload route has no idempotency key — the same
 * blob posted twice becomes two rows of the same page of the same lorry
 * receipt, under two different UUID paths, and nothing downstream can tell they
 * are duplicates.
 *
 * Every pending photo is attempted even after one fails: on a depot connection
 * the usual cause is signal, but a 413 on one oversized shot must not stop the
 * three good ones behind it.
 */
export async function uploadStagedPhotos(
  mrnId: number,
  lineId: number | null,
  kind: MrnPhotoKind,
  photos: StagedPhoto[],
  onProgress: (next: StagedPhoto[]) => void,
): Promise<UploadOutcome> {
  let working = photos.map((p) => (p.status === "failed" ? { ...p, status: "pending" as const, error: undefined } : p));
  onProgress(working);

  const patch = (key: number, fields: Partial<StagedPhoto>) => {
    working = working.map((p) => (p.key === key ? { ...p, ...fields } : p));
    onProgress(working);
  };

  const todo = working.filter((p) => p.status !== "saved");
  for (const p of todo) {
    patch(p.key, { status: "uploading" });
    try {
      const form = new FormData();
      form.append("photo", p.blob, "photo.jpg");
      form.append("kind", kind);
      if (lineId !== null) form.append("lineId", String(lineId));

      const res = await fetch(`/api/mrn/${mrnId}/photo`, { method: "POST", body: form });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        patch(p.key, { status: "failed", error: json.error ?? "Upload failed" });
        continue;
      }
      const created = (await res.json()) as { id: number };
      patch(p.key, { status: "saved", serverId: created.id, error: undefined });
    } catch {
      // The no-signal case. There is no queue and no retry loop — the photo is
      // still only on this phone, and the caller says so.
      patch(p.key, { status: "failed", error: "No connection" });
    }
  }

  const uploaded = working.filter((p) => p.status === "saved").length;
  return {
    ok: working.every((p) => p.status === "saved"),
    uploaded,
    attempted: working.length,
    photos: working,
  };
}

/**
 * The sentence shown when some but not all of a group reached the server.
 *
 * ⚠ IT ALWAYS NAMES THE COUNT AND ALWAYS NAMES THE CONSEQUENCE. "Some photos
 * failed" tells him nothing he can act on; "2 of 3 uploaded" tells him which
 * retry is left, and the second clause tells him the thing he would otherwise
 * assume wrongly — that the truck is still open, or the line unconfirmed.
 * `consequence` is the caller's, because only it knows what did not happen.
 */
export function partialUploadMessage(
  uploaded: number,
  attempted: number,
  noun: string,
  consequence: string,
): string {
  return `${uploaded} of ${attempted} ${noun} uploaded. ${consequence}`;
}

// ── Camera ──────────────────────────────────────────────────────────────────

interface CameraProps {
  title: string;
  onCaptured: (blob: Blob, dataUrl: string) => void;
  onCancel: () => void;
}

/**
 * Camera → review → hand the blob back. It NEVER uploads: staging is the
 * caller's, and both callers upload at their own moment (line confirm, or
 * immediately before /end) so a failure can abort the thing that follows.
 */
export function MrnPhotoCamera({ title, onCaptured, onCancel }: CameraProps): React.JSX.Element {
  const [shot, setShot] = useState<{ blob: Blob; dataUrl: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  function use(): void {
    if (!shot) return;
    // The server enforces this too (413). Checked here so he is told before
    // spending a slow upload on a photo that will be refused at the far end.
    if (shot.blob.size > MAX_PHOTO_BYTES) {
      setError(
        `This photo is ${Math.round(shot.blob.size / 1000)}KB, over the ${Math.round(
          MAX_PHOTO_BYTES / 1000,
        )}KB limit. Retake it a little further back.`,
      );
      return;
    }
    onCaptured(shot.blob, shot.dataUrl);
  }

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-black">
      <div className="flex items-center justify-between px-3 py-3">
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white"
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
          alt="Just captured"
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
            className="flex h-[50px] flex-1 items-center justify-center gap-2 rounded-[13px] bg-white/15 text-[15px] font-semibold text-white"
          >
            <Camera className="h-4 w-4" />
            Retake
          </button>
          <button
            type="button"
            onClick={use}
            className="flex h-[50px] flex-1 items-center justify-center gap-2 rounded-[13px] bg-teal-600 text-[15px] font-bold text-white active:bg-teal-700"
          >
            <Check className="h-4 w-4" />
            Use photo
          </button>
        </div>
      </div>
    </div>
  );
}

// ── The strip ───────────────────────────────────────────────────────────────

interface StripProps {
  photos: StagedPhoto[];
  /** Rows ALREADY on the server for this group, from a previous session or a
   *  previous partial upload. They count against the cap but have no thumbnail
   *  here — the phone never had their blobs. */
  serverCount: number;
  busy: boolean;
  onAdd: () => void;
  onRemove: (key: number) => void;
  /** Label for the add control when the strip is empty. */
  addLabel: string;
}

export function PhotoStrip({
  photos,
  serverCount,
  busy,
  onAdd,
  onRemove,
  addLabel,
}: StripProps): React.JSX.Element {
  // 🔴 THE CAP COUNTS BOTH: what is already on the server for this group AND
  // what is staged but not yet sent. Counting only the strip would let him
  // stage five on top of two that already exist, and the route would then
  // refuse the last two after he had taken them — the worst moment to find out.
  const total = serverCount + photos.length;
  const full = total >= MAX_PHOTOS_PER_GROUP;

  return (
    <div>
      {(photos.length > 0 || serverCount > 0) && (
        <div className="mb-2.5 flex flex-wrap gap-2">
          {serverCount > 0 && (
            // No blob to show — the row exists but this phone never held the
            // image. Saying so beats an empty box or a broken <img>.
            <div className="flex h-[62px] w-[62px] shrink-0 flex-col items-center justify-center rounded-[10px] border border-dashed border-gray-300 bg-gray-50 text-center">
              <Check size={13} className="text-teal-600" />
              <span className="mt-0.5 text-[10px] font-semibold leading-tight text-[#667085]">
                {serverCount} saved
              </span>
            </div>
          )}

          {photos.map((p) => (
            <div key={p.key} className="relative shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.dataUrl}
                alt="Staged photo"
                className={
                  "h-[62px] w-[62px] rounded-[10px] object-cover " +
                  (p.status === "failed"
                    ? "ring-2 ring-red-400"
                    : p.status === "saved"
                      ? "ring-2 ring-teal-500"
                      : "ring-1 ring-gray-200")
                }
              />

              {/* Per-photo state. He must be able to point at a thumbnail and
                  say "that one didn't go". */}
              {p.status === "uploading" && (
                <span className="absolute inset-0 flex items-center justify-center rounded-[10px] bg-black/45 text-[10px] font-bold text-white">
                  …
                </span>
              )}
              {p.status === "saved" && (
                <span className="absolute bottom-0.5 left-0.5 flex h-[16px] w-[16px] items-center justify-center rounded-full bg-teal-600 text-white">
                  <Check size={10} />
                </span>
              )}
              {p.status === "failed" && (
                <span className="absolute bottom-0.5 left-0.5 flex h-[16px] w-[16px] items-center justify-center rounded-full bg-red-600 text-white">
                  <AlertTriangle size={9} />
                </span>
              )}

              {/* ⚠ A SAVED PHOTO KEEPS NO ✕ HERE. Removing it from the strip
                  would hide a row that exists on the server, and this component
                  cannot delete rows — that is the canDelete path in
                  DELETE /api/mrn/photo/[photoId]. Showing a control that only
                  half-works is worse than showing none. */}
              {p.status !== "saved" && p.status !== "uploading" && (
                <button
                  type="button"
                  onClick={() => onRemove(p.key)}
                  disabled={busy}
                  aria-label="Remove this photo"
                  className="absolute -right-1.5 -top-1.5 flex h-[22px] w-[22px] items-center justify-center rounded-full bg-gray-900 text-white shadow disabled:opacity-50"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={onAdd}
        disabled={busy || full}
        className={
          "flex h-[42px] w-full items-center justify-center gap-2 rounded-[11px] text-[13.5px] font-semibold disabled:opacity-60 " +
          (full
            ? "cursor-not-allowed bg-gray-100 text-gray-400"
            : "bg-gray-900 text-white active:bg-gray-800")
        }
      >
        {photos.length > 0 || serverCount > 0 ? <Plus size={15} /> : <Camera size={15} />}
        {full
          ? // 🔴 A PLAIN REASON, NOT JUST A GREY BUTTON. A disabled control with
            // no sentence reads as broken software; UI §10 is explicit that
            // "not yet" must say why.
            `Maximum ${MAX_PHOTOS_PER_GROUP} photos`
          : photos.length > 0 || serverCount > 0
            ? "Add another photo"
            : addLabel}
      </button>
    </div>
  );
}
