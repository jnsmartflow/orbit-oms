"use client";

// Freight Trips — the TOP BAR: Billing's header search, top RIGHT (owner,
// 2026-10-03). The title lives at the top of the rail; the bar's left is empty.
//
// 🔴 NOT <UniversalHeader /> — a NAMED EXCEPTION to CORE §3 / CLAUDE_UI §6, like
// /floor (21aca46e). The SEARCH BOX, though, is Billing's exactly: its markup and
// classes are COPIED from components/universal-header.tsx (`wideBoxClass` and the
// wide `searchField`, the box /mail-orders draws with searchLayout="wide-right")
// — copied because the header builds it inline and exports no standalone box.
// The 52px row is the header's Row 1. Shared header file untouched.
//
// Behaviour stays freight's: runs on ENTER (a paste never makes the cards jump),
// ✕ clears when there is text, "{n} matches" sits left of the box, and "/"
// focuses it — scoped: not while typing in a field or with a drawer / modal up.

import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";

/** Billing's search box, verbatim from universal-header.tsx (`wideBoxClass`). */
const BOX =
  "flex items-center gap-2 w-[240px] max-w-full min-w-0 h-[36px] rounded-[10px] bg-[#f7f7f5] border border-gray-200 px-3 transition-colors hover:border-gray-300 focus-within:bg-white focus-within:border-brand-600 focus-within:ring-2 focus-within:ring-brand-600/15";

export function SearchBar({
  committed,
  matches,
  onSearch,
  onClear,
}: {
  /** The search in effect ("" = none). */
  committed: string;
  /** Matching held bills while a search is in effect, else null. */
  matches: number | null;
  onSearch: (raw: string) => void;
  onClear: () => void;
}) {
  const [value, setValue] = useState(committed);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => setValue(committed), [committed]);
  const active = committed.trim().length > 0;

  // "/" focuses the box — Billing's shortcut, scoped: ignored while typing in a
  // field, and while a freight drawer / modal (data-freight-overlay) is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      if (document.querySelector("[data-freight-overlay]")) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-[52px] min-h-[52px] shrink-0 items-center justify-end gap-3 border-b border-gray-200 bg-white px-4">
      {active && matches !== null && (
        <span className="whitespace-nowrap text-[12px] tabular-nums text-ink-400">
          {matches} match{matches === 1 ? "" : "es"}
        </span>
      )}
      {!active && value.trim() !== "" && (
        <span className="whitespace-nowrap text-[11.5px] text-ink-400">Press Enter to search</span>
      )}
      <div className={BOX}>
        <Search size={15} className="flex-shrink-0 text-gray-400" />
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onSearch(value); // commit on Enter only
            }
          }}
          placeholder="Search name, OBD or invoice…"
          aria-label="Search held bills by name, OBD or invoice"
          className="flex-1 border-0 bg-transparent text-[13px] text-gray-900 outline-none placeholder:text-gray-400"
        />
        {value || committed ? (
          <button
            type="button"
            onClick={() => {
              setValue("");
              onClear();
              inputRef.current?.focus();
            }}
            className="flex-shrink-0 text-[12px] text-gray-400 hover:text-gray-700"
            aria-label="Clear search"
          >
            ✕
          </button>
        ) : (
          !focused && (
            // Billing's "/" hint chip — same show/hide rule (not focused, empty).
            <span className="flex-shrink-0 rounded-[5px] border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[11px] text-gray-500">
              /
            </span>
          )
        )}
      </div>
    </div>
  );
}
