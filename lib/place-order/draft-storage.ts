// localStorage draft persistence for /place-order (planning doc §5.3).
//
// Single key holds a record of drafts keyed by SAP customer code. Each
// draft carries the full editable order state (bills, ship-to, dispatch,
// marker) plus a timestamp. Drafts older than 24h are dropped silently
// when read.
//
// The cart shape (Bill / CartLine) lives in
// app/(place-order)/place-order/types.ts; we import it here so the
// stored payload can round-trip through `bills` directly.

import type { Bill, Customer } from "@/app/(place-order)/place-order/types";
import type { EmailCallTarget, EmailDispatch, EmailMarker } from "./email";

const STORAGE_KEY = "orbitoms_place_order_draft_v2";
const TTL_MS      = 24 * 60 * 60 * 1000;

// One-shot cleanup of the v1 key (2026-05-12 flip — packQtys interpretation
// changed boxes → units, so v1 entries are misleading rather than
// migratable). removeItem is a no-op after the first run on each browser.
if (typeof window !== "undefined") {
  window.localStorage.removeItem("orbitoms_place_order_draft_v1");
}

export interface DraftSnapshot {
  bills:        Bill[];
  activeBillId: number;
  billCounter:  number;
  shipTo:       string;
  dispatch:     EmailDispatch;
  callTarget:   EmailCallTarget;
  marker:       EmailMarker;
  crossDepot:   string | null;
  notes:        string;
}

interface StoredEntry extends DraftSnapshot {
  customer:  Customer;
  updatedAt: number;
}

interface DraftStore {
  byCustomer: Record<string, StoredEntry>;
}

function readStore(): DraftStore {
  if (typeof window === "undefined") return { byCustomer: {} };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { byCustomer: {} };
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { byCustomer: {} };
    const obj = parsed as { byCustomer?: unknown };
    if (!obj.byCustomer || typeof obj.byCustomer !== "object") return { byCustomer: {} };
    return parsed as DraftStore;
  } catch {
    return { byCustomer: {} };
  }
}

function writeStore(store: DraftStore): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Quota exceeded / private mode → silently drop. The email is the real
    // record of truth; a missing draft just means the user starts fresh
    // after a refresh.
  }
}

export function saveDraft(customer: Customer, snapshot: DraftSnapshot): void {
  const store = readStore();
  store.byCustomer[customer.code] = {
    ...snapshot,
    customer,
    updatedAt: Date.now(),
  };
  writeStore(store);
}

// Returns null when no draft exists for the code OR the draft is past TTL.
// Stale entries are evicted from storage on the same read.
export function loadDraft(customerCode: string): DraftSnapshot | null {
  const store = readStore();
  const entry = store.byCustomer[customerCode];
  if (!entry) return null;
  if (Date.now() - entry.updatedAt > TTL_MS) {
    delete store.byCustomer[customerCode];
    writeStore(store);
    return null;
  }
  return {
    bills:        entry.bills,
    activeBillId: entry.activeBillId,
    billCounter:  entry.billCounter,
    shipTo:       entry.shipTo,
    dispatch:     entry.dispatch,
    // Defaults keep pre-existing drafts (saved before these fields) valid.
    callTarget:   entry.callTarget === "SO" || entry.callTarget === "Dealer" ? entry.callTarget : null,
    marker:       entry.marker,
    crossDepot:   typeof entry.crossDepot === "string" ? entry.crossDepot : null,
    notes:        typeof entry.notes === "string" ? entry.notes : "",
  };
}

export function clearDraft(customerCode: string): void {
  const store = readStore();
  if (!store.byCustomer[customerCode]) return;
  delete store.byCustomer[customerCode];
  writeStore(store);
}
