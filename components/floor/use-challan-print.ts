"use client";

// Floor's DC column — print a delivery challan WITHOUT leaving Floor
// (2026-10-09, owner; mockup docs/mockups/floor-challan-print/).
//
// Click 📎 → the challan loads out of sight in a hidden same-origin iframe
// (app/challan-print/[orderId]) → Chrome's own print box opens on top of Floor
// → Print or Cancel → back on Floor, nothing reloaded, selection kept.
//
// ONE engine for the whole screen. floor-page.tsx mounts <ChallanPrintProvider>
// once, above every FloorTable (a trip draws one table per stop, and live sync
// re-renders them), so "which 📎 is spinning" and "one print at a time" survive
// any table re-render.
//
// 🔴 WHEN IT PRINTS. Only after ALL of: the iframe's `load` (the page is
// server-rendered, so data and the logo <img> are in by then) → the ready
// marker `[data-challan-ready] #challan-print-area` is present (a refused page
// renders none — see the page's header) → document.fonts.ready → every <img>
// decoded. Printing earlier gives a blank logo or an empty table.
//
// 🔴 THE IFRAME IS OFF-SCREEN AT A4 SIZE, never 0×0 and never display:none —
// a zero-size or undisplayed frame can skip image decoding, and the document's
// `min-height: 100vh` would resolve against a zero viewport.
//
// Chrome's window.print() blocks until the box closes; `afterprint` cleans up,
// with a short fallback after print() returns. The top tab's title is set to
// the challan number while the box is open, so "Save as PDF" offers it as the
// file name whichever document Chrome takes the name from.

import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";

export interface ChallanPrintApi {
  /** The order whose challan is loading for print, or null. Drives the spinner. */
  printingOrderId: number | null;
  /** Start a print. Ignored while another one is loading (one at a time). */
  print: (orderId: number, challanNumber: string) => void;
}

const ChallanPrintContext = createContext<ChallanPrintApi | null>(null);

/** A FloorTable outside the provider gets null — its DC cells draw no 📎 action. */
export function useChallanPrint(): ChallanPrintApi | null {
  return useContext(ChallanPrintContext);
}

// A4 at 96 dpi. Off-screen, real size.
const FRAME_STYLE =
  "position:fixed;left:-10000px;top:0;width:794px;height:1123px;border:0;";
type FailReason = "no-frame-document" | "no-ready-marker" | "image-decode" | "print-threw" | "timeout";

// No print box within this long → give up with the message.
const LOAD_TIMEOUT_MS = 20_000;

function useChallanPrintEngine(): ChallanPrintApi {
  const [printingOrderId, setPrintingOrderId] = useState<number | null>(null);
  // The synchronous guard: state lags a fast double-click, a ref does not.
  const busyRef = useRef(false);
  // The current job's teardown, so an unmount mid-print leaves no iframe behind.
  const teardownRef = useRef<(() => void) | null>(null);

  useEffect(() => () => teardownRef.current?.(), []);

  const print = useCallback((orderId: number, challanNumber: string) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setPrintingOrderId(orderId);

    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.style.cssText = FRAME_STYLE;

    const prevTitle = document.title;
    let done = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const teardown = () => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      document.title = prevTitle;
      frame.remove();
      teardownRef.current = null;
      busyRef.current = false;
      setPrintingOrderId(null);
    };
    // Every failure names itself in the Console, so the next one needs no
    // diagnosis: [dc-print] <reason> <orderId>. The toast stays generic.
    const fail = (reason: FailReason) => {
      if (done) return;
      console.warn("[dc-print]", reason, orderId);
      teardown();
      toast.error(`Couldn't load challan ${challanNumber} — try again`);
    };
    teardownRef.current = teardown;

    frame.addEventListener("load", () => {
      void (async () => {
        try {
          const win = frame.contentWindow;
          const doc = frame.contentDocument;
          // null doc = the frame was refused (X-Frame-Options / CSP) or left the origin.
          if (!win || !doc) return fail("no-frame-document");
          // Missing = refused, voided, not found, or a /login bounce.
          if (!doc.querySelector("[data-challan-ready] #challan-print-area")) return fail("no-ready-marker");
          await doc.fonts.ready;
          // A logo that will not decode fails the job — never print without it.
          try {
            await Promise.all(Array.from(doc.images).map((img) => img.decode()));
          } catch {
            return fail("image-decode");
          }
          if (done) return; // torn down while waiting (unmount / timeout)
          if (timer) clearTimeout(timer);
          win.addEventListener("afterprint", teardown, { once: true });
          document.title = challanNumber;
          win.focus();
          try {
            win.print();
          } catch {
            return fail("print-threw");
          }
          // print() has returned, so the box is closed. Fallback for a missed
          // afterprint; teardown is idempotent.
          setTimeout(teardown, 500);
        } catch {
          // Anything else on the way (e.g. fonts.ready rejecting) — still named.
          fail("no-frame-document");
        }
      })();
    });

    timer = setTimeout(() => fail("timeout"), LOAD_TIMEOUT_MS);
    frame.src = `/challan-print/${orderId}`;
    document.body.appendChild(frame);
  }, []);

  return useMemo(() => ({ printingOrderId, print }), [printingOrderId, print]);
}

/** Mount ONCE, above every FloorTable (floor-page.tsx). */
export function ChallanPrintProvider({ children }: { children: ReactNode }) {
  const api = useChallanPrintEngine();
  return createElement(ChallanPrintContext.Provider, { value: api }, children);
}
