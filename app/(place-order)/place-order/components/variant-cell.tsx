"use client";

import { forwardRef, useImperativeHandle, useRef } from "react";

// Variant qty cell — Excel-feel single-cell input.
//
// Visual states (planning doc §7.1):
//   - Empty       : faint dot "·" placeholder
//   - Active >0   : soft mint background, bold teal-700 number
//   - Focused     : white bg, 2px teal ring + outer halo
//   - NA          : em-dash, non-interactive
//
// Phase 5 keyboard (planning doc §8.4):
//   ←/→/↑/↓   → onCellNav("left"/"right"/"up"/"down")
//   Enter     → onCellNav("enter") — moves down one row
//   Tab/S+Tab → native (DOM order; NA cells are non-focusable divs)
//   0–9       → typed natively into the input (overwrites since onFocus selects)
//   +         → increment qty by 1
//   -         → decrement qty by 1 (floor 0)
//   Backspace → native (clears input value → onChange → setQty(0))
//   Esc / *   → onClose (close panel, return to grid)
//
// `data-place-order-input="cell"` marks the input for the page-level router.

export type CellNavDirection = "up" | "down" | "left" | "right" | "enter";

interface VariantCellProps {
  qty:              number;
  isAvailable:      boolean;
  rowIdx:           number;
  colIdx:           number;
  onSetQty:         (qty: number) => void;
  onCellNav:        (direction: CellNavDirection, fromRow: number, fromCol: number) => void;
  onClose:          () => void;
  // Optional — only wired in family/section-drilled contexts where a
  // tab bar exists. When undefined, PageDown/PageUp are still
  // intercepted (suppressing browser page-scroll) but no-op.
  onNextSubProduct?: () => void;
  onPrevSubProduct?: () => void;
  // Optional — only wired when the active sub-product is paginated.
  // `[` = prev page, `]` = next page. When undefined (or sub-product
  // not paginated), the keys still preventDefault (suppress literal
  // bracket input) but no-op.
  onPageChange?:     (direction: -1 | 1) => void;
}

export interface VariantCellHandle {
  focus(): void;
}

const VariantCell = forwardRef<VariantCellHandle, VariantCellProps>(function VariantCell(
  { qty, isAvailable, rowIdx, colIdx, onSetQty, onCellNav, onClose, onNextSubProduct, onPrevSubProduct, onPageChange },
  ref,
) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
  }), []);

  if (!isAvailable) {
    return (
      <div
        className="w-[56px] h-[32px] mx-auto rounded-[4px] flex items-center justify-center text-gray-200 text-[13px] cursor-not-allowed"
        aria-label="Not available"
      >
        —
      </div>
    );
  }

  const isActive = qty > 0;

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === "ArrowRight") { e.preventDefault(); onCellNav("right", rowIdx, colIdx); return; }
    if (e.key === "ArrowLeft")  { e.preventDefault(); onCellNav("left",  rowIdx, colIdx); return; }
    if (e.key === "ArrowDown")  { e.preventDefault(); onCellNav("down",  rowIdx, colIdx); return; }
    if (e.key === "ArrowUp")    { e.preventDefault(); onCellNav("up",    rowIdx, colIdx); return; }
    if (e.key === "Enter")      { e.preventDefault(); onCellNav("enter", rowIdx, colIdx); return; }
    // PageDown / PageUp — v4: next/prev sub-product TAB.
    // Shift+PageDown / Shift+PageUp — v5: next/prev pagination PAGE.
    // Order-of-check pattern: guard the unshifted branch with
    // !e.shiftKey so Shift-modified keys fall through to the v5 branch.
    if (e.key === "PageDown" && !e.shiftKey) { e.preventDefault(); onNextSubProduct?.(); return; }
    if (e.key === "PageUp"   && !e.shiftKey) { e.preventDefault(); onPrevSubProduct?.(); return; }
    if (e.key === "PageDown" &&  e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      e.nativeEvent.stopPropagation();
      onPageChange?.(1);
      return;
    }
    if (e.key === "PageUp"   &&  e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      e.nativeEvent.stopPropagation();
      onPageChange?.(-1);
      return;
    }
    if (e.key === "+")          { e.preventDefault(); onSetQty(qty + 1); return; }
    if (e.key === "-")          { e.preventDefault(); onSetQty(Math.max(0, qty - 1)); return; }
    if (e.key === "Escape" || e.key === "*") {
      // The cell legitimately owns Esc while focused. Stop both the
      // React-synthetic and native propagation so the window-level
      // keyboard router doesn't ALSO fire its own Escape branch on the
      // same keydown — without these two stops, the native event keeps
      // bubbling to window, sees focus has just moved to <main> (from
      // onClose), and triggers onClosePanel → re-focuses search bar.
      e.preventDefault();
      e.stopPropagation();
      e.nativeEvent.stopPropagation();
      onClose();
      return;
    }
    // Backspace / Delete / digits / Tab → native input handling.
  }

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      data-place-order-input="cell"
      value={isActive ? String(qty) : ""}
      placeholder="·"
      onChange={(e) => {
        const raw = e.target.value.replace(/\D/g, "");
        const n   = raw === "" ? 0 : parseInt(raw, 10);
        onSetQty(Number.isFinite(n) && n >= 0 ? n : 0);
      }}
      onFocus={(e) => e.target.select()}
      onKeyDown={handleKeyDown}
      className={`w-[56px] h-[32px] mx-auto rounded-[4px] text-center text-[13px] font-semibold border-0 outline-none transition-all duration-75
        placeholder:text-[20px] placeholder:text-gray-300 placeholder:font-normal
        focus:bg-white focus:text-gray-900 focus:relative focus:z-[2] focus:shadow-[inset_0_0_0_2px_#0d9488,0_0_0_4px_rgba(20,184,166,0.18)]
        ${isActive
          ? "bg-teal-50 text-teal-700 hover:bg-teal-100"
          : "bg-[#fafbfc] text-transparent caret-gray-400 hover:bg-[#f3f4f6]"
        }`}
    />
  );
});

export default VariantCell;
