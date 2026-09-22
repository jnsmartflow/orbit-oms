"use client";

// Floor Control — THE SHARED BOTTOM-BAR SHELL (floor-bulk-actions v5, 2026-09-22).
//
// One shell, two bars: the Floor tab's bar (floor-bottom-bar.tsx) and the Hold
// tab's release bar (hold-bar.tsx). Both read the same way — what is ticked on
// the left, what you can do with it on the right — so they are built once:
//
//   {N} selected  [✕ Clear]                        [main CTA] │ [··· More]
//   1,320 L   1,822 kg   21 articles   3 routes
//
// 🔴 IT IS POSITIONED BY ITS PARENT. `absolute inset-x-0 bottom-0` resolves
// against the nearest `relative` ancestor, and that must be the BILLS column —
// never a box that also holds the trip rail (TripDesk gives its bills column
// `relative`; HoldTab's root is `relative` too). Mounted any higher, the bar
// runs under the rail, which is the bug this shell's move fixed.
//
// ⚠ ONE BRAND BUTTON (CLAUDE_UI §10). The caller puts exactly one BAR_PRIMARY in
// `children`; everything else is BAR_SECONDARY. Disabled is grey, never a faded
// brand — both classes carry the grey disabled state.
//
// ⚠ NO KEY LISTENER HERE OR IN MoreMenu. floor-page.tsx is the single Esc owner
// for the floor tree (CLAUDE_FLOOR §4.6); it closes the menu through
// `onOpenChange`. The menu's outside-click is a document MOUSEDOWN listener,
// live only while the menu is open — not a key listener.

import { useEffect, useRef, type ReactNode } from "react";

/** The one brand button on a bar — the state's real job. */
export const BAR_PRIMARY =
  "inline-flex h-[44px] min-w-[112px] items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-brand-600 bg-brand-600 px-[18px] text-[14px] font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-100 disabled:text-gray-400";

/** Everything else on a bar. White, ink border. */
export const BAR_SECONDARY =
  "inline-flex h-[44px] min-w-[112px] items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-ink-200 bg-white px-[18px] text-[14px] font-semibold text-ink-900 hover:border-ink-400 hover:bg-ink-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-100 disabled:text-gray-400";

/** The 1px rule between the main CTA and ··· More. */
export function BarDivider() {
  return <span aria-hidden className="h-9 w-px shrink-0 bg-ink-100" />;
}

/** One number on the figures line: the value bold, the unit quiet. */
export interface BarFigure {
  key: string;
  value: string;
  unit: string;
  title?: string;
}

export function FloorActionBar({
  count,
  figures,
  extra,
  onClear,
  clearDisabled = false,
  children,
}: {
  count: number;
  figures: BarFigure[];
  /** Anything after the figures, e.g. "on L-260921-20". */
  extra?: ReactNode;
  onClear: () => void;
  clearDisabled?: boolean;
  /** The right-hand action area: main CTA, then <BarDivider/> + <MoreMenu/>. */
  children: ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div className="absolute inset-x-0 bottom-0 z-20 flex min-h-[76px] items-center gap-4 border-t border-gray-200 bg-white px-[18px] py-2.5 shadow-[0_-6px_18px_-12px_rgba(0,0,0,0.25)]">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex items-center gap-2.5">
          <span className="whitespace-nowrap text-[18px] font-bold leading-tight text-ink-900">{count} selected</span>
          {/* ⚠ THE GLOBAL CLEAR STAYS (CLAUDE_FLOOR §4.6). toggleAll() is per
              group and selects-all on a partial selection, so no header
              checkbox can clear a selection that spans groups. */}
          <button
            type="button"
            onClick={onClear}
            disabled={clearDisabled}
            className="whitespace-nowrap rounded-md border border-ink-100 bg-ink-50 px-2 py-[3px] text-[12px] font-semibold text-ink-600 hover:bg-ink-100 disabled:cursor-not-allowed disabled:text-gray-400"
          >
            ✕ Clear
          </button>
        </div>
        {(figures.length > 0 || extra) && (
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-0.5 text-[13px] text-ink-500">
            {figures.map((f) => (
              <span key={f.key} title={f.title} className="whitespace-nowrap">
                <span className="text-[15px] font-semibold tabular-nums text-ink-900">{f.value}</span> {f.unit}
              </span>
            ))}
            {extra && <span className="min-w-0 truncate whitespace-nowrap">{extra}</span>}
          </div>
        )}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2.5">{children}</div>
    </div>
  );
}

export interface MoreMenuItem {
  key: string;
  label: string;
  /** One line under the label saying what happens. */
  hint: string;
  icon: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
}

/**
 * "··· More" — a secondary button that opens a menu UPWARD, right-aligned.
 * Controlled: floor-page owns `open` so its single Esc listener can close it.
 * Closes on an item click, on a mousedown outside, and (via the owner) on Esc.
 */
export function MoreMenu({
  open,
  onOpenChange,
  items,
  disabled = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: MoreMenuItem[];
  disabled?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onOpenChange(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, onOpenChange]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => onOpenChange(!open)}
        className={`${BAR_SECONDARY} ${open ? "border-ink-400 bg-ink-50" : ""}`}
      >
        <span aria-hidden className="-mt-1 text-[18px] leading-none tracking-[1px]">···</span>
        More
      </button>
      {open && (
        <div
          role="menu"
          className="absolute bottom-[calc(100%+8px)] right-0 z-30 w-[290px] rounded-xl border border-ink-200 bg-white p-1.5 shadow-lg"
        >
          {items.map((it) => (
            <button
              key={it.key}
              type="button"
              role="menuitem"
              disabled={it.disabled}
              onClick={() => {
                onOpenChange(false);
                it.onSelect();
              }}
              className="flex min-h-[44px] w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
            >
              <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-lg bg-ink-50 text-ink-700">
                {it.icon}
              </span>
              <span className="min-w-0">
                <span className="block text-[14px] font-semibold text-ink-900">{it.label}</span>
                <span className="mt-0.5 block text-[12px] text-ink-500">{it.hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
