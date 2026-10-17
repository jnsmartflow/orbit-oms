"use client";

import { useEffect, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { CiSheet } from "./sheet";
import type { CiBillLine } from "@/lib/ci/types";
import { cleanWholeCount } from "@/lib/paste-clean";

// The quantity sheet — frame 5 of docs/mockups/ci/supervisor.html.
//
// HE TYPES TINS AND NOTHING ELSE (spec §6). Litres are calculated from SAP's
// volumeLine ÷ unitQty and shown back to him read-only, so the number on the
// return is never one a phone invented.
//
// ⚠ THE SCRIM, PANEL, Z-VALUES, RADIUS AND GRAB HANDLE ALL COME FROM ./sheet.tsx
// — no hand-rolled z-index here. That file records why the z-numbers are what
// they are and why CI's bottom offset is 0 where Picking's is
// MOBILE_NAV_CLEARANCE.
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
  // 🔴 THE BOX HOLDS TEXT, NOT A NUMBER (2026-10-17). It was `type="number"`,
  // which turned a pasted "1,234.00" into "" and so into a silent 0, truncated
  // "12.50" to 12, and clamped anything above the delivered quantity without a
  // word. Now the text is cleaned by cleanWholeCount (lib/paste-clean.ts) and a
  // bad value is SHOWN, never quietly turned into a different number.
  const [text, setText] = useState<string>(String(initialQty ?? line.deliveryQty));

  // Re-seed when the sheet is reused for a different line. Without this, tapping
  // a second line would show the first line's number.
  useEffect(() => {
    setText(String(initialQty ?? line.deliveryQty));
  }, [line.rawLineItemId, initialQty, line.deliveryQty]);

  const parsed = cleanWholeCount(text);
  // 🔴 ABOVE DELIVERED IS REFUSED VISIBLY, NOT CLAMPED — and re-checked on the
  // server: app/api/ci/[ciId]/lines/route.ts is what actually refuses a
  // quantity above what was delivered. A screen rule alone is not a rule.
  const error = !parsed.ok
    ? parsed.reason
    : parsed.value > line.deliveryQty
      ? `Only ${line.deliveryQty} were sent`
      : null;
  const qty = parsed.ok && error === null ? parsed.value : null;

  // The steppers still clamp — they move one tin at a time from a valid number,
  // so they can never land outside 0..delivered. From a bad value they start at 0.
  const clamp = (n: number): number => Math.max(0, Math.min(line.deliveryQty, n));
  const base = parsed.ok ? clamp(parsed.value) : 0;

  // Litres, read-only, derived from the SAP figure the server snapshotted.
  // Null litresPerTin (unitQty null or 0 — never seen live) renders blank, and
  // ZERO renders "0 L": 346 active lines are brushes and rollers with a real
  // volume of zero, and blanking those would claim "unknown" about a known
  // thing. Same rule lib/ci/derive.ts states. An invalid box also renders blank.
  const litres = line.litresPerTin === null || qty === null ? null : line.litresPerTin * qty;

  return (
    <CiSheet label={`Returned quantity for ${line.skuCode}`} onDismiss={onCancel}>
      <div className="px-4">
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
            onClick={() => setText(String(clamp(base - 1)))}
            aria-label="One fewer"
            disabled={parsed.ok && base <= 0}
            className="w-12 h-12 rounded-full border border-gray-200 flex items-center justify-center text-gray-700 disabled:text-gray-300 disabled:border-gray-100 active:bg-gray-50"
          >
            <Minus size={20} />
          </button>
          <input
            type="text"
            inputMode="numeric"
            value={text}
            onChange={(e) => setText(e.target.value)}
            // Show the cleaned figure back once he leaves the box, so a pasted
            // "1,2 " reads as "12" — only when it IS a valid count.
            onBlur={() => {
              if (parsed.ok) setText(String(parsed.value));
            }}
            aria-label="Tins returned"
            aria-invalid={error !== null}
            className={
              "w-24 text-center text-[34px] font-extrabold tabular-nums text-gray-900 border-b-2 outline-none " +
              (error !== null ? "border-red-400" : "border-gray-200 focus:border-brand-600")
            }
          />
          <button
            type="button"
            onClick={() => setText(String(clamp(base + 1)))}
            aria-label="One more"
            disabled={parsed.ok && base >= line.deliveryQty}
            className="w-12 h-12 rounded-full border border-gray-200 flex items-center justify-center text-gray-700 disabled:text-gray-300 disabled:border-gray-100 active:bg-gray-50"
          >
            <Plus size={20} />
          </button>
        </div>

        {/* The reason, under the box. The line is always there (min-h) so the
            sheet does not jump when a message appears or clears. */}
        <div className="min-h-[18px] mt-1.5 text-center text-[12.5px] font-semibold text-red-600" role="alert">
          {error}
        </div>

        <div className="flex items-center justify-between mt-2.5 px-1">
          <span className="text-[12.5px] text-gray-500">Litres</span>
          <span className="text-[13.5px] font-semibold tabular-nums text-gray-700">
            {litres === null ? "—" : `${Math.round(litres * 1000) / 1000} L`}
          </span>
        </div>

        {/* "All 8" — the shortcut for the commonest answer. */}
        <button
          type="button"
          onClick={() => setText(String(line.deliveryQty))}
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
          {/* 🔴 Save is OFF while the box is invalid — a bad paste must never
              reach onSave, where 0 means "clear this line". UI §10: disabled is
              grey, never a faded brand button. */}
          <button
            type="button"
            onClick={() => {
              if (qty !== null) onSave(qty);
            }}
            disabled={qty === null}
            className={
              "flex-1 h-12 rounded-full text-[14.5px] font-bold " +
              (qty !== null
                ? "bg-brand-600 active:bg-brand-700 text-white shadow-[0_8px_22px_rgba(124,58,237,0.42)]"
                : "bg-gray-100 border border-gray-200 text-gray-400 cursor-not-allowed")
            }
          >
            Save
          </button>
        </div>
      </div>
    </CiSheet>
  );
}
