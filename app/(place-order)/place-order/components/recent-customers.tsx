"use client";

import { useEffect, useState } from "react";
import { getRecents, type RecentCustomer } from "@/lib/place-order/recents";
import type { Customer } from "../types";

// Landing-only recent-dealers grid for /place-order. Matches the approved
// mockup (docs/mockups/place-order/recents-seamless.html): borderless
// two-column grid, NO outer box, NO row dividers, soft rounded hover only.
//
// Reads the device-local recents (lib/place-order/recents.ts) on mount, so on
// SSR + the first client render it shows the `fallback` (today's "type a
// customer name…" hint) — no hydration mismatch — and swaps to the grid once
// recents are read. When there are no recents it stays on `fallback`, leaving
// the existing empty state exactly as-is.

interface RecentCustomersProps {
  customerCount: number;
  onSelect:      (customer: Customer) => void;
  fallback:      React.ReactNode;
}

// First letters of the first two words, uppercased ("Maruti Hardware" -> "MH").
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? "")).toUpperCase();
}

// "today" for same-day, else "{N}d" since the stamp.
function recency(stamp: number): string {
  if (!stamp) return "";
  const days = Math.floor((Date.now() - stamp) / (24 * 60 * 60 * 1000));
  return days <= 0 ? "today" : `${days}d`;
}

export default function RecentCustomers({
  customerCount, onSelect, fallback,
}: RecentCustomersProps): React.JSX.Element {
  // null = not yet read (SSR + first client render) -> show fallback.
  const [recents, setRecents] = useState<RecentCustomer[] | null>(null);
  useEffect(() => { setRecents(getRecents()); }, []);

  if (recents === null || recents.length === 0) return <>{fallback}</>;

  return (
    <div className="pt-6">
      <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400 mb-4 ml-3">
        Recent
      </div>
      <div className="grid grid-cols-2 gap-x-7 gap-y-0.5">
        {recents.map((r) => (
          <button
            key={r.code}
            type="button"
            onClick={() => onSelect({ name: r.name, code: r.code, area: r.area })}
            className="flex items-center gap-[13px] w-full px-3 py-[11px] rounded-[10px] text-left cursor-pointer hover:bg-gray-50 transition-colors duration-100"
          >
            <span className="w-9 h-9 rounded-full bg-teal-50 text-teal-700 text-[12.5px] font-semibold inline-flex items-center justify-center flex-shrink-0">
              {initials(r.name)}
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-[14px] font-bold text-gray-900 leading-[1.35] truncate">
                {r.name}
              </span>
              <span className="block text-[11px] text-gray-400 mt-px truncate">
                <span className="font-mono text-gray-500">{r.code}</span>
                {r.area ? ` · ${r.area}` : ""}
              </span>
            </span>
            <span className="text-[11px] text-gray-300 flex-shrink-0">
              {recency(r.stamp)}
            </span>
          </button>
        ))}
      </div>
      <div className="text-[11px] text-gray-300 mt-6 ml-3">
        or type above to search all {customerCount} customers
      </div>
    </div>
  );
}
