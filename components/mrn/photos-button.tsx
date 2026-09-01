"use client";

import { useEffect, useMemo, useState } from "react";
import { Camera } from "lucide-react";
import type { MrnDetail } from "@/lib/mrn/types";
import { PhotoLightbox, type MrnPhotoRow, type PhotoLineRef } from "./photo-lightbox";

// Billing's way into the photos: ONE control in the pane's action row, beside
// Print / PDF and Download XLS, carrying a count badge.
//
// 🔴 THE THUMBNAIL BAND IS GONE (owner, 2026-09-01, after seeing it). This file
// used to be `photo-band.tsx` and rendered a strip of tiles between the header
// block and the scrolling table. It was replaced, not moved or collapsed: the
// header must not grow a second row of pictures, and a strip of thumbnails cost
// every truck with photos a permanent band of vertical space above the lines
// billing actually reads. A button that says how many there are, and opens the
// viewer, does the same job in the space of a button. Do not reinstate the
// strip.
//
// 🔴 THE CONTROL RENDERS NOTHING AT ZERO PHOTOS — not greyed, not a "0" badge,
// not an empty slot. Most trucks will never carry a photo, and a permanently
// dead button in the action row is exactly the "greyed control they can never
// earn" that detail-pane.tsx's hidden-vs-disabled rule (UI §10) exists to stop.
// The zero case here is "nothing to look at", which is absence, not "not yet".
//
// ⚠ IT IS A PEER OF ITS NEIGHBOURS, NOT A NEW KIND OF THING. The button copies
// PaneButton's box model exactly — h-8, gap-1.5, rounded-lg, border, px-3,
// text-[12px] — because detail-pane.tsx's own comment insists that row keeps
// one box model so it does not shift by a pixel when a truck changes state.
// If PaneButton's shape ever changes, change this with it.

interface PhotosButtonProps {
  detail: MrnDetail;
  /** `mrn` canDelete — the ROLE axis. The STATE axis is applied below. */
  canDelete: boolean;
}

export function PhotosButton({ detail, canDelete }: PhotosButtonProps): React.JSX.Element | null {
  const [photos, setPhotos] = useState<MrnPhotoRow[]>([]);
  const [open, setOpen] = useState<number | null>(null);

  // 🔴 ONE CALL PER MRN, AND NO SIGNED URLs AT ALL. Without the thumbnail strip
  // there is nothing on screen to show, so there is nothing to mint: the list
  // gives the count for the badge and the array the viewer will walk. URLs are
  // minted only when the viewer actually displays a photo. On a 10-photo MRN
  // that is 1 request on load instead of the 11 the band used to make.
  useEffect(() => {
    let cancelled = false;
    setPhotos([]);
    setOpen(null);
    void (async () => {
      try {
        const res = await fetch(`/api/mrn/${detail.id}/photos`, { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { photos: MrnPhotoRow[] };
        if (!cancelled) setPhotos(json.photos);
      } catch {
        // Silent. A count that cannot load renders as no button; the lines
        // table below is the screen's actual job and must not be blocked by an
        // error about pictures.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [detail.id]);

  /** lineId → line facts, for the viewer's caption. */
  const lineRefs = useMemo(() => {
    const m = new Map<number, PhotoLineRef>();
    for (const l of detail.lines) m.set(l.id, { lineNo: l.lineNo, skuCode: l.skuCode });
    return m;
  }, [detail.lines]);

  /**
   * 🔴 LR FIRST, THEN LINES IN LINE ORDER — and this order IS the viewer's.
   * The arrows walk this exact array, so "3 of 10" means the third photo in the
   * order billing would expect: the lorry receipt, then the truck top to bottom.
   */
  const ordered = useMemo(() => {
    const lr = photos.filter((p) => p.kind === "lr");
    const rest = photos
      .filter((p) => p.kind !== "lr")
      .sort((a, b) => {
        const la = a.lineId !== null ? (lineRefs.get(a.lineId)?.lineNo ?? 1e9) : 1e9;
        const lb = b.lineId !== null ? (lineRefs.get(b.lineId)?.lineNo ?? 1e9) : 1e9;
        if (la !== lb) return la - lb;
        return a.id - b.id;
      });
    return [...lr, ...rest];
  }, [photos, lineRefs]);

  // The whole control disappears — see the header.
  if (ordered.length === 0) return null;

  // Delete needs BOTH axes. canDelete is the role (billing_operator, admin);
  // done/closed is the state — while the truck is still being checked a photo
  // belongs to the supervisor who took it, on his phone.
  // DELETE /api/mrn/photo/[photoId] enforces exactly this and is the authority;
  // this only decides whether to offer the button.
  const deletable = canDelete && (detail.status === "done" || detail.status === "closed");

  return (
    <>
      {/* ⚠ `relative` IS LOAD-BEARING — it is what the badge below positions
          against. Everything else here is PaneButton's box model from
          detail-pane.tsx, unchanged, so this button is the same width and
          weight as Print / PDF beside it. */}
      <button
        type="button"
        onClick={() => setOpen(0)}
        className="relative inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-[12px] font-medium text-[#475467] transition-colors hover:bg-gray-50"
      >
        <Camera size={13} />
        Photos

        {/* ── The count badge ───────────────────────────────────────────────
            An app-icon unread count: absolutely positioned on the TOP-RIGHT
            corner and sitting ON the boundary, half on the button and half
            off. It was an inline pill after the word "Photos" until
            2026-09-01; that made the button wider than its neighbours and read
            as part of the label rather than as a count.

            ⚠ IT OVERFLOWS THE BUTTON ON PURPOSE, so nothing in its ancestry
            may clip it. Verified 2026-09-01: the action row, the header block
            and the pane root carry no overflow — the nearest is the two-track
            grid in billing-board.tsx:259, and the button sits 18px inside the
            pane's right edge against a 6px overhang, so there is no contact.
            If a wrapper ever gains overflow-hidden, this corner is what is lost
            first, and it will look like a missing badge rather than a clip.

            🔴 THE SHADE HAS ONE OWNER AND IT IS NOT THIS FILE. #f5f3ff /
            #5b21b6 come from components/floor/tint-strip.tsx:30 — the pair
            CLAUDE_UI.md §28 documents as the notes/remark treatment
            (InstructionsStrip tone="violet"). instructions-strip.tsx:16 puts it
            plainly: "Do not substitute a Tailwind `purple-*` here: one owner
            for the shade, so the two screens cannot drift apart." Use the
            hexes, never purple-50. The #e9e3fb hairline is from the same file
            (:43, the progress track) — it gives the chip an edge against a
            white button, where a #f5f3ff fill is otherwise almost white.

            SHAPE: a 17px circle at one or two digits; `min-w` plus `px-1`
            lets three digits grow it into a pill instead of squashing the
            number or bursting the circle. The white ring is what lifts it off
            the button rather than letting it look inset. */}
        <span className="absolute -right-1.5 -top-1.5 inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-[#f5f3ff] px-1 text-[10px] font-bold leading-none tabular-nums text-[#5b21b6] ring-2 ring-white [box-shadow:inset_0_0_0_1px_#e9e3fb]">
          {ordered.length}
        </span>
      </button>

      {open !== null && (
        <PhotoLightbox
          mrnNumber={detail.mrnNumber}
          photos={ordered}
          index={Math.min(open, ordered.length - 1)}
          onIndex={setOpen}
          lineRefs={lineRefs}
          canDelete={deletable}
          onDeleted={(photoId) => {
            const remaining = ordered.filter((p) => p.id !== photoId);
            setPhotos((prev) => prev.filter((p) => p.id !== photoId));
            if (remaining.length === 0) {
              // That was the last one — the button is about to vanish too.
              setOpen(null);
              return;
            }
            // Step to whatever now occupies this slot, or back one if the
            // deleted photo was last. Falling off the end would unmount the
            // viewer without the operator asking for it.
            setOpen((cur) => (cur === null ? null : Math.min(cur, remaining.length - 1)));
          }}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}
