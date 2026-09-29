-- sql/2026-09-30-live-changes.sql — LIVE FEED step 1: the change book + the `orders` trigger (Schema v27.45)
--
-- Design of record: docs/prompts/drafts/code-discovery-2026-09-29-live-change-feed.md
--   (§B.4 which tables get triggers, §C the change book, §C.4 the cursor, §H loopholes, §M build order)
-- Record:           docs/prompts/drafts/code-update-2026-09-30-live-changes-step1.md
--
-- WHAT THIS DOES
--   1. Creates `live_changes` — one narrow line per changed entity, written ONLY by database
--      triggers, never by app code. NOTHING READS IT YET: the catch-up API, the prune cron and
--      every screen come in later steps (§M 2-7). Until then it only accumulates (≈ 4-8k rows a
--      day, see the record) — harmless; the 3-day prune arrives with step 2.
--   2. Creates `live_feed_meta` — one row ('live_changes') holding the prune watermark the future
--      catch-up API compares a client cursor against ("too old → full reload").
--   3. Creates three trigger functions and three statement-level AFTER triggers on `orders`
--      (INSERT / UPDATE / DELETE — one per event, each with its own transition table). A
--      statement that touches 300 orders is ONE trigger call and ONE INSERT … SELECT.
--
-- WHAT COUNTS AS A CHANGE (UPDATE)
--   A row is recorded only when the whole row, as jsonb, MINUS "updatedAt", differs between
--   before and after:  (to_jsonb(new) - 'updatedAt') IS DISTINCT FROM (to_jsonb(old) - 'updatedAt').
--   So a no-op UPDATE (same values) and an UPDATE that only moves "updatedAt" write NOTHING.
--   "updatedAt" is the only column excluded: Prisma stamps it on every update, so without the
--   exclusion every Prisma write would count, changed or not. Every other column counts.
--   An order line is `entity='order'`, and — because trip cards count their bills — any recorded
--   order whose "tripDropId" (before OR after) is set also records its trip: `entity='trip'`,
--   via trip_drops."tripId". orders.id never changes (it is the primary key), which the join relies on.
--
-- THE CURSOR (what the future catch-up API will do — design §C.4)
--   Each line stores the writing transaction's id ("txId", xid8, pg_current_xact_id()) and a
--   bigint seq. seq is drawn at INSERT time, NOT at commit, so a plain `seq > lastSeq` would
--   skip a transaction that commits late. The reader instead returns only lines below the
--   commit-safe horizon, ordered by ("txId", seq):
--       WHERE ("txId", seq) > ($cursorTx, $cursorSeq)
--         AND "txId" < pg_snapshot_xmin(pg_current_snapshot())
--       ORDER BY "txId", seq
--   Every transaction older than the snapshot's xmin has finished, so nothing can ever appear
--   below the horizon later. A long-open transaction pauses the feed; it never loses a change.
--
-- 🔴 FAILURE DIRECTION — DELIBERATELY THE OPPOSITE OF THE ACCESS-VERSION TRIGGERS
--   Every function here wraps its work in EXCEPTION WHEN OTHERS → RAISE WARNING → RETURN NULL.
--   A broken change book must NEVER fail an order write: the bill matters, the bell does not,
--   and the screens' safety-net poll / full reload recovers a missed line.
--   sql/2026-09-30-access-notebook.sql does the reverse on purpose (a failed access bump FAILS
--   the access write). Do not "harmonise" the two — each direction is the safe one for its job.
--   (Cost: one subtransaction per orders STATEMENT, not per row.)
--
-- PRIVILEGES
--   Supabase's default privileges grant new public tables to anon / authenticated / service_role.
--   Nothing browser-side uses those roles today (no anon key is published), but the book must
--   never be readable through the REST API, so this file REVOKEs ALL on both tables and on the
--   identity sequence from anon and authenticated. No RLS policies are added. The app reaches
--   the table as `postgres` (Prisma), which owns it; service_role keeps its default grant.
--   The verification row "anon can read live_changes" must say false.
--
-- HOW TO RUN (Smart Flow, Supabase SQL Editor)
--   a. FIRST run the READ-ONLY PRE-CHECK below on its own (un-comment it, run, re-comment).
--   b. Then run this whole file ONCE, top to bottom, with the database healthy (after hours).
--      It is re-runnable: IF NOT EXISTS / ON CONFLICT DO NOTHING / CREATE OR REPLACE /
--      DROP TRIGGER IF EXISTS throughout.
--   c. The last statement is the verification (one UNION ALL result).
--   d. Then run sql/2026-09-30-live-changes-TEST.sql — it proves the trigger and leaves no trace
--      (its final ERROR "TEST OK — rolled back" is the success signal).
--
-- KILL SWITCH (run on its own; instant, no deploy — orders writes carry on untouched)
--   ALTER TABLE orders DISABLE TRIGGER trg_live_changes_orders_ins;
--   ALTER TABLE orders DISABLE TRIGGER trg_live_changes_orders_upd;
--   ALTER TABLE orders DISABLE TRIGGER trg_live_changes_orders_del;
--   -- back on:
--   ALTER TABLE orders ENABLE TRIGGER trg_live_changes_orders_ins;
--   ALTER TABLE orders ENABLE TRIGGER trg_live_changes_orders_upd;
--   ALTER TABLE orders ENABLE TRIGGER trg_live_changes_orders_del;
--
-- FULL ROLLBACK (nothing reads these objects yet, so removing them breaks nothing)
--   DROP TRIGGER IF EXISTS trg_live_changes_orders_ins ON orders;
--   DROP TRIGGER IF EXISTS trg_live_changes_orders_upd ON orders;
--   DROP TRIGGER IF EXISTS trg_live_changes_orders_del ON orders;
--   DROP FUNCTION IF EXISTS live_changes_orders_ins();
--   DROP FUNCTION IF EXISTS live_changes_orders_upd();
--   DROP FUNCTION IF EXISTS live_changes_orders_del();
--   DROP TABLE IF EXISTS live_feed_meta;
--   DROP TABLE IF EXISTS live_changes;
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- READ-ONLY PRE-CHECK — run on its own FIRST (un-comment, run, re-comment). Expect:
--   · pg_version 13 or higher (xid8, pg_current_xact_id, pg_snapshot_xmin are PG 13+)
--   · a btree operator class for xid8 (the ("txId", seq) index needs it)
--   · orders columns id / "tripDropId" / "updatedAt" and trip_drops columns id / "tripId"
--   · NO existing live_changes / live_feed_meta tables and NO trg_live_changes_* triggers
--   · the list of triggers already on orders (expected: none)
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- SELECT 'pg_version' AS chk, current_setting('server_version')::text AS detail
-- UNION ALL
-- SELECT 'xid8 btree opclass', opcname::text FROM pg_opclass c JOIN pg_am a ON a.oid = c.opcmethod
--  WHERE a.amname = 'btree' AND c.opcintype = 'xid8'::regtype
-- UNION ALL
-- SELECT 'column', table_name::text || '.' || column_name::text || ' · ' || data_type::text
--   FROM information_schema.columns
--  WHERE table_schema = 'public'
--    AND ((table_name = 'orders' AND column_name IN ('id','tripDropId','updatedAt'))
--      OR (table_name = 'trip_drops' AND column_name IN ('id','tripId')))
-- UNION ALL
-- SELECT 'table already exists (expect none)', table_name::text FROM information_schema.tables
--  WHERE table_schema = 'public' AND table_name IN ('live_changes','live_feed_meta')
-- UNION ALL
-- SELECT 'trigger on orders (expect none)', tgname::text || ' · enabled = ' || tgenabled::text
--   FROM pg_trigger WHERE tgrelid = 'public.orders'::regclass AND NOT tgisinternal;
-- ─────────────────────────────────────────────────────────────────────────────────────────────

-- 1. The change book.
CREATE TABLE IF NOT EXISTS live_changes (
  seq           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "txId"        xid8        NOT NULL DEFAULT pg_current_xact_id(),
  entity        text        NOT NULL,
  "entityId"    text        NOT NULL,
  op            text        NOT NULL,
  "sourceTable" text        NOT NULL,
  "createdAt"   timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT chk_live_changes_entity CHECK (entity IN ('order', 'trip', 'config')),
  CONSTRAINT chk_live_changes_op     CHECK (op IN ('I', 'U', 'D'))
);

-- The ONLY secondary index: the catch-up read is a range scan on ("txId", seq) with a row
-- comparison and ORDER BY "txId", seq. The PK covers seq alone. No "createdAt" index: the daily
-- prune (step 2) deletes ≤ ~10k rows from a ≤ ~30k-row table once a day — a scan is cheaper than
-- maintaining an index on every insert.
CREATE INDEX IF NOT EXISTS live_changes_tx_seq_idx ON live_changes ("txId", seq);

-- 2. The prune watermark (one row). The prune job (step 2) sets "prunedThroughTxId" to the
--    highest "txId" it deleted; a client cursor older than that gets "reset" (one full reload).
CREATE TABLE IF NOT EXISTS live_feed_meta (
  id                  text PRIMARY KEY,
  "prunedThroughTxId" xid8,
  "prunedAt"          timestamptz(6),
  "updatedAt"         timestamptz(6) NOT NULL DEFAULT now()
);
INSERT INTO live_feed_meta (id) VALUES ('live_changes') ON CONFLICT (id) DO NOTHING;

-- 3. Privileges — never readable or writable through the REST API roles.
REVOKE ALL ON TABLE live_changes   FROM anon, authenticated;
REVOKE ALL ON TABLE live_feed_meta FROM anon, authenticated;
DO $$
DECLARE s text := pg_get_serial_sequence('public.live_changes', 'seq');
BEGIN
  IF s IS NOT NULL THEN
    EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM anon, authenticated', s);
  END IF;
END
$$;

-- 4. The trigger functions. One per event, because each event has its own transition table
--    (INSERT: new rows only · DELETE: old rows only · UPDATE: both). Every body is wrapped so a
--    failure only WARNs — see "FAILURE DIRECTION" above.
CREATE OR REPLACE FUNCTION live_changes_orders_ins() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    INSERT INTO live_changes (entity, "entityId", op, "sourceTable")
    SELECT 'order', n.id::text, 'I', 'orders' FROM lc_new n
    UNION ALL
    SELECT DISTINCT 'trip', d."tripId"::text, 'U', 'orders'
      FROM lc_new n JOIN trip_drops d ON d.id = n."tripDropId";
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'live_changes: orders INSERT not recorded (% %) — the order write itself succeeded', SQLSTATE, SQLERRM;
  END;
  RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION live_changes_orders_upd() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    WITH changed AS (
      SELECT n.id, n."tripDropId" AS new_drop, o."tripDropId" AS old_drop
        FROM lc_new n
        JOIN lc_old o ON o.id = n.id
       WHERE (to_jsonb(n) - 'updatedAt') IS DISTINCT FROM (to_jsonb(o) - 'updatedAt')
    ),
    drops AS (
      SELECT new_drop AS drop_id FROM changed WHERE new_drop IS NOT NULL
      UNION
      SELECT old_drop FROM changed WHERE old_drop IS NOT NULL
    )
    INSERT INTO live_changes (entity, "entityId", op, "sourceTable")
    SELECT 'order', c.id::text, 'U', 'orders' FROM changed c
    UNION ALL
    SELECT DISTINCT 'trip', d."tripId"::text, 'U', 'orders'
      FROM drops x JOIN trip_drops d ON d.id = x.drop_id;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'live_changes: orders UPDATE not recorded (% %) — the order write itself succeeded', SQLSTATE, SQLERRM;
  END;
  RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION live_changes_orders_del() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    INSERT INTO live_changes (entity, "entityId", op, "sourceTable")
    SELECT 'order', o.id::text, 'D', 'orders' FROM lc_old o
    UNION ALL
    SELECT DISTINCT 'trip', d."tripId"::text, 'U', 'orders'
      FROM lc_old o JOIN trip_drops d ON d.id = o."tripDropId";
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'live_changes: orders DELETE not recorded (% %) — the order write itself succeeded', SQLSTATE, SQLERRM;
  END;
  RETURN NULL;
END
$$;

-- 5. The triggers — statement-level AFTER, one per event, each with its transition table(s).
DROP TRIGGER IF EXISTS trg_live_changes_orders_ins ON orders;
CREATE TRIGGER trg_live_changes_orders_ins
  AFTER INSERT ON orders
  REFERENCING NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_orders_ins();

DROP TRIGGER IF EXISTS trg_live_changes_orders_upd ON orders;
CREATE TRIGGER trg_live_changes_orders_upd
  AFTER UPDATE ON orders
  REFERENCING OLD TABLE AS lc_old NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_orders_upd();

DROP TRIGGER IF EXISTS trg_live_changes_orders_del ON orders;
CREATE TRIGGER trg_live_changes_orders_del
  AFTER DELETE ON orders
  REFERENCING OLD TABLE AS lc_old
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_orders_del();

-- 6. Verification (read-only). The SQL Editor shows only the last result, so everything comes
--    back together. Expect: 2 tables · 11 columns · 3 indexes (2 pkeys + live_changes_tx_seq_idx)
--    · 2 CHECKs · 3 triggers each enabled = O · the meta row · "anon can read live_changes = false"
--    · a row count (0, or more if orders were written since step 5 ran).
SELECT 'table'::text AS kind, table_name::text AS name, ''::text AS detail
  FROM information_schema.tables
 WHERE table_schema = 'public' AND table_name IN ('live_changes', 'live_feed_meta')
UNION ALL
SELECT 'column', table_name::text || '.' || column_name::text,
       data_type::text || ' · nullable = ' || is_nullable::text || ' · default = ' || coalesce(column_default, 'none')::text
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name IN ('live_changes', 'live_feed_meta')
UNION ALL
SELECT 'index', indexname::text, indexdef::text
  FROM pg_indexes
 WHERE schemaname = 'public' AND tablename IN ('live_changes', 'live_feed_meta')
UNION ALL
SELECT 'constraint', conname::text, pg_get_constraintdef(oid)::text
  FROM pg_constraint
 WHERE conrelid = 'public.live_changes'::regclass AND contype = 'c'
UNION ALL
SELECT 'trigger', tgname::text, (tgrelid::regclass)::text || ' · enabled = ' || tgenabled::text
  FROM pg_trigger
 WHERE tgname LIKE 'trg_live_changes_%'
UNION ALL
SELECT 'meta row', id::text, coalesce("prunedThroughTxId"::text, 'no prune yet')
  FROM live_feed_meta
UNION ALL
SELECT 'privilege', 'anon can read live_changes', has_table_privilege('anon', 'public.live_changes', 'SELECT')::text
UNION ALL
SELECT 'rows', 'live_changes', count(*)::text
  FROM live_changes
ORDER BY 1, 2;
