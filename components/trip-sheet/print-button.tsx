"use client";

// "Print / Save PDF" for the Orbit trip sheet's toolbar. Lives outside
// #orbit-trip-sheet-print-area, so the print isolation hides it.
export function OrbitTripSheetPrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex items-center justify-center gap-1.5 bg-ink-900 hover:bg-ink-700 text-white text-[13px] font-medium h-9 px-4 rounded-lg cursor-pointer"
    >
      Print / Save PDF
    </button>
  );
}
