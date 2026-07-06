import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { toBlob } from "html-to-image";
import { TripSheetDocument, type TripSheetDocumentProps } from "@/components/trip-report/trip-sheet-document";

// ─────────────────────────────────────────────────────────────────────────────
// Trip sheet → PNG → share/download. Read-only client-side feature.
//
// Renders <TripSheetDocument> (the SAME component the print route uses) into
// a hidden container in the SAME document/JS realm as this code, using data
// already held in memory (no fetch, no iframe). A prior iframe-based version
// captured `.trip-sheet-inner` from a hidden IFRAME's contentDocument — a
// DIFFERENT document/realm than the one html-to-image itself runs in.
// html-to-image cannot reliably capture cross-realm nodes (cross-realm
// `instanceof` checks and style/URL resolution fail), so it threw. Rendering
// in-document eliminates that failure mode entirely.
// ─────────────────────────────────────────────────────────────────────────────

type SheetProps = Omit<TripSheetDocumentProps, "printAreaId">;

export interface ShareTripSheetParams {
  caption: string;
  sheet: SheetProps;
}

async function captureSheetImage(sheet: SheetProps): Promise<Blob> {
  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.left = "-10000px";
  container.style.top = "0";
  container.style.width = "210mm";
  document.body.appendChild(container);

  const root = createRoot(container);

  try {
    // Mount, then wait two animation frames so React has committed and the
    // browser has painted the layout before we read anything from the DOM.
    await new Promise<void>((resolve) => {
      root.render(createElement(TripSheetDocument, sheet));
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });

    const node = container.querySelector(".trip-sheet-inner") as HTMLElement | null;
    if (!node) throw new Error("Trip sheet did not render");

    // Wait for EVERY image (currently just the inlined-data-URI logo) to finish
    // decoding/loading so none is missing/blank in the capture. Awaiting all
    // images — not just the first — means no future DOM change can shift which
    // element is awaited. The logo is a data URI, so decode() resolves instantly
    // with no network: fast and deterministic.
    const imgs = Array.from(node.querySelectorAll("img"));
    await Promise.all(
      imgs.map(async (img) => {
        try {
          await img.decode();
        } catch {
          // decode() can reject on some engines even for a valid image; fall
          // back to the load event, and never block the capture on one image.
          if (img.complete) return;
          await new Promise<void>((resolve) => {
            img.addEventListener("load", () => resolve(), { once: true });
            img.addEventListener("error", () => resolve(), { once: true });
          });
        }
      }),
    );

    const blob = await toBlob(node, {
      pixelRatio: 2,
      backgroundColor: "#ffffff",
      // false: the logo has an explicit px width now (the real fix); a
      // cache-bust ?t= query would only risk the apex->www redirect on the
      // inline fetch for no benefit (same-origin /public asset).
      cacheBust: false,
    });
    if (!blob) throw new Error("html-to-image returned no data");
    return blob;
  } finally {
    root.unmount();
    document.body.removeChild(container);
  }
}

// Feature-detects Web Share API (files). Falls back to a PNG download +
// best-effort caption copy. Returns which path was taken so the caller can
// show the right toast.
export async function shareTripSheetImage({
  caption,
  sheet,
}: ShareTripSheetParams): Promise<"shared" | "downloaded"> {
  const blob = await captureSheetImage(sheet);
  const fileName = `TripSheet-${sheet.tripNo}-${sheet.date}.png`;
  const file = new File([blob], fileName, { type: "image/png" });

  if (
    typeof navigator.canShare === "function" &&
    typeof navigator.share === "function" &&
    navigator.canShare({ files: [file] })
  ) {
    await navigator.share({ files: [file], text: caption, title: `Trip Sheet ${sheet.tripNo}` });
    return "shared";
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  try {
    await navigator.clipboard.writeText(caption);
  } catch {
    // Clipboard is best-effort — insecure context / permission denial is fine.
  }

  return "downloaded";
}
