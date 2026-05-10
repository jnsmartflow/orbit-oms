"use client";

import { useEffect } from "react";

// Page-level keyboard router for /place-order.
//
// Single document-level keydown listener (planning doc §8.7). It only
// handles the GRID context — i.e. keys that fire when no input is focused.
// Per-input contexts (customer / search / cell) own their own onKeyDown
// handlers because their keys overlap with typing.
//
// Grid context keys handled here (planning doc §8.2):
//   1-9  → open Nth top-9 family in sortedFamilies
//   *    → focus the product search input
//   Esc  → close the open category panel (if any)
//   A-Z  → focus search and seed it with the typed letter
//
// Cross-context key:
//   /    → send-confirm overlay. Active in grid + cell + panel contexts;
//          ignored in customer + search (so users can type / there).
//          Phase 6 wires the actual overlay; for now we just preventDefault.
//
// Inputs that participate in context detection set data-place-order-input
// to "customer" | "search" | "cell" — see customer-search.tsx, product-
// search.tsx, variant-cell.tsx.

export type PlaceOrderInputKind = "customer" | "search" | "cell";

// Anything with a focus() method satisfies the router — works for both an
// HTMLInputElement ref and the ProductSearchHandle exposed via forwardRef.
type FocusableRef = React.RefObject<{ focus(): void } | null>;

interface RouterDeps {
  sortedFamilies:    string[];
  expandedFamily:    string | null;
  confirmOpen:       boolean;       // confirm overlay owns the keyboard while open
  helpOpen:          boolean;       // help overlay owns the keyboard while open
  onOpenCategory:    (family: string) => void;
  onCloseCategory:   () => void;
  onSearchPrefill:   (firstChar: string) => void;
  onConfirmSend:     () => void;
  onShowHelp:        () => void;
  searchInputRef:    FocusableRef;
}

function placeOrderInputKind(el: Element | null): PlaceOrderInputKind | null {
  if (!(el instanceof HTMLElement)) return null;
  const k = el.dataset.placeOrderInput;
  if (k === "customer" || k === "search" || k === "cell") return k;
  return null;
}

function isAnyInputFocused(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
}

export function useKeyboardRouting(deps: RouterDeps): void {
  const {
    sortedFamilies, expandedFamily, confirmOpen, helpOpen,
    onOpenCategory, onCloseCategory,
    onSearchPrefill, onConfirmSend,
    onShowHelp,
    searchInputRef,
  } = deps;

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      // Either overlay open → its own listener handles keys.
      if (confirmOpen || helpOpen) return;

      const ae   = document.activeElement;
      const kind = placeOrderInputKind(ae);

      // / — works everywhere except customer + search inputs.
      if (e.key === "/") {
        if (kind !== "customer" && kind !== "search") {
          e.preventDefault();
          onConfirmSend();
        }
        return;
      }

      // Ignore modified keys (Ctrl, Alt, Meta) — those are reserved for
      // browser shortcuts and Phase 7 overlays.
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // Below here: grid-context keys. Only fire when no input is focused.
      if (isAnyInputFocused(ae)) return;

      // 1-9 → open Nth top-9 category
      if (/^[1-9]$/.test(e.key)) {
        const idx    = parseInt(e.key, 10) - 1;
        const family = sortedFamilies[idx];
        if (family) {
          e.preventDefault();
          onOpenCategory(family);
        }
        return;
      }

      // Esc → close the open panel (if any)
      if (e.key === "Escape" && expandedFamily) {
        e.preventDefault();
        onCloseCategory();
        return;
      }

      // * — context-aware (planning doc §8.4 vs §8.2):
      //   panel open  → close panel
      //   panel closed → focus search input
      if (e.key === "*") {
        e.preventDefault();
        if (expandedFamily) onCloseCategory();
        else                searchInputRef.current?.focus();
        return;
      }

      // ? (Shift+/) → toggle keyboard help overlay
      if (e.key === "?") {
        e.preventDefault();
        onShowHelp();
        return;
      }

      // Multi-bill is mouse-only — clicking the [+ Add] tab in the cart
      // panel adds a bill, clicking a bill tab switches the active bill.
      // Planning doc §8.5 (b cycle / Shift+B add) was deliberately removed
      // because the keys collided with letter-prefilling the search bar
      // ("b" in customer names) and the workflow is rare enough to not
      // earn a keyboard slot.

      // A-Z (single letter, no modifiers) → focus search + seed first char
      if (/^[A-Za-z]$/.test(e.key)) {
        e.preventDefault();
        onSearchPrefill(e.key);
        // Focus after the prefill so the input value is set before focus.
        // requestAnimationFrame avoids the rare race where focus lands
        // before React commits the controlled value.
        requestAnimationFrame(() => searchInputRef.current?.focus());
        return;
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    sortedFamilies, expandedFamily, confirmOpen, helpOpen,
    onOpenCategory, onCloseCategory,
    onSearchPrefill, onConfirmSend,
    onShowHelp,
    searchInputRef,
  ]);
}
