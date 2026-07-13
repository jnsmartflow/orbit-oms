// "Sent" list for /po (feature-flagged behind ?draft=on — see po-page.tsx).
// Storage key `po_sent_orders`. Every Send (when draftsEnabled) appends one
// entry here — this is a log of recent sends, not an edit-in-place store like
// saved-drafts.ts, so there is no upsert-by-id, only add/remove.
//
// COMPLETELY SEPARATE from `orbitoms_po_draft` (crash-recovery auto-save) and
// `po_saved_drafts` (named drafts) — different key, different purpose, never
// read/written/cleared from here.
//
// Retention: kept only while sentAt falls on TODAY or YESTERDAY by IST
// calendar day (Asia/Kolkata, fixed +5:30 — India has no DST, so this is a
// safe, dependency-free way to mirror the codebase's IST-conversion pattern
// in plain client-side JS). Pruned on every load AND before every write.

import type { PoDraft } from "@/app/po/po-page";

const STORAGE_KEY = "po_sent_orders";
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type SentOrderSnapshot = Omit<PoDraft, "updatedAt">;

export interface SentOrder {
  id:       string;
  label:    string;
  sentAt:   number;
  snapshot: SentOrderSnapshot;
}

interface SentStore {
  version: 1;
  orders:  SentOrder[];
}

// "IST calendar day" as a YYYY-MM-DD string for a UTC epoch ms timestamp.
function istDateKey(epochMs: number): string {
  const ist = new Date(epochMs + IST_OFFSET_MS);
  const y = ist.getUTCFullYear();
  const m = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const d = String(ist.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function pruneToRecent(orders: SentOrder[], nowMs: number): SentOrder[] {
  const todayKey     = istDateKey(nowMs);
  const yesterdayKey = istDateKey(nowMs - DAY_MS);
  return orders.filter((o) => {
    const key = istDateKey(o.sentAt);
    return key === todayKey || key === yesterdayKey;
  });
}

function readRawStore(): SentStore {
  if (typeof window === "undefined") return { version: 1, orders: [] };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { version: 1, orders: [] };
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return { version: 1, orders: [] };
    const obj = parsed as Partial<SentStore>;
    if (!Array.isArray(obj.orders)) return { version: 1, orders: [] };
    return { version: 1, orders: obj.orders };
  } catch {
    return { version: 1, orders: [] };
  }
}

function writeStore(store: SentStore): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Quota exceeded / private mode — silently drop, mirrors savePoDraft.
  }
}

export function newSentId(): string {
  return `s${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
}

// Prunes on read AND writes the pruned result back (actual storage shrinkage,
// not just an in-memory filter) whenever pruning drops anything.
export function loadSentOrders(): SentOrder[] {
  const raw = readRawStore();
  const pruned = pruneToRecent(raw.orders, Date.now());
  if (pruned.length !== raw.orders.length) writeStore({ version: 1, orders: pruned });
  return pruned;
}

// Appends a new Sent record (newest-first). Not an upsert — every Send is a
// distinct event, never overwriting a prior one.
export function addSentOrder(order: SentOrder): void {
  const pruned = pruneToRecent(readRawStore().orders, Date.now());
  writeStore({ version: 1, orders: [order, ...pruned] });
}

export function removeSentOrder(id: string): void {
  const pruned = pruneToRecent(readRawStore().orders, Date.now()).filter((o) => o.id !== id);
  writeStore({ version: 1, orders: pruned });
}
