"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface ShipToSearchResult {
  id: number;
  customerName: string;
  area: string | null;
}

interface ShipToOverrideCellProps {
  orderId: number;
  current: { id: number; customerName: string } | null;
  onSave: (orderId: number, customerId: number | null) => Promise<void>;
}

// Inline ship-to override cell for the Support table. Three states:
// EMPTY (faint "Set ship-to") → EDITING (debounced search + dropdown,
// name-over-area rows) → SET (teal pill, name only, × clears). Mirrors
// customer-search.tsx's mousedown-before-blur trick and the Dispatch
// Slot cell's optimistic "label + spinner" pattern while a save is
// in flight (components/support/support-orders-table.tsx savingSlot).
export function ShipToOverrideCell({ orderId, current, onSave }: ShipToOverrideCellProps) {
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ShipToSearchResult[]>([]);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [savingLabel, setSavingLabel] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current);
    };
  }, []);

  function cancelEditing() {
    setEditing(false);
    setQuery("");
    setResults([]);
    setHighlightedIndex(-1);
  }

  function handleQueryChange(value: string) {
    setQuery(value);
    setHighlightedIndex(-1);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = value.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/support/ship-to-search?q=${encodeURIComponent(q)}`);
        if (!res.ok) throw new Error("Search failed");
        const data = (await res.json()) as ShipToSearchResult[];
        setResults(data);
      } catch {
        toast.error("Ship-to search failed");
        setResults([]);
      }
    }, 250);
  }

  async function handlePick(result: ShipToSearchResult) {
    cancelEditing();
    setSavingLabel(result.customerName);
    try {
      await onSave(orderId, result.id);
    } catch {
      // onSave already toasts on failure (mirrors handleDispatch's own toast)
    } finally {
      setSavingLabel(null);
    }
  }

  async function handleClear(e: React.MouseEvent) {
    e.stopPropagation();
    setSavingLabel("Clearing…");
    try {
      await onSave(orderId, null);
    } catch {
      // onSave already toasts on failure
    } finally {
      setSavingLabel(null);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      cancelEditing();
      return;
    }
    if (results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((i) => (i < results.length - 1 ? i + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((i) => (i > 0 ? i - 1 : results.length - 1));
    } else if (e.key === "Enter") {
      if (highlightedIndex < 0) return;
      const r = results[highlightedIndex];
      if (!r) return;
      e.preventDefault();
      void handlePick(r);
    }
  }

  function handleBlur() {
    // Delay so a result's onMouseDown registers before the dropdown unmounts.
    blurTimeoutRef.current = setTimeout(() => cancelEditing(), 150);
  }

  let content: React.ReactNode;

  if (savingLabel !== null) {
    content = (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-gray-500">
        <span className="truncate max-w-[140px]">{savingLabel}</span>
        <Loader2 size={11} className="animate-spin text-gray-300 flex-shrink-0" />
      </span>
    );
  } else if (editing) {
    content = (
      <>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          placeholder="Customer name…"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className="w-full max-w-[190px] h-[26px] rounded-[6px] border border-teal-500 bg-white px-2 text-[11px] text-gray-900 outline-none focus:ring-2 focus:ring-teal-500/10"
        />
        {results.length > 0 && (
          <div className="absolute left-0 top-[30px] z-40 w-[240px] bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
            {results.map((r, i) => (
              <button
                key={r.id}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); void handlePick(r); }}
                className={cn(
                  "w-full flex items-start gap-2 px-3 py-2 text-left border-b border-gray-50 last:border-b-0",
                  i === highlightedIndex ? "bg-teal-50" : "hover:bg-gray-50",
                )}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-teal-600 shrink-0 mt-[5px]" />
                <span className="flex-1 min-w-0 flex flex-col">
                  <span className="text-[13px] text-gray-900 truncate">{r.customerName}</span>
                  <span className="text-[11px] text-gray-400 truncate mt-0.5">{r.area ?? "—"}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </>
    );
  } else if (current) {
    content = (
      <span className="inline-flex items-center gap-1.5 max-w-full text-[11px] font-medium px-2.5 py-0.5 rounded-full border bg-teal-50 border-teal-200 text-teal-700">
        <span className="w-[5px] h-[5px] rounded-full inline-block bg-teal-600 flex-shrink-0" />
        <span className="truncate">{current.customerName}</span>
        <button
          type="button"
          onClick={handleClear}
          aria-label="Clear ship-to override"
          className="text-teal-400 hover:text-teal-700 text-[13px] leading-none flex-shrink-0"
        >
          ×
        </button>
      </span>
    );
  } else {
    content = (
      <span
        onClick={() => setEditing(true)}
        className="text-[11px] text-gray-300 hover:text-gray-400 cursor-pointer"
      >
        Set ship-to
      </span>
    );
  }

  return (
    <div className="relative" data-popover>
      {content}
    </div>
  );
}
