// Device-local recent customers for /place-order (client-only localStorage).
//
// Distinct storage key from the /po mobile page — the two surfaces are
// independent and must NOT share recents. No DB, no API route: the sent email
// is the record of truth; recents are a convenience shortcut on the landing
// screen. Mirrors the SSR-guarded, best-effort try/catch convention in
// lib/place-order/draft-storage.ts.

import type { Customer } from "@/app/(place-order)/place-order/types";

const RECENTS_KEY = "place_order_recent_customers";
const RECENTS_CAP = 10;

export type RecentCustomer = {
  name:  string;
  code:  string;
  area:  string | null;   // locality from the Customer record; null when absent
  stamp: number;          // ms epoch of the last send for this dealer
};

// Read + parse the recents list. Returns [] on SSR or any storage/parse error.
export function getRecents(): RecentCustomer[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (e): e is RecentCustomer =>
          !!e
          && typeof (e as RecentCustomer).name === "string"
          && typeof (e as RecentCustomer).code === "string",
      )
      .map((e) => ({
        name:  e.name,
        code:  e.code,
        area:  typeof e.area === "string" ? e.area : null,
        stamp: typeof e.stamp === "number" ? e.stamp : 0,
      }))
      .slice(0, RECENTS_CAP);
  } catch {
    return [];
  }
}

// Unshift this customer to the front, dedupe by code (newest wins), cap 10,
// write back. SSR-guarded + try/catch so a storage failure never throws and
// never blocks Send.
export function addRecent(customer: Customer): void {
  if (typeof window === "undefined") return;
  const entry: RecentCustomer = {
    name:  customer.name,
    code:  customer.code,
    area:  customer.area ?? null,
    stamp: Date.now(),
  };
  const next = [entry, ...getRecents().filter((e) => e.code !== entry.code)]
    .slice(0, RECENTS_CAP);
  try {
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    // Quota exceeded / private mode — recents are best-effort, drop silently.
  }
}
