"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import type { Customer } from "../types";

// Customer search — desktop pill + dropdown.
//
// Two states share the same slot in the topbar:
//   - Unselected:  search-icon input. 4+ chars → dropdown of up to 8 matches.
//                  Mode auto-detects: digits-only → SAP code search, anything
//                  with letters → name search. ↓/↑ to navigate, Enter to
//                  select, Esc to clear the query.
//   - Selected:    teal pill with brand dot + name + mono code + ×. Click ×
//                  to clear (with confirm if cart has items — Phase 7 wires
//                  the cart-aware confirmation; Phase 2 just clears).
//
// Hand-off after select: parent receives onSelect(customer). The customer
// locks; in later phases the parent moves focus to the category grid.

interface CustomerSearchProps {
  customers:           Customer[];
  selected:            Customer | null;
  onSelect:            (customer: Customer) => void;
  onClear:             () => void;
  autoFocusOnMount?:   boolean;
}

export default function CustomerSearch({
  customers,
  selected,
  onSelect,
  onClear,
  autoFocusOnMount = false,
}: CustomerSearchProps): React.JSX.Element {
  const [query,            setQuery]            = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Mount auto-focus — the page wants the customer pill to claim focus first
  // (planning doc §5.2). Guarded by prop so we don't focus when re-rendering
  // after selection.
  useEffect(() => {
    if (autoFocusOnMount && !selected) inputRef.current?.focus();
  }, [autoFocusOnMount, selected]);

  // Auto-detect mode: pure digits → code prefix match, anything else → name
  // substring match. 4+ char gate per planning doc §5.2.
  const suggestions = useMemo<Customer[]>(() => {
    const q = query.trim();
    if (q.length < 4) return [];
    const lower      = q.toLowerCase();
    const digitsOnly = /^\d+$/.test(q);
    if (digitsOnly) {
      return customers.filter((c) => c.code.includes(q)).slice(0, 8);
    }
    return customers.filter((c) => c.name.toLowerCase().includes(lower)).slice(0, 8);
  }, [query, customers]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === "Escape") {
      e.preventDefault();
      setQuery("");
      setHighlightedIndex(-1);
      return;
    }
    if (suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((i) => i < suggestions.length - 1 ? i + 1 : 0);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((i) => i > 0 ? i - 1 : suggestions.length - 1);
    } else if (e.key === "Enter") {
      if (highlightedIndex < 0) return;
      const c = suggestions[highlightedIndex];
      if (!c) return;
      e.preventDefault();
      onSelect(c);
      setQuery("");
      setHighlightedIndex(-1);
      // Hand off keyboard context to the grid by blurring this input.
      // The page-level router only fires its 1-9 / letter shortcuts when
      // no input is focused.
      inputRef.current?.blur();
    }
  }

  // Reset highlight whenever the query changes (new filter pool).
  function handleChange(value: string): void {
    setQuery(value);
    setHighlightedIndex(-1);
  }

  if (selected) {
    // v5 spec — padding-based sizing (no fixed height), per-element colour
    // weights. Pill sits inside the h-[52px] top bar and centers vertically
    // via the parent flex container.
    return (
      <span className="ml-4 inline-flex items-center gap-2 px-2.5 py-1 rounded-md bg-teal-50 border border-teal-200 max-w-full min-w-0">
        <span className="w-1.5 h-1.5 rounded-full bg-teal-600 flex-shrink-0" />
        <span className="text-[12px] font-medium text-teal-800 truncate">{selected.name}</span>
        <span className="font-mono text-[10px] text-teal-600 flex-shrink-0">{selected.code}</span>
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear customer"
          className="ml-1 text-teal-400 hover:text-teal-700 text-[14px] leading-none"
        >
          ×
        </button>
      </span>
    );
  }

  return (
    <div className="ml-6 relative w-[280px]">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
        <Search className="w-4 h-4" />
      </span>
      <input
        ref={inputRef}
        type="text"
        data-place-order-input="customer"
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Customer name or code… (4+ chars)"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        className="w-full h-[34px] rounded-[8px] border border-gray-200 bg-white pl-9 pr-3 text-[13px] text-gray-900 placeholder:text-gray-400 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10"
      />
      {suggestions.length > 0 && (
        <div className="absolute left-0 right-0 top-[40px] z-40 bg-white border border-gray-200 rounded-[8px] shadow-lg overflow-hidden">
          {suggestions.map((c, i) => {
            const isHighlighted = i === highlightedIndex;
            return (
              <button
                key={c.code}
                type="button"
                // Use mousedown so the input doesn't blur (and unmount this
                // dropdown) before the click registers.
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelect(c);
                  setQuery("");
                  setHighlightedIndex(-1);
                }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-left border-b border-gray-50 last:border-b-0 ${
                  isHighlighted ? "bg-teal-50" : "hover:bg-gray-50"
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-teal-600 shrink-0" />
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] text-gray-900 truncate">{c.name}</span>
                  <span className="block text-[11px] text-gray-400 font-mono mt-0.5">{c.code}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
