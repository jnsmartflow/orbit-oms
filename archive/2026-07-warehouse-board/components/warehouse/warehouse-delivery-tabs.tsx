"use client";

import { cn } from "@/lib/utils";

interface WarehouseDeliveryTabsProps {
  active: string;
  onChange: (type: string) => void;
  counts: Record<string, number>;
}

const TABS = ["Local", "Upcountry", "IGT", "Cross"];

export function WarehouseDeliveryTabs({ active, onChange, counts }: WarehouseDeliveryTabsProps) {
  return (
    <div className="flex items-center gap-4 mb-3 text-[11px]">
      {TABS.map((tab) => {
        const count = counts[tab] ?? 0;
        const isActive = active === tab;
        const isEmpty = count === 0;

        return (
          <button
            key={tab}
            type="button"
            onClick={() => onChange(tab)}
            className={cn(
              "pb-1 transition-colors",
              isActive
                ? "font-semibold text-gray-800 border-b-2 border-gray-800"
                : isEmpty
                  ? "text-gray-300"
                  : "text-gray-400 hover:text-gray-600",
            )}
          >
            {tab}{" "}
            <span className={isActive ? "text-gray-400 font-normal" : ""}>
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
