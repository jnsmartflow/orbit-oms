"use client";

import { useEffect, useState } from "react";

/**
 * Is the soft keyboard ACTUALLY open?
 *
 * 🔴 MEASURED FROM THE VISUAL VIEWPORT, NEVER FROM INPUT FOCUS. This is the
 * whole point of the hook and the reason CLAUDE_UI.md §55/§59.6 states the rule
 * twice: **Android can dismiss the keyboard without blurring the input** (the
 * down-caret on the keyboard bar). A footer gated on `inputFocused` therefore
 * stays stuck hidden after the keyboard closes, with no way back short of
 * tapping elsewhere — the "stuck Add button" `/po` shipped and then fixed.
 *
 * The mechanism is `/po`'s, extracted (app/po/po-page.tsx keeps its own copy
 * because it is fused with that page's `--vvh` writer, which this hook
 * deliberately does NOT touch — a second writer would fight it):
 *
 *   • the tallest height seen is treated as "no keyboard"
 *   • a drop of more than 120px counts as open — comfortably above iOS
 *     URL-bar-collapse noise, comfortably below any real keyboard
 *   • debounced ~100ms, or the flag flickers on the open/close ramp
 *
 * Height READ only, no offset arithmetic (UI §22).
 *
 * Returns false on any browser without visualViewport and during SSR, which is
 * the safe default: a footer that renders is recoverable, one that hides
 * forever is not.
 */
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const vv = typeof window === "undefined" ? null : window.visualViewport;
    if (!vv) return;

    let fullH = vv.height;
    let debounce: ReturnType<typeof setTimeout> | null = null;

    function measure(): void {
      if (!vv) return;
      const h = vv.height;
      // The tallest height seen IS the no-keyboard height. Rotating the device
      // or collapsing the URL bar raises it; nothing lowers it except a
      // keyboard, which is what makes the comparison below meaningful.
      if (h > fullH) fullH = h;
      const next = fullH - h > 120;
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        setOpen(next);
        debounce = null;
      }, 100);
    }

    // BOTH events: Android fires resize, iOS fires scroll as the page shifts
    // under a keyboard that overlays rather than shrinks.
    vv.addEventListener("resize", measure);
    vv.addEventListener("scroll", measure);
    measure();
    return () => {
      if (debounce) clearTimeout(debounce);
      vv.removeEventListener("resize", measure);
      vv.removeEventListener("scroll", measure);
    };
  }, []);

  return open;
}
