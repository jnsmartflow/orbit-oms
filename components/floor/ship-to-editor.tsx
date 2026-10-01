"use client";

// The inline "Change ship-to" editor — a debounced site search and a pick list.
//
// Extracted VERBATIM from components/floor/detail-panel.tsx (2026-10-01, Tint
// Manager tabs build step 7 — plan §A) so Floor's detail panel and the Tint
// Manager's share ONE editor. Two additions, both opt-in so Floor is unchanged:
//   - `searchUrl` — which search route to call. Default: Floor's
//     /api/floor/ship-to-search. The Tint Manager passes its own
//     /api/tint/manager/ship-to-search (same lib/floor/ship-to.ts searchShipTo,
//     same bare-array answer, under the tint_ship_to tick).
//   - `onClear` — when given, a "Clear redirect" button sends the bill back to
//     its own site. Floor passes none (its panel has never offered a clear).
// The SAVE stays with the caller (onPick / onClear), as it always has on Floor:
// each desk posts to its own write route (/api/floor/ship-to,
// /api/tint/manager/ship-to — both lib/floor/ship-to.ts setShipToOverride).

import { useEffect, useRef, useState } from "react";

interface ShipToResult {
  id: number;
  customerName: string;
  area: string | null;
}

export function ShipToEditor({
  busy,
  onCancel,
  onPick,
  onClear,
  searchUrl = "/api/floor/ship-to-search",
}: {
  busy: boolean;
  onCancel: () => void;
  onPick: (customerId: number) => void;
  /** Send the bill back to its own site. Omitted → no Clear button (Floor). */
  onClear?: () => void;
  /** The search route; `?q=` is appended. Default = Floor's. */
  searchUrl?: string;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<ShipToResult[]>([]);
  const [searching, setSearching] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const query = q.trim();
    if (query.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`${searchUrl}?q=${encodeURIComponent(query)}`, { cache: "no-store" });
        setResults(res.ok ? ((await res.json()) as ShipToResult[]) : []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q, searchUrl]);

  return (
    <div className="border-b border-gray-200 bg-[#fcfcfd] px-5 py-3">
      <div className="mb-1.5 text-[9.5px] font-semibold uppercase tracking-[0.05em] text-gray-400">Change ship-to</div>
      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search dealer or site name…"
        className="h-8 w-full rounded-[7px] border border-gray-300 px-2.5 text-[12px] outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10"
      />
      {q.trim().length >= 2 && (
        <div className="mt-1.5 max-h-[220px] overflow-y-auto">
          {searching && results.length === 0 ? (
            <div className="px-1 py-2 text-[11px] text-gray-400">Searching…</div>
          ) : results.length === 0 ? (
            <div className="px-1 py-2 text-[11px] text-gray-400">No matches.</div>
          ) : (
            results.map((r) => (
              <button
                key={r.id}
                type="button"
                disabled={busy}
                onClick={() => onPick(r.id)}
                className="flex w-full items-center gap-2 rounded-[6px] px-2.5 py-2 text-left hover:bg-[#F5F3FF] disabled:opacity-40"
              >
                <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-gray-800">{r.customerName}</span>
                {r.area && <span className="shrink-0 text-[10px] text-gray-400">{r.area}</span>}
              </button>
            ))
          )}
        </div>
      )}
      <div className="mt-2 flex">
        <button type="button" onClick={onCancel} className="rounded-[6px] border border-gray-200 px-3 py-1.5 text-[11.5px] text-gray-500 hover:border-gray-300 hover:text-gray-700">
          Cancel
        </button>
        {onClear && (
          <button
            type="button"
            disabled={busy}
            onClick={onClear}
            className="ml-auto rounded-[6px] border border-gray-200 px-3 py-1.5 text-[11.5px] text-gray-600 hover:border-gray-300 hover:text-gray-900 disabled:opacity-40"
          >
            Clear redirect
          </button>
        )}
      </div>
    </div>
  );
}
