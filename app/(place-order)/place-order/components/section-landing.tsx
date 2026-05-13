"use client";

import type { CartLine, Product } from "../types";
import type { RawPack } from "@/lib/place-order/pack-buckets";
import type { FamilyInSection } from "@/lib/place-order/queries";
import SpeedDialTile from "./speed-dial-tile";
import FamilyNavWithTabs from "./family-nav-with-tabs";
import { monogramFor } from "@/lib/place-order/monogram";

// Section landing — only ever active for tile-type='section' (currently
// only WOODCARE in QUICK_TILES_V1). Two visual states driven by the
// `drilled` prop:
//
//   drilled === null   → state A: section header + mini speed-dial of
//                        the section's families (1-N tiles).
//   drilled !== null   → state B: section header + breadcrumb row +
//                        embedded FamilyNavWithTabs for the drilled
//                        family.
//
// Fully controlled — drillState lives in the page-level ActivePanelState
// union so use-keyboard-routing.ts (3.6) can read + write transitions
// directly without an imperative ref.

export interface SectionLandingProps {
  sectionName:        string;
  families:           FamilyInSection[];
  productsByFamily:   Record<string, Product[]>;
  cartLines:          CartLine[];
  drilled:            null | { familyName: string; activeSubProduct: string };
  qtyAt:              (product: Product, pack: RawPack) => number;
  onSetQty:           (product: Product, pack: RawPack, qty: number) => void;
  speedDialPosition?: number;
  focusHintBase?:     string | null;
  onFocused?:         () => void;
  onEscape:           () => void;
  onClose:            () => void;                                                  // exit panel entirely
  onDrillTo:          (familyName: string, firstSubProduct: string) => void;
  onDrillBack:        () => void;
  onSubProductChange: (subProduct: string) => void;                                // forwarded to embedded FamilyNavWithTabs
}

const COLS_CLASS_MAP: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
  5: "grid-cols-5",
  6: "grid-cols-6",
  7: "grid-cols-7",
  8: "grid-cols-8",
  9: "grid-cols-9",
};

export default function SectionLanding({
  sectionName, families, productsByFamily, cartLines,
  drilled, qtyAt, onSetQty, speedDialPosition,
  focusHintBase, onFocused, onEscape, onClose,
  onDrillTo, onDrillBack, onSubProductChange,
}: SectionLandingProps): React.JSX.Element {
  const headerLine2 = drilled === null
    ? `${families.length} families · pick one to start`
    : `${families.length} families`;

  function handleTileClick(family: string): void {
    const list = productsByFamily[family] ?? [];
    // Phase 3 (2026-05-13): default tab is the first row's uiGroup
    // when present, else its subProduct (unmigrated families).
    const firstSubProduct = list[0]
      ? list[0].uiGroup ?? list[0].subProduct
      : "";
    onDrillTo(family, firstSubProduct);
  }

  // Cap mini-dial at 9 columns so wider sections still render in one row;
  // anything wider would need wrapping logic — defer until we have a >9
  // section in the data.
  const cols      = Math.min(Math.max(families.length, 1), 9);
  const colsClass = COLS_CLASS_MAP[cols] ?? "grid-cols-9";

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-5">
      <div className="px-3 py-1.5 border-b border-gray-100 flex items-center gap-3">
        <span
          className="w-[24px] h-[24px] rounded-[5px] inline-flex items-center justify-center text-[10px] font-bold text-gray-500 flex-shrink-0"
          style={{ background: "linear-gradient(135deg, #f3f4f6, #e5e7eb)" }}
        >
          {monogramFor(sectionName)}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-bold text-gray-900 truncate">{sectionName}</div>
          <div className="text-[10.5px] text-gray-400 truncate">{headerLine2}</div>
        </div>
        {speedDialPosition !== undefined && (
          <div className="text-[10px] text-gray-400 flex items-center gap-1.5 flex-shrink-0">
            <kbd className="font-mono px-1.5 py-0.5 bg-gray-100 rounded text-[9.5px]">
              {speedDialPosition}
            </kbd>
            <span>active</span>
          </div>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="ml-2 text-gray-300 hover:text-gray-500 text-[18px] flex-shrink-0"
        >
          ×
        </button>
      </div>

      {drilled === null ? (
        <div className="px-5 py-4">
          <div className={`grid ${colsClass} gap-2`}>
            {families.map((f, idx) => (
              <SpeedDialTile
                key={f.family}
                position={idx + 1}
                label={f.family}
                parentLabel={null}
                type="family"
                hasCartLines={cartLines.some((l) => l.family === f.family)}
                isActive={false}
                onClick={() => handleTileClick(f.family)}
              />
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="px-5 py-2 border-b border-gray-100 text-[11px] flex items-center gap-1.5">
            <button
              type="button"
              onClick={onDrillBack}
              className="text-gray-500 hover:text-gray-900 flex items-center gap-1 transition-colors duration-75"
            >
              <span>←</span>
              <span>{sectionName}</span>
            </button>
            <span className="text-gray-300">›</span>
            <span className="text-gray-900 font-medium">{drilled.familyName} family</span>
          </div>
          <FamilyNavWithTabs
            familyName={drilled.familyName}
            section={sectionName}
            products={productsByFamily[drilled.familyName] ?? []}
            activeSubProduct={drilled.activeSubProduct}
            onSubProductChange={onSubProductChange}
            qtyAt={qtyAt}
            onSetQty={onSetQty}
            cartLines={cartLines}
            focusHintBase={focusHintBase}
            onFocused={onFocused}
            onEscape={onEscape}
            onClose={() => { /* unused in embedded mode */ }}
            embedded
          />
        </>
      )}
    </div>
  );
}
