"use client";

// Freight Trips — the TOP BAR: one big search box and nothing else (owner,
// 2026-10-03). The title lives at the top of the rail.
//
// 🔴 NOT <UniversalHeader /> — a NAMED EXCEPTION to CORE §3 / CLAUDE_UI §6, like
// /floor. The header's search caps at 240px (440 expanded), has no ✕ clear, and
// filters on every keystroke; this box is Floor's (components/floor/search-box.tsx,
// copied look, never imported — it types its props from floor-page): wide, runs
// on ENTER so a paste never makes the cards jump mid-way, ✕ clears, and the
// match count sits beside it. No "/" shortcut — Floor's box has none either.

import { useEffect, useState } from "react";
import { Search } from "lucide-react";

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
  useEffect(() => setValue(committed), [committed]);
  const active = committed.trim().length > 0;

  return (
    <div className="flex h-[56px] shrink-0 items-center gap-3 border-b border-gray-200 bg-white px-4">
      <div
        className={`flex h-[38px] w-full max-w-[720px] items-center gap-2 rounded-[9px] border bg-white px-3 text-[13px] ${
          active ? "border-brand-500 shadow-[0_0_0_3px_rgba(124,58,237,0.08)]" : "border-gray-200"
        }`}
      >
        <Search size={15} className="shrink-0 text-gray-400" />
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onSearch(value); // commit on Enter only, as Floor does
            }
          }}
          placeholder="Search name, or paste numbers"
          aria-label="Search held bills by name, OBD or invoice"
          className="min-w-0 flex-1 bg-transparent text-gray-900 outline-none placeholder:text-gray-400"
        />
        {(value || committed) && (
          <button
            type="button"
            onClick={() => {
              setValue("");
              onClear();
            }}
            className="shrink-0 px-1 text-gray-400 hover:text-gray-700"
            aria-label="Clear search"
          >
            ✕
          </button>
        )}
      </div>
      {active && matches !== null && (
        <span className="whitespace-nowrap text-[12.5px] tabular-nums text-ink-600">
          <b className="font-semibold text-ink-900">{matches}</b> match{matches === 1 ? "" : "es"}
        </span>
      )}
      {!active && value.trim() !== "" && <span className="whitespace-nowrap text-[11.5px] text-ink-400">Press Enter to search</span>}
    </div>
  );
}
