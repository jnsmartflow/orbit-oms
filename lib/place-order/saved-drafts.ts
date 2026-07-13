// Named "Save draft + reopen later" store for /po (feature-flagged behind
// ?draft=on — see po-page.tsx). Storage key `po_saved_drafts`.
//
// COMPLETELY SEPARATE from `orbitoms_po_draft` (po-page.tsx's own crash-recovery
// auto-save) — different key, different purpose, never read/written/cleared
// from here. Do not merge the two mechanisms.

import type { PoDraft } from "@/app/po/po-page";

const STORAGE_KEY = "po_saved_drafts";
// Mirrors the po_recent_customers cap-6 pattern (po-page.tsx PO_RECENTS_CAP).
const MAX_DRAFTS = 6;

export type SavedDraftSnapshot = Omit<PoDraft, "updatedAt">;

export interface SavedDraft {
  id:       string;
  label:    string;
  savedAt:  number;
  snapshot: SavedDraftSnapshot;
}

interface DraftStore {
  version: 1;
  drafts:  SavedDraft[];
}

function readStore(): DraftStore {
  if (typeof window === "undefined") return { version: 1, drafts: [] };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { version: 1, drafts: [] };
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return { version: 1, drafts: [] };
    const obj = parsed as Partial<DraftStore>;
    if (!Array.isArray(obj.drafts)) return { version: 1, drafts: [] };
    return { version: 1, drafts: obj.drafts };
  } catch {
    return { version: 1, drafts: [] };
  }
}

function writeStore(store: DraftStore): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Quota exceeded / private mode — silently drop, mirrors savePoDraft.
  }
}

export function loadSavedDrafts(): SavedDraft[] {
  return readStore().drafts;
}

export function newDraftId(): string {
  return `d${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
}

// Upsert by id — a fresh save inserts newest-first (capped); saving again with
// the SAME id (a reopened draft) replaces that entry in place instead of
// duplicating it.
export function upsertSavedDraft(draft: SavedDraft): void {
  const store = readStore();
  const others = store.drafts.filter((d) => d.id !== draft.id);
  const next = [draft, ...others].slice(0, MAX_DRAFTS);
  writeStore({ version: 1, drafts: next });
}

export function removeSavedDraft(id: string): void {
  const store = readStore();
  const next = store.drafts.filter((d) => d.id !== id);
  writeStore({ version: 1, drafts: next });
}

// "N bills · N units" for a Drafts-screen row.
export function draftSummary(snapshot: SavedDraftSnapshot): { bills: number; units: number } {
  const activeBills = snapshot.bills.filter((b) => b.lines.length > 0);
  let units = 0;
  for (const b of snapshot.bills) {
    for (const line of b.lines) {
      for (const q of Object.values(line.packQtys)) units += q;
    }
  }
  return { bills: activeBills.length, units };
}

// "Today, 11:42 am" / "Yesterday, 4:05 pm" / "2 days ago" / "04 Jul" for a
// Drafts-screen row's saved timestamp. Device-local time — this is a
// client-only cosmetic display, not an email/backend IST timestamp.
export function formatSavedAt(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const time = d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return `Today, ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`;
  const days = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (days >= 0 && days <= 6) return `${days} days ago`;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}
