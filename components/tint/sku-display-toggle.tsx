"use client";

import { useSkuDisplayMode } from "@/lib/hooks/use-sku-display-mode";

export function SkuDisplayToggle() {
  const { mode, setMode } = useSkuDisplayMode();

  return (
    <div
      className="flex border border-gray-300 rounded-[5px] overflow-hidden"
      title="SKU code display (Fini / Generic)"
    >
      <button
        type="button"
        onClick={() => setMode("fini")}
        className={`text-[10px] px-2.5 py-[3px] font-medium transition-colors ${
          mode === "fini"
            ? "bg-gray-800 text-white"
            : "bg-white text-gray-500 hover:bg-gray-50"
        }`}
      >
        Fini
      </button>
      <button
        type="button"
        onClick={() => setMode("generic")}
        className={`text-[10px] px-2.5 py-[3px] font-medium transition-colors ${
          mode === "generic"
            ? "bg-gray-800 text-white"
            : "bg-white text-gray-500 hover:bg-gray-50"
        }`}
      >
        Generic
      </button>
    </div>
  );
}
