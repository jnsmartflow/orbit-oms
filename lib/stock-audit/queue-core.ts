// lib/stock-audit/queue-core.ts — the stock-count OFFLINE QUEUE's rules, as
// pure functions (Schema v27.80, Smart Flow 2026-11-04). The phone's storage
// (components/stock-audit/count-queue-store.ts) and sender
// (components/stock-audit/use-count-queue.ts) call these; the tests
// (queue-core.test.ts) run them without a browser.
//
// THE MODEL. Submit saves the entry ON THE PHONE first; a background sender
// posts the queue oldest first, one at a time, whenever the page is open and
// the network allows. Every entry carries a clientId made once at Submit, so a
// retry of a send whose reply was lost is answered by the server with the line
// it already holds — never a second line.
//
//   waiting ──send──▶ sending ──2xx──▶ removed from the queue (it is now a
//                                      server line = "Sent")
//                        ├─ NETWORK / timeout / 5xx / TRY_AGAIN / UNKNOWN ─▶ waiting (attempts+1, backoff)
//                        ├─ 409 AUDIT_CLOSED ─▶ failed{closed}   KEPT — never dropped; the counter may discard it
//                        ├─ 400 NOT_IN_CATALOG ─▶ failed{confirm}  tap → "Count as Not in catalog?" → waiting
//                        ├─ 400 INVALID / 404 / 409 CLIENT_ID_CONFLICT … ─▶ failed{other}  tap = retry
//                        └─ 401 / 403 / 409 WRONG_USER ─▶ waiting, and the WHOLE queue pauses
//   failed ──tap──▶ waiting
//
// "sending" is in-memory only: toStored() writes it as "waiting", and
// reviveQueue() turns any stored "sending" back into "waiting" — the send may
// have reached the server, and the clientId makes the retry harmless.
// A failed entry never blocks the ones behind it.
//
// 🔴 PURE — no React, no window, no fetch, no Prisma.

import { validateQty } from "./calc";
import { isClientId } from "./client-id";
import type { CountLine } from "./types";

export type EntryState = "waiting" | "sending" | "failed";
export type FailKind = "closed" | "confirm" | "other";

export interface EntryFail {
  kind: FailKind;
  code: string;
  message: string;
}

export interface QueuedEntry {
  clientId: string;
  material: string;
  /** Pieces; already passed validateQty. */
  qty: number;
  /** What the POST sends — true = the counter confirmed "Not in catalog". */
  notInCatalog: boolean;
  /** Display snapshot from the phone's catalog (the server re-resolves). */
  inCatalog: boolean;
  skuDescription: string | null;
  skuPack: string | null;
  /** The phone's clock at Submit, ISO with Z. */
  countedAt: string;
  state: EntryState;
  attempts: number;
  lastTriedAt: string | null;
  fail?: EntryFail;
}

export interface QueueDoc {
  v: 1;
  userId: number;
  auditId: number;
  auditNumber: string;
  entries: QueuedEntry[];
}

// ── Shape checks (what comes back out of localStorage is untrusted) ─────────

function isEntry(v: unknown): v is QueuedEntry {
  if (v === null || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  const strOrNull = (x: unknown): boolean => x === null || typeof x === "string";
  return (
    isClientId(o.clientId) &&
    typeof o.material === "string" &&
    o.material !== "" &&
    typeof o.qty === "number" &&
    validateQty(o.qty).ok &&
    typeof o.notInCatalog === "boolean" &&
    typeof o.inCatalog === "boolean" &&
    strOrNull(o.skuDescription) &&
    strOrNull(o.skuPack) &&
    typeof o.countedAt === "string" &&
    (o.state === "waiting" || o.state === "sending" || o.state === "failed") &&
    typeof o.attempts === "number" &&
    strOrNull(o.lastTriedAt)
  );
}

export function isQueueDoc(v: unknown): v is QueueDoc {
  if (v === null || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    o.v === 1 &&
    typeof o.userId === "number" &&
    typeof o.auditId === "number" &&
    typeof o.auditNumber === "string" &&
    Array.isArray(o.entries)
  );
}

export function emptyQueue(userId: number, auditId: number, auditNumber: string): QueueDoc {
  return { v: 1, userId, auditId, auditNumber, entries: [] };
}

/**
 * A doc read back from storage: entries that fail the shape check are kept
 * OUT of the send path but never silently lost — they are simply not entries
 * this code can send (a future version's shape). A stored "sending" becomes
 * "waiting" (the tab that was sending it is gone).
 */
export function reviveQueue(doc: QueueDoc): QueueDoc {
  const entries: QueuedEntry[] = [];
  for (const e of doc.entries as unknown[]) {
    if (!isEntry(e)) continue;
    entries.push(e.state === "sending" ? { ...e, state: "waiting" } : e);
  }
  return { ...doc, entries };
}

/** What gets written to storage — "sending" never persists. */
export function toStored(doc: QueueDoc): QueueDoc {
  return { ...doc, entries: doc.entries.map((e) => (e.state === "sending" ? { ...e, state: "waiting" } : e)) };
}

// ── Transitions ─────────────────────────────────────────────────────────────

export interface NewEntryInput {
  clientId: string;
  material: string;
  qty: number;
  inCatalog: boolean;
  skuDescription: string | null;
  skuPack: string | null;
  countedAt: string;
}

export function makeEntry(input: NewEntryInput): QueuedEntry {
  return {
    clientId: input.clientId,
    material: input.material,
    qty: input.qty,
    notInCatalog: !input.inCatalog,
    inCatalog: input.inCatalog,
    skuDescription: input.inCatalog ? input.skuDescription : null,
    skuPack: input.inCatalog ? input.skuPack : null,
    countedAt: input.countedAt,
    state: "waiting",
    attempts: 0,
    lastTriedAt: null,
  };
}

/** Add an entry (a repeat clientId is ignored — the first copy stands). */
export function enqueue(doc: QueueDoc, entry: QueuedEntry): QueueDoc {
  if (doc.entries.some((e) => e.clientId === entry.clientId)) return doc;
  return { ...doc, entries: [...doc.entries, entry] };
}

/** The next entry to send: the OLDEST waiting one (failed ones are skipped). */
export function nextToSend(doc: QueueDoc): QueuedEntry | null {
  let best: QueuedEntry | null = null;
  for (const e of doc.entries) {
    if (e.state !== "waiting") continue;
    if (best === null || e.countedAt < best.countedAt) best = e;
  }
  return best;
}

function mapEntry(doc: QueueDoc, clientId: string, f: (e: QueuedEntry) => QueuedEntry | null): QueueDoc {
  const entries: QueuedEntry[] = [];
  for (const e of doc.entries) {
    if (e.clientId !== clientId) {
      entries.push(e);
      continue;
    }
    const next = f(e);
    if (next !== null) entries.push(next);
  }
  return { ...doc, entries };
}

export function markSending(doc: QueueDoc, clientId: string, nowIso: string): QueueDoc {
  return mapEntry(doc, clientId, (e) => (e.state === "waiting" ? { ...e, state: "sending", lastTriedAt: nowIso } : e));
}

/** What one send came back with, as the queue sees it. */
export type SendOutcome =
  | { kind: "sent" }
  | { kind: "retry" }
  | { kind: "fail"; fail: EntryFail }
  | { kind: "pause"; reason: PauseReason };

export type PauseReason = "auth" | "forbidden" | "wrong_user";

/** A send result → the queue's outcome. `code` is the route's error code, or
 *  NETWORK / UNKNOWN from the browser (components/stock-audit/count-api.ts). */
export function classifySend(r: { ok: true } | { ok: false; code: string; message: string }): SendOutcome {
  if (r.ok) return { kind: "sent" };
  switch (r.code) {
    case "NETWORK":
    case "TRY_AGAIN":
    case "UNKNOWN":
      return { kind: "retry" };
    case "UNAUTHORIZED":
      return { kind: "pause", reason: "auth" };
    case "FORBIDDEN":
      return { kind: "pause", reason: "forbidden" };
    case "WRONG_USER":
      return { kind: "pause", reason: "wrong_user" };
    case "AUDIT_CLOSED":
      return { kind: "fail", fail: { kind: "closed", code: r.code, message: r.message } };
    case "NOT_IN_CATALOG":
      return { kind: "fail", fail: { kind: "confirm", code: r.code, message: r.message } };
    default:
      // INVALID, NOT_FOUND, CLIENT_ID_CONFLICT, NOT_OWNER, anything new.
      return { kind: "fail", fail: { kind: "other", code: r.code, message: r.message } };
  }
}

/** Apply a send's outcome to the entry. `sent` removes it from the queue. */
export function applyOutcome(doc: QueueDoc, clientId: string, outcome: SendOutcome): QueueDoc {
  return mapEntry(doc, clientId, (e) => {
    switch (outcome.kind) {
      case "sent":
        return null;
      case "retry":
        return { ...e, state: "waiting", attempts: e.attempts + 1 };
      case "pause":
        return { ...e, state: "waiting" };
      case "fail": {
        const { fail: _old, ...rest } = e;
        void _old;
        return { ...rest, state: "failed", attempts: e.attempts + 1, fail: outcome.fail };
      }
    }
  });
}

/** Tap on a Failed entry → waiting again. A "closed" one cannot be retried.
 *  `asNotInCatalog` is the counter's confirm for a NOT_IN_CATALOG answer. */
export function retryEntry(doc: QueueDoc, clientId: string, asNotInCatalog = false): QueueDoc {
  return mapEntry(doc, clientId, (e) => {
    if (e.state !== "failed" || e.fail?.kind === "closed") return e;
    const { fail: _old, ...rest } = e;
    void _old;
    if (asNotInCatalog) {
      return { ...rest, state: "waiting", notInCatalog: true, inCatalog: false, skuDescription: null, skuPack: null };
    }
    return { ...rest, state: "waiting" };
  });
}

/** Edit the qty of an entry still on the phone (same clientId). Not while it
 *  is sending, and not a "closed" one. A failed{other} entry goes back to waiting. */
export function editEntry(doc: QueueDoc, clientId: string, qty: number): QueueDoc {
  return mapEntry(doc, clientId, (e) => {
    if (e.state === "sending" || e.fail?.kind === "closed") return e;
    if (e.state === "failed" && e.fail?.kind === "confirm") return { ...e, qty };
    const { fail: _old, ...rest } = e;
    void _old;
    return { ...rest, qty, state: "waiting" };
  });
}

/** Remove (or, for a "closed" one, discard) an entry. Never while sending. */
export function removeEntry(doc: QueueDoc, clientId: string): QueueDoc {
  return mapEntry(doc, clientId, (e) => (e.state === "sending" ? e : null));
}

/** After a GET of my lines: drop every queued entry the server already holds
 *  (its save landed, the reply was lost). Not one that is sending right now. */
export function dropConfirmed(doc: QueueDoc, serverClientIds: Iterable<string | null>): QueueDoc {
  const ids = new Set<string>();
  for (const id of Array.from(serverClientIds)) if (id) ids.add(id.toLowerCase());
  if (ids.size === 0) return doc;
  return { ...doc, entries: doc.entries.filter((e) => e.state === "sending" || !ids.has(e.clientId)) };
}

// ── Backoff ─────────────────────────────────────────────────────────────────

const BACKOFF_S = [3, 6, 12, 24, 48, 60] as const;

/** Delay before retry `n` (1 = after the first failure): 3 → 6 → 12 → 24 →
 *  48 → 60 s cap, ±20% jitter. `rand` in [0, 1). */
export function backoffMs(n: number, rand: () => number = Math.random): number {
  const i = Math.min(Math.max(n, 1), BACKOFF_S.length) - 1;
  const base = BACKOFF_S[i] * 1000;
  return Math.round(base * (0.8 + 0.4 * rand()));
}

// ── Counting + the banner ───────────────────────────────────────────────────

/** Submitted (n): server lines + queued entries the server does not hold yet. */
export function submittedCount(entries: readonly QueuedEntry[], lines: readonly CountLine[] | null): number {
  const server = new Set<string>();
  for (const l of lines ?? []) if (l.clientId) server.add(l.clientId);
  let n = lines?.length ?? 0;
  for (const e of entries) if (!server.has(e.clientId)) n++;
  return n;
}

export interface BannerInput {
  /** waiting + sending entries, every audit. */
  pending: number;
  /** failed{confirm|other}. */
  failedOther: number;
  /** failed{closed}. */
  failedClosed: number;
  paused: PauseReason | null;
  /** The last attempt failed on the network (or the browser says offline). */
  networkDown: boolean;
  /** A network failure was seen since the queue last emptied. */
  recovered: boolean;
  /** false = storage is not working; counts cannot survive a reload. */
  persistent: boolean;
}

export type BannerTone = "warn" | "info" | "danger";

export interface Banner {
  tone: BannerTone;
  text: string;
  /** Show the Sign in link. */
  signIn?: boolean;
}

export function bannerFor(b: BannerInput): Banner | null {
  const waiting = b.pending + b.failedOther;
  if (b.paused === "auth" && waiting > 0) return { tone: "warn", text: `Signed out · ${waiting} waiting`, signIn: true };
  if (b.paused === "wrong_user" && waiting > 0) {
    // No Sign-in link: /login sends a signed-in user straight back to their
    // home — they must sign out and back in as the counter who made these.
    return { tone: "warn", text: `Signed in as someone else · ${waiting} waiting` };
  }
  if (b.paused === "forbidden" && waiting > 0) {
    return { tone: "danger", text: `No access to Stock count · ${waiting} waiting` };
  }
  if (b.pending > 0 && b.networkDown) return { tone: "warn", text: `No signal · ${b.pending} waiting` };
  if (b.pending > 0) {
    return { tone: "info", text: b.recovered ? `Back online · sending ${b.pending}` : `Sending ${b.pending}…` };
  }
  if (b.failedOther > 0) return { tone: "danger", text: `${b.failedOther} not sent — open Submitted and tap to retry` };
  if (b.failedClosed > 0) return { tone: "danger", text: `${b.failedClosed} not sent — audit closed` };
  if (!b.persistent) {
    return { tone: "warn", text: "Phone storage is not available — counts are saved online only" };
  }
  return null;
}
