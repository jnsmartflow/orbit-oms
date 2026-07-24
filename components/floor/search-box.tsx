"use client";

// Floor Control — the header search box + the results strip (design §5.2, mockup
// 01-board.html #sbox / #hits). One box, runs on ENTER (never on keystroke), for
// both a text query and a pasted list of OBD numbers.

import { useState, useEffect } from "react";
import { Search } from "lucide-react";
import type { ParsedSearch, SearchReport } from "@/lib/floor/search";

export function SearchBox({
  committed,
  onSearch,
  onClear,
}: {
  committed: string;
  onSearch: (raw: string) => void;
  onClear: () => void;
}) {
  const [value, setValue] = useState(committed);
  // Keep the box in sync when the committed value is cleared elsewhere.
  useEffect(() => setValue(committed), [committed]);

  const active = committed.trim().length > 0;

  return (
    <div
      className={`flex h-[30px] w-[260px] items-center gap-[7px] rounded-[7px] border bg-white px-[9px] text-[11.5px] ${
        active ? "border-teal-500 shadow-[0_0_0_3px_rgba(13,148,136,0.08)]" : "border-gray-200"
      }`}
    >
      <Search size={13} className="flex-shrink-0 text-gray-400" />
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onSearch(value); // commit on Enter only (design §5.2)
          }
        }}
        placeholder="Search name, or paste numbers"
        className="min-w-0 flex-1 bg-transparent text-gray-900 outline-none placeholder:text-gray-400"
      />
      {(value || committed) && (
        <button
          type="button"
          onClick={() => {
            setValue("");
            onClear();
          }}
          className="flex-shrink-0 text-gray-400 hover:text-gray-600"
          aria-label="Clear search"
        >
          ✕
        </button>
      )}
    </div>
  );
}

// The teal results strip. Text mode → one summary line; numbers mode → a chip per
// number (teal with a count, red "not found") + a summary. Not-found is never
// silent (design §5.2). Renders nothing when no search is active.
export function SearchHits({
  parsed,
  report,
  onClear,
}: {
  parsed: ParsedSearch;
  report: SearchReport | null;
  onClear: () => void;
}) {
  if (parsed.mode === "none" || !report) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b border-[#ccfbf1] bg-[#f0fdfa] px-4 py-[9px] text-[11.5px] text-[#0f766e]">
      {parsed.mode === "text" ? (
        <span>
          <b className="font-bold">{report.matchedCount}</b> match &ldquo;{parsed.text}&rdquo; in this list
        </span>
      ) : (
        <>
          <span>
            <b className="font-bold">{report.matchedCount}</b> bill{report.matchedCount === 1 ? "" : "s"} matched
          </span>
          {report.notFound > 0 && (
            <span className="font-semibold text-[#b91c1c]">
              · {report.notFound} number{report.notFound === 1 ? "" : "s"} not in this list
            </span>
          )}
          {report.perToken.map((t) => (
            <span
              key={t.token}
              className={`inline-flex items-center gap-[5px] rounded-[4px] border px-2 py-[2px] font-mono text-[10.5px] ${
                t.count > 0 ? "border-[#ccfbf1] bg-white text-[#0f766e]" : "border-[#fecaca] bg-[#fef2f2] text-[#b91c1c]"
              }`}
            >
              {t.token}
              <span className="opacity-60">{t.count > 0 ? t.count : "not found"}</span>
            </span>
          ))}
        </>
      )}
      <button type="button" onClick={onClear} className="ml-auto text-[11px] font-semibold text-teal-600 hover:text-teal-700">
        Clear search ✕
      </button>
    </div>
  );
}
