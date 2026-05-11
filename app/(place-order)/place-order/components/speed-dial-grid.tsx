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
}

const COLS_CLASS_MAP: Record<number, string> = {
  7: "grid-cols-7",
  9: "grid-cols-9",
};

export default function SpeedDialGrid({
  tiles,
  activeTileId,
  cartItemLabels,
  onTileClick,
  headerLabel    = "Quick access — press the number on your keyboard",
  headerSubtitle = "",
  columns        = 9,
}: SpeedDialGridProps): React.JSX.Element {
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
