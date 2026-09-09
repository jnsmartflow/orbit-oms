"use client";

export function TripSheetPrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex items-center justify-center gap-1.5 bg-ink-900 hover:bg-ink-700 text-white text-[13px] font-medium h-9 px-4 rounded-lg cursor-pointer"
    >
      🖨 Print / Save PDF
    </button>
  );
}
