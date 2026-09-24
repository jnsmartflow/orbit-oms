-- ═══════════════════════════════════════════════════════════════════════════
-- Billing · mail-order actions (CI/Cancel · Hand) — step 3 SQL
-- 2026-09-24 · design: docs/prompts/drafts/web-update-2026-09-24-billing-mo-actions.md (v4)
-- gates:  docs/prompts/drafts/code-discovery-2026-09-24-billing-mo-actions-gate.md
--         docs/prompts/drafts/code-discovery-2026-09-24-billing-mo-actions-regate.md
--
-- Run in the Supabase SQL Editor, top to bottom, in ONE paste. NO transaction
-- wrapper — BEGIN/COMMIT fails silently there (CORE §3). camelCase identifiers,
-- quoted. Timestamps timestamptz(6).
--
-- WRITTEN, NOT RUN. Nothing in the app reads any of this yet.
--
-- ── WHAT THIS FILE CHANGES (plain English) ────────────────────────────────
--   PART 1  mo_orders gains four columns:
--             billOnlyAt / billOnlyById  — billing pressed CI on this mail order
--             handAt / handById          — billing pressed Hand (dealer collects)
--   PART 2  orders gains two columns: handAt / handById (carried from the mail
--           order by enrichment and dual-written by the billing actions route).
--   PART 3  so_tags gains fromMailOrder (boolean, default false) — the tag was
--           written because a mail order is marked CI (design §3.6).
--   PART 4  trips gains isHand (boolean, default false) — a Hand trip: the dealer
--           collects, no vehicle (design §4).
--   PART 5  One partial index: mo_orders (soNumber) WHERE billOnlyAt IS NOT NULL.
--   PART 6  Verification — ONE SELECT.
--
--   Ship-to text, area, trip-stop key and challan table removed 2026-09-24 — design §5 parked; do not re-add in this file.
--
--   NO DATA IS WRITTEN. No backfill is needed: every new column is NULL / false
--   on every existing row, which means "not marked", exactly the truth today.
--   Nothing is dropped or altered; only columns, FKs and one index are added.
--
-- ── SCHEMA VERSION ────────────────────────────────────────────────────────
--   CORE header (read 2026-09-24, local and origin/main): v110 · Schema v27.40.
--   This file mints **v27.41**, recorded in CORE §7 in the same pass as the
--   Prisma edit (design §9 step 4).
--   ⚠ Two earlier SQL files are NOT in the CORE chain at all:
--     sql/2026-09-21-trips-vehicle-size.sql, sql/2026-09-21-load-plan-snapshot.sql
--   (grep of CORE for vehicleSize / load_plan_snapshot: 0 hits). If the CORE
--   pass mints those first, this file becomes the next number after them.
--   Decide in that pass; do not renumber here.
--
-- ── RE-RUN SAFETY ─────────────────────────────────────────────────────────
--   ADD COLUMN IF NOT EXISTS · CREATE INDEX IF NOT EXISTS · every FK added in a
--   DO block that tests pg_constraint first. A second paste changes nothing.
--   ⚠ IF NOT EXISTS skips a column that already exists WHATEVER its type — the
--   verification in PART 6 prints each column's type and default. Read them.
--
-- ── NAMES ─────────────────────────────────────────────────────────────────
--   FKs use Prisma's own default names ({table}_{col}_fkey), so the hand-edited
--   schema needs no `map:`. The one PARTIAL index (PART 5) cannot be expressed
--   in Prisma and is recorded as a model comment, as so_tags_soNumber_live_key
--   was (v27.39).
--   🔴 Named constraints are double-quoted, never bare: an unquoted camelCase
--   name folds to lower case (CLAUDE_MRN.md §10, 2026-09-01).
--
-- ── PRISMA RELATIONS THE SCHEMA EDIT WILL NEED (step 4, not this file) ────
--   mo_orders → users gains TWO more FKs (billOnlyById, handById) beside
--   punchedById, and orders → users gains handById beside its SEVEN named ones.
--   Every one must carry an explicit @relation("…") name on BOTH sides
--   (CORE §7.3 ambiguity trap). Suggested: MoOrderBillOnlyBy, MoOrderHandBy,
--   OrderHandBy.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- PART 1 — mo_orders: the two marks, as billing sets them (the INTENT)
-- ───────────────────────────────────────────────────────────────────────────
--
-- billOnlyAt / billOnlyById — CI pressed (design §3.2). A timestamp + actor pair,
--   the house shape for a decision (invoicedAt/ById, pickEarlyReleasedAt/ById),
--   never a status value. NULL = not marked.
-- handAt / handById — Hand pressed (design §4). 🔴 Hand is NEVER a dispatchStatus
--   value: every board predicate pins 'dispatch' and a new value would drop the
--   bill off picking and billing (discovery B2).
--
-- Actor FKs: SET NULL — the optional "who" stamp beside a timestamp, the same as
-- trips' six actor FKs and so_tags.removedById. Users are deactivated, not deleted;
-- if one ever is, the mark (the timestamp) must survive.

ALTER TABLE mo_orders ADD COLUMN IF NOT EXISTS "billOnlyAt"   timestamptz(6);
ALTER TABLE mo_orders ADD COLUMN IF NOT EXISTS "billOnlyById" integer;
ALTER TABLE mo_orders ADD COLUMN IF NOT EXISTS "handAt"       timestamptz(6);
ALTER TABLE mo_orders ADD COLUMN IF NOT EXISTS "handById"     integer;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mo_orders_billOnlyById_fkey') THEN
    ALTER TABLE mo_orders ADD CONSTRAINT "mo_orders_billOnlyById_fkey"
      FOREIGN KEY ("billOnlyById") REFERENCES users("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mo_orders_handById_fkey') THEN
    ALTER TABLE mo_orders ADD CONSTRAINT "mo_orders_handById_fkey"
      FOREIGN KEY ("handById") REFERENCES users("id") ON DELETE SET NULL;
  END IF;
END $$;


-- ───────────────────────────────────────────────────────────────────────────
-- PART 2 — orders: the Hand mark on the bill (the FACT the floor reads)
-- ───────────────────────────────────────────────────────────────────────────
--
-- No billOnlyAt on orders: a CI'd bill is recorded by its ci_returns row and
-- workflowStage 'cancelled' (design §3.3), not by a mark.
-- ⚠ orders → users already carries SEVEN named relations; handById is the eighth
-- and MUST be named on both sides in Prisma (CORE §7.3).

ALTER TABLE orders ADD COLUMN IF NOT EXISTS "handAt"   timestamptz(6);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS "handById" integer;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_handById_fkey') THEN
    ALTER TABLE orders ADD CONSTRAINT "orders_handById_fkey"
      FOREIGN KEY ("handById") REFERENCES users("id") ON DELETE SET NULL;
  END IF;
END $$;

-- Index deliberately NOT added on orders.handAt (justified, per the brief): every
-- read that filters on it (route cards, pool header, load plan v1 on the client;
-- load plan v2's where and the gate's `unplanned` count on the server) is already
-- narrowed by stage + tripDropId + dispatchStatus to tens or hundreds of rows. A
-- partial index would serve no plan. Same for mo_orders.handAt.


-- ───────────────────────────────────────────────────────────────────────────
-- PART 3 — so_tags: "this tag belongs to a marked mail order"
-- ───────────────────────────────────────────────────────────────────────────
--
-- A flag, NOT a moOrderId (re-gate R4): one tag per SO can be shared by two
-- mail orders (split halves, a duplicate punch). The owning mail orders are
-- found by SO: mo_orders WHERE soNumber = … AND billOnlyAt IS NOT NULL (PART 5).
-- DEFAULT false: every existing tag was typed on the Telephonic tab.
-- Mail-order tags get expiresAt far in the future (e.g. 2099-12-31) — written by
-- code, NOT defaulted here (design §3.6).

ALTER TABLE so_tags ADD COLUMN IF NOT EXISTS "fromMailOrder" boolean NOT NULL DEFAULT false;


-- ───────────────────────────────────────────────────────────────────────────
-- PART 4 — trips: the Hand trip
-- ───────────────────────────────────────────────────────────────────────────
--
-- Gate G3: a boolean, not the HAND transporter row (editable after bills join,
-- found by name) and not a new typeCode letter (needs a fake delivery type).
-- Number, letter, delivery type and tab are unchanged. POST sets it, PATCH
-- refuses to change it, vehicle/plate are refused on it — all in code.
-- No index: trips is small and every read is by id or by tripDate.

ALTER TABLE trips ADD COLUMN IF NOT EXISTS "isHand" boolean NOT NULL DEFAULT false;


-- ───────────────────────────────────────────────────────────────────────────
-- PART 5 — the one index the new read paths need
-- ───────────────────────────────────────────────────────────────────────────
--
-- mo_orders has NO declared index on soNumber (prisma/schema.prisma declares no
-- @@index on the model; live not re-read). Three new reads ask "is any mail order
-- on this SO marked CI?":
--   • enrichment's skip, keyed on the SO, not the newest mail order (design §3.4)
--   • un-press: remove the shared tag only when no other marked mail order holds
--     the SO (§3.6)
--   • re-punch: move the tag (§3.6)
-- Partial on billOnlyAt IS NOT NULL: the index holds only the handful of marked
-- mail orders, costs nothing on the ~150 unmarked a day, and answers each of
-- those reads without touching the table. Not expressible in Prisma — record it
-- as a comment in the model.

CREATE INDEX IF NOT EXISTS "mo_orders_billOnly_soNumber_idx"
  ON mo_orders ("soNumber")
  WHERE "billOnlyAt" IS NOT NULL;


-- ───────────────────────────────────────────────────────────────────────────
-- PART 6 — verification. ONE SELECT (the editor shows only the last result).
--
-- Expect:
--   every column row: present, with its type (timestamp with time zone /
--     integer / boolean), default false on the two booleans
--   every FK row: present, with its definition (ON DELETE SET NULL)
--   the index row: present
--   rows marked by this file: 0 · 0 · 0 · 0
-- ───────────────────────────────────────────────────────────────────────────

SELECT sort_order, item, value FROM (

  -- columns: presence, type, default
  SELECT 1 AS sort_order,
         ('column ' || x.tbl || '."' || x.col || '"')::text AS item,
         COALESCE((SELECT (c.data_type || COALESCE(' · default ' || c.column_default, '')
                           || ' · nullable ' || c.is_nullable)::text
                     FROM information_schema.columns c
                    WHERE c.table_schema = 'public'
                      AND c.table_name = x.tbl AND c.column_name = x.col), 'MISSING')::text AS value
    FROM (VALUES
      ('mo_orders', 'billOnlyAt'), ('mo_orders', 'billOnlyById'),
      ('mo_orders', 'handAt'), ('mo_orders', 'handById'),
      ('orders', 'handAt'), ('orders', 'handById'),
      ('so_tags', 'fromMailOrder'),
      ('trips', 'isHand')
    ) AS x(tbl, col)

  -- foreign keys: presence + definition
  UNION ALL
  SELECT 2, ('constraint ' || k.name)::text,
         COALESCE((SELECT (c.contype::text || ' · ' || pg_get_constraintdef(c.oid))::text
                     FROM pg_constraint c WHERE c.conname = k.name), 'MISSING')::text
    FROM (VALUES
      ('mo_orders_billOnlyById_fkey'), ('mo_orders_handById_fkey'),
      ('orders_handById_fkey')
    ) AS k(name)

  -- the index: presence + definition
  UNION ALL
  SELECT 3, 'index mo_orders_billOnly_soNumber_idx'::text,
         COALESCE((SELECT i.indexdef::text FROM pg_indexes i
                    WHERE i.schemaname = 'public'
                      AND i.indexname = 'mo_orders_billOnly_soNumber_idx'), 'MISSING')::text

  -- nothing was marked by this file (no backfill)
  UNION ALL
  SELECT 4, 'rows marked by this file (expect 0 · 0 · 0 · 0)'::text,
         ((SELECT count(*) FROM mo_orders WHERE "billOnlyAt" IS NOT NULL OR "handAt" IS NOT NULL)::text
          || ' · ' || (SELECT count(*) FROM orders WHERE "handAt" IS NOT NULL)::text
          || ' · ' || (SELECT count(*) FROM so_tags WHERE "fromMailOrder")::text
          || ' · ' || (SELECT count(*) FROM trips WHERE "isHand")::text)::text

) v
ORDER BY sort_order, item;
