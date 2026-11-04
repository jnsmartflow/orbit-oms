// components/stock-audit/count-queue-store.ts — the phone's storage for the
// stock-count OFFLINE QUEUE (Schema v27.80). Client-only.
//
// THE catalog-store.ts PATTERN: EVERY read and write is wrapped. Private mode,
// a full quota or blocked site data must never break the screen — the data
// then lives in `memory` for the session. writeQueue() reports whether the
// copy really reached localStorage, so the shell can fall back to saving
// online only (Smart Flow, 2026-11-04) instead of pretending a count will
// survive a reload.
//
// KEYS — always scoped by the signed-in user's id, so a different person on
// the same phone never sees or sends someone else's counts:
//   stock_count_queue_v1:<userId>:<auditId>  QueueDoc — counts not yet confirmed
//                                            by the server (lib/stock-audit/queue-core.ts)
//   stock_count_audit_v1:<userId>            the last open audit, so a weak-signal
//                                            open goes straight to Count
//   stock_count_sent_v1:<userId>:<auditId>   the last GET of my lines — a read-only
//                                            copy for Submitted when offline
// Entries leave the queue only when the server confirms them. Nothing here is
// cleared on sign-out (a later sign-in as the same person resumes sending).

import { isQueueDoc, reviveQueue, toStored, type QueueDoc } from "@/lib/stock-audit/queue-core";
import type { CountLine, MyAudit } from "@/lib/stock-audit/types";

const QUEUE_PREFIX = "stock_count_queue_v1:";
const AUDIT_PREFIX = "stock_count_audit_v1:";
const SENT_PREFIX = "stock_count_sent_v1:";

export const queueKey = (userId: number, auditId: number): string => `${QUEUE_PREFIX}${userId}:${auditId}`;
const auditKey = (userId: number): string => `${AUDIT_PREFIX}${userId}`;
const sentKey = (userId: number, auditId: number): string => `${SENT_PREFIX}${userId}:${auditId}`;

/** True for a storage event key that belongs to this user's queues. */
export function isMyQueueKey(key: string | null, userId: number): boolean {
  return key === null || key.startsWith(`${QUEUE_PREFIX}${userId}:`);
}

/** The session's copies (the fallback, and the latest either way). */
const memory = new Map<string, string>();

function getRaw(key: string): string | null {
  try {
    const v = window.localStorage.getItem(key);
    if (v !== null) return v;
  } catch {
    // fall through to memory
  }
  return memory.get(key) ?? null;
}

/** Write; true only when localStorage really took it. */
function setRaw(key: string, value: string): boolean {
  memory.set(key, value);
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function removeRaw(key: string): void {
  memory.delete(key);
  try {
    window.localStorage.removeItem(key);
  } catch {
    // nothing to do
  }
}

function parse(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ── The queue ────────────────────────────────────────────────────────────────

/** This user's queue for one audit, or null when there is none. */
export function readQueue(userId: number, auditId: number): QueueDoc | null {
  const v = parse(getRaw(queueKey(userId, auditId)));
  if (!isQueueDoc(v) || v.userId !== userId || v.auditId !== auditId) return null;
  return reviveQueue(v);
}

/** Store the queue (an empty one is removed). true = it reached localStorage. */
export function writeQueue(doc: QueueDoc): boolean {
  const key = queueKey(doc.userId, doc.auditId);
  if (doc.entries.length === 0) {
    removeRaw(key);
    return true;
  }
  return setRaw(key, JSON.stringify(toStored(doc)));
}

/** Every audit id this user has a stored queue for. */
export function listQueueAuditIds(userId: number): number[] {
  const prefix = `${QUEUE_PREFIX}${userId}:`;
  const ids = new Set<number>();
  try {
    const ls = window.localStorage;
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (k && k.startsWith(prefix)) ids.add(Number(k.slice(prefix.length)));
    }
  } catch {
    // memory only
  }
  for (const k of Array.from(memory.keys())) if (k.startsWith(prefix)) ids.add(Number(k.slice(prefix.length)));
  return Array.from(ids).filter((n) => Number.isInteger(n) && n > 0);
}

const PROBE_KEY = "stock_count_probe_v1";

/** Does localStorage accept a write right now? (Private mode / blocked → false.) */
export function storageWorks(): boolean {
  try {
    window.localStorage.setItem(PROBE_KEY, "1");
    window.localStorage.removeItem(PROBE_KEY);
    return true;
  } catch {
    return false;
  }
}

// ── The last open audit ─────────────────────────────────────────────────────

function isMyAudit(v: unknown): v is MyAudit {
  if (v === null || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.id === "number" && typeof o.auditNumber === "string" && typeof o.createdAt === "string" && typeof o.myLines === "number";
}

export function readCachedAudit(userId: number): MyAudit | null {
  const v = parse(getRaw(auditKey(userId)));
  return isMyAudit(v) ? v : null;
}

/** null clears it (the server said no audit is open). */
export function writeCachedAudit(userId: number, audit: MyAudit | null): void {
  if (audit === null) removeRaw(auditKey(userId));
  else setRaw(auditKey(userId), JSON.stringify(audit));
}

// ── The last GET of my lines (read-only, for offline display) ───────────────

export function readSentLines(userId: number, auditId: number): CountLine[] | null {
  const v = parse(getRaw(sentKey(userId, auditId)));
  if (!Array.isArray(v)) return null;
  return v.filter(
    (l): l is CountLine =>
      l !== null && typeof l === "object" && typeof (l as CountLine).id === "number" && typeof (l as CountLine).material === "string",
  ).map((l) => ({ ...l, clientId: l.clientId ?? null, countedAt: l.countedAt ?? null }));
}

export function writeSentLines(userId: number, auditId: number, lines: CountLine[]): void {
  setRaw(sentKey(userId, auditId), JSON.stringify(lines));
}
