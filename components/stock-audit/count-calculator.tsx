"use client";

// components/stock-audit/count-calculator.tsx — the one-box qty entry, for a
// NEW line and for an EDIT. (The file keeps its old name; there is no
// calculator any more.)
//
// v27.79 (Smart Flow, 2026-11-03): pick SKU → type ONE number, "Qty (pcs)" →
// Submit. No Pieces/Cartons, no stack/depth/rows/pcs-per-carton/loose — the
// counter does the maths off the app. Qty is ALWAYS pieces. An edit changes
// the qty only (the SKU is the line's own).
//
// 🔴 THE RULE IS lib/stock-audit/calc.ts validateQty — the SAME one the
// server runs on the body. Submit is enabled only for a qty it accepts.
//
// ⚠ THE FOOTER FOLLOWS keyboardOpen, NEVER FOCUS (CLAUDE_UI §55). With the
// keyboard down, Submit/Cancel sit in a fixed footer in the thumb zone (the
// shell hides the tab bar while this is open — hideBar). With the keyboard UP
// the footer is not drawn and the same two buttons render inline under the
// box instead, so Submit is reachable without dismissing the keyboard. Never
// both at once.

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useKeyboardOpen } from "@/lib/hooks/use-keyboard-open";
import { validateQty } from "@/lib/stock-audit/calc";

/** The SKU being counted. */
export interface CalcSku {
  material: string;
  description: string | null;
  pack: string | null;
  inCatalog: boolean;
}

interface Props {
  sku: CalcSku;
  /** "" for a new line; the saved qty as a string for an edit. */
  initialQty: string;
  submitLabel: "Submit" | "Update";
  busy: boolean;
  /** A save error to show above the buttons (network, closed …). */
  error: string | null;
  onSubmit: (qty: string) => void;
  onCancel: () => void;
}

export function CountCalculator({ sku, initialQty, submitLabel, busy, error, onSubmit, onCancel }: Props): React.JSX.Element {
  const [qty, setQty] = useState(initialQty);
  const [touched, setTouched] = useState(false);
  const keyboardOpen = useKeyboardOpen();
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Focus the box on open (autoFocus alone is unreliable after a tap on iOS).
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, []);

  const result = validateQty(qty);
  const shownError = touched && !result.ok ? result.message : "";

  function submit(): void {
    setTouched(true);
    if (!result.ok || busy) return;
    onSubmit(qty);
  }

  const actions = (
    <div className="flex flex-col gap-2.5">
      {error && (
        <p role="alert" className="rounded-[10px] bg-danger-bg px-3 py-2.5 text-[14px] text-danger-text">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={submit}
        disabled={!result.ok || busy}
        className="h-[52px] w-full rounded-[12px] bg-brand-600 text-[16px] font-semibold text-white active:bg-brand-700 disabled:bg-ink-100 disabled:text-ink-400"
      >
        {busy ? "Saving…" : submitLabel}
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        className="h-[48px] w-full rounded-[12px] text-[15px] font-semibold text-brand-700 active:bg-ink-50"
      >
        Cancel
      </button>
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6 pt-4">
        <div className="font-mono text-[17px] font-bold text-ink-900">{sku.material}</div>
        <div className="mb-5 text-[13px] text-ink-500">
          {sku.inCatalog ? `${sku.description ?? ""}${sku.pack ? ` · ${sku.pack}` : ""}` : "Not in catalog"}
        </div>

        <label htmlFor="sc-qty" className="mb-2 block text-[13px] text-ink-500">
          Qty (pcs)
        </label>
        <input
          id="sc-qty"
          ref={inputRef}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          autoFocus
          enterKeyHint="done"
          value={qty}
          onChange={(e) => {
            setTouched(true);
            setQty(e.target.value.replace(/[^0-9]/g, "").slice(0, 10));
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          className={cn(
            // 32px: well above the 16px iOS zoom threshold.
            "h-16 w-full rounded-[10px] border bg-white text-center text-[32px] font-semibold tabular-nums text-ink-900 outline-none",
            "focus:border-brand-600 focus:ring-2 focus:ring-brand-100",
            shownError ? "border-danger" : "border-ink-100",
          )}
        />

        <div className="mt-1.5 min-h-[18px] text-[13px] text-danger-text" aria-live="polite">
          {shownError}
        </div>

        {keyboardOpen && <div className="mt-2">{actions}</div>}
      </div>

      {!keyboardOpen && (
        <div
          className="flex-none border-t border-ink-100 bg-white px-4 pt-3"
          style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 12px)" }}
        >
          {actions}
        </div>
      )}
    </div>
  );
}
