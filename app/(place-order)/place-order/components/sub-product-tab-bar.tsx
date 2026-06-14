"use client";

// Horizontal sub-product tab bar — appears above the variant grid when a
// family with multiple sub-products is the active state. Number badge per
// tab (1-N) maps to the page-level keyboard router (Step 3.6); this
// component is click-only and controlled by `activeSubProduct`.

export interface SubProductTab {
  name:         string;
  skuCount:     number;     // SKU count rendered as a small grey number after the name
  hasCartLines: boolean;    // teal in-cart dot indicator
}

export interface SubProductTabBarProps {
  tabs:             SubProductTab[];
  activeSubProduct: string;
  onSelect:         (subProduct: string) => void;
}

export default function SubProductTabBar({
  tabs, activeSubProduct, onSelect,
}: SubProductTabBarProps): React.JSX.Element {
  return (
    <div className="border-b border-gray-200 bg-gray-50/40 px-5">
      <div className="flex items-end gap-1 -mb-px overflow-x-auto">
        {tabs.map((tab, idx) => {
          const isActive = tab.name === activeSubProduct;
          return (
            <button
              key={tab.name}
              type="button"
              onClick={() => onSelect(tab.name)}
              className={`px-3 py-1.5 text-[12px] flex items-center whitespace-nowrap shrink-0 transition-all duration-75 border-b-2 ${
                isActive
                  ? "text-gray-900 font-bold border-gray-900"
                  : "text-gray-500 border-transparent hover:text-gray-900"
              }`}
            >
              <span
                className={`font-mono text-[10px] font-bold mr-1.5 ${
                  isActive ? "text-gray-500" : "text-gray-400"
                }`}
              >
                {idx + 1}
              </span>
              {tab.name}
              <span
                className={`text-[10px] ml-1 ${
                  isActive ? "text-gray-500" : "text-gray-400"
                }`}
              >
                {tab.skuCount}
              </span>
              {tab.hasCartLines && (
                <span className="inline-block w-[5px] h-[5px] rounded-full bg-teal-600 ml-1.5 align-middle" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
