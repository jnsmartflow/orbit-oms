// lib/trip-sheet/share-image.ts
//
// Orbit trip sheet → PNG → share (phone) or download (desktop). CLIENT-ONLY.
//
// The capture technique is the one proven on the NTS sheet (CLAUDE_TRIP_REPORT
// §6), re-implemented here so nothing imports the NTS code:
//   - render <OrbitTripSheetDocument> into a hidden SAME-DOCUMENT div — never an
//     iframe: html-to-image cannot capture a node from another realm;
//   - an off-screen container that is still PAINTED (opacity 1, never
//     display:none / visibility:hidden);
//   - wait two frames, await every <img> decode, then one more frame, so the
//     logo (a data URI with an explicit 141×34, eager + sync decode) is ready;
//   - toBlob at pixelRatio 2, cacheBust false — TWICE, keeping the second
//     (the WebKit first-draw quirk, see captureSheet).
// The data is the TripSheet already in memory — no fetch.

import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { toBlob } from "html-to-image";
import { OrbitTripSheetDocument } from "@/components/trip-sheet/trip-sheet-document";
import { buildTripSheetCaption } from "./caption";
import type { TripSheet } from "./types";

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

const CAPTURE_OPTIONS = { pixelRatio: 2, backgroundColor: "#ffffff", cacheBust: false } as const;

async function captureSheet(sheet: TripSheet): Promise<Blob> {
  // Off-screen but PAINTED: fixed, far left, fully opaque. Never display:none or
  // visibility:hidden — WebKit skips decoding/painting images in a box it is
  // not rendering, and the capture then clones an unpainted logo.
  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.left = "-10000px";
  container.style.top = "0";
  container.style.width = "210mm";
  container.style.opacity = "1";
  container.style.pointerEvents = "none";
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

    // EVERY image decoded before the capture (decode(), falling back to load).
    await Promise.all(
      Array.from(node.querySelectorAll("img")).map(async (img) => {
        try {
          await img.decode();
        } catch {
          // decode() can reject on some engines for a valid image — fall back
          // to the load event and never block the capture on one image.
          if (img.complete && img.naturalWidth > 0) return;
          await new Promise<void>((resolve) => {
            img.addEventListener("load", () => resolve(), { once: true });
            img.addEventListener("error", () => resolve(), { once: true });
          });
        }
      }),
    );
    await nextFrame();

    // 🔴 CAPTURED TWICE, THE FIRST RESULT THROWN AWAY — the known WebKit
    // first-draw quirk (2026-10-10). html-to-image serialises the node into an
    // SVG <foreignObject> and draws that onto a canvas; on iOS Safari the
    // <img> inside the foreignObject is often NOT painted on the FIRST draw of
    // that SVG, even with a data URI, an explicit 141×34 and a resolved
    // decode(). The second draw has it. That is the symptom reported (logo
    // missing in the PNG, present on the print page, which never goes through
    // foreignObject). Costs one extra capture (~a few hundred ms). Do not
    // "optimise" back to one call.
    await toBlob(node, CAPTURE_OPTIONS);
    const blob = await toBlob(node, CAPTURE_OPTIONS);
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
