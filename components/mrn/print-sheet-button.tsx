"use client";

import { Printer } from "lucide-react";

/**
 * The print trigger for /mrn/[mrnId]/sheet.
 *
 * The ONLY client component on that route, and deliberately the smallest one
 * possible — the document itself (components/mrn/print-sheet.tsx) is a server
 * component and ships no JS. Same split as the trip sheet, for the same reason.
 *
 * ⚠ It lives OUTSIDE `#mrn-print-area`, which is what makes it disappear from
 * the printout for free: globals.css hides `body *` in print and re-reveals only
 * the print area. It needs no `print:hidden` class and must not be moved inside
 * the document to "sit nicer" on screen.
 *
 * Teal here is fine and is NOT a violation of the sheet's black-and-white rule
 * — that rule governs INK. This button is screen chrome that never prints.
 */
export function PrintSheetButton(): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-teal-600 px-4 text-[13px] font-medium text-white hover:bg-teal-700"
    >
      <Printer size={14} />
      Print / Save PDF
    </button>
  );
}
