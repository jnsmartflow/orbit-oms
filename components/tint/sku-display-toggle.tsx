"use client";

import { useSkuDisplayMode } from "@/lib/hooks/use-sku-display-mode";

export function SkuDisplayToggle() {
  const { mode, setMode } = useSkuDisplayMode();

  return (
    <div
      className="flex items-center bg-gray-100 rounded-lg p-[3px] gap-[2px]"
      title="SKU code display (Fini / Generic)"
    >
      <button
        type="button"
        onClick={() => setMode("fini")}
        className={`text-[10px] px-2.5 py-[3px] rounded-md transition-colors ${
          mode === "fini"
            ? "bg-white text-gray-900 font-medium shadow-sm"
            : "text-gray-500"
        }`}
      >
        Fini
      </button>
      <button
        type="button"
        onClick={() => setMode("generic")}
        className={`text-[10px] px-2.5 py-[3px] rounded-md transition-colors ${
          mode === "generic"
            ? "bg-white text-gray-900 font-medium shadow-sm"
            : "text-gray-500"
        }`}
      >
        Generic
      </button>
    </div>
  );
}
