"use client";

import { monogramFor } from "@/lib/place-order/monogram";

// Sub-products this order has touched, ordered by lastTouchedAt DESC.
// Click → page sets activeState to that sub-product's grid view.
//
// Returns null when items.length === 0 (no recent activity → page hides
// the section rather than showing an empty box).

export interface RecentlyUsedItem {
  subProduct:    string;
  family:        string;
  cartLineCount: number;
  lastTouchedAt: number;       // ms epoch — derived from CartLine.touchedAt
}

export interface RecentlyUsedProps {
  items:       RecentlyUsedItem[];
  onItemClick: (item: { subProduct: string; family: string }) => void;
}

function relativeTime(then: number): string {
  if (then === 0) return "";
  const diffSec = Math.floor((Date.now() - then) / 1000);
  if (diffSec < 60)   return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60)   return `${diffMin} min ago`;
  const diffHr = Math.floor(diffMin / 60);
  return `${diffHr}h ago`;
}

export default function RecentlyUsed({
  items, onItemClick,
}: RecentlyUsedProps): React.JSX.Element | null {
  if (items.length === 0) return null;

  return (
    <div className="mb-5">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">
        Recently used in this order
      </div>
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        {items.map((item, idx) => {
          const isLast    = idx === items.length - 1;
          const lineLabel = item.cartLineCount === 1 ? "line" : "lines";
          return (
            <button
              key={`${item.family}|||${item.subProduct}`}
              type="button"
              onClick={() =>
                onItemClick({ subProduct: item.subProduct, family: item.family })
              }
              className={`w-full px-4 py-2.5 flex items-center gap-3 text-left transition-colors duration-75 hover:bg-gray-50 ${
                isLast ? "" : "border-b border-gray-100"
              }`}
            >
              <span
                className="w-[28px] h-[28px] rounded-[5px] inline-flex items-center justify-center text-[10px] font-bold text-gray-500 flex-shrink-0"
                style={{ background: "linear-gradient(135deg, #f3f4f6, #e5e7eb)" }}
              >
                {monogramFor(item.subProduct)}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-[12.5px] font-semibold text-gray-900 truncate">
                  {item.subProduct}
                  <span className="text-gray-400 font-normal text-[11px]"> · {item.family}</span>
                </span>
                <span className="block text-[10px] text-gray-500 truncate">
                  {item.cartLineCount} {lineLabel} in cart · click to edit
                </span>
              </span>
              <span className="text-[10px] text-gray-400 flex-shrink-0">
                {relativeTime(item.lastTouchedAt)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
