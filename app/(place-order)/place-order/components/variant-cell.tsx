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
  qty:         number;
  isAvailable: boolean;
  rowIdx:      number;
  colIdx:      number;
  onSetQty:    (qty: number) => void;
  onCellNav:   (direction: CellNavDirection, fromRow: number, fromCol: number) => void;
  onClose:     () => void;
}

export interface VariantCellHandle {
  focus(): void;
}

const VariantCell = forwardRef<VariantCellHandle, VariantCellProps>(function VariantCell(
  { qty, isAvailable, rowIdx, colIdx, onSetQty, onCellNav, onClose },
  ref,
) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
  }), []);

  if (!isAvailable) {
    return (
      <div
        className="w-[64px] h-[36px] mx-auto rounded-[7px] flex items-center justify-center text-gray-200 text-[13px] cursor-not-allowed"
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
    if (e.key === "+")          { e.preventDefault(); onSetQty(qty + 1); return; }
    if (e.key === "-")          { e.preventDefault(); onSetQty(Math.max(0, qty - 1)); return; }
    if (e.key === "Escape" || e.key === "*") {
      e.preventDefault();
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
      className={`w-[64px] h-[36px] mx-auto rounded-[7px] text-center text-[14px] font-semibold bg-transparent border-0 outline-none transition-colors
        placeholder:text-[20px] placeholder:text-gray-300 placeholder:font-normal
        focus:bg-white focus:text-gray-900 focus:shadow-[0_0_0_2px_#14b8a6,0_0_0_4px_rgba(20,184,166,0.18)] focus:relative focus:z-[2]
        ${isActive
          ? "bg-teal-50 text-teal-700"
          : "text-transparent caret-gray-400"
        }`}
    />
  );
});

export default VariantCell;
