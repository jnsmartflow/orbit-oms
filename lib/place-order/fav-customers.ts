// Favourites list for /po Home — replaces the shuffling "Recent" customers
// list with a curated, stable set the operator pins themselves via the star
// toggle on the customer build header. Storage key `po_fav_customers`,
// separate from `po_recent_customers` (po-page.tsx's inline recents helpers)
// which keep running in the background, unrendered, so recents can be
// restored later if needed.
//
// Mirrors the sent-orders.ts / saved-drafts.ts persistence pattern: a
// versioned object, silent try/catch on read/write (quota / private mode).

import type { Customer } from "@/app/(place-order)/place-order/types";

const STORAGE_KEY = "po_fav_customers";
const FAV_CAP = 8;

export type FavCustomer = {
  id:   string;   // == customer code — Customer carries no separate numeric id
  name: string;
  code: string;
  area: string | null;
};

interface FavStore {
  version: 1;
  favs:    FavCustomer[];
}

function readStore(): FavStore {
  if (typeof window === "undefined") return { version: 1, favs: [] };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { version: 1, favs: [] };
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return { version: 1, favs: [] };
    const obj = parsed as Partial<FavStore>;
    if (!Array.isArray(obj.favs)) return { version: 1, favs: [] };
    return {
      version: 1,
      favs: obj.favs.filter(
        (f): f is FavCustomer =>
          !!f && typeof f.id === "string" && typeof f.name === "string" && typeof f.code === "string",
      ),
    };
  } catch {
    return { version: 1, favs: [] };
  }
}

function writeStore(store: FavStore): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Quota exceeded / private mode — silently drop, mirrors savePoDraft.
  }
}

// Sorted A-Z by name — the whole point of Favourites over Recent (stable,
// curated order instead of a shuffling recency list).
export function loadFavs(): FavCustomer[] {
  return [...readStore().favs].sort((a, b) => a.name.localeCompare(b.name));
}

export function isFav(id: string): boolean {
  return readStore().favs.some((f) => f.id === id);
}

// Adds `customer` as a favourite. Idempotent — already-fav is a no-op that
// still reports "added". Blocks at FAV_CAP rather than evicting an existing
// favourite; caller shows the "full" message and leaves the star outline.
export function addFav(customer: Customer): "added" | "full" {
  const store = readStore();
  const id = customer.code;
  if (store.favs.some((f) => f.id === id)) return "added";
  if (store.favs.length >= FAV_CAP) return "full";
  const entry: FavCustomer = { id, name: customer.name, code: customer.code, area: customer.area ?? null };
  writeStore({ version: 1, favs: [...store.favs, entry] });
  return "added";
}

export function removeFav(id: string): void {
  const store = readStore();
  writeStore({ version: 1, favs: store.favs.filter((f) => f.id !== id) });
}
