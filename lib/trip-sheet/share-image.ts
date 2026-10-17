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
//
// TWO HALVES (2026-10-17, the list's share chips): prepareTripSheetShare does
// the slow capture; deliverTripSheetShare hands a READY file to the share
// sheet. A chip that lost the iPhone gesture window (NotAllowedError) keeps its
// prepared file and delivers it on the next tap, with nothing slow in between.

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
      // compact: no blank filler rows in the image (2026-10-10) — the print
      // route keeps them. Every logo precaution below is unchanged.
      root.render(createElement(OrbitTripSheetDocument, { sheet, compact: true }));
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

/** A captured sheet, ready to hand to the share sheet with nothing slow left to do. */
export interface PreparedTripSheetShare {
  file: File;
  caption: string;
  title: string;
}

/**
 * The slow half: caption + capture. `groupLabel` (a list share chip, e.g.
 * "City 1") goes in the FILE NAME only — "TripSheet-L-261017-02-City-1.png".
 * The caption and the share title are the full trip's format, no label
 * (owner, 2026-10-17). Throws on a capture failure.
 */
export async function prepareTripSheetShare(sheet: TripSheet, groupLabel?: string): Promise<PreparedTripSheetShare> {
  const caption = buildTripSheetCaption(sheet);
  const blob = await captureSheet(sheet);
  const tag = groupLabel ? `-${groupLabel.replace(/[^A-Za-z0-9]+/g, "-")}` : "";
  const fileName = `TripSheet-${sheet.header.tripNumber}${tag}.png`;
  const title = `Trip Sheet ${sheet.header.tripNumber}`;
  return { file: new File([blob], fileName, { type: "image/png" }), caption, title };
}

/**
 * The fast half: hand off a prepared file. "shared" = the share sheet completed;
 * "cancelled" = the user closed it (AbortError); "downloaded" = no file sharing
 * here, so the PNG was downloaded and the caption copied. Any other share error
 * — NotAllowedError when the tap's gesture window has expired — is THROWN, so
 * the caller can keep the prepared file and offer a second tap.
 */
export async function deliverTripSheetShare(p: PreparedTripSheetShare): Promise<"shared" | "cancelled" | "downloaded"> {
  if (
    typeof navigator.canShare === "function" &&
    typeof navigator.share === "function" &&
    navigator.canShare({ files: [p.file] })
  ) {
    try {
      await navigator.share({ files: [p.file], text: p.caption, title: p.title });
    } catch (err) {
      // The user closing the share sheet is not an error.
      if (err instanceof DOMException && err.name === "AbortError") return "cancelled";
      throw err;
    }
    return "shared";
  }

  const url = URL.createObjectURL(p.file);
  const a = document.createElement("a");
  a.href = url;
  a.download = p.file.name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  try {
    await navigator.clipboard.writeText(p.caption);
  } catch {
    // Best effort — an insecure context or a denied permission is fine.
  }
  return "downloaded";
}

/**
 * Capture and hand off — the detail page's full-trip Share, unchanged in
 * behaviour. "shared" = the phone's share sheet opened (or the user dismissed
 * it); "downloaded" = no file sharing here, so the PNG was downloaded and the
 * caption copied. Throws on a capture failure — the caller toasts it.
 */
export async function shareTripSheet(sheet: TripSheet): Promise<"shared" | "downloaded"> {
  const outcome = await deliverTripSheetShare(await prepareTripSheetShare(sheet));
  return outcome === "cancelled" ? "shared" : outcome;
}
