-- ============================================================================
-- sql/2026-11-02-v27.78-stock-audit.sql
-- 2026-11-02 · Stock audit PHASE 1 — stock_audits, stock_audit_counters,
-- stock_audit_lines.
-- RUN 2026-11-02 — VERIFY clean.
--
-- Planned Schema v27.78 (CORE's header and §7 chain read v27.77 on 2026-11-02 —
-- sql/2026-10-24-orders-sample.sql). ⚠ NOT RUN. The version is minted only
-- after the owner runs this file and the VERIFY block (section 6) reads back
-- clean. Prisma is hand-edited AFTER the run, never before (CORE §3).
--
-- PURPOSE. A physical stock count of the Surat depot. A desk user with
-- `stock_audit_manage` opens an audit (SA-0001, SA-0002 …) and assigns counters;
-- each counter holding `stock_audit_count` enters LINES on a phone: one SKU at
-- one spot, with the full working (stack × rows × depth [× pcs per carton]
-- + loose = total pieces). Blind count: a counter sees only their own lines.
-- Same SKU in many places = many lines. That is normal.
--
-- PHASE 1 HAS NO BOOK STOCK. No book qty, no variance, anywhere. Phase 2 adds
-- its own table (e.g. stock_audit_book, keyed (auditId, material)) and joins on
-- the natural key; nothing in this file changes when it arrives.
--
-- THE SKU IS STORED BY NATURAL KEY — "material", the SAP code, as typed —
-- NEVER a catalog row id, and with NO FK to sku_master_v2. sku_master and
-- sku_master_v2 assign completely different ids to the same code (CORE §13,
-- the id-space landmine), and the catalog is maintained by SQL/CSV and may be
-- reseeded. Description and pack are SNAPSHOTS taken at entry (the MRN
-- cartonQty rule): a count taken today must not restate itself if the catalog
-- is edited later.
--
-- ── DECISIONS (Smart Flow, 2026-11-02) ──────────────────────────────────────
--   1. SOFT DELETE. A counter may remove their OWN line while the audit is
--      open: "isRemoved" + "removedAt", both-or-neither (chk_…_removed).
--      Removed lines are excluded from EVERY total, summary, ledger, export
--      and count. Never hard-deleted.
--   2. NOT IN CATALOG. A code not in sku_master_v2 may still be counted.
--      "inCatalog" = false → description and pack may be NULL; "inCatalog" =
--      true → description is NOT NULL and not blank (chk_…_catalog). The
--      material is stored as typed, TRIMMED and UPPER-CASED — enforced here
--      (chk_…_material), not only in the app.
--   3. CARTON RULE — app logic, no DDL. Default mode = 'cartons' when
--      sku_master_v2."piecesPerCarton" > 0, else 'pieces'. The pre-filled
--      carton size is editable; what the counter used is saved on the line.
--      Live 2026-11-02: filled on 703 of 1,743 rows (1L 6–9, 4L 4, 500ML 12,
--      200/100/50ML 12–24; 10L/20L none).
--   4. SEARCH RULE — app logic, no DDL. The typed digits match ANYWHERE in
--      material (01033071 finds IN01033071), minimum 4 characters, active
--      rows only, "isPrimary" first, max 20. EXCLUDE tagged codes
--      (material ~ '^[0-9]+-'): live check found all 19 have a plain twin.
--      Live 2026-11-02: 815 active codes start with letters (all IN + digits),
--      which is why "contains", not "starts with".
--   5. NO REOPEN. Once closed, an audit stays closed (no DDL needed: nothing
--      writes 'closed' → 'open'). Zero-total lines are refused —
--      chk_stock_audit_lines_total requires "totalPcs" > 0.
--
-- ── LIVE FEED: NO TRIGGERS, ON PURPOSE ───────────────────────────────────────
--   CORE §13 says every table a screen reads needs a live_changes trigger. These
--   three are the SECOND documented exception, after freight_*. The live feed
--   speaks order / trip / config entities and /api/live/changes gates on keys
--   (floor, mail_orders, picking, tint_*) no stock counter holds. The desk
--   screen polls GET /api/stock-audit/audits/[id]/marker instead (the Freight
--   Trips pattern: usePickingMarker with its own url, 15 s). CORE §13 must say
--   so in the same commit as the canon update, or a later session will
--   "complete" the trigger list.
--
-- ── NO GRANTS ────────────────────────────────────────────────────────────────
--   No user_page_access rows, no role_permissions rows. The two page keys
--   (stock_audit_count, stock_audit_manage) are ticked per person on
--   /admin/access once they are in ALL_PAGE_KEYS; an absent row reads as
--   all-false (CORE §7.14).
--
-- ── NUMBERING (app logic; the shape is a CHECK here) ────────────────────────
--   "auditNumber" = 'SA-' || lpad(seq, greatest(4, length(seq)), '0').
--   seq = MAX(seq) + 1 over ALL rows (MRN/CI style, never reused), UNIQUE on
--   both seq and "auditNumber" as the backstop; the create route retries once
--   on P2002. greatest(4, …) copies the trips CHECK: Postgres lpad TRUNCATES,
--   so a bare width of 4 would refuse SA-10000.
--
-- ── FKs and ON DELETE ────────────────────────────────────────────────────────
--   stock_audits."createdById"         → users  RESTRICT  (an audit always knows who opened it)
--   stock_audits."closedById"          → users  SET NULL  (the MRN closedById rule)
--   stock_audit_counters."auditId"     → stock_audits CASCADE
--   stock_audit_counters."userId"      → users  RESTRICT
--   stock_audit_counters."addedById"   → users  SET NULL
--   stock_audit_lines."auditId"        → stock_audits RESTRICT (audits are never deleted)
--   stock_audit_lines."countedById"    → users  RESTRICT  (a line always knows its counter)
--   Several FKs reach users from one table → every Prisma relation is NAMED on
--   both sides (StockAuditCreatedBy, StockAuditClosedBy, StockAuditCounterUser,
--   StockAuditCounterAddedBy, StockAuditLineCountedBy).
--   Taking a counter OFF an audit deletes their stock_audit_counters row; their
--   lines survive, because lines point at users, not at that table.
--
-- ── updatedAt ────────────────────────────────────────────────────────────────
--   NOT NULL DEFAULT now() with no trigger, so the DB covers INSERT only.
--   Prisma models both as @updatedAt (the MRN reasoning), so every app UPDATE
--   stamps it — including a soft delete, which is what moves the marker.
--
-- ── HOW TO RUN (Smart Flow, Supabase SQL Editor) ─────────────────────────────
--   The whole file in ONE paste, top to bottom. No BEGIN/COMMIT (CORE §3). The
--   editor shows only the LAST result — the VERIFY block.
--   🔴 SINGLE-RUN FILE. CREATE TABLE is deliberately NOT "IF NOT EXISTS": a
--   half-created table with missing constraints would sail through a re-run.
--   Section 2's guard instead REFUSES the paste if any stock_audit* table
--   already exists. The editor runs a paste as one implicit transaction, so a
--   failure part-way normally leaves NOTHING behind — run the VERIFY block
--   alone to confirm.
--   IF IT HALF-FAILS (VERIFY shows some tables but not all, or a MISSING row):
--   the tables are new and empty, so run section 7 (rollback, commented out)
--   to drop all three, then paste this whole file again. Never patch a
--   half-created table by hand.
--   Never with session_replication_role = replica (CORE §13).
-- ============================================================================


-- ============================================================================
-- 1. TIMEOUT (the postgres role's statement_timeout is 30s).
-- ============================================================================

SET statement_timeout = 0;


-- ============================================================================
-- 2. GUARD — stops the paste before any CREATE if a stock_audit* table exists.
-- Live 2026-11-02: none exist.
-- ============================================================================

DO $$
DECLARE
  v_existing text;
BEGIN
  SELECT string_agg(table_name::text, ', ') INTO v_existing
    FROM information_schema.tables
   WHERE table_schema = 'public' AND table_name LIKE 'stock\_audit%';
  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION 'stock audit v27.78: table(s) already exist: %. This file is single-run — see HOW TO RUN in the header. Nothing was changed.', v_existing;
  END IF;
END
$$;


-- ============================================================================
-- 3. stock_audits — one row per count. Status 'open' → 'closed', never back.
-- ============================================================================

CREATE TABLE stock_audits (
  "id"          serial          NOT NULL,
  "seq"         integer         NOT NULL,
  "auditNumber" text            NOT NULL,
  "status"      text            NOT NULL DEFAULT 'open',
  "createdById" integer         NOT NULL,
  "createdAt"   timestamptz(6)  NOT NULL DEFAULT now(),
  "closedAt"    timestamptz(6),
  "closedById"  integer,
  "updatedAt"   timestamptz(6)  NOT NULL DEFAULT now(),

  CONSTRAINT "stock_audits_pkey"            PRIMARY KEY ("id"),
  CONSTRAINT "stock_audits_seq_key"         UNIQUE ("seq"),
  CONSTRAINT "stock_audits_auditNumber_key" UNIQUE ("auditNumber"),
  CONSTRAINT chk_stock_audits_seq           CHECK ("seq" > 0),
  CONSTRAINT chk_stock_audits_number_shape  CHECK (
    "auditNumber" = 'SA-' || lpad("seq"::text, greatest(4, length("seq"::text)), '0')
  ),
  CONSTRAINT chk_stock_audits_status        CHECK ("status" IN ('open', 'closed')),
  -- closed ⇔ closedAt set. closedById is NOT in this rule: it is SET NULL on a
  -- user delete, and a CHECK on it would make that delete fail.
  CONSTRAINT chk_stock_audits_closed_shape  CHECK (("status" = 'closed') = ("closedAt" IS NOT NULL)),
  CONSTRAINT "stock_audits_createdById_fkey" FOREIGN KEY ("createdById")
    REFERENCES users("id") ON DELETE RESTRICT,
  CONSTRAINT "stock_audits_closedById_fkey"  FOREIGN KEY ("closedById")
    REFERENCES users("id") ON DELETE SET NULL
);

-- The desk rail: open first, newest first.
CREATE INDEX "stock_audits_status_createdAt_idx"
  ON stock_audits ("status", "createdAt" DESC);


-- ============================================================================
-- 4. stock_audit_counters — who may count on an audit. No zones.
-- Holding stock_audit_count is NOT enough on its own: the person must ALSO
-- have a row here (checked server-side on every counter route).
-- ============================================================================

CREATE TABLE stock_audit_counters (
  "id"        serial          NOT NULL,
  "auditId"   integer         NOT NULL,
  "userId"    integer         NOT NULL,
  "addedById" integer,
  "addedAt"   timestamptz(6)  NOT NULL DEFAULT now(),

  CONSTRAINT "stock_audit_counters_pkey"               PRIMARY KEY ("id"),
  CONSTRAINT "stock_audit_counters_auditId_userId_key" UNIQUE ("auditId", "userId"),
  CONSTRAINT "stock_audit_counters_auditId_fkey"   FOREIGN KEY ("auditId")
    REFERENCES stock_audits("id") ON DELETE CASCADE,
  CONSTRAINT "stock_audit_counters_userId_fkey"    FOREIGN KEY ("userId")
    REFERENCES users("id") ON DELETE RESTRICT,
  CONSTRAINT "stock_audit_counters_addedById_fkey" FOREIGN KEY ("addedById")
    REFERENCES users("id") ON DELETE SET NULL
);

-- "Which open audits am I a counter on?" — the phone's first read.
CREATE INDEX "stock_audit_counters_userId_idx"
  ON stock_audit_counters ("userId");


-- ============================================================================
-- 5. stock_audit_lines — one counted spot. Saves ALL the working.
-- ============================================================================

CREATE TABLE stock_audit_lines (
  "id"             serial          NOT NULL,
  "auditId"        integer         NOT NULL,
  "material"       text            NOT NULL,
  "inCatalog"      boolean         NOT NULL,
  "skuDescription" text,
  "skuPack"        text,
  "mode"           text            NOT NULL,
  "stack"          integer         NOT NULL DEFAULT 0,
  "rows"           integer         NOT NULL DEFAULT 0,
  "depth"          integer         NOT NULL DEFAULT 0,
  "pcsPerCarton"   integer,
  "loose"          integer         NOT NULL DEFAULT 0,
  "totalPcs"       integer         NOT NULL,
  "countedById"    integer         NOT NULL,
  "isRemoved"      boolean         NOT NULL DEFAULT false,
  "removedAt"      timestamptz(6),
  "createdAt"      timestamptz(6)  NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz(6)  NOT NULL DEFAULT now(),

  CONSTRAINT "stock_audit_lines_pkey" PRIMARY KEY ("id"),
  -- Decision 2: stored as typed, trimmed + upper-cased, never blank.
  CONSTRAINT chk_stock_audit_lines_material CHECK (
    "material" <> '' AND "material" = upper(btrim("material"))
  ),
  -- Decision 2: a catalogued line carries its description snapshot.
  CONSTRAINT chk_stock_audit_lines_catalog CHECK (
    NOT "inCatalog" OR ("skuDescription" IS NOT NULL AND btrim("skuDescription") <> '')
  ),
  CONSTRAINT chk_stock_audit_lines_mode CHECK ("mode" IN ('pieces', 'cartons')),
  CONSTRAINT chk_stock_audit_lines_nonneg CHECK (
    "stack" >= 0 AND "rows" >= 0 AND "depth" >= 0 AND "loose" >= 0
  ),
  -- Pieces mode carries no carton size; cartons mode needs one > 0.
  CONSTRAINT chk_stock_audit_lines_carton CHECK (
    ("mode" = 'pieces'  AND "pcsPerCarton" IS NULL) OR
    ("mode" = 'cartons' AND "pcsPerCarton" > 0)
  ),
  -- The saved working must add up to the saved total, and the total is > 0
  -- (decision 5). Multiplied in bigint so a huge typo is a clean CHECK
  -- failure, not an integer-overflow error.
  CONSTRAINT chk_stock_audit_lines_total CHECK (
    "totalPcs" > 0 AND
    "totalPcs"::bigint =
      "stack"::bigint * "rows"::bigint * "depth"::bigint
      * COALESCE("pcsPerCarton", 1)::bigint + "loose"::bigint
  ),
  -- Decision 1: removed ⇔ removedAt set.
  CONSTRAINT chk_stock_audit_lines_removed CHECK ("isRemoved" = ("removedAt" IS NOT NULL)),
  CONSTRAINT "stock_audit_lines_auditId_fkey"     FOREIGN KEY ("auditId")
    REFERENCES stock_audits("id") ON DELETE RESTRICT,
  CONSTRAINT "stock_audit_lines_countedById_fkey" FOREIGN KEY ("countedById")
    REFERENCES users("id") ON DELETE RESTRICT
);

-- Plan §3: summary / ledger by SKU (all lines).
CREATE INDEX "stock_audit_lines_auditId_material_idx"
  ON stock_audit_lines ("auditId", "material");

-- Decision 1: every report reads live lines only — summary, ledger, export,
-- stats. The partial index is the one those reads use.
CREATE INDEX "stock_audit_lines_live_auditId_material_idx"
  ON stock_audit_lines ("auditId", "material") WHERE NOT "isRemoved";

-- The phone's Submitted tab: my lines in this audit, newest first.
CREATE INDEX "stock_audit_lines_auditId_countedById_createdAt_idx"
  ON stock_audit_lines ("auditId", "countedById", "createdAt" DESC);

-- The desk marker: MAX("updatedAt") per audit (an edit or a removal moves it).
CREATE INDEX "stock_audit_lines_auditId_updatedAt_idx"
  ON stock_audit_lines ("auditId", "updatedAt" DESC);


-- ============================================================================
-- 6. VERIFY — READ-ONLY, the last statement (the one the editor shows).
-- Expect, with NO 'MISSING' row:
--   stock_audits          9 columns · 9 constraints (p 1 · u 2 · c 4 · f 2) · 4 indexes
--   stock_audit_counters  5 columns · 5 constraints (p 1 · u 1 · f 3)       · 3 indexes
--   stock_audit_lines    18 columns · 10 constraints (p 1 · c 7 · f 2)      · 5 indexes
--   (Indexes include the pkey and UNIQUE indexes. Postgres prints CHECK text in
--   its own normal form — record what comes back in CORE §7, not this file.)
-- ============================================================================

SELECT * FROM (
  -- Columns: type + nullable + default.
  SELECT (CASE c.table_name WHEN 'stock_audits' THEN 1 WHEN 'stock_audit_counters' THEN 2 ELSE 3 END) AS t,
         1 AS kind,
         c.ordinal_position::int AS ord,
         c.table_name::text AS tbl,
         'column'::text AS what,
         c.column_name::text AS name,
         (c.data_type::text || ' · nullable ' || c.is_nullable::text
          || ' · default ' || COALESCE(c.column_default::text, '(none)'))::text AS detail
    FROM information_schema.columns c
   WHERE c.table_schema = 'public'
     AND c.table_name IN ('stock_audits', 'stock_audit_counters', 'stock_audit_lines')

  UNION ALL
  -- Constraints: contype (p/u/c/f) + definition.
  SELECT (CASE r.relname::text WHEN 'stock_audits' THEN 1 WHEN 'stock_audit_counters' THEN 2 ELSE 3 END),
         2,
         0,
         r.relname::text,
         ('constraint · ' || k.contype::text)::text,
         k.conname::text,
         pg_get_constraintdef(k.oid)::text
    FROM pg_constraint k
    JOIN pg_class r ON r.oid = k.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
   WHERE n.nspname = 'public'
     AND r.relname::text IN ('stock_audits', 'stock_audit_counters', 'stock_audit_lines')

  UNION ALL
  -- Indexes: name + definition.
  SELECT (CASE i.tablename::text WHEN 'stock_audits' THEN 1 WHEN 'stock_audit_counters' THEN 2 ELSE 3 END),
         3,
         0,
         i.tablename::text,
         'index'::text,
         i.indexname::text,
         i.indexdef::text
    FROM pg_indexes i
   WHERE i.schemaname = 'public'
     AND i.tablename::text IN ('stock_audits', 'stock_audit_counters', 'stock_audit_lines')

  UNION ALL
  -- Per-table counts, to compare against the Expect block above.
  SELECT (CASE w.tbl WHEN 'stock_audits' THEN 1 WHEN 'stock_audit_counters' THEN 2 ELSE 3 END),
         4,
         0,
         w.tbl,
         'totals'::text,
         'columns · constraints · indexes'::text,
         ((SELECT count(*) FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = w.tbl)::text
          || ' · ' ||
          (SELECT count(*) FROM pg_constraint k
             JOIN pg_class r ON r.oid = k.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'public' AND r.relname::text = w.tbl)::text
          || ' · ' ||
          (SELECT count(*) FROM pg_indexes
            WHERE schemaname = 'public' AND tablename::text = w.tbl)::text)::text
    FROM unnest(ARRAY['stock_audits', 'stock_audit_counters', 'stock_audit_lines']) AS w(tbl)

  UNION ALL
  -- Anything expected that is absent.
  SELECT 9, 9, 0, w.n::text, 'MISSING'::text, w.n::text, NULL::text
    FROM unnest(ARRAY[
      'stock_audits', 'stock_audit_counters', 'stock_audit_lines',
      'stock_audits_pkey', 'stock_audits_seq_key', 'stock_audits_auditNumber_key',
      'chk_stock_audits_seq', 'chk_stock_audits_number_shape', 'chk_stock_audits_status',
      'chk_stock_audits_closed_shape', 'stock_audits_createdById_fkey', 'stock_audits_closedById_fkey',
      'stock_audit_counters_pkey', 'stock_audit_counters_auditId_userId_key',
      'stock_audit_counters_auditId_fkey', 'stock_audit_counters_userId_fkey',
      'stock_audit_counters_addedById_fkey',
      'stock_audit_lines_pkey', 'chk_stock_audit_lines_material', 'chk_stock_audit_lines_catalog',
      'chk_stock_audit_lines_mode', 'chk_stock_audit_lines_nonneg', 'chk_stock_audit_lines_carton',
      'chk_stock_audit_lines_total', 'chk_stock_audit_lines_removed',
      'stock_audit_lines_auditId_fkey', 'stock_audit_lines_countedById_fkey',
      'stock_audits_status_createdAt_idx', 'stock_audit_counters_userId_idx',
      'stock_audit_lines_auditId_material_idx', 'stock_audit_lines_live_auditId_material_idx',
      'stock_audit_lines_auditId_countedById_createdAt_idx', 'stock_audit_lines_auditId_updatedAt_idx'
    ]) AS w(n)
   WHERE NOT EXISTS (SELECT 1 FROM information_schema.tables
                      WHERE table_schema = 'public' AND table_name = w.n)
     AND NOT EXISTS (SELECT 1 FROM pg_constraint k
                       JOIN pg_namespace n ON n.oid = k.connamespace
                      WHERE n.nspname = 'public' AND k.conname::text = w.n)
     AND NOT EXISTS (SELECT 1 FROM pg_indexes
                      WHERE schemaname = 'public' AND indexname::text = w.n)
) v
ORDER BY t, kind, ord, name;


-- ============================================================================
-- 7. ROLLBACK — ⚠ ONLY FOR A HALF-FAILED RUN, OR IF THE OWNER SAYS ROLL BACK,
-- AND ONLY WHILE THE TABLES ARE EMPTY (before any audit is created). Fully
-- commented out. Remove the leading "-- " from each line and run it as one
-- paste. Children first. If Prisma was already edited, revert that too and
-- run `npx prisma generate`.
-- ============================================================================

-- SET statement_timeout = 0;
-- SELECT 'stock_audits' AS t, count(*)::text AS n FROM stock_audits
-- UNION ALL SELECT 'stock_audit_counters', count(*)::text FROM stock_audit_counters
-- UNION ALL SELECT 'stock_audit_lines', count(*)::text FROM stock_audit_lines;   -- expect 0 · 0 · 0
-- DROP TABLE IF EXISTS stock_audit_lines;
-- DROP TABLE IF EXISTS stock_audit_counters;
-- DROP TABLE IF EXISTS stock_audits;
