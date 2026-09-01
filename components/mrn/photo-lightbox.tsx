"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  Trash2,
  X,
} from "lucide-react";
import { fetchPhotoBlob, forgetSignedUrl, getSignedUrl } from "@/lib/mrn/signed-url";
import { formatIstDateTime } from "./format";

// The full-screen photo viewer for billing. New UI — there is no gallery or
// lightbox anywhere else in this app; components/admin/attendance/photo-viewer.tsx
// is a single <img> and not a precedent for any of this.
//
// 🔴 fixed inset-0, COVERING EVERYTHING INCLUDING THE SIDEBAR. It copies
// LineDrawer's overlay pattern (components/mrn/line-drawer.tsx:116) for the
// reason that pattern exists: the detail pane is an `overflow-auto` box inside
// a grid track, and anything positioned inside that subtree scrolls away with
// the table. Escaping to the viewport is the only way a viewer stays put.
//
// 🔴 THIS COMPONENT OWNS ONE window-level keydown AND IT IS BRANCHED, NOT
// STACKED. components/mrn/modal-shell.tsx:36 binds Escape whenever an MRN modal
// is mounted, and line-drawer.tsx declined to add a second because two
// listeners fire in registration order and one surface closes under the other
// (CLAUDE_FLOOR.md §4.6). The listener here is safe because it is the ONLY one
// live while the viewer is up:
//   • a ModalShell cannot be opened underneath — its own scrim covers the band,
//     so the thumbnail cannot be clicked while one is open;
//   • the delete confirmation below is deliberately NOT a ModalShell, precisely
//     so it does not register a second listener. Esc is branched here instead:
//     while confirming it cancels the confirm, otherwise it closes the viewer.
// That is the shape line-drawer.tsx's comment asks for — "ONE owner … guarded
// branch by branch". Do not turn the confirm into a ModalShell.

export interface MrnPhotoRow {
  id: number;
  kind: string;
  lineId: number | null;
  bytes: number;
  widthPx: number | null;
  heightPx: number | null;
  createdAt: string;
  capturedByName: string | null;
}

/** Line facts the caption needs, resolved by the band from MrnDetail. */
export interface PhotoLineRef {
  lineNo: number;
  skuCode: string;
}

interface LightboxProps {
  mrnNumber: string;
  /** Every photo on the MRN, in band order — the arrows walk THIS array. */
  photos: MrnPhotoRow[];
  index: number;
  onIndex: (i: number) => void;
  /** lineId → { lineNo, skuCode }. Missing for an LR (lineId null). */
  lineRefs: Map<number, PhotoLineRef>;
  /** `mrn` canDelete AND the MRN is done/closed — resolved by the caller. */
  canDelete: boolean;
  onDeleted: (photoId: number) => void;
  onClose: () => void;
}

type CopyState = "idle" | "working" | "done" | "failed";

export function PhotoLightbox({
  mrnNumber,
  photos,
  index,
  onIndex,
  lineRefs,
  canDelete,
  onDeleted,
  onClose,
}: LightboxProps): React.JSX.Element | null {
  const photo = photos[index];

  const [url, setUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [copy, setCopy] = useState<CopyState>("idle");
  const [copyError, setCopyError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const hasPrev = index > 0;
  const hasNext = index < photos.length - 1;

  const step = useCallback(
    (delta: number) => {
      const next = index + delta;
      if (next < 0 || next >= photos.length) return;
      onIndex(next);
    },
    [index, photos.length, onIndex],
  );

  // The image for the current photo, plus a quiet head start on the next one.
  //
  // 🔴 NOTHING IS MINTED BEFORE THE VIEWER OPENS. The thumbnail band that used
  // to pre-mint a URL per photo is gone (2026-09-01) — the pane now makes ONE
  // list call and no signed URLs at all, so on a 10-photo MRN the cost of
  // opening the truck went from 11 requests to 1. That saving is the reason
  // this effect exists in this shape.
  //
  // ⚠ THE NEXT PHOTO IS PREFETCHED, THE PREVIOUS ONE IS NOT — and that is not
  // an oversight. Forward is how a gallery is read; backward is almost always a
  // return to something already opened, which is already in the cache
  // (lib/mrn/signed-url.ts). Prefetching both directions would double the
  // requests to save a wait that mostly cannot happen.
  //
  // The prefetch is fire-and-forget and its failure is swallowed on purpose: it
  // is an optimisation, and surfacing its error would put a message on screen
  // about a photo the operator has not asked to see. If it did fail, arrowing
  // to that photo simply mints it then, and THAT failure is reported.
  useEffect(() => {
    if (!photo) return;
    let cancelled = false;
    setUrl(null);
    setLoadError(null);
    setCopy("idle");
    setCopyError(null);
    setActionError(null);
    setConfirming(false);
    void (async () => {
      try {
        const u = await getSignedUrl(photo.id);
        if (!cancelled) setUrl(u);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Could not load this photo.");
      }
    })();

    const next = photos[index + 1];
    if (next) void getSignedUrl(next.id).catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [photo, photos, index]);

  // ── The single, branched keyboard owner — see the header ───────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        // Branch, never a second listener: the confirm is the innermost
        // surface, so Esc dismisses it first and leaves the viewer up.
        if (confirming) setConfirming(false);
        else if (!deleting) onClose();
        return;
      }
      if (deleting || confirming) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        step(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        step(1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirming, deleting, onClose, step]);

  if (!photo) return null;

  const line = photo.lineId !== null ? lineRefs.get(photo.lineId) : undefined;
  const isLr = photo.kind === "lr";

  // Position within its own group, so the name reads LR-1 / line-4-2 rather
  // than carrying a UUID nobody can say out loud.
  const groupOrdinal =
    photos
      .filter((p) => (isLr ? p.kind === "lr" : p.lineId === photo.lineId))
      .findIndex((p) => p.id === photo.id) + 1;
  const filename = isLr
    ? `${mrnNumber}-LR-${groupOrdinal}.jpg`
    : `${mrnNumber}-line-${line?.lineNo ?? "unknown"}-${groupOrdinal}.jpg`;

  /**
   * Put the IMAGE on the clipboard so it pastes straight into Outlook.
   *
   * 🔴 PNG, NOT JPEG. `navigator.clipboard.write()` accepts a narrow set of
   * types, and Chromium's write-safe list is text/plain, text/html and
   * image/png — image/jpeg is NOT on it and throws
   * "Type image/jpeg not supported on write". Safari and Firefox agree on PNG.
   * Our objects are JPEG, so they are decoded and re-encoded through a canvas
   * on the way to the clipboard. Do not "optimise" this by writing the fetched
   * blob directly; it will fail on every browser billing uses.
   *
   * 🔴 THE BLOB IS PASSED AS A PROMISE. Chrome requires transient user
   * activation for a clipboard write, and awaiting a network fetch plus a
   * canvas encode can outlive it. ClipboardItem accepts a Promise<Blob> exactly
   * so the gesture is captured at construction and the data resolves after —
   * Safari REQUIRES this form. Awaiting first and writing second is the version
   * that works on a fast connection and fails on a depot one.
   *
   * 🔴 FEATURE-DETECTED AND CAUGHT, AND A FAILURE SAYS SO. "Copied" over a copy
   * that did not happen sends someone to Outlook to paste nothing, and they
   * blame the paste. On failure the button says Copy failed and the row below
   * points at Download, which always works.
   */
  async function onCopy(): Promise<void> {
    setCopyError(null);
    if (typeof window === "undefined" || typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
      setCopy("failed");
      setCopyError("This browser cannot copy images. Use Download, or Open and right-click the image.");
      return;
    }
    setCopy("working");
    try {
      const png = (async () => {
        const blob = await fetchPhotoBlob(photo.id);
        const bitmap = await createImageBitmap(blob);
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas unavailable");
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        const out = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, "image/png"),
        );
        if (!out) throw new Error("Could not convert the image");
        return out;
      })();

      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
      setCopy("done");
      window.setTimeout(() => setCopy((c) => (c === "done" ? "idle" : c)), 2000);
    } catch {
      setCopy("failed");
      setCopyError("The browser refused the copy. Use Download instead, or Open and right-click the image.");
    }
  }

  /**
   * Download with a readable name.
   *
   * 🔴 VIA A BLOB, NOT href={signedUrl}. The `download` attribute is IGNORED on
   * a CROSS-ORIGIN href — the signed URL is on supabase.co — so the browser
   * would navigate to the image instead of saving it, and the filename would be
   * thrown away. detail-pane.tsx:251's plain <a download> works only because
   * /api/mrn/[id]/export is same-origin. A blob: URL is same-origin, so the
   * attribute is honoured and the name survives.
   */
  async function onDownload(): Promise<void> {
    setActionError(null);
    try {
      const blob = await fetchPhotoBlob(photo.id);
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoke on the next tick — revoking synchronously can beat the download.
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
    } catch {
      setActionError("Could not download this photo. Check your connection and try again.");
    }
  }

  /** A fresh URL every time: the one on screen may be minutes old, and a new
   *  tab landing on an expired token shows a Supabase error page. */
  async function onOpen(): Promise<void> {
    setActionError(null);
    try {
      const fresh = await getSignedUrl(photo.id, true);
      window.open(fresh, "_blank", "noopener,noreferrer");
    } catch {
      setActionError("Could not open this photo.");
    }
  }

  async function onDelete(): Promise<void> {
    setDeleting(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/mrn/photo/${photo.id}`, { method: "DELETE" });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setActionError(json.error ?? "Could not delete this photo.");
        setDeleting(false);
        return;
      }
      forgetSignedUrl(photo.id);
      setConfirming(false);
      setDeleting(false);
      onDeleted(photo.id);
    } catch {
      setActionError("Could not reach the server. The photo was not deleted.");
      setDeleting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[120] flex flex-col bg-[#0b0d10]/95">
      {/* ── Top bar ────────────────────────────────────────────────────────
          🔴 THE ✕ IS BIG AND IT IS TOP-RIGHT. It is the first thing anyone
          looks for in a full-screen viewer and the thing they get annoyed
          about not finding. Esc and a click on the dark ground do the same,
          but neither is discoverable and neither is what a mouse reaches for. */}
      <div className="flex shrink-0 items-center gap-3 px-4 py-3 text-white">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold">
            {isLr ? "LR / lorry receipt" : line ? `Line ${line.lineNo} · ${line.skuCode}` : "Photo"}
          </div>
          <div className="mt-0.5 truncate text-[12px] text-white/55">
            {photo.capturedByName ?? "Unknown"} · {formatIstDateTime(photo.createdAt) ?? "—"}
            {photo.widthPx && photo.heightPx ? ` · ${photo.widthPx}×${photo.heightPx}` : ""}
            {` · ${Math.round(photo.bytes / 1000)}KB`}
          </div>
        </div>

        <div className="shrink-0 text-[13px] font-medium tabular-nums text-white/70">
          {index + 1} of {photos.length}
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close photo viewer"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
        >
          <X className="h-6 w-6" />
        </button>
      </div>

      {/* ── The image ──────────────────────────────────────────────────────
          Clicking the dark ground closes; clicking the image does not, so a
          mis-aimed click on the photo itself is not punished. */}
      <div
        className="flex min-h-0 flex-1 items-center justify-center px-4"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        {hasPrev && (
          <button
            type="button"
            onClick={() => step(-1)}
            aria-label="Previous photo"
            className="mr-3 flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
        )}

        {loadError ? (
          <div className="flex items-center gap-2 rounded-[12px] bg-white/10 px-4 py-3 text-[13px] text-white">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {loadError}
          </div>
        ) : url ? (
          // 🔴 PLAIN <img>, NEVER next/image. next.config.mjs has no `images`
          // key, deliberately — next/image would need every signed-URL host
          // whitelisted, and the host is per-object. Do not add remotePatterns.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={isLr ? "LR document" : `Line ${line?.lineNo ?? ""} photo`}
            // Never cropped, and never blown up past its own pixels: an
            // upscaled damage photo invents detail that is not there.
            className="max-h-full max-w-full object-contain"
            style={{ maxWidth: photo.widthPx ?? undefined }}
          />
        ) : (
          <div className="text-[13px] text-white/60">Loading…</div>
        )}

        {hasNext && (
          <button
            type="button"
            onClick={() => step(1)}
            aria-label="Next photo"
            className="ml-3 flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        )}
      </div>

      {/* ── Actions ────────────────────────────────────────────────────────
          The owner's sentence: billing must "see, refer, copy, download and
          easily paste in their email as attachment." One row, in that order. */}
      <div
        className="shrink-0 px-4 pb-4 pt-3"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 16px)" }}
      >
        {(copyError || actionError) && (
          <div className="mx-auto mb-2.5 flex max-w-[640px] gap-2.5 rounded-[11px] bg-red-500/15 px-3 py-2.5 text-[13px] leading-[1.5] text-red-200">
            <AlertTriangle className="mt-px h-4 w-4 shrink-0" />
            <div>{copyError ?? actionError}</div>
          </div>
        )}

        <div className="mx-auto flex max-w-[640px] gap-2.5">
          <ActionButton
            onClick={() => void onCopy()}
            disabled={copy === "working" || deleting}
            tone={copy === "done" ? "ok" : copy === "failed" ? "bad" : "plain"}
            icon={copy === "done" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            label={
              copy === "working"
                ? "Copying…"
                : copy === "done"
                  ? "Copied"
                  : copy === "failed"
                    ? "Copy failed"
                    : "Copy"
            }
          />
          <ActionButton
            onClick={() => void onDownload()}
            disabled={deleting}
            icon={<Download className="h-4 w-4" />}
            label="Download"
          />
          <ActionButton
            onClick={() => void onOpen()}
            disabled={deleting}
            icon={<ExternalLink className="h-4 w-4" />}
            label="Open"
          />
          {/* HIDDEN, not disabled, without the permission — the role axis, per
              detail-pane.tsx's hidden-vs-disabled rule (UI §10). */}
          {canDelete && (
            <ActionButton
              onClick={() => setConfirming(true)}
              disabled={deleting}
              tone="bad"
              icon={<Trash2 className="h-4 w-4" />}
              label="Delete"
            />
          )}
        </div>
      </div>

      {/* ── Delete confirmation ────────────────────────────────────────────
          🔴 NOT A ModalShell, AND THAT IS THE POINT. ModalShell registers its
          own window-level Escape listener (modal-shell.tsx:36); mounting one
          here would put two listeners on the same key and close the viewer out
          from under its own confirm. This is a plain layer, and Esc is branched
          in the single handler above.

          A photo is evidence and there is no undo — the row goes first, then
          the object, and neither comes back. */}
      {confirming && (
        <div className="absolute inset-0 z-[121] flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-[380px] rounded-[14px] bg-white p-4">
            <div className="text-[15px] font-bold text-gray-900">Delete this photo?</div>
            <div className="mt-1.5 text-[13px] leading-[1.55] text-[#475467]">
              {isLr ? "This LR page" : `This photo of line ${line?.lineNo ?? ""}`} will be removed
              from the MRN and from storage. This cannot be undone.
            </div>
            <div className="mt-4 flex gap-2.5">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={deleting}
                className="h-[44px] flex-1 rounded-[11px] bg-gray-100 text-[14px] font-semibold text-[#475467] disabled:opacity-60"
              >
                Keep it
              </button>
              <button
                type="button"
                onClick={() => void onDelete()}
                disabled={deleting}
                className="h-[44px] flex-1 rounded-[11px] bg-red-600 text-[14px] font-bold text-white active:bg-red-700 disabled:opacity-60"
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ActionButton({
  onClick,
  disabled,
  icon,
  label,
  tone = "plain",
}: {
  onClick: () => void;
  disabled?: boolean;
  icon: React.ReactNode;
  label: string;
  tone?: "plain" | "ok" | "bad";
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        "flex h-[46px] flex-1 items-center justify-center gap-2 rounded-[12px] text-[14px] font-semibold disabled:opacity-50 " +
        (tone === "ok"
          ? "bg-teal-600 text-white"
          : tone === "bad"
            ? "bg-red-500/15 text-red-200 hover:bg-red-500/25"
            : "bg-white/10 text-white hover:bg-white/20")
      }
    >
      {icon}
      {label}
    </button>
  );
}
