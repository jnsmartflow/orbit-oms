"use client";

// The keyboard-shortcuts control — trigger + popover listing the shortcuts.
//
// EXTRACTED VERBATIM from components/universal-header.tsx (2026-08-01), along
// with the `universalShortcuts` derivation and the outside-click effect that
// only ever served it. A MOVE, not a rewrite: same markup, same class strings,
// same two-list render, same title attribute. UniversalHeader renders it in the
// exact spot the inline block occupied, so every existing caller is unchanged.
//
// It exists as its own component for the same reason HeaderFilter and
// HeaderDateStepper do (both extracted 2026-07-31): the Billing tab row hosts
// the SAME control, and two copies of a popover drift.
//
// ── OPEN STATE: controlled OR uncontrolled, and the difference matters ──
// UniversalHeader keeps owning `shortcutsOpen` and passes it in (`open` +
// `onOpenChange`). That is deliberate: the header's Escape handler runs a
// PRIORITY CHAIN — search first, then this sheet, then the filter — and only
// the owner of all three states can order them. If this component installed its
// own Escape listener while the header also had one, pressing Escape with the
// search focused would clear the search AND close this popover, where today it
// clears the search only.
//
// Used WITHOUT `open` (the tab row), it manages its own state and installs its
// own Escape listener — correct there, because no priority chain exists.
//
// This is the same contract header-filter.tsx implements; the two were written
// to match deliberately. Change one, change the other.

import { useCallback, useEffect, useRef, useState } from "react";
import { Keyboard } from "lucide-react";

export interface ShortcutItem {
  key: string;
  label: string;
}

export function HeaderShortcuts({
  shortcuts,
  segmentCount,
  variant = "header",
  open: openProp,
  onOpenChange,
}: {
  /** Caller's extra rows, listed below the universal ones behind a divider. */
  shortcuts?: ShortcutItem[];
  /**
   * How many segments the surface has, if any — drives the "Jump to slot" row.
   * A NUMBER rather than the segments themselves, so this component never has
   * to know what a segment is.
   */
  segmentCount?: number;
  /**
   * TRIGGER styling only; the popover is identical either way.
   * "header" — the filled chip this has always been in Row 1.
   * "row"    — outlined, to sit beside HeaderFilter and HeaderDateStepper in a
   *            control row, where a filled chip reads as the odd one out.
   */
  variant?: "header" | "row";
  /** Omit for self-managed open state. Pass to let a parent own it. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [openLocal, setOpenLocal] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : openLocal;

  const shortcutsRef = useRef<HTMLDivElement>(null);

  const setOpen = useCallback(
    (v: boolean) => {
      if (!controlled) setOpenLocal(v);
      onOpenChange?.(v);
    },
    [controlled, onOpenChange],
  );

  // Close on outside click — moved verbatim from universal-header.tsx:214-223,
  // same dependency (the open flag) and the same mousedown/document pairing.
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (shortcutsRef.current && !shortcutsRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open, setOpen]);

  // Escape — UNCONTROLLED MODE ONLY. See the note at the top of this file: when
  // the header owns the state it also owns the Escape priority chain, and a
  // second listener here would close this popover on an Escape the header meant
  // for the search.
  useEffect(() => {
    if (controlled || !open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [controlled, open, setOpen]);

  // Universal shortcuts — moved verbatim from universal-header.tsx:369-378. The
  // only change is the source of the segment count: `segments && segments.length
  // > 0` became this prop, so the same row appears under the same condition.
  const universalShortcuts: ShortcutItem[] = [
    { key: "/", label: "Focus search" },
    { key: "Esc", label: "Close / clear" },
    ...(segmentCount && segmentCount > 0
      ? [{ key: "1-" + Math.min(segmentCount, 9), label: "Jump to slot" }]
      : []),
    { key: "↑↓", label: "Navigate rows" },
    { key: "↵", label: "Expand" },
  ];

  return (
    <div className="relative" ref={shortcutsRef}>
      <button
        onClick={() => setOpen(!open)}
        className={
          variant === "row"
            ? "border border-gray-200 hover:border-gray-300 rounded-[5px] px-[7px] py-[3px] cursor-pointer transition-colors flex items-center"
            : "bg-gray-50 rounded-[5px] p-[4px_8px] cursor-pointer hover:bg-gray-100 transition-colors"
        }
        title="Keyboard shortcuts (?)"
      >
        <Keyboard size={variant === "row" ? 12 : 13} className="text-gray-400" />
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-2 z-50 bg-white border border-gray-200 rounded-lg shadow-lg p-3 w-[220px] max-h-[calc(100vh-120px)] overflow-y-auto">
          <p className="text-[11px] font-semibold text-gray-900 mb-2">
            Keyboard shortcuts
          </p>
          {universalShortcuts.map((s) => (
            <div key={s.key} className="flex items-center justify-between py-[3px]">
              <span className="text-[11px] text-gray-600">{s.label}</span>
              <span className="text-[11px] font-mono text-gray-500 bg-gray-50 border border-gray-200 rounded px-[6px] py-[1px]">
                {s.key}
              </span>
            </div>
          ))}
          {shortcuts && shortcuts.length > 0 && (
            <>
              <div className="border-t border-gray-100 my-2" />
              {shortcuts.map((s) => (
                <div key={s.key} className="flex items-center justify-between py-[3px]">
                  <span className="text-[11px] text-gray-600">{s.label}</span>
                  <span className="text-[11px] font-mono text-gray-500 bg-gray-50 border border-gray-200 rounded px-[6px] py-[1px]">
                    {s.key}
                  </span>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
