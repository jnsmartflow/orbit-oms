// lib/trip-sheet/share-image.ts
//
// Orbit trip sheet → PNG → share (phone) or download (desktop). CLIENT-ONLY.
//
// The capture technique is the one proven on the NTS sheet (CLAUDE_TRIP_REPORT
// §6), re-implemented here so nothing imports the NTS code:
//   - render <OrbitTripSheetDocument> into a hidden SAME-DOCUMENT div — never an
//     iframe: html-to-image cannot capture a node from another realm;
//   - wait two frames, then await every <img> decode, so the logo (a data URI
//     with an explicit 141×34) is never captured blank;
//   - toBlob at pixelRatio 2, cacheBust false.
// The data is the TripSheet already in memory — no fetch.

import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { toBlob } from "html-to-image";
import { OrbitTripSheetDocument } from "@/components/trip-sheet/trip-sheet-document";
import { buildTripSheetCaption } from "./caption";
import type { TripSheet } from "./types";

async function captureSheet(sheet: TripSheet): Promise<Blob> {
  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.left = "-10000px";
  container.style.top = "0";
  container.style.width = "210mm";
  document.body.appendChild(container);
  const root = createRoot(container);

  try {
    await new Promise<void>((resolve) => {
      // No printAreaId — the hidden copy must never be revealed by a stray print.
      root.render(createElement(OrbitTripSheetDocument, { sheet }));
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });

    const node = container.querySelector(".orbit-trip-sheet-inner") as HTMLElement | null;
    if (!node) throw new Error("Trip sheet did not render");

    await Promise.all(
      Array.from(node.querySelectorAll("img")).map(async (img) => {
        try {
          await img.decode();
        } catch {
          // decode() can reject on some engines for a valid image — fall back
          // to the load event and never block the capture on one image.
          if (img.complete) return;
          await new Promise<void>((resolve) => {
            img.addEventListener("load", () => resolve(), { once: true });
            img.addEventListener("error", () => resolve(), { once: true });
          });
        }
      }),
    );

    const blob = await toBlob(node, { pixelRatio: 2, backgroundColor: "#ffffff", cacheBust: false });
    if (!blob) throw new Error("The image came back empty");
    return blob;
  } finally {
    root.unmount();
    document.body.removeChild(container);
  }
}

/**
 * Capture and hand off. "shared" = the phone's share sheet opened (or the user
 * dismissed it); "downloaded" = no file sharing here, so the PNG was downloaded
 * and the caption copied. Throws on a capture failure — the caller toasts it.
 */
export async function shareTripSheet(sheet: TripSheet): Promise<"shared" | "downloaded"> {
  const caption = buildTripSheetCaption(sheet);
  const blob = await captureSheet(sheet);
  const fileName = `TripSheet-${sheet.header.tripNumber}.png`;
  const file = new File([blob], fileName, { type: "image/png" });

  if (
    typeof navigator.canShare === "function" &&
    typeof navigator.share === "function" &&
    navigator.canShare({ files: [file] })
  ) {
    try {
      await navigator.share({ files: [file], text: caption, title: `Trip Sheet ${sheet.header.tripNumber}` });
    } catch (err) {
      // The user closing the share sheet is not an error.
      if (err instanceof DOMException && err.name === "AbortError") return "shared";
      throw err;
    }
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
    // Best effort — an insecure context or a denied permission is fine.
  }
  return "downloaded";
}
