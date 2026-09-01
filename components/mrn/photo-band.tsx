"use client";

import { useEffect, useMemo, useState } from "react";
import type { MrnDetail } from "@/lib/mrn/types";
import { getSignedUrl } from "@/lib/mrn/signed-url";
import { PhotoLightbox, type MrnPhotoRow, type PhotoLineRef } from "./photo-lightbox";

// Billing's photo band — a strip of thumbnails between the header block and the
// scrolling lines table (design §6.1).
//
// 🔴 THUMBNAILS AND NOTHING ELSE. No buttons on a tile, no kebab, no inline
// delete. The whole tile is ONE tap target that opens the viewer, and every
// action lives there. A tile with controls on it is a tile you cannot click.
//
// 🔴 THE BAND RENDERS NOTHING AT ALL WHEN THERE ARE NO PHOTOS — no empty state,
// no "0 photos", no border. Most MRNs will never have one, and a permanent
// empty strip would cost every truck a row of vertical space to say nothing.
//
// 🔴 TWO CONSTRAINTS ALREADY WRITTEN INTO detail-pane.tsx, BOTH OBSERVED HERE:
//   • header-card.tsx was DELETED (detail-pane.tsx:25-28) — "Do not reintroduce
//     a second header." This band carries no MRN number, no status pill and no
//     document actions. It is thumbnails and group labels.
//   • The Facts row rule (:298-300) — "a fact disappears only when it cannot
//     exist yet." A photo COUNT in that row would inherit it and be forced to
//     render "0 photos" on every truck for ever. The band is not a Fact, which
//     is precisely why it is allowed to vanish.

interface PhotoBandProps {
  detail: MrnDetail;
  /** `mrn` canDelete — the ROLE axis. The band adds the STATE axis below. */
  canDelete: boolean;
}

export function PhotoBand({ detail, canDelete }: PhotoBandProps): React.JSX.Element | null {
  const [photos, setPhotos] = useState<MrnPhotoRow[]>([]);
  const [open, setOpen] = useState<number | null>(null);

  // ONE list call per MRN. Thumbnails then mint their own URLs — see Thumb.
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
        // Silent. A band that cannot load is a band that does not render; the
        // lines table below is the screen's actual job and must not be blocked
        // by an error about pictures.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [detail.id]);

  /** lineId → line facts, for the group labels and the viewer's caption. */
  const lineRefs = useMemo(() => {
    const m = new Map<number, PhotoLineRef>();
    for (const l of detail.lines) m.set(l.id, { lineNo: l.lineNo, skuCode: l.skuCode });
    return m;
  }, [detail.lines]);

  /**
   * 🔴 LR FIRST, THEN LINES IN LINE ORDER, AND THIS ORDER IS THE VIEWER'S TOO.
   * The arrows walk the same array the band renders, so "3 of 7" means the
   * third tile from the left. Sorting them differently in the two places would
   * make the counter a lie about where he is.
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

  // 🔴 THE WHOLE POINT OF THE BAND: nothing at all when there is nothing.
  if (ordered.length === 0) return null;

  // Delete is BOTH axes. canDelete is the role (billing_operator, admin); the
  // status is the state — while the truck is still being checked, deleting a
  // photo belongs to the supervisor who took it, on his phone
  // (DELETE /api/mrn/photo/[photoId] enforces exactly this and is the
  // authority; this only decides whether to offer the button).
  const deletable = canDelete && (detail.status === "done" || detail.status === "closed");

  const lrCount = ordered.filter((p) => p.kind === "lr").length;

  return (
    <>
      <div className="shrink-0 border-b border-[#eceff2] bg-white px-[18px] py-3">
        <div className="mb-2 flex items-baseline gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-gray-400">
            Photos
          </span>
          <span className="text-[11px] text-gray-400">
            {ordered.length}
            {lrCount === 0 && " · no LR"}
          </span>
        </div>

        {/* One horizontal run. It scrolls rather than wrapping: the band is a
            fixed strip above a scrolling table, and a wrapping grid would push
            the table down a row at a time as photos are added. */}
        <div className="flex gap-2.5 overflow-x-auto pb-1">
          {ordered.map((p, i) => (
            <Thumb
              key={p.id}
              photo={p}
              label={
                p.kind === "lr"
                  ? "LR"
                  : p.lineId !== null && lineRefs.has(p.lineId)
                    ? `Line ${lineRefs.get(p.lineId)!.lineNo}`
                    : "Line —"
              }
              onOpen={() => setOpen(i)}
            />
          ))}
        </div>
      </div>

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
              // It was the last one — the band is about to disappear too.
              setOpen(null);
              return;
            }
            // Step to what now occupies this slot, or back one if the deleted
            // photo was last. Staying put would show the NEXT photo without the
            // operator asking, which is fine; falling off the end would not be.
            setOpen((cur) => (cur === null ? null : Math.min(cur, remaining.length - 1)));
          }}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}

/**
 * One tile. Mints its own signed URL when it mounts.
 *
 * ⚠ ONE REQUEST PER RENDERED THUMBNAIL, and they are cached in
 * lib/mrn/signed-url.ts so opening the viewer costs nothing more. A 6-photo MRN
 * is therefore 1 list call + 6 URL calls on open, and 0 on every subsequent
 * click. A batch endpoint would make it 2, but that is a new route for a saving
 * measured in single-digit requests on a desk screen.
 */
function Thumb({
  photo,
  label,
  onOpen,
}: {
  photo: MrnPhotoRow;
  label: string;
  onOpen: () => void;
}): React.JSX.Element {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const u = await getSignedUrl(photo.id);
        if (!cancelled) setUrl(u);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [photo.id]);

  return (
    <button
      type="button"
      onClick={onOpen}
      title={label}
      className="group relative h-[72px] w-[72px] shrink-0 overflow-hidden rounded-[10px] border border-[#e6e9ec] bg-gray-50"
    >
      {url && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={label} className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-[10px] text-gray-400">
          {failed ? "!" : "…"}
        </span>
      )}

      {/* The label rides ON the tile — billing must be able to tell an LR from
          a line photo without opening either. */}
      <span className="absolute inset-x-0 bottom-0 truncate bg-black/55 px-1 py-[2px] text-[9.5px] font-semibold text-white">
        {label}
      </span>
    </button>
  );
}
