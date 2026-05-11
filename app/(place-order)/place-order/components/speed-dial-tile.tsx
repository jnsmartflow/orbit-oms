"use client";

// Single tile in the 9-tile speed dial (and reused in the WOODCARE
// section landing's mini-dial). Visual states match the v4 mockup:
//   default → white bg + gray-200 border
//   hover   → teal-600 border + teal-50 bg + 1px lift  (only when !isActive)
//   active  → teal-600 border + teal-50 bg + teal halo (no lift)
//   in-cart → 6×6 teal dot top-right (independent of active/hover)
//
// Activation is by mouse click (onClick) or by page-level digit press
// (the global keyboard router calls onTileClick directly on the parent
// grid). Tab focus on tiles was removed — digit 1-9 is the canonical
// keyboard entry point.

export type SpeedDialTileType = "sub-product" | "family" | "section";

export interface SpeedDialTileProps {
  position:     number;                  // digit badge 1-9 (or 1-N for section mini-dial)
  label:        string;                  // "GLOSS", "VT GLO", "WOODCARE"
  parentLabel:  string | null;           // "ENAMELS", null for top-level sections
  type:         SpeedDialTileType;
  hasCartLines: boolean;                 // shows the in-cart dot indicator
  isActive:     boolean;                 // teal-600 border + teal-50 bg when active
  onClick:      () => void;
}

function labelFontClass(label: string): string {
  if (label.includes("\n")) return "text-[11px]";
  if (label.includes(" "))  return "text-[11.5px]";
  return "text-[12px]";
}

export default function SpeedDialTile({
  position, label, parentLabel, hasCartLines, isActive, onClick,
}: SpeedDialTileProps): React.JSX.Element {
  const fontClass     = labelFontClass(label);
  const subtitleClass = isActive ? "text-gray-500" : "text-gray-400";

  return (
    <button
      type="button"
      onClick={onClick}
      style={{ height: "78px" }}
      className={`relative rounded-lg p-2 pt-5 flex flex-col items-center justify-center text-center transition-all duration-75 ${
        isActive
          ? "bg-teal-50 border border-teal-600 shadow-[0_0_0_3px_rgba(20,184,166,0.12)]"
          : "bg-white border border-gray-200 hover:bg-teal-50 hover:border-teal-600 hover:-translate-y-px"
      }`}
    >
      <span className="absolute top-[6px] left-[8px] font-mono text-[10px] font-bold text-gray-400">
        {position}
      </span>
      {hasCartLines && (
        <span className="absolute top-[6px] right-[6px] w-[6px] h-[6px] rounded-full bg-teal-600" />
      )}
      <div className={`${fontClass} font-bold text-gray-900 leading-tight whitespace-pre-line`}>
        {label}
      </div>
      {parentLabel && (
        <div className={`text-[9px] mt-0.5 leading-tight ${subtitleClass}`}>
          {parentLabel}
        </div>
      )}
    </button>
  );
}
