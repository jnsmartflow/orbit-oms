// lib/live/feed.ts — server-side reads for the live change feed (Node only).
//
// Design of record: docs/prompts/drafts/code-discovery-2026-09-29-live-change-feed.md §C.4, §F.1
// Pure helpers (cursor, grouping, switch parsing): lib/live/cursor.ts
// Table: sql/2026-09-30-live-changes.sql — "txId" is xid8, which Prisma 5 cannot
// model (Unsupported), so every read here is $queryRaw with bound parameters and
// every xid8 / bigint is cast to ::text for transport (never a BigInt in JSON).
//
// Sequential awaits only (CORE §3 — never prisma.$transaction).

import { prisma } from "@/lib/prisma";
import {
  LIVE_FEED_KEY,
  LIVE_FEED_BILLING_KEY,
  parseLiveFeedSwitch,
  type Cursor,
  type LiveRow,
  type LiveTopic,
} from "@/lib/live/cursor";

// ── The kill switch ─────────────────────────────────────────────────────────
// app_settings "settingKey" = 'live.feed' (the same per-flag table and read
// style as the pick gate, lib/picking/visibility-gate.ts). OFF unless the row
// exists with isEnabled = true. Cached per server instance for 30 s, so a flip
// lands everywhere within ~30 s and a busy poll costs at most one read per
// instance per 30 s. A READ ERROR → OFF, cached for the TTL — the feed is an
// optimisation, so failing it off is always safe (screens keep their old poll).
const SWITCH_TTL_MS = 30_000;
// One cache entry per settingKey (2026-09-30: 'live.feed' and 'live.feed.billing').
const switchCache = new Map<string, { on: boolean; at: number }>();

async function isSwitchOn(settingKey: string): Promise<boolean> {
  const now = Date.now();
  const hit = switchCache.get(settingKey);
  if (hit && now - hit.at < SWITCH_TTL_MS) return hit.on;
  let on = false;
  try {
    const row = await prisma.app_settings.findUnique({
      where:  { settingKey },
      select: { isEnabled: true },
    });
    on = parseLiveFeedSwitch(row);
  } catch (err) {
    console.error(`[live] could not read the ${settingKey} switch; treating it as OFF:`, err);
    on = false;
  }
  switchCache.set(settingKey, { on, at: now });
  return on;
}

/** The global kill switch — every screen's feed. Unchanged behaviour. */
export async function isLiveFeedOn(): Promise<boolean> {
  return isSwitchOn(LIVE_FEED_KEY);
}

/**
 * Billing's feed: 'live.feed' AND 'live.feed.billing' (absent = OFF). The global switch is read
 * first, so with it OFF the Billing key is never read (the caller's "reading nothing").
 */
export async function isBillingFeedOn(): Promise<boolean> {
  if (!(await isLiveFeedOn())) return false;
  return isSwitchOn(LIVE_FEED_BILLING_KEY);
}

// ── Horizon, watermark and lag (one small statement, no live_changes read) ──
//
//   SELECT pg_snapshot_xmin(pg_current_snapshot())::text               AS horizon,
//          (SELECT "prunedThroughTxId"::text FROM live_feed_meta
//            WHERE id = 'live_changes')                                 AS pruned,
//          (SELECT coalesce(extract(epoch FROM now() - min(xact_start)), 0)
//             FROM pg_stat_activity
//            WHERE backend_xid IS NOT NULL AND pid <> pg_backend_pid()) AS lag
//
// horizon — every transaction with a smaller id has finished; the next cursor
//   for a caller with no cursor (or a reset one) is (horizon, 0).
// pruned  — live_feed_meta watermark; a cursor at or below it is "too old".
// lag     — seconds the oldest transaction still holding an xid has been open.
//   That transaction is what holds the horizon back, so this is how long the
//   feed can currently be delayed (~0 normally). pg_stat_activity only shows
//   xact_start for sessions this role may see, so it can under-report; it is a
//   hint for a "delayed" chip, never used for correctness.
export interface FeedMeta {
  horizon: string;
  pruned: string | null;
  lagSeconds: number;
}

export async function readFeedMeta(): Promise<FeedMeta> {
  const rows = await prisma.$queryRaw<{ horizon: string; pruned: string | null; lag: number | string | null }[]>`
    SELECT pg_snapshot_xmin(pg_current_snapshot())::text AS horizon,
           (SELECT "prunedThroughTxId"::text FROM live_feed_meta WHERE id = 'live_changes') AS pruned,
           (SELECT coalesce(extract(epoch FROM now() - min(xact_start)), 0)::float8
              FROM pg_stat_activity
             WHERE backend_xid IS NOT NULL AND pid <> pg_backend_pid()) AS lag`;
  const r = rows[0];
  const lag = r?.lag === null || r?.lag === undefined ? 0 : Number(r.lag);
  return {
    horizon: r?.horizon ?? "0",
    pruned: r?.pruned ?? null,
    lagSeconds: Number.isFinite(lag) ? Math.max(0, Math.round(lag)) : 0,
  };
}

// ── The one live_changes read per request ───────────────────────────────────
//
//   WITH h AS (SELECT pg_snapshot_xmin(pg_current_snapshot()) AS xmin)
//   SELECT h.xmin::text AS horizon, r.seq::text, r."txId"::text, r.entity, r."entityId"
//     FROM h
//     LEFT JOIN LATERAL (
//       SELECT lc.seq, lc."txId", lc.entity, lc."entityId"
//         FROM live_changes lc
//        WHERE (lc."txId", lc.seq) > ($cursorTx::xid8, $cursorSeq::bigint)
//          AND lc."txId" < h.xmin
//          AND lc.entity = ANY ($topics::text[])
//        ORDER BY lc."txId", lc.seq
//        LIMIT $limitPlusOne
//     ) r ON true
//
// Index: live_changes_tx_seq_idx ("txId", seq) — the row comparison and the
// `"txId" < xmin` bound are both index conditions, and the ORDER BY matches the
// index, so this is one bounded index range scan; `entity` is filtered on the
// rows the scan visits. The LEFT JOIN LATERAL returns exactly one row (null
// columns) when nothing is new, so the horizon THIS statement used always
// comes back — that is the horizon the next cursor may jump to, and it must be
// the same snapshot the rows were read under.
export async function readChangesAfter(args: {
  after: Cursor;
  topics: LiveTopic[];
  limitPlusOne: number;
}): Promise<{ horizon: string; rows: LiveRow[] }> {
  const { after, topics, limitPlusOne } = args;
  const result = await prisma.$queryRaw<
    { horizon: string; seq: string | null; txId: string | null; entity: string | null; entityId: string | null }[]
  >`
    WITH h AS (SELECT pg_snapshot_xmin(pg_current_snapshot()) AS xmin)
    SELECT h.xmin::text AS horizon,
           r.seq::text   AS seq,
           r."txId"::text AS "txId",
           r.entity       AS entity,
           r."entityId"   AS "entityId"
      FROM h
      LEFT JOIN LATERAL (
        SELECT lc.seq, lc."txId", lc.entity, lc."entityId"
          FROM live_changes lc
         WHERE (lc."txId", lc.seq) > (${after.txId}::xid8, ${after.seq}::bigint)
           AND lc."txId" < h.xmin
           AND lc.entity = ANY (${topics}::text[])
         ORDER BY lc."txId", lc.seq
         LIMIT ${limitPlusOne}::int
      ) r ON true`;
  const horizon = result[0]?.horizon ?? after.txId;
  const rows: LiveRow[] = [];
  for (const r of result) {
    if (r.seq === null || r.txId === null || r.entity === null || r.entityId === null) continue;
    rows.push({ seq: r.seq, txId: r.txId, entity: r.entity, entityId: r.entityId });
  }
  return { horizon, rows };
}
