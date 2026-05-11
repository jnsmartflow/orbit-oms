"use client";

import SpeedDialTile, { type SpeedDialTileType } from "./speed-dial-tile";

// Generic visual contract — both the top-level dial (9 QuickTiles) and the
// WOODCARE section landing's mini-dial (7 family tiles) flatten to this
// shape. The parent's click handler is responsible for mapping `tile.label`
// back to whatever discriminator data it needs (QuickTile, family entry).
export interface SpeedDialItem {
  position:     number;
  label:        string;
  parentLabel:  string | null;
  type:         SpeedDialTileType;
}

export interface SpeedDialGridProps {
  tiles:           SpeedDialItem[];
  activeTileId:    string | null;            // null when no tile selected
  cartItemLabels:  Set<string>;              // labels of tiles with cart lines
  onTileClick:     (tile: SpeedDialItem) => void;
  headerLabel?:    string;
  headerSubtitle?: string;
  columns?:        number;                   // 7 (woodcare mini-dial) or 9 (default)
  // v5: when an active sub-product is open, collapse to a 40px-tall pill
  // strip to recover vertical space for the variant grid. Full 9-tile grid
  // renders when compact = false (idle state).
  compact?:        boolean;
}

const COLS_CLASS_MAP: Record<number, string> = {
  7: "grid-cols-7",
  9: "grid-cols-9",
};

interface SpeedPillProps {
  position: number;
  label:    string;
  isActive: boolean;
  onClick:  () => void;
}

// Compact pill — used when SpeedDialGrid renders in `compact` mode.
// Spartan by design: digit prefix + label + `▸` active marker. No in-cart
// dot (operators expand back to full tiles to see cart status).
function SpeedPill({ position, label, isActive, onClick }: SpeedPillProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11.5px] transition-all duration-100 ${
        isActive
          ? "bg-teal-50 border border-teal-600 text-teal-700 font-semibold"
          : "bg-white border border-gray-200 text-gray-600 font-medium hover:border-teal-600 hover:text-teal-600"
      }`}
    >
      <span className={`font-mono text-[10px] ${isActive ? "text-teal-600" : "text-gray-400"}`}>
        {position}
      </span>
      {label}
      {isActive && <span className="text-teal-500 text-[10px] ml-0.5">▸</span>}
    </button>
  );
}

export default function SpeedDialGrid({
  tiles,
  activeTileId,
  cartItemLabels,
  onTileClick,
  headerLabel    = "Quick access — press the number on your keyboard",
  headerSubtitle = "",
  columns        = 9,
  compact        = false,
}: SpeedDialGridProps): React.JSX.Element {
  if (compact) {
    return (
      <div className="mb-2 flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] uppercase tracking-wider text-gray-400 font-medium mr-1">
          Quick:
        </span>
        {tiles.map((tile) => (
          <SpeedPill
            key={tile.label}
            position={tile.position}
            label={tile.label}
            isActive={tile.label === activeTileId}
            onClick={() => onTileClick(tile)}
          />
        ))}
      </div>
    );
  }

  const colsClass = COLS_CLASS_MAP[columns] ?? "grid-cols-9";

  return (
    <div className="mb-5">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2 flex items-center justify-between">
        <span>{headerLabel}</span>
        {headerSubtitle && <span className="text-gray-300">{headerSubtitle}</span>}
      </div>
      <div className={`grid ${colsClass} gap-2`}>
        {tiles.map((tile) => (
          <SpeedDialTile
            key={tile.label}
            position={tile.position}
            label={tile.label}
            parentLabel={tile.parentLabel}
            type={tile.type}
            hasCartLines={cartItemLabels.has(tile.label)}
            isActive={tile.label === activeTileId}
            onClick={() => onTileClick(tile)}
          />
        ))}
      </div>
    </div>
  );
}
