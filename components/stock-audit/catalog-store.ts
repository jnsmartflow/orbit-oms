// components/stock-audit/catalog-store.ts — the phone's copy of the SKU list.
// Client-only. Downloaded once, kept in localStorage, searched locally
// (lib/stock-audit/sku-search.ts) — no server call per keystroke.
//
// Storage: localStorage key `stock_count_catalog_v2` = { version, fetchedAt,
// rows } (~90 KB of text for ~1,700 rows). v2 (2026-11-03): rows lost the
// carton-size slot (qty is always pieces); a stored v1 copy is simply never
// read again — the 4-slot isCatalogRow would refuse its 5-slot rows anyway. Not a `po2_*` key and unrelated to
// /po2. EVERY read and write is wrapped: private mode, a full quota or blocked
// site data must never break the screen — the list then lives in memory for
// the session (`memory` below) and is re-downloaded on the next open.
//
// Refresh rule:
//   · every time the screen opens: show the stored list at once, then ask
//     GET /api/stock-count/catalog?have=<version> — "unchanged" (~60 bytes) or
//     the full list, which replaces the stored one;
//   · at once after a NOT_IN_CATALOG answer on save (the list may be stale);
//   · no polling — the catalogue changes rarely and the server re-checks the
//     code on every save anyway.

import { isCatalogRow, type CatalogRow } from "@/lib/stock-audit/sku-search";
import { fetchCatalog, type CountError } from "./count-api";

const STORAGE_KEY = "stock_count_catalog_v2";

export interface StoredCatalog {
  version: string;
  fetchedAt: string;
  rows: CatalogRow[];
}

/** The in-memory fallback (and the latest copy either way). */
let memory: StoredCatalog | null = null;

function isStored(v: unknown): v is StoredCatalog {
  if (v === null || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.version === "string" &&
    typeof o.fetchedAt === "string" &&
    Array.isArray(o.rows) &&
    o.rows.every(isCatalogRow)
  );
}

/** The stored list, or null — never throws. */
export function readStoredCatalog(): StoredCatalog | null {
  if (memory) return memory;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isStored(parsed)) return null;
    memory = parsed;
    return parsed;
  } catch {
    return null;
  }
}

function writeStoredCatalog(c: StoredCatalog): void {
  memory = c;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
  } catch {
    // Quota / private mode / blocked storage — the memory copy serves this session.
  }
}

export type CatalogRefresh = { ok: true; catalog: StoredCatalog } | { ok: false; error: CountError };

/** Ask the server whether our copy is current; replace it when not. */
export async function refreshCatalog(): Promise<CatalogRefresh> {
  const current = readStoredCatalog();
  const r = await fetchCatalog(current?.version ?? null);
  if (!r.ok) return { ok: false, error: r.error };
  if ("unchanged" in r.data && current) return { ok: true, catalog: current };
  if (!("skus" in r.data) || !Array.isArray(r.data.skus)) {
    // "unchanged" but we hold nothing (storage was cleared meanwhile) — fetch in full.
    const full = await fetchCatalog(null);
    if (!full.ok) return { ok: false, error: full.error };
    if (!("skus" in full.data)) return { ok: false, error: { code: "UNKNOWN", message: "" } };
    const c: StoredCatalog = { version: full.data.version, fetchedAt: new Date().toISOString(), rows: full.data.skus.filter(isCatalogRow) };
    writeStoredCatalog(c);
    return { ok: true, catalog: c };
  }
  const c: StoredCatalog = { version: r.data.version, fetchedAt: new Date().toISOString(), rows: r.data.skus.filter(isCatalogRow) };
  writeStoredCatalog(c);
  return { ok: true, catalog: c };
}
