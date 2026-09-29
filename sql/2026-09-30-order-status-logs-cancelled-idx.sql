-- sql/2026-09-30-order-status-logs-cancelled-idx.sql — the Floor Cancelled-feed index (Schema v27.46)
--
-- Record: docs/prompts/drafts/code-update-2026-09-30-live-feed-step4.md
-- Why:    docs/prompts/drafts/code-discovery-2026-09-29-disk-io.md §B — /api/floor/cancelled scanned the
--         WHOLE order_status_logs table on every Floor load (the table has only its PK and
--         order_status_logs_orderId_idx).
--
-- THE QUERY IT SERVES (the only reader in app/ or lib/ that filters order_status_logs on "toStage" —
-- swept 2026-09-30): lib/floor/queries.ts getFloorCancelled, step b "Today's cancel logs":
--     WHERE "toStage" = 'cancelled' AND "createdAt" >= <IST day start> AND "createdAt" < <IST day end>
--     ORDER BY "createdAt" DESC
--
-- THE INDEX — PARTIAL, on "createdAt", only for cancel rows:
--     CREATE INDEX order_status_logs_cancelled_created_idx
--       ON order_status_logs ("createdAt") WHERE "toStage" = 'cancelled';
--   · The query's equality term matches the partial predicate exactly, so the planner uses it; the
--     "createdAt" range is the index condition, and ORDER BY "createdAt" DESC is a backward scan of the
--     same index (no sort).
--   · Partial, not ("toStage","createdAt"): order_status_logs is the busiest insert-only table (39
--     write sites — every bill action writes one). A full two-column index would add an entry to
--     EVERY log insert; this one only to the few cancel logs a day, and it stays tiny. The one reader
--     always filters on exactly 'cancelled', so nothing is lost. A future reader of another toStage
--     value would need its own index — recorded in prisma/schema.prisma's order_status_logs comment.
--   · Prisma cannot model a partial index — NOT in @@index; recorded in a schema comment (CORE §7).
--
-- LOCK AND DURATION (plain CREATE INDEX — CONCURRENTLY cannot run in the SQL Editor's multi-statement
-- run): a SHARE lock on order_status_logs for the build. READS carry on; every INSERT into
-- order_status_logs — i.e. most bill actions (assign, done, hold, cancel, imports) — WAITS until the
-- build finishes. The build is one sequential scan of the table plus a sort of only the cancel rows:
-- EST a few seconds on a healthy disk for a table of this size (the pre-check prints the row
-- estimate). RUN IT AFTER HOURS, database healthy.
--
-- HOW TO RUN (Smart Flow)
--   a. The READ-ONLY PRE-CHECK below on its own (un-comment, run, re-comment).
--   b. This file once. Re-runnable (IF NOT EXISTS).
--   c. The last statement is the verification.
--   Optional, read-only, afterwards — confirm the plan uses it:
--     EXPLAIN SELECT "orderId", "createdAt" FROM order_status_logs
--      WHERE "toStage" = 'cancelled' AND "createdAt" >= now() - interval '1 day' AND "createdAt" < now()
--      ORDER BY "createdAt" DESC;
--     → expect "Index Scan Backward using order_status_logs_cancelled_created_idx".
--
-- ROLLBACK
--   DROP INDEX IF EXISTS order_status_logs_cancelled_created_idx;
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- READ-ONLY PRE-CHECK — expect: both columns present · the current indexes (PK + orderId, no
-- *_cancelled_created_idx yet) · a row estimate (sizes the lock window) · the table size.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- SELECT 'column'::text AS chk, column_name::text || ' · ' || data_type::text AS detail
--   FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name = 'order_status_logs' AND column_name IN ('toStage','createdAt')
-- UNION ALL
-- SELECT 'existing index'::text, indexname::text || ' · ' || indexdef::text
--   FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'order_status_logs'
-- UNION ALL
-- SELECT 'row estimate'::text, reltuples::bigint::text FROM pg_class WHERE oid = 'public.order_status_logs'::regclass
-- UNION ALL
-- SELECT 'table size'::text, pg_size_pretty(pg_total_relation_size('public.order_status_logs'))::text;
-- ─────────────────────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS order_status_logs_cancelled_created_idx
  ON order_status_logs ("createdAt")
  WHERE "toStage" = 'cancelled';

-- Verification (read-only): the index definition and its size.
SELECT 'index'::text AS kind, indexname::text AS name, indexdef::text AS detail
  FROM pg_indexes
 WHERE schemaname = 'public' AND tablename = 'order_status_logs'
   AND indexname = 'order_status_logs_cancelled_created_idx'
UNION ALL
SELECT 'size'::text, 'order_status_logs_cancelled_created_idx'::text,
       pg_size_pretty(pg_relation_size('public.order_status_logs_cancelled_created_idx'::regclass))::text;
