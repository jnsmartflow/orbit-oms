"use client";

// Floor Control — the header search box + the results strip (design §5.2, mockup
// 01-board.html #sbox / #hits). One box, runs on ENTER (never on keystroke), for
// both a text query and a pasted list of OBD numbers.

import { useState, useEffect } from "react";
import { Search } from "lucide-react";
import type { ParsedSearch, SearchReport } from "@/lib/floor/search";
import type { TripSearchHit, LookupState, LookupTrip } from "./floor-page";
import type { FloorSearchHit } from "@/lib/floor/types";

/** "2026-09-24" → "24 Sep" — a trip's own day, for the lookup's choice list. */
function formatTripDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** Where a search hit lives, in the tabs' own words (2026-10-06). */
function hitPlace(h: FloorSearchHit): string {
  switch (h.target) {
    case "cancel_ci":
      return h.cis.length > 0 ? `CI ${h.cis[0].ciNumber ?? ""}`.trim() : "Cancelled";
    case "hold":
      return "On hold";
    case "tinting":
      return "Tinting";
    case "trip":
      return h.trip ? `${h.trip.number} · ${formatTripDay(h.trip.date)}` : "On a trip";
    default:
      return "Floor";
  }
}

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
        active ? "border-brand-500 shadow-[0_0_0_3px_rgba(124,58,237,0.08)]" : "border-gray-200"
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
//
// 2026-09-29 (owner): bills that sit on TRIPS are not pool hits. They get one
// line per trip — "1 bill on L-260929-03 ›" — that opens the trip, and a
// numbers chip found only there reads "on a trip" instead of "not found". The
// The search (GET /api/floor/search, 2026-10-06 — it replaced the trip-only
// lookup here) reports here too: looking, no bill with that number, a bill that
// has moved since, or one button per bill when the number names several (a
// shared invoice) — each jumps to its tab.
export function SearchHits({
  parsed,
  report,
  onClear,
  tripHits = [],
  onOpenTrip,
  lookup = null,
  onPickHit,
  onRetryOpen,
}: {
  parsed: ParsedSearch;
  report: SearchReport | null;
  onClear: () => void;
  tripHits?: TripSearchHit[];
  onOpenTrip?: (tripId: number) => void;
  lookup?: LookupState | null;
  onPickHit?: (hit: FloorSearchHit) => void;
  /** Retry a History jump whose load failed ("open-failed"). */
  onRetryOpen?: (trip: LookupTrip) => void;
}) {
  if (parsed.mode === "none" || !report) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b border-[#EDE9FE] bg-[#F5F3FF] px-4 py-[9px] text-[11.5px] text-[#6D28D9]">
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
                t.count > 0 || t.elsewhere > 0 ? "border-ok/30 bg-white text-ok-text" : "border-[#fecaca] bg-[#fef2f2] text-[#b91c1c]"
              }`}
            >
              {t.token}
              <span className="opacity-60">
                {t.count > 0 ? t.count : t.elsewhere > 0 ? "on a trip" : "not found"}
              </span>
            </span>
          ))}
        </>
      )}
      {tripHits.map((h) => (
        <button
          key={h.tripId}
          type="button"
          onClick={() => onOpenTrip?.(h.tripId)}
          className="font-semibold text-brand-600 hover:text-brand-700"
        >
          · {h.count} bill{h.count === 1 ? "" : "s"} on {h.tripNumber} ›
        </button>
      ))}
      {lookup?.status === "loading" && <span className="text-[#6b7280]">· Looking it up…</span>}
      {lookup?.status === "none" && <span className="text-[#6b7280]">· No bill with that number</span>}
      {lookup?.status === "error" && (
        <span className="font-semibold text-[#b91c1c]">· Could not look it up</span>
      )}
      {lookup?.status === "moved" && <span className="font-semibold text-[#b91c1c]">· {lookup.message}</span>}
      {/* The History jump (2026-09-29): up from the lookup's answer until that
          day's board and trips have landed with the trip selected. On a slow
          link that is many seconds, and a silent gap reads as "nothing
          happened". Settled by load() in floor-page.tsx. */}
      {lookup?.status === "opening" && (
        <span className="font-semibold text-[#6D28D9]">
          · Opening {lookup.trip.tripNumber} ({formatTripDay(lookup.trip.tripDate)})…
        </span>
      )}
      {lookup?.status === "open-failed" && (
        <span className="inline-flex items-center gap-1.5">
          <span className="font-semibold text-[#b91c1c]">
            · Could not open {lookup.trip.tripNumber} ({formatTripDay(lookup.trip.tripDate)})
            {lookup.reason ? ` — ${lookup.reason}` : ""}
          </span>
          <button
            type="button"
            onClick={() => onRetryOpen?.(lookup.trip)}
            className="font-semibold text-brand-600 underline hover:text-brand-700"
          >
            Retry
          </button>
        </span>
      )}
      {lookup?.status === "many" && (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <span className="text-[#6b7280]">
            · {lookup.hits.length === 1 ? "Found:" : `${lookup.hits.length} bills:`}
          </span>
          {lookup.hits.map((h) => (
            <button
              key={h.orderId}
              type="button"
              onClick={() => onPickHit?.(h)}
              title={h.dealer}
              className="rounded-[4px] border border-brand-100 bg-white px-2 py-[2px] font-mono text-[10.5px] text-brand-700 hover:border-brand-500"
            >
              {h.obdNumber} · {hitPlace(h)}
            </button>
          ))}
        </span>
      )}
      <button type="button" onClick={onClear} className="ml-auto text-[11px] font-semibold text-brand-600 hover:text-brand-700">
        Clear search ✕
      </button>
    </div>
  );
}
