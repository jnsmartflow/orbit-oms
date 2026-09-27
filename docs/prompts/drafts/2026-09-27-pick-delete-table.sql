-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-09-27 — pick_delete_decisions (Billing "Pick delete", build step 3)
-- Plan: docs/prompts/drafts/code-discovery-2026-09-27-pick-delete-build-plan.md §1
-- Decisions: docs/prompts/drafts/web-update-2026-09-27-billing-pick-delete.md
--
-- Run ONCE, top to bottom, in the Supabase SQL Editor. No BEGIN/COMMIT.
-- Safe to re-run: the table and every index use IF NOT EXISTS; nothing is dropped.
-- Only the LAST statement's result is shown: the read-only verify block at the end.
--
-- ⚠ orderIds / keptOrderIds are written SORTED ASCENDING by the app — the partial
--   unique index on ("soNumber","orderIds") depends on it.
-- ⚠ undoneById is SET NULL, so chk_pick_delete_decisions_undo is one-directional.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS pick_delete_decisions (
  "id"               SERIAL         PRIMARY KEY,
  "soNumber"         text           NOT NULL,
  "kind"             text           NOT NULL,
  "orderIds"         integer[]      NOT NULL,
  "deletedOrderId"   integer        NULL,
  "deletedFromStage" text           NULL,
  "deletedPickerId"  integer        NULL,
  "keptOrderIds"     integer[]      NOT NULL DEFAULT '{}',
  "decidedById"      integer        NOT NULL,
  "decidedAt"        timestamptz(6) NOT NULL DEFAULT now(),
  "undoneAt"         timestamptz(6) NULL,
  "undoneById"       integer        NULL,
  "createdAt"        timestamptz(6) NOT NULL DEFAULT now(),
  "updatedAt"        timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT "pick_delete_decisions_deletedOrderId_fkey"
    FOREIGN KEY ("deletedOrderId")  REFERENCES orders(id) ON DELETE RESTRICT,
  CONSTRAINT "pick_delete_decisions_deletedPickerId_fkey"
    FOREIGN KEY ("deletedPickerId") REFERENCES users(id)  ON DELETE SET NULL,
  CONSTRAINT "pick_delete_decisions_decidedById_fkey"
    FOREIGN KEY ("decidedById")     REFERENCES users(id)  ON DELETE RESTRICT,
  CONSTRAINT "pick_delete_decisions_undoneById_fkey"
    FOREIGN KEY ("undoneById")      REFERENCES users(id)  ON DELETE SET NULL,
  CONSTRAINT chk_pick_delete_decisions_kind
    CHECK ("kind" IN ('all_ok', 'pick_delete')),
  CONSTRAINT chk_pick_delete_decisions_shape
    CHECK (
         ("kind" = 'all_ok'      AND "deletedOrderId" IS NULL     AND "deletedFromStage" IS NULL     AND "deletedPickerId" IS NULL)
      OR ("kind" = 'pick_delete' AND "deletedOrderId" IS NOT NULL AND "deletedFromStage" IS NOT NULL)
    ),
  CONSTRAINT chk_pick_delete_decisions_set
    CHECK (cardinality("orderIds") >= 2),
  CONSTRAINT chk_pick_delete_decisions_member
    CHECK ("deletedOrderId" IS NULL OR "deletedOrderId" = ANY ("orderIds")),
  CONSTRAINT chk_pick_delete_decisions_undo
    CHECK ("undoneById" IS NULL OR "undoneAt" IS NOT NULL)
);

-- One ACTIVE All OK per exact (sorted) set — a double press hits P2002.
CREATE UNIQUE INDEX IF NOT EXISTS pick_delete_decisions_all_ok_live_key
  ON pick_delete_decisions ("soNumber", "orderIds")
  WHERE "kind" = 'all_ok' AND "undoneAt" IS NULL;

-- One ACTIVE Pick delete per bill.
CREATE UNIQUE INDEX IF NOT EXISTS pick_delete_decisions_deleted_live_key
  ON pick_delete_decisions ("deletedOrderId")
  WHERE "kind" = 'pick_delete' AND "undoneAt" IS NULL;

CREATE INDEX IF NOT EXISTS pick_delete_decisions_so_idx
  ON pick_delete_decisions ("soNumber");
CREATE INDEX IF NOT EXISTS pick_delete_decisions_decided_idx
  ON pick_delete_decisions ("decidedAt" DESC);
CREATE INDEX IF NOT EXISTS pick_delete_decisions_picker_idx
  ON pick_delete_decisions ("deletedPickerId", "decidedAt");
-- The referencing side of the RESTRICT FK to orders.
CREATE INDEX IF NOT EXISTS pick_delete_decisions_deleted_order_idx
  ON pick_delete_decisions ("deletedOrderId");

-- ── VERIFY (read-only) — the only result the editor shows ──────────────────
-- Expect: 14 column rows · 10 constraint rows (1 p, 4 f, 5 c) · 7 index rows
--         (pkey + 2 partial unique + 4 plain) · 4 fk_target rows.
SELECT '1 column'::text AS q,
       c.column_name::text AS name,
       (c.data_type::text || ' / ' || c.udt_name::text) AS type,
       ('nullable=' || c.is_nullable::text) AS detail,
       COALESCE(c.column_default::text, '') AS extra
FROM information_schema.columns c
WHERE c.table_schema = 'public' AND c.table_name = 'pick_delete_decisions'
UNION ALL
SELECT '2 constraint'::text,
       con.conname::text,
       con.contype::text,
       pg_get_constraintdef(con.oid)::text,
       ''::text
FROM pg_constraint con
WHERE con.conrelid = 'public.pick_delete_decisions'::regclass
UNION ALL
SELECT '3 index'::text,
       i.indexname::text,
       ''::text,
       i.indexdef::text,
       ''::text
FROM pg_indexes i
WHERE i.schemaname = 'public' AND i.tablename = 'pick_delete_decisions'
UNION ALL
SELECT '4 fk_target'::text,
       con.conname::text,
       con.confrelid::regclass::text,
       (SELECT string_agg(a.attname::text, ', ')
          FROM pg_attribute a
         WHERE a.attrelid = con.confrelid AND a.attnum = ANY (con.confkey))::text,
       CASE con.confdeltype::text
         WHEN 'r' THEN 'ON DELETE RESTRICT'
         WHEN 'n' THEN 'ON DELETE SET NULL'
         WHEN 'c' THEN 'ON DELETE CASCADE'
         WHEN 'a' THEN 'ON DELETE NO ACTION'
         ELSE 'ON DELETE ' || con.confdeltype::text
       END
FROM pg_constraint con
WHERE con.conrelid = 'public.pick_delete_decisions'::regclass AND con.contype = 'f'
ORDER BY 1, 2;
