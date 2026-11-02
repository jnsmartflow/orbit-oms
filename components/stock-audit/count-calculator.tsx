"use client";

// components/stock-audit/count-calculator.tsx — the Stack × Depth × Rows
// (× Pcs/carton) + Loose calculator, for a NEW line and for an EDIT.
//
// BLANK FACTORS (2026-11-02): a blank Stack / Depth / Rows counts as 1 unless
// all three are blank (then the line is loose only). A blank box shows a grey
// "1" placeholder whenever that rule would make it 1, so the counter sees it
// before Submit. Pcs/carton never defaults. The total shows as soon as any box
// has a value (previewLine). The phone sends the total it SHOWED as
// clientTotal; the server refuses a mismatch (TOTAL_MISMATCH).
//
// 🔴 THE MATHS IS lib/stock-audit/calc.ts — the SAME validateLineInput /
// formatWorking / computeTotal the server runs. The live total shown above
// Submit is never computed any other way, and the server recomputes it anyway.
//
// Layout follows docs/mockups/stock-audit/stock-audit-mobile.html (counter()):
// code + description · pack, Pieces | Cartons, Stack × Depth × Rows on one
// line, [× Pcs / carton] + Loose pcs on the next, the working + big total,
// then Submit (or Update) and Cancel.
//
// ⚠ THE FOOTER FOLLOWS keyboardOpen, NEVER FOCUS (CLAUDE_UI §55). With the
// keyboard down, Submit/Cancel sit in a fixed footer in the thumb zone (the
// shell hides the tab bar while this is open — hideBar). With the keyboard UP
// the footer is not drawn and the same two buttons render inline under the
// total instead, so Submit is reachable without dismissing the keyboard. Never
// both at once.

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useKeyboardOpen } from "@/lib/hooks/use-keyboard-open";
import { previewLine, validateLineInput, type LineField } from "@/lib/stock-audit/calc";
import { COUNT_MODE, type CountMode } from "@/lib/stock-audit/status";
import { fmtPcs } from "./count-api";

/** The SKU the calculator is counting. */
export interface CalcSku {
  material: string;
  description: string | null;
  pack: string | null;
  inCatalog: boolean;
  /** Catalog carton size (> 0) or null. */
  piecesPerCarton: number | null;
}

export interface CalcValues {
  mode: CountMode;
  stack: string;
  rows: string;
  depth: string;
  pcsPerCarton: string;
  loose: string;
}

type NumField = "stack" | "rows" | "depth" | "pcsPerCarton" | "loose";

interface Props {
  sku: CalcSku;
  initial: CalcValues;
  submitLabel: "Submit" | "Update";
  busy: boolean;
  /** A save error to show above the buttons (network, closed …). */
  error: string | null;
  /** total = the number shown to the counter (sent as clientTotal). */
  onSubmit: (values: CalcValues, total: number) => void;
  onCancel: () => void;
}

function NumBox({
  id,
  label,
  value,
  placeholder,
  error,
  inputRef,
  onChange,
  onEnter,
  last,
}: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  error: boolean;
  inputRef: (el: HTMLInputElement | null) => void;
  onChange: (v: string) => void;
  onEnter: () => void;
  last: boolean;
}): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <label htmlFor={id} className="text-center text-[12px] text-ink-500">
        {label}
      </label>
      <input
        id={id}
        ref={inputRef}
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        enterKeyHint={last ? "done" : "next"}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, "").slice(0, 10))}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onEnter();
          }
        }}
        className={cn(
          // 24px: well above the 16px iOS zoom threshold.
          "h-14 w-full rounded-[10px] border bg-white text-center text-[24px] tabular-nums text-ink-900 outline-none placeholder:text-ink-400",
          "focus:border-brand-600 focus:ring-2 focus:ring-brand-100",
          error ? "border-danger" : "border-ink-100",
        )}
      />
    </div>
  );
}

function Op({ children }: { children: string }): React.JSX.Element {
  return <span className="flex-none pt-7 text-[20px] text-ink-400" aria-hidden="true">{children}</span>;
}

export function CountCalculator({ sku, initial, submitLabel, busy, error, onSubmit, onCancel }: Props): React.JSX.Element {
  const [v, setV] = useState<CalcValues>(initial);
  const [touched, setTouched] = useState(false);
  const keyboardOpen = useKeyboardOpen();
  const refs = useRef<Partial<Record<NumField, HTMLInputElement | null>>>({});

  // Focus the first box on open (the mockup's pick → focus Stack).
  useEffect(() => {
    const t = setTimeout(() => refs.current.stack?.focus(), 50);
    return () => clearTimeout(t);
  }, []);

  const isCartons = v.mode === COUNT_MODE.cartons;
  const order: NumField[] = isCartons
    ? ["stack", "depth", "rows", "pcsPerCarton", "loose"]
    : ["stack", "depth", "rows", "loose"];

  const result = useMemo(
    () =>
      validateLineInput({
        mode: v.mode,
        stack: v.stack,
        rows: v.rows,
        depth: v.depth,
        // Pieces mode never sends a carton size — the CHECK refuses one.
        pcsPerCarton: isCartons ? v.pcsPerCarton : null,
        loose: v.loose,
      }),
    [v, isCartons],
  );

  // The live working + total show even while invalid, with the SAME blank rule
  // the server applies (calc.ts previewLine).
  const preview = previewLine({
    mode: v.mode,
    stack: v.stack,
    depth: v.depth,
    rows: v.rows,
    pcsPerCarton: isCartons ? v.pcsPerCarton : null,
    loose: v.loose,
  });
  const working = preview.total === null ? "—" : preview.working;
  const total = result.ok ? result.totalPcs : preview.total;
  // A blank factor shows a grey "1" while another factor has a value — that is
  // exactly when it will be saved as 1.
  const anyFactor = v.stack !== "" || v.depth !== "" || v.rows !== "";
  const factorPlaceholder = anyFactor ? "1" : "";

  const fieldErrors = new Map<LineField, string>();
  if (!result.ok && touched) for (const e of result.errors) if (!fieldErrors.has(e.field)) fieldErrors.set(e.field, e.message);

  function set(field: NumField, value: string): void {
    setTouched(true);
    setV((prev) => ({ ...prev, [field]: value }));
  }

  function switchMode(mode: CountMode): void {
    setV((prev) => ({
      ...prev,
      mode,
      // Pre-fill the carton size from the catalog when switching to Cartons with none typed.
      pcsPerCarton:
        mode === COUNT_MODE.cartons && prev.pcsPerCarton === "" && sku.piecesPerCarton !== null
          ? String(sku.piecesPerCarton)
          : prev.pcsPerCarton,
    }));
  }

  function submit(): void {
    setTouched(true);
    if (!result.ok || busy) return;
    onSubmit({ ...v, pcsPerCarton: isCartons ? v.pcsPerCarton : "" }, result.totalPcs);
  }

  function enterFrom(field: NumField): void {
    const i = order.indexOf(field);
    const next = order[i + 1];
    if (next) refs.current[next]?.focus();
    else submit();
  }

  const box = (field: NumField, label: string) => (
    <NumBox
      id={`sc-${field}`}
      label={label}
      value={v[field]}
      placeholder={field === "stack" || field === "depth" || field === "rows" ? factorPlaceholder : ""}
      error={fieldErrors.has(field)}
      inputRef={(el) => {
        refs.current[field] = el;
      }}
      onChange={(val) => set(field, val)}
      onEnter={() => enterFrom(field)}
      last={field === "loose"}
    />
  );

  const shownErrors = Array.from(fieldErrors.values());

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
        <div className="text-[17px] font-bold tabular-nums text-ink-900">{sku.material}</div>
        <div className="mb-4 text-[13px] text-ink-500">
          {sku.inCatalog ? `${sku.description ?? ""}${sku.pack ? ` · ${sku.pack}` : ""}` : "Not in catalog"}
        </div>

        {/* Pieces | Cartons — a SELECTION control (UI §59.9: data-slate, never violet). */}
        <div className="mb-4 flex gap-2" role="group" aria-label="Count in">
          {([COUNT_MODE.pieces, COUNT_MODE.cartons] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => switchMode(m)}
              aria-pressed={v.mode === m}
              className={cn(
                "h-[42px] flex-1 rounded-[10px] border text-[14px]",
                v.mode === m
                  ? "border-data-slate bg-ink-25 font-semibold text-ink-900"
                  : "border-ink-100 bg-white text-ink-500",
              )}
            >
              {m === COUNT_MODE.pieces ? "Pieces" : "Cartons"}
            </button>
          ))}
        </div>

        <div className="flex items-start gap-1.5">
          {box("stack", "Stack")}
          <Op>×</Op>
          {box("depth", "Depth")}
          <Op>×</Op>
          {box("rows", "Rows")}
        </div>
        <div className="mt-2.5 flex items-start gap-1.5">
          {isCartons && (
            <>
              <Op>×</Op>
              {box("pcsPerCarton", "Pcs / carton")}
            </>
          )}
          <Op>+</Op>
          {box("loose", "Loose pcs")}
        </div>

        <div className="mt-4 rounded-[10px] bg-ink-50 px-3 py-3.5 text-center">
          <div className="text-[13px] tabular-nums text-ink-500">{working}</div>
          <div className="text-[36px] font-semibold tabular-nums text-ink-900">{total === null ? "—" : fmtPcs(total)}</div>
          <div className="text-[13px] text-ink-500">pieces</div>
        </div>

        <div className="mt-1.5 min-h-[18px] text-[13px] text-danger-text" aria-live="polite">
          {shownErrors.join(" · ")}
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
