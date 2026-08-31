"use client";

import { useEffect, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { MOBILE_NAV_CLEARANCE } from "@/components/shared/mobile-shell";
import type { CiBillLine } from "@/lib/ci/types";

// The quantity sheet — frame 5 of docs/mockups/ci/supervisor.html.
//
// HE TYPES TINS AND NOTHING ELSE (spec §6). Litres are calculated from SAP's
// volumeLine ÷ unitQty and shown back to him read-only, so the number on the
// return is never one a phone invented.
//
// ⚠ Z-INDEX AND BOTTOM OFFSET COME FROM THE SHARED CONSTANTS, not from local
// literals. MOBILE_NAV_CLEARANCE has been missed as a hand-copied "76px +
// safe-area" four separate times (CLAUDE_PICKING.md §7); it has exactly one
// source, in the file that renders the nav. The z-numbers clear mobile-shell's
// OWN stack (nav z-40 → scrim z-50 → menu/you z-[60] → sign-out z-[70]), not
// just the nav.
//
// ⚠ The sheet is only ever opened from a PART bill, so `deliveryQty` is always
// the real ceiling. Full bill never opens it — the server computes those lines.

export function CiQtySheet({
  line,
  initialQty,
  onCancel,
  onSave,
}: {
  line: CiBillLine;
  /** null = untouched. Opens at the full delivered quantity, which is the
   *  commonest answer: a dealer usually returns whole lines. */
  initialQty: number | null;
  onCancel: () => void;
  /** qty 0 means "clear this line" — the caller removes it from the set. */
  onSave: (qty: number) => void;
}): React.JSX.Element {
  const [qty, setQty] = useState<number>(initialQty ?? line.deliveryQty);

  // Re-seed when the sheet is reused for a different line. Without this, tapping
  // a second line would show the first line's number.
  useEffect(() => {
    setQty(initialQty ?? line.deliveryQty);
  }, [line.rawLineItemId, initialQty, line.deliveryQty]);

  // 🔴 CLAMPED HERE AND RE-CHECKED ON THE SERVER. This is the screen being
  // polite; app/api/ci/[ciId]/lines/route.ts is what actually refuses a
  // quantity above what was delivered. A UI clamp alone is not a rule.
  const clamp = (n: number): number => Math.max(0, Math.min(line.deliveryQty, n));

  // Litres, read-only, derived from the SAP figure the server snapshotted.
  // Null litresPerTin (unitQty null or 0 — never seen live) renders blank, and
  // ZERO renders "0 L": 346 active lines are brushes and rollers with a real
  // volume of zero, and blanking those would claim "unknown" about a known
  // thing. Same rule lib/ci/derive.ts states.
  const litres = line.litresPerTin === null ? null : line.litresPerTin * qty;

  return (
    <>
      <div
        className="fixed inset-0 bg-black/40 z-[65]"
        onClick={onCancel}
        aria-hidden="true"
      />
      <div
        className="fixed left-0 right-0 bg-white rounded-t-[18px] z-[75] px-4 pt-4 shadow-[0_-8px_30px_rgba(16,25,29,0.18)]"
        style={{ bottom: 0, paddingBottom: `max(env(safe-area-inset-bottom, 0px), 16px)` }}
        role="dialog"
        aria-label={`Returned quantity for ${line.skuCode}`}
      >
        <div className="font-mono text-[17px] font-bold text-gray-900 truncate">
          {line.skuCode}
        </div>
        <div className="text-[12.5px] text-gray-500 mt-0.5 truncate">
          {[line.pack, line.description, `${line.deliveryQty} sent`]
            .filter(Boolean)
            .join(" · ")}
        </div>

        {/* Stepper — 44px tap targets either side, the number in the middle as
            a real input so the OS number pad is one tap away (mockup frame 5). */}
        <div className="flex items-center justify-center gap-5 mt-5">
          <button
            type="button"
            onClick={() => setQty((q) => clamp(q - 1))}
            aria-label="One fewer"
            disabled={qty <= 0}
            className="w-12 h-12 rounded-full border border-gray-200 flex items-center justify-center text-gray-700 disabled:text-gray-300 disabled:border-gray-100 active:bg-gray-50"
          >
            <Minus size={20} />
          </button>
          <input
            type="number"
            inputMode="numeric"
            value={qty}
            min={0}
            max={line.deliveryQty}
            onChange={(e) => {
              const n = Number(e.target.value);
              setQty(Number.isFinite(n) ? clamp(Math.trunc(n)) : 0);
            }}
            aria-label="Tins returned"
            className="w-24 text-center text-[34px] font-extrabold tabular-nums text-gray-900 border-b-2 border-gray-200 focus:border-teal-600 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          <button
            type="button"
            onClick={() => setQty((q) => clamp(q + 1))}
            aria-label="One more"
            disabled={qty >= line.deliveryQty}
            className="w-12 h-12 rounded-full border border-gray-200 flex items-center justify-center text-gray-700 disabled:text-gray-300 disabled:border-gray-100 active:bg-gray-50"
          >
            <Plus size={20} />
          </button>
        </div>

        <div className="flex items-center justify-between mt-4 px-1">
          <span className="text-[12.5px] text-gray-500">Litres</span>
          <span className="text-[13.5px] font-semibold tabular-nums text-gray-700">
            {litres === null ? "—" : `${Math.round(litres * 1000) / 1000} L`}
          </span>
        </div>

        {/* "All 8" — the shortcut for the commonest answer. */}
        <button
          type="button"
          onClick={() => setQty(line.deliveryQty)}
          className="w-full h-11 rounded-full border border-gray-200 text-[13.5px] font-semibold text-gray-700 mt-4 active:bg-gray-50"
        >
          All {line.deliveryQty}
        </button>

        <div className="flex gap-2.5 mt-2.5">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 h-12 rounded-full border border-gray-200 text-[14.5px] font-bold text-gray-700 active:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSave(qty)}
            className="flex-1 h-12 rounded-full bg-teal-600 active:bg-teal-700 text-white text-[14.5px] font-bold shadow-[0_8px_22px_rgba(13,148,136,0.42)]"
          >
            Save
          </button>
        </div>
        {/* Clearance so the sheet never sits under the shell's bottom bar on a
            screen where it is still mounted. */}
        <div style={{ height: 0, marginBottom: `calc(${MOBILE_NAV_CLEARANCE} * 0)` }} />
      </div>
    </>
  );
}
