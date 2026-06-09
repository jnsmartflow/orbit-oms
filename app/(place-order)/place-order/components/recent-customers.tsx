"use client";

import { useEffect, useState } from "react";
import { getRecents, type RecentCustomer } from "@/lib/place-order/recents";
import type { Customer } from "../types";

// Landing-only recent-dealers grid for /place-order. Matches the approved
// "recents-light" spec: filled neutral rows (#f6f7f8, hover #eceef0), rounded,
// two-column grid, neutral-gray circular initials avatar.
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
    <div className="max-w-[920px] mx-auto pt-6">
      <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-500 mb-4 pl-3">
        Recent
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-2">
        {recents.map((r) => (
          <button
            key={r.code}
            type="button"
            onClick={() => onSelect({ name: r.name, code: r.code, area: r.area })}
            className="flex items-center gap-[13px] w-full px-[14px] py-3 rounded-[10px] bg-[#f6f7f8] hover:bg-[#eceef0] text-left cursor-pointer transition-colors duration-100"
          >
            <span className="w-[38px] h-[38px] rounded-full bg-[#e7e9ed] text-gray-600 text-[13px] font-medium inline-flex items-center justify-center flex-shrink-0">
              {initials(r.name)}
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-[14px] font-medium text-gray-900 truncate">
                {r.name}
              </span>
              <span className="block text-[11.5px] text-gray-500 mt-0.5 truncate">
                <span className="font-mono text-gray-600">{r.code}</span>
                {r.area ? ` · ${r.area}` : ""}
              </span>
            </span>
            <span className="text-[11px] text-gray-400 flex-shrink-0">
              {recency(r.stamp)}
            </span>
          </button>
        ))}
      </div>
      <div className="text-[11px] text-gray-400 mt-6 pl-3">
        or type above to search all {customerCount} customers
      </div>
    </div>
  );
}
