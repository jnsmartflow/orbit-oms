import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET /api/cron/live-prune
//
// Vercel Cron schedule: "30 21 * * *" UTC = 03:00 IST daily (Hobby: at most once
// a day, fires within the hour — CORE §4). Clear of the other three crons:
// 15:30 UTC load-plan-snapshot (21:00 IST), 18:35 UTC attendance-rollover
// (00:05 IST), 20:30 UTC attendance-purge (02:00 IST).
//
// Deletes live_changes rows older than RETENTION_DAYS (design decision: 3 days,
// docs/prompts/drafts/code-discovery-2026-09-29-live-change-feed.md §C.1) and
// advances live_feed_meta."prunedThroughTxId" — the watermark GET
// /api/live/changes compares a client cursor against ("too old → full load").
//
// 🔴 ONE STATEMENT PER BATCH, AND THE WATERMARK MOVES IN THE SAME STATEMENT AS
// THE DELETE. Data-modifying CTEs commit together, so there is never a moment
// where rows are gone but the watermark does not cover them (which would let a
// client silently miss changes). The watermark only ever moves forward
// (GREATEST), and if the live_feed_meta row is missing the batch deletes
// NOTHING — no watermark, no delete.
//
// Bounded: at most MAX_BATCHES × BATCH rows per run, and it stops starting new
// batches after TIME_BUDGET_MS, so it finishes well inside Vercel's function
// limit and each statement stays far under the role's 30 s statement_timeout
// (CORE §4 — SET LOCAL is unavailable outside a transaction). Expected volume is
// ≤ ~10k rows a day, i.e. one or two batches. Safe to run twice: a second run
// finds nothing older than the cutoff.
//
// The batch statement (xid8 is Unsupported in Prisma → $queryRaw, bound params):
//   WITH batch AS (SELECT seq, "txId" FROM live_changes
//                   WHERE "createdAt" < now() - make_interval(days => $days)
//                     AND EXISTS (SELECT 1 FROM live_feed_meta WHERE id = 'live_changes')
//                   ORDER BY seq LIMIT $batch),
//        mx    AS (SELECT "txId" FROM batch ORDER BY "txId" DESC LIMIT 1),
//        upd   AS (UPDATE live_feed_meta SET "prunedThroughTxId" = GREATEST("prunedThroughTxId", (SELECT "txId" FROM mx)),
//                         "prunedAt" = now(), "updatedAt" = now()
//                   WHERE id = 'live_changes' AND EXISTS (SELECT 1 FROM mx) RETURNING 1),
//        del   AS (DELETE FROM live_changes WHERE seq IN (SELECT seq FROM batch) RETURNING 1)
//   SELECT (SELECT count(*) FROM del)::int AS deleted, (SELECT "txId"::text FROM mx) AS "maxTxId"
// No "createdAt" index by design (sql/2026-09-30-live-changes.sql): a scan of a
// ≤ ~30k-row table once a day is cheaper than indexing every insert.

const RETENTION_DAYS = 3;
const BATCH = 5000;
const MAX_BATCHES = 10;
const TIME_BUDGET_MS = 20_000;

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  let deleted = 0;
  let batches = 0;
  let watermark: string | null = null;

  try {
    while (batches < MAX_BATCHES && Date.now() - startedAt < TIME_BUDGET_MS) {
      const rows = await prisma.$queryRaw<{ deleted: number; maxTxId: string | null }[]>`
        WITH batch AS (
          SELECT seq, "txId" FROM live_changes
           WHERE "createdAt" < now() - make_interval(days => ${RETENTION_DAYS}::int)
             AND EXISTS (SELECT 1 FROM live_feed_meta WHERE id = 'live_changes')
           ORDER BY seq
           LIMIT ${BATCH}::int
        ),
        mx AS (SELECT "txId" FROM batch ORDER BY "txId" DESC LIMIT 1),
        upd AS (
          UPDATE live_feed_meta
             SET "prunedThroughTxId" = GREATEST("prunedThroughTxId", (SELECT "txId" FROM mx)),
                 "prunedAt" = now(),
                 "updatedAt" = now()
           WHERE id = 'live_changes' AND EXISTS (SELECT 1 FROM mx)
          RETURNING 1
        ),
        del AS (DELETE FROM live_changes WHERE seq IN (SELECT seq FROM batch) RETURNING 1)
        SELECT (SELECT count(*) FROM del)::int AS deleted,
               (SELECT "txId"::text FROM mx)   AS "maxTxId"`;
      batches++;
      const n = Number(rows[0]?.deleted ?? 0);
      deleted += n;
      if (rows[0]?.maxTxId) watermark = rows[0].maxTxId;
      if (n < BATCH) break;
    }

    const ms = Date.now() - startedAt;
    console.info(
      `[cron/live-prune] deleted ${deleted} row(s) in ${batches} batch(es), ` +
        `watermark ${watermark ?? "unchanged"}, ${ms} ms`,
    );
    return NextResponse.json({ ok: true, deleted, batches, watermark, ms, retentionDays: RETENTION_DAYS });
  } catch (e) {
    console.error("[cron/live-prune]", e instanceof Error ? e.message.split("\n")[0] : e);
    return NextResponse.json({ ok: false, deleted, batches, error: "prune failed" }, { status: 500 });
  }
}
