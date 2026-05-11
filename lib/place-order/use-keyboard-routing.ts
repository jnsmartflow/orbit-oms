"use client";

import { useEffect } from "react";
import type { Product } from "@/app/(place-order)/place-order/types";
import type { ActivePanelState } from "@/app/(place-order)/place-order/components/active-product-panel";
import type { QuickTile } from "./quick-tiles-config";

// Page-level keyboard router for /place-order. Single window-level
// keydown listener that routes 1-9 / `/` / `?` / Escape based on DOM
// focus context. Inputs and variant cells own their own keys; the hook
// bails when document.activeElement is one of them.
//
// Digit routing is FLAT — 1-9 always maps to the top-level speed-dial
// tile at that position, regardless of activeState. Operators reported
// confusion when digits switched meaning between contexts (e.g. inside
// PRIMER, "2" was the second sub-product tab instead of SATIN). One key,
// one meaning. Sub-product tab switching is PageUp/PageDown only
// (handled inside variant-cell). Section mini-dial family selection is
// mouse-click only.

export type RouteAction =
  | { action: "tile"; tile: QuickTile }
  | { action: "noop" };

export function routeDigit(
  digit:       number,
  _activeState: ActivePanelState,
  _productsAll: Product[],
  quickTiles:  QuickTile[],
): RouteAction {
  if (digit < 1 || digit > quickTiles.length) {
    return { action: "noop" };
  }
  return { action: "tile", tile: quickTiles[digit - 1] };
}

function isFocusInInputOrCell(): boolean {
  if (typeof document === "undefined") return false;
  const ae = document.activeElement;
  if (!(ae instanceof HTMLElement)) return false;
  const tag = ae.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (ae.isContentEditable) return true;
  if (ae.dataset.placeOrderInput) return true;
  return false;
}

export interface UseKeyboardRoutingOpts {
  activeState:    ActivePanelState;
  onDigit:        (digit: number) => void;     // page owns the dispatch via routeDigit
  onClosePanel:   () => void;
  onFocusSearch:  () => void;                  // "/" from body → focus big search bar (no send shortcut)
  onToggleHelp:   () => void;
  enabled?:       boolean;                      // false = bail (overlay open, etc.)
}

// Single-source digit dispatch — the page builds `onDigit` once (typically
// routeDigit + switch over the result), and both this window-level hook
// AND the BigSearchBar empty-query interceptor route through the same
// callback. Prevents the routing logic from diverging between the two
// entry points.
export function useKeyboardRouting(opts: UseKeyboardRoutingOpts): void {
  const { activeState, onDigit, onClosePanel, onFocusSearch, onToggleHelp, enabled = true } = opts;

  useEffect(() => {
    if (!enabled) return;

    function onKey(e: KeyboardEvent): void {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isFocusInInputOrCell())              return;

      const k = e.key;

      if (/^[1-9]$/.test(k)) {
        e.preventDefault();
        onDigit(parseInt(k, 10));
        return;
      }

      if (k === "/") {
        e.preventDefault();
        onFocusSearch();
        return;
      }

      if (k === "?") {
        e.preventDefault();
        onToggleHelp();
        return;
      }

      if (k === "Escape") {
        if (activeState.kind !== "idle") {
          e.preventDefault();
          onClosePanel();
        }
        return;
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, activeState, onDigit, onClosePanel, onFocusSearch, onToggleHelp]);
}
