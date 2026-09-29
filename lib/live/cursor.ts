// lib/live/cursor.ts — PURE helpers for the live change feed's cursor and
// response shaping. No Prisma, no clock — unit-tested by lib/live/live.test.ts.
//
// Design of record: docs/prompts/drafts/code-discovery-2026-09-29-live-change-feed.md §C.4, §F.1
// Table:            sql/2026-09-30-live-changes.sql (live_changes: seq, "txId" xid8, entity, "entityId")
//
// ── THE CURSOR ──────────────────────────────────────────────────────────────
// An OPAQUE string to clients: "v1.<txId>.<seq>", both parts plain decimal
// (xid8 prints as an unsigned 64-bit decimal; seq is a bigint identity).
//   · Ordered by (txId, seq) — NEVER by seq alone. seq is drawn at INSERT time,
//     not at commit, so `seq > lastSeq` would skip a transaction that commits
//     late (§C.4).
//   · The server only ever hands out cursors at or below the commit-safe
//     horizon pg_snapshot_xmin(pg_current_snapshot()), so nothing can later
//     appear behind a cursor it has handed out.
//   · "v1." lets the format change later without misreading an old cursor.
// Both numbers stay STRINGS end to end (JSON cannot carry a 64-bit integer, and
// a BigInt must never reach JSON.stringify — CORE §7.13). Comparison is done on
// the decimal strings (compareDecimal), so no BigInt is needed at all.

export interface Cursor {
  /** xid8 as an unsigned decimal string. */
  txId: string;
  /** bigint seq as an unsigned decimal string. */
  seq: string;
}

const CURSOR_RE = /^v1\.(\d{1,20})\.(\d{1,20})$/;

/** Strip leading zeros so equal numbers compare equal ("007" → "7", "0" stays "0"). */
function norm(d: string): string {
  const s = d.replace(/^0+/, "");
  return s === "" ? "0" : s;
}

export function encodeCursor(c: Cursor): string {
  return `v1.${norm(c.txId)}.${norm(c.seq)}`;
}

/** null for anything that is not a well-formed v1 cursor. */
export function decodeCursor(raw: string | null | undefined): Cursor | null {
  if (typeof raw !== "string") return null;
  const m = CURSOR_RE.exec(raw.trim());
  if (!m) return null;
  return { txId: norm(m[1]), seq: norm(m[2]) };
}

/** Compare two unsigned decimal strings: -1, 0 or 1. */
export function compareDecimal(a: string, b: string): number {
  const x = norm(a);
  const y = norm(b);
  if (x.length !== y.length) return x.length < y.length ? -1 : 1;
  if (x === y) return 0;
  return x < y ? -1 : 1;
}

/** Compare two cursors by (txId, seq). */
export function compareCursor(a: Cursor, b: Cursor): number {
  return compareDecimal(a.txId, b.txId) || compareDecimal(a.seq, b.seq);
}

export function maxCursor(...cs: Cursor[]): Cursor {
  return cs.reduce((best, c) => (compareCursor(c, best) > 0 ? c : best));
}

/** The cursor that means "everything before the horizon has been seen". */
export function horizonCursor(horizonTxId: string): Cursor {
  return { txId: norm(horizonTxId), seq: "0" };
}

// ── TOPICS ──────────────────────────────────────────────────────────────────
// The entities live_changes can carry (chk_live_changes_entity).
export const LIVE_TOPICS = ["order", "trip", "config"] as const;
export type LiveTopic = (typeof LIVE_TOPICS)[number];

/**
 * `?topics=order,trip` → the known topics, de-duplicated, in canonical order.
 * Absent / blank → every topic. Unknown names are ignored; null when the param
 * was given but named no known topic (the route answers 400).
 */
export function parseTopics(raw: string | null | undefined): LiveTopic[] | null {
  if (raw === null || raw === undefined || raw.trim() === "") return [...LIVE_TOPICS];
  const asked = new Set(raw.split(",").map((t) => t.trim().toLowerCase()));
  const topics = LIVE_TOPICS.filter((t) => asked.has(t));
  return topics.length > 0 ? topics : null;
}

export const DEFAULT_LIMIT = 500;
export const MAX_LIMIT = 1000;

/** `?limit=` → an integer in [1, MAX_LIMIT]; absent or junk → DEFAULT_LIMIT. */
export function parseLimit(raw: string | null | undefined): number {
  if (raw === null || raw === undefined || raw.trim() === "") return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, n));
}

// ── RESPONSE SHAPING ────────────────────────────────────────────────────────

export interface LiveRow {
  seq: string;
  txId: string;
  entity: string;
  entityId: string;
}

export interface LiveGroup {
  entity: string;
  /** order / trip ids as numbers; config entries (table names) as strings. */
  ids: (number | string)[];
}

/**
 * Group rows by entity and de-duplicate ids, keeping first-seen order. Entity
 * groups come out in LIVE_TOPICS order; an entity with no rows is omitted.
 * Ids only — never business data.
 */
export function groupChanges(rows: LiveRow[]): LiveGroup[] {
  const byEntity = new Map<string, (number | string)[]>();
  const seen = new Map<string, Set<string>>();
  for (const r of rows) {
    let ids = byEntity.get(r.entity);
    let set = seen.get(r.entity);
    if (!ids || !set) {
      ids = [];
      set = new Set<string>();
      byEntity.set(r.entity, ids);
      seen.set(r.entity, set);
    }
    if (set.has(r.entityId)) continue;
    set.add(r.entityId);
    const asInt = /^\d{1,15}$/.test(r.entityId) && r.entity !== "config" ? Number(r.entityId) : null;
    ids.push(asInt !== null ? asInt : r.entityId);
  }
  const order: string[] = [...LIVE_TOPICS];
  return Array.from(byEntity.entries())
    .sort(([a], [b]) => {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      return (ia === -1 ? order.length : ia) - (ib === -1 ? order.length : ib);
    })
    .map(([entity, ids]) => ({ entity, ids }));
}

/**
 * The cursor to hand back after a read.
 *   · page FULL (limit + 1 rows came back → `more`): the last row RETURNED —
 *     the next call continues right after it;
 *   · page NOT full: everything below the horizon has now been seen, so jump
 *     to (horizon, 0) — never backwards past the caller's own cursor.
 */
export function nextCursor(args: {
  after: Cursor;
  returned: LiveRow[];
  more: boolean;
  horizonTxId: string;
}): Cursor {
  const { after, returned, more, horizonTxId } = args;
  const last = returned.length > 0 ? returned[returned.length - 1] : null;
  const lastCursor: Cursor | null = last ? { txId: last.txId, seq: last.seq } : null;
  if (more && lastCursor) return maxCursor(after, lastCursor);
  const candidates: Cursor[] = [after, horizonCursor(horizonTxId)];
  if (lastCursor) candidates.push(lastCursor);
  return maxCursor(...candidates);
}

/**
 * "Too old": the log has been pruned past this cursor, so changes the caller
 * never saw may be gone — the caller must do one full load. Inclusive (<=):
 * a prune batch can stop part-way through one transaction's rows, so a cursor
 * sitting ON the pruned txId may have lost rows of that transaction after its
 * seq. Conservative by design: a needless reset costs one full load, a missed
 * one costs a stale screen.
 */
export function isPrunedPast(after: Cursor, prunedThroughTxId: string | null): boolean {
  if (prunedThroughTxId === null) return false;
  return compareDecimal(after.txId, prunedThroughTxId) <= 0;
}

// ── THE HEAD CACHE (live feed 7a, 2026-09-30) ───────────────────────────────
// Per server instance, GET /api/live/changes remembers the latest SAFE head it
// handed out — a cursor from a read that was NOT full (so everything below that
// statement's horizon had been returned), or the head it gave a new caller —
// for HEAD_CACHE_TTL_MS. A caller whose cursor EQUALS that head within the TTL
// is answered "no changes" with its OWN cursor, without touching live_changes.
//
// WHY IT CANNOT SKIP A CHANGE: the cached answer never moves the caller's
// cursor. Anything committed in those ≤ 5 s is either below the old horizon
// (impossible — every transaction below it had already finished and was read)
// or at/above it, and the next uncached call reads everything after the
// unchanged cursor. The only effect is up to TTL of extra delay. It also never
// needs the prune check: a cursor that is a head handed out ≤ 5 s ago is days
// newer than anything the 3-day prune can delete.
export const HEAD_CACHE_TTL_MS = 5_000;

export interface HeadCache {
  /** Remember a safe head (only from a non-full read or a fresh-head answer). */
  remember(head: Cursor, lagSeconds: number): void;
  /** The cached lag if `after` IS the cached head and the entry is fresh; else null. */
  hit(after: Cursor): { lagSeconds: number } | null;
  clear(): void;
}

export function createHeadCache(now: () => number, ttlMs: number = HEAD_CACHE_TTL_MS): HeadCache {
  let entry: { head: Cursor; lagSeconds: number; at: number } | null = null;
  return {
    remember(head, lagSeconds) {
      entry = { head, lagSeconds, at: now() };
    },
    hit(after) {
      if (!entry) return null;
      const age = now() - entry.at;
      if (age < 0 || age >= ttlMs) return null;
      return compareCursor(after, entry.head) === 0 ? { lagSeconds: entry.lagSeconds } : null;
    },
    clear() {
      entry = null;
    },
  };
}

// ── THE SWITCH ──────────────────────────────────────────────────────────────
/** app_settings "settingKey" for the live feed kill switch. Never retype it. */
export const LIVE_FEED_KEY = "live.feed";

/** ON only for a row whose isEnabled is exactly true; no row / null / false → OFF. */
export function parseLiveFeedSwitch(row: { isEnabled: boolean | null } | null | undefined): boolean {
  return row?.isEnabled === true;
}
