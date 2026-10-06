-- ═══════════════════════════════════════════════════════════════════════════
-- Challan Orders · Phase 1 · slice 1 — DDL                       (Schema v27.60)
-- 2026-10-06 · design: docs/prompts/drafts/web-update-2026-10-06-challan-orders.md
-- plan of record:      docs/prompts/drafts/code-plan-2026-10-06-challan-slice1.md
--
-- ✅ RUN on live 2026-10-06 by owner — verification passed (12 rows):
--    2 orders columns · 12 link-table columns · 13 constraints · 4 indexes ·
--    3 triggers enabled 'O' · data 0 / 0 / 0 · RLS false / false (matches orders).
--    The owner ran the web-reviewed copy: this file's DDL, a shortened header,
--    and PART 5 row 12 (RLS parity), which is now appended below. The LIVE
--    database is the source of truth for this DDL.
-- ⚠ Drafted as "v27.59"; that number was minted the same day for
--    mo_orders_soNumber_idx (222913d2), so this slice is v27.60.
--
-- Run in the Supabase SQL Editor, top to bottom, as ONE paste.
-- NO transaction wrapper — BEGIN/COMMIT fails silently there (CORE §3).
-- camelCase identifiers, quoted. No @map anywhere.
--
-- Re-runnable: columns / tables / indexes are IF NOT EXISTS; constraints and
-- triggers are added inside DO blocks that first look them up in the catalog.
-- ⚠ IF NOT EXISTS skips an object that already exists WHATEVER its shape —
-- the read-back in PART 5 is what catches a mismatch. Read it.
--
-- Additive only. NOTHING existing is dropped, altered or deleted. No data is
-- written: no backfill, no user_page_access rows (access is slice 9).
--
-- WHAT IS NOT IN THIS FILE, ON PURPOSE
--   • The print log (D7 parked).
--   • The new status value — it needs NO DDL. It is a workflowStage value,
--     'challan_linked', and orders.workflowStage carries NO CHECK constraint
--     (live, below). Plan §2 says why workflowStage and not dispatchStatus.
--   • Page keys — they live in TypeScript only (the PageKey union in
--     lib/permissions.ts). There is no page-key table and no FK on
--     user_page_access."pageKey" (CORE §7.14). Nothing to create here.
--   • ORB numbering — needs no DDL. ORB-{YYYY}-{NNNNN} is written into
--     orders."obdNumber", whose live UNIQUE orders_obdNumber_key already
--     rejects a clash (allocate → insert → on P2002 retry once, in code).
--
-- LIVE PRE-CHECK (read-only, 2026-10-06, pooler):
--   orders: 17,175 rows · constraints c/u/x = ONLY orders_obdNumber_key
--           UNIQUE ("obdNumber") — no CHECK on any column
--   orders."workflowStage" text NOT NULL DEFAULT 'order_created'
--   orders."dispatchStatus" text NULL, values: dispatch 14,660 · <null> 2,355 · hold 160
--   orders."obdNumber" text NULL (Prisma: required) · 0 start 'ORB-'
--   orders.id / users.id integer
--   no table, column or constraint named %challan_order% (only the existing
--     delivery_challans / delivery_challan_formulas)
--   order_status_logs: no CHECK constraint
--   orders already has 3 live-feed triggers (trg_live_changes_orders_*) — enabled 'O'
--   live_changes_child_{ins,upd,del}() exist; chk_live_changes_entity admits 'order'
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- PART 1 — orders: the challan flag and the link back to the ORB order
-- ───────────────────────────────────────────────────────────────────────────
--
-- "isChallanOrder" — TRUE on an ORB order (the challan itself, created on
-- desktop /place-order). NOT NULL DEFAULT false so every existing row reads
-- false and a predicate can say { isChallanOrder: false } with no NULL arm
-- (CORE §13, NULL three-valued logic). On PG 11+ an ADD COLUMN with a constant
-- default is a catalog change, not a table rewrite: no row is touched, so the
-- orders live-feed UPDATE trigger does not fire.
--
-- "challanOrderId" — set on the SAP OBD row that billing linked to a challan:
-- it points at the ORB order. A SELF-relation, so Prisma must name it on BOTH
-- sides ("OrderChallanOrder", plan §3). NULL on every other bill.
-- This column is the per-OBD link (one SO can yield several OBDs — 225 SOs had
-- more than one live OBD in the last 90 days, live 2026-10-06).

ALTER TABLE orders ADD COLUMN IF NOT EXISTS "isChallanOrder" boolean NOT NULL DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS "challanOrderId" integer;

-- RESTRICT: orders are soft-deleted (isRemoved), never hard-deleted. A delete
-- of an ORB order that SAP bills point at must FAIL, never orphan them.
-- Name = Prisma's default, so the model needs no `map:`.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'orders_challanOrderId_fkey'
                    AND conrelid = 'public.orders'::regclass) THEN
    ALTER TABLE orders
      ADD CONSTRAINT "orders_challanOrderId_fkey"
      FOREIGN KEY ("challanOrderId") REFERENCES orders("id") ON DELETE RESTRICT;
  END IF;
END $$;

-- Backs the FK (Postgres does not index the referencing side) and the
-- "which SAP OBDs belong to this challan" read on every Billed / History row.
-- Name = Prisma's default for @@index([challanOrderId]). A plain CREATE INDEX
-- takes a SHARE lock on orders for the build — 17k rows, well under a second,
-- but it blocks order writes while it runs: run outside import hours.
CREATE INDEX IF NOT EXISTS "orders_challanOrderId_idx" ON orders ("challanOrderId");

-- The FIRST CHECK constraints on orders. Each validates all 17,175 rows once
-- (an ACCESS EXCLUSIVE lock for the scan — milliseconds at this size); every
-- live row passes (both new columns are false/NULL, 0 obdNumbers start 'ORB-').
DO $$
BEGIN
  -- A row is EITHER a challan (ORB) order OR a SAP bill linked to one, never both.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'chk_orders_challan_role'
                    AND conrelid = 'public.orders'::regclass) THEN
    ALTER TABLE orders ADD CONSTRAINT chk_orders_challan_role
      CHECK (NOT ("isChallanOrder" AND "challanOrderId" IS NOT NULL));
  END IF;

  -- A bill cannot be linked to itself.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'chk_orders_challan_not_self'
                    AND conrelid = 'public.orders'::regclass) THEN
    ALTER TABLE orders ADD CONSTRAINT chk_orders_challan_not_self
      CHECK ("challanOrderId" IS NULL OR "challanOrderId" <> "id");
  END IF;

  -- The ORB number and the flag travel together:
  --   challan order  → obdNumber is exactly ORB-YYYY-NNNNN (F6)
  --   any other bill → obdNumber never starts 'ORB-'
  -- A NULL obdNumber (0 live; Prisma forbids it) evaluates to NULL and passes,
  -- which is the CHECK convention, not a hole this constraint is meant to close.
  -- ⚠ 'ORB-' is ALSO the prefix of Orbit CUSTOMER codes in
  -- delivery_point_master ('ORB-00001', v27.57). Different table, different
  -- shape (no year) — this CHECK only governs orders."obdNumber".
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'chk_orders_orb_number'
                    AND conrelid = 'public.orders'::regclass) THEN
    ALTER TABLE orders ADD CONSTRAINT chk_orders_orb_number
      CHECK (
        ("isChallanOrder"     AND "obdNumber" ~  '^ORB-[0-9]{4}-[0-9]{5}$')
        OR
        (NOT "isChallanOrder" AND "obdNumber" !~ '^ORB-')
      );
  END IF;
END $$;


-- ───────────────────────────────────────────────────────────────────────────
-- PART 2 — challan_order_so_links: one row per SO pasted against an ORB order
-- ───────────────────────────────────────────────────────────────────────────
--
-- Separate table because the SO is pasted BEFORE the SAP OBD exists (D10).
-- One ORB order → many SOs (part-billing, F5). One SO → one ORB order among
-- rows that are not unlinked (F5) — the partial unique below.
--
-- status:
--   'waiting'  — SO pasted, its OBD not imported yet
--   'linked'   — the import found an OBD for this SO; "linkedOrderId" is the
--                first such OBD (a further OBD on the same SO carries its own
--                orders."challanOrderId" — that column, not this one, is the
--                per-OBD truth)
--   'unlinked' — billing took a wrong SO off (M5). Allowed from 'waiting' only,
--                so an unlinked row never carries an OBD. The row is KEPT: the
--                audit trail is the row itself, never a hard delete.
--
-- 🔴 "soNumber" is a 10-digit SAP SO. Live, 17,086 of 17,161 orders.soNumber are
-- 10 digits; the other 75 are free text typed in SAP ("CHALLAN - 1790",
-- "J2/GST-0057", "POTLI", "SAMPLE" …) and can never be an SO that an OBD file
-- will match. normaliseSoNumber (lib/billing/telephonic-so.ts) already applies
-- the same 10-digit rule in code; the CHECK makes the table refuse a paste that
-- could never link.

CREATE TABLE IF NOT EXISTS challan_order_so_links (
  "id"            SERIAL         NOT NULL,
  "orbOrderId"    integer        NOT NULL,
  "soNumber"      text           NOT NULL,
  "status"        text           NOT NULL DEFAULT 'waiting',
  "linkedOrderId" integer,
  "obdLinkedAt"   timestamptz(6),
  "linkedById"    integer        NOT NULL,
  "linkedAt"      timestamptz(6) NOT NULL DEFAULT now(),
  "unlinkedById"  integer,
  "unlinkedAt"    timestamptz(6),
  "createdAt"     timestamptz(6) NOT NULL DEFAULT now(),
  -- No trigger stamps it: Prisma's @updatedAt advances it (modelled as
  -- @default(now()) @updatedAt, like user_page_access and so_tags).
  "updatedAt"     timestamptz(6) NOT NULL DEFAULT now(),

  CONSTRAINT challan_order_so_links_pkey PRIMARY KEY ("id"),

  CONSTRAINT chk_challan_order_so_links_status
    CHECK ("status" IN ('waiting', 'linked', 'unlinked')),

  CONSTRAINT chk_challan_order_so_links_so_shape
    CHECK ("soNumber" ~ '^[0-9]{10}$'),

  -- The three states and exactly the columns each may carry. "unlinkedById" is
  -- not required on 'unlinked' because its FK is SET NULL (the same
  -- one-directional rule as chk_so_order_access_revoke, v27.43).
  CONSTRAINT chk_challan_order_so_links_shape CHECK (
       ("status" = 'waiting'  AND "linkedOrderId" IS NULL     AND "obdLinkedAt" IS NULL
                              AND "unlinkedAt" IS NULL        AND "unlinkedById" IS NULL)
    OR ("status" = 'linked'   AND "linkedOrderId" IS NOT NULL AND "obdLinkedAt" IS NOT NULL
                              AND "unlinkedAt" IS NULL        AND "unlinkedById" IS NULL)
    OR ("status" = 'unlinked' AND "linkedOrderId" IS NULL     AND "obdLinkedAt" IS NULL
                              AND "unlinkedAt" IS NOT NULL)
  ),

  CONSTRAINT chk_challan_order_so_links_not_self
    CHECK ("linkedOrderId" IS NULL OR "linkedOrderId" <> "orbOrderId"),

  -- RESTRICT on both orders FKs: orders are soft-deleted, never hard-deleted;
  -- an accidental delete must FAIL rather than cascade the link history away.
  CONSTRAINT "challan_order_so_links_orbOrderId_fkey"
    FOREIGN KEY ("orbOrderId")    REFERENCES orders("id") ON DELETE RESTRICT,
  CONSTRAINT "challan_order_so_links_linkedOrderId_fkey"
    FOREIGN KEY ("linkedOrderId") REFERENCES orders("id") ON DELETE RESTRICT,

  -- RESTRICT: the person who pasted the SO is the record of who linked it —
  -- the so_tags.addedById / ci_returns.supervisorId rule.
  CONSTRAINT "challan_order_so_links_linkedById_fkey"
    FOREIGN KEY ("linkedById")    REFERENCES users("id")  ON DELETE RESTRICT,
  -- SET NULL: an optional actor stamp; status + unlinkedAt still say what happened.
  CONSTRAINT "challan_order_so_links_unlinkedById_fkey"
    FOREIGN KEY ("unlinkedById")  REFERENCES users("id")  ON DELETE SET NULL
);

-- F5 — one SO belongs to one challan, among rows that are not unlinked. Also
-- the import's lookup index ("is this SO linked to a challan?"), on exactly
-- that predicate. PARTIAL → not expressible in Prisma: recorded as a model
-- comment, never @@unique (same class as so_tags_soNumber_live_key, v27.39).
CREATE UNIQUE INDEX IF NOT EXISTS "challan_order_so_links_soNumber_live_key"
  ON challan_order_so_links ("soNumber")
  WHERE "status" <> 'unlinked';

-- "every SO on this challan" (every row of the shared screen) + the orbOrderId FK.
CREATE INDEX IF NOT EXISTS "challan_order_so_links_orbOrderId_idx"
  ON challan_order_so_links ("orbOrderId");

-- The linkedOrderId FK's referencing side (an orders delete would otherwise scan).
CREATE INDEX IF NOT EXISTS "challan_order_so_links_linkedOrderId_idx"
  ON challan_order_so_links ("linkedOrderId");


-- ───────────────────────────────────────────────────────────────────────────
-- PART 3 — live feed: the screens read this table (CORE §13 "every table a
-- screen reads needs a live_changes trigger … in the same commit")
-- ───────────────────────────────────────────────────────────────────────────
--
-- The so_tag_matches pattern, read live 2026-10-06:
--   live_changes_child_{ins,upd,del}('order', 'parent', 'orderId')
-- Here the parent is the ORB order: a paste / link / unlink writes no orders
-- row, so without this the shared screen would only change on reload.
-- entity 'order' is already admitted by chk_live_changes_entity — no CHECK
-- change. The functions swallow their own failure (v27.45): a broken feed can
-- never fail a link write.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgname = 'trg_live_changes_challan_order_so_links_ins'
                    AND tgrelid = 'public.challan_order_so_links'::regclass) THEN
    CREATE TRIGGER trg_live_changes_challan_order_so_links_ins
      AFTER INSERT ON public.challan_order_so_links
      REFERENCING NEW TABLE AS lc_new
      FOR EACH STATEMENT EXECUTE FUNCTION live_changes_child_ins('order', 'parent', 'orbOrderId');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgname = 'trg_live_changes_challan_order_so_links_upd'
                    AND tgrelid = 'public.challan_order_so_links'::regclass) THEN
    CREATE TRIGGER trg_live_changes_challan_order_so_links_upd
      AFTER UPDATE ON public.challan_order_so_links
      REFERENCING OLD TABLE AS lc_old NEW TABLE AS lc_new
      FOR EACH STATEMENT EXECUTE FUNCTION live_changes_child_upd('order', 'parent', 'orbOrderId');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgname = 'trg_live_changes_challan_order_so_links_del'
                    AND tgrelid = 'public.challan_order_so_links'::regclass) THEN
    CREATE TRIGGER trg_live_changes_challan_order_so_links_del
      AFTER DELETE ON public.challan_order_so_links
      REFERENCING OLD TABLE AS lc_old
      FOR EACH STATEMENT EXECUTE FUNCTION live_changes_child_del('order', 'parent', 'orbOrderId');
  END IF;
END $$;


-- ───────────────────────────────────────────────────────────────────────────
-- PART 4 — the linked-OBD status: NO DDL (recorded so nobody adds one)
-- ───────────────────────────────────────────────────────────────────────────
--
-- The linked SAP OBD gets  orders."workflowStage" = 'challan_linked'
-- (a terminal stage like 'cancelled'; dispatchStatus left NULL).
-- Live: orders carries NO CHECK on "workflowStage" (only orders_obdNumber_key),
-- and order_status_logs carries no CHECK on "toStage" — so neither needs an
-- ALTER. The value is registered in code (lib/workflow-stages.ts STAGE_LADDER,
-- rank null, terminal) in slice 1b. PART 5 re-reads both facts.


-- ───────────────────────────────────────────────────────────────────────────
-- PART 5 — verification. ONE SELECT (the editor shows only the last result).
--
-- Expect:
--   orders."isChallanOrder"  boolean | NO  | false
--   orders."challanOrderId"  integer | YES | none
--   challan_order_so_links columns = 12
--   constraints present = 13 · indexes present = 4 · triggers present = 3
--   orders CHECK on workflowStage / dispatchStatus = 0 · order_status_logs CHECK = 0
--   orders isChallanOrder=true = 0 · challanOrderId set = 0 · link rows = 0
--   RLS orders / challan_order_so_links = the same value both sides
-- ───────────────────────────────────────────────────────────────────────────

SELECT sort_order, item, value FROM (
  SELECT 1 AS sort_order, ('column orders.' || c.column_name)::text AS item,
         (c.data_type || ' | nullable=' || c.is_nullable || ' | default=' || coalesce(c.column_default, 'none'))::text AS value
    FROM information_schema.columns c
   WHERE c.table_schema = 'public' AND c.table_name = 'orders'
     AND c.column_name IN ('isChallanOrder', 'challanOrderId')
  UNION ALL
  SELECT 2, 'table challan_order_so_links — columns (expect 12)'::text,
         CASE WHEN to_regclass('public.challan_order_so_links') IS NULL THEN 'MISSING'
              ELSE (SELECT count(*) FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'challan_order_so_links')::text
         END
  UNION ALL
  SELECT 3, ('constraint ' || con.conname::text || ' (' || con.contype::text || ')')::text,
         pg_get_constraintdef(con.oid)::text
    FROM pg_constraint con
   WHERE con.conname::text IN (
           'orders_challanOrderId_fkey', 'chk_orders_challan_role',
           'chk_orders_challan_not_self', 'chk_orders_orb_number',
           'challan_order_so_links_pkey', 'chk_challan_order_so_links_status',
           'chk_challan_order_so_links_so_shape', 'chk_challan_order_so_links_shape',
           'chk_challan_order_so_links_not_self',
           'challan_order_so_links_orbOrderId_fkey', 'challan_order_so_links_linkedOrderId_fkey',
           'challan_order_so_links_linkedById_fkey', 'challan_order_so_links_unlinkedById_fkey')
  UNION ALL
  SELECT 4, 'constraints present (expect 13)'::text,
         (SELECT count(*) FROM pg_constraint con
           WHERE con.conname::text IN (
                   'orders_challanOrderId_fkey', 'chk_orders_challan_role',
                   'chk_orders_challan_not_self', 'chk_orders_orb_number',
                   'challan_order_so_links_pkey', 'chk_challan_order_so_links_status',
                   'chk_challan_order_so_links_so_shape', 'chk_challan_order_so_links_shape',
                   'chk_challan_order_so_links_not_self',
                   'challan_order_so_links_orbOrderId_fkey', 'challan_order_so_links_linkedOrderId_fkey',
                   'challan_order_so_links_linkedById_fkey', 'challan_order_so_links_unlinkedById_fkey'))::text
  UNION ALL
  SELECT 5, ('index ' || i.indexname::text)::text, i.indexdef::text
    FROM pg_indexes i
   WHERE i.schemaname = 'public'
     AND i.indexname IN ('orders_challanOrderId_idx', 'challan_order_so_links_soNumber_live_key',
                         'challan_order_so_links_orbOrderId_idx', 'challan_order_so_links_linkedOrderId_idx')
  UNION ALL
  SELECT 6, 'indexes present (expect 4)'::text,
         (SELECT count(*) FROM pg_indexes i
           WHERE i.schemaname = 'public'
             AND i.indexname IN ('orders_challanOrderId_idx', 'challan_order_so_links_soNumber_live_key',
                                 'challan_order_so_links_orbOrderId_idx', 'challan_order_so_links_linkedOrderId_idx'))::text
  UNION ALL
  SELECT 7, ('trigger ' || tg.tgname::text)::text, (tg.tgenabled::text || ' | ' || pg_get_triggerdef(tg.oid))::text
    FROM pg_trigger tg
   WHERE NOT tg.tgisinternal AND tg.tgname::text LIKE 'trg_live_changes_challan_order_so_links_%'
  UNION ALL
  SELECT 8, 'triggers present (expect 3, enabled O)'::text,
         (SELECT count(*) FROM pg_trigger tg
           WHERE NOT tg.tgisinternal AND tg.tgname::text LIKE 'trg_live_changes_challan_order_so_links_%')::text
  UNION ALL
  SELECT 9, 'orders CHECKs mentioning workflowStage / dispatchStatus (expect 0)'::text,
         (SELECT count(*) FROM pg_constraint con
           WHERE con.conrelid = 'public.orders'::regclass AND con.contype = 'c'
             AND (pg_get_constraintdef(con.oid) ILIKE '%workflowStage%'
                  OR pg_get_constraintdef(con.oid) ILIKE '%dispatchStatus%'))::text
  UNION ALL
  SELECT 10, 'order_status_logs CHECKs (expect 0)'::text,
         (SELECT count(*) FROM pg_constraint con
           WHERE con.conrelid = 'public.order_status_logs'::regclass AND con.contype = 'c')::text
  UNION ALL
  SELECT 11, 'data untouched: isChallanOrder=true / challanOrderId set / link rows (expect 0 / 0 / 0)'::text,
         ((SELECT count(*) FROM orders WHERE "isChallanOrder")::text
          || ' / ' || (SELECT count(*) FROM orders WHERE "challanOrderId" IS NOT NULL)::text
          || ' / ' || (SELECT count(*) FROM challan_order_so_links)::text)
  UNION ALL
  SELECT 12, 'RLS enabled: orders / challan_order_so_links (expect the SAME value both sides)'::text,
         ((SELECT c2.relrowsecurity FROM pg_class c2 WHERE c2.oid = 'public.orders'::regclass)::text
          || ' / ' ||
          coalesce((SELECT c3.relrowsecurity FROM pg_class c3
                     WHERE c3.oid = to_regclass('public.challan_order_so_links'))::text, 'MISSING'))
) v
ORDER BY sort_order, item;
