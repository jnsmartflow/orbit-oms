-- ═══════════════════════════════════════════════════════════════════════════
-- docs/prompts/drafts/code-sql-2026-10-19-ship-to-freetext.sql
-- Free-text ship-to + dealer challan copy: DATABASE STEP (build step 3)
-- Design: docs/prompts/drafts/web-update-2026-10-19-ship-to-freetext.md §4
--
-- PROPOSED SCHEMA VERSION: v27.73 (CORE v148 header reads Schema v27.72).
--   Not minted here. Step 4 mints the CORE entry together with the hand-edited
--   prisma/schema.prisma, after the owner has run this file.
--
-- RUN STATUS: NOT RUN. Written 2026-10-19.
--   Run the whole file in ONE paste in the Supabase SQL Editor. No BEGIN/COMMIT.
--   It is re-runnable: ADD COLUMN IF NOT EXISTS, CREATE ... IF NOT EXISTS,
--   guarded constraint adds, DROP TRIGGER IF EXISTS, and the drop-key CHECK is
--   dropped and re-added inside ONE ALTER TABLE statement.
--   The last statement is the read-back.
--
-- GATE (read-only, live 2026-10-19, before this file was written)
--   · chk_trip_drops_key live text = the schema.prisma comment (c:/s: only).
--   · None of the 5 new columns exists; ship_to_copies does not exist.
--   · area_master / mo_orders / orders / users ids are all `integer` (serial).
--     mo_orders."soNumber" and orders."soNumber" are `text`.
--   · MRN's uploader FK: mrn_photos."capturedById" → users(id) ON DELETE RESTRICT.
--   · trip_drops: 4,259 rows · 0 fail the new CHECK · 0 rows start 't:'.
--   · No constraint / index / trigger / table name below exists yet (the only
--     ship-to names live are the two shipToOverrideCustomerId FKs).
--   · RLS is OFF on all 193 public tables, with 0 policies (orders, mo_orders,
--     mrn_photos, trip_drops, trip_share_log, ci_returns checked by name).
--   · Buckets live: attendance-photos, mrn-photos. No ship-to-challans yet.
--
-- OWNER DECISION 2026-10-19 (at the gate): ship_to_copies."soNumber" is NULLABLE.
--   The Billing ✎ pencil works before the SO is punched
--   (components/billing/billing-ship-to-pencil.tsx:13-15), so a Billing copy can
--   exist with no SO yet, and a re-punch can change the SO. soNumber is a
--   snapshot, filled when known. The owner is moOrderId (Billing) or orderId
--   (Floor); chk_ship_to_copies_owner requires at least one. Readers find a
--   Billing copy through moOrderId → mo_orders."soNumber", never by the snapshot.
--
-- WHAT
--   1. mo_orders."shipToText" text NULL, "shipToAreaId" integer NULL → area_master
--   2. orders."shipToText"    text NULL, "shipToAreaId" integer NULL → area_master
--      + chk_*_ship_to_text: NULL or holds at least one non-space character.
--      shipToAreaId is NULL for "As per challan" (the bill keeps the dealer's area).
--   3. trip_drops."shipToText" text NULL + chk_trip_drops_key rewritten with the
--      t: branch FIRST. c:/s: branches unchanged.
--   4. New table ship_to_copies (+ indexes, live-feed triggers).
--   5. Read-back.
--
-- DROP-KEY CHECK — WHY DROP + ADD IN ONE PASTE IS SAFE
--   · Every existing row has "shipToText" NULL (the column is new in PART 3), so
--     the new CASE falls straight to the old c:/s: branches for every row: it is
--     the same expression the live CHECK enforces today. Gate: 0 of 4,259 rows
--     fail it, and 0 rows use 't:'.
--   · DROP and ADD are ONE ALTER TABLE statement, so there is no moment with no
--     CHECK. The editor also runs a multi-statement paste as one implicit
--     transaction, so a failure anywhere rolls the whole paste back.
--   · ADD CONSTRAINT validates 4,259 rows under a short ACCESS EXCLUSIVE lock.
--   · The app writes no t: key until the code step. Until then the new branch is
--     unused.
--   · What the app must store in trip_drops."shipToText" (design §5 of the
--     2026-09-24 draft, re-gated): '<scope>/<text>', scope = the bill's
--     customerId, else its SAP shipToCode; text lower-cased, spaces/newlines
--     collapsed, '|' and '#' stripped, capped at 80; an empty result → NULL
--     (today's c:/s: key). The CHECK only ties dropKey to the column. The shape
--     is the app's job (lib/trips/drop-key.ts).
--
-- LIVE FEED (CORE §13: every table a screen reads needs a live_changes trigger)
--   · mo_orders / orders / trip_drops already carry their triggers. The new
--     columns ride them; nothing to add.
--   · ship_to_copies gets TWO child trigger sets on EXISTING functions (none
--     created or replaced; both entities already admitted by live_changes):
--       ('order',      'parent', 'orderId')    → Floor rows of that bill
--       ('mail_order', 'parent', 'moOrderId')  → the Billing mail order
--     live_changes_keys skips NULL keys (live function read 2026-10-19), so a
--     Billing copy (orderId NULL) records only the mail order and a Floor copy
--     (moOrderId NULL) records only the bill.
--   ⚠ A Billing copy does NOT tick the SO's Floor rows by itself. The ship-to
--     save that comes with it writes every bill (orders trigger), which
--     refreshes Floor. An upload on its own, with no save, reaches Floor on the
--     next reload.
--
-- RLS / GRANTS: none, matching every public table (RLS off on all 193 live).
--   Access is enforced in the API (billing_ship_to tick / floor canEdit).
--
-- KILL SWITCH for the triggers (run on its own if ever needed):
--   ALTER TABLE ship_to_copies DISABLE TRIGGER trg_live_changes_ship_to_copies_ins;
--   ALTER TABLE ship_to_copies DISABLE TRIGGER trg_live_changes_ship_to_copies_upd;
--   ALTER TABLE ship_to_copies DISABLE TRIGGER trg_live_changes_ship_to_copies_del;
--   ALTER TABLE ship_to_copies DISABLE TRIGGER trg_live_changes_ship_to_copies_mo_ins;
--   ALTER TABLE ship_to_copies DISABLE TRIGGER trg_live_changes_ship_to_copies_mo_upd;
--   ALTER TABLE ship_to_copies DISABLE TRIGGER trg_live_changes_ship_to_copies_mo_del;
--
-- Constraint names are double-quoted wherever they hold capitals. Postgres
-- folds unquoted names to lower case (CLAUDE_MRN.md §10).
-- ═══════════════════════════════════════════════════════════════════════════


-- ── PART 1. mo_orders ──────────────────────────────────────────────────────
ALTER TABLE mo_orders ADD COLUMN IF NOT EXISTS "shipToText"   text    NULL;
ALTER TABLE mo_orders ADD COLUMN IF NOT EXISTS "shipToAreaId" integer NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'mo_orders_shipToAreaId_fkey' AND conrelid = 'mo_orders'::regclass) THEN
    ALTER TABLE mo_orders
      ADD CONSTRAINT "mo_orders_shipToAreaId_fkey"
      FOREIGN KEY ("shipToAreaId") REFERENCES area_master(id) ON DELETE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'chk_mo_orders_ship_to_text' AND conrelid = 'mo_orders'::regclass) THEN
    ALTER TABLE mo_orders
      ADD CONSTRAINT chk_mo_orders_ship_to_text
      CHECK ("shipToText" IS NULL OR "shipToText" ~ '\S');
  END IF;
END $$;


-- ── PART 2. orders ─────────────────────────────────────────────────────────
ALTER TABLE orders ADD COLUMN IF NOT EXISTS "shipToText"   text    NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS "shipToAreaId" integer NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'orders_shipToAreaId_fkey' AND conrelid = 'orders'::regclass) THEN
    ALTER TABLE orders
      ADD CONSTRAINT "orders_shipToAreaId_fkey"
      FOREIGN KEY ("shipToAreaId") REFERENCES area_master(id) ON DELETE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'chk_orders_ship_to_text' AND conrelid = 'orders'::regclass) THEN
    ALTER TABLE orders
      ADD CONSTRAINT chk_orders_ship_to_text
      CHECK ("shipToText" IS NULL OR "shipToText" ~ '\S');
  END IF;
END $$;


-- ── PART 3. trip_drops."shipToText" + chk_trip_drops_key (t: branch first) ──
ALTER TABLE trip_drops ADD COLUMN IF NOT EXISTS "shipToText" text NULL;

-- ONE statement: no window without the CHECK. Re-runnable (IF EXISTS).
ALTER TABLE trip_drops
  DROP CONSTRAINT IF EXISTS chk_trip_drops_key,
  ADD CONSTRAINT chk_trip_drops_key CHECK ("dropKey" =
    CASE
      WHEN "shipToText" IS NOT NULL THEN 't:' || "shipToText"
      WHEN "customerId" IS NOT NULL THEN 'c:' || "customerId"::text
      ELSE 's:' || "shipToCode"
    END);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'chk_trip_drops_ship_to_text' AND conrelid = 'trip_drops'::regclass) THEN
    ALTER TABLE trip_drops
      ADD CONSTRAINT chk_trip_drops_ship_to_text
      CHECK ("shipToText" IS NULL OR "shipToText" ~ '\S');
  END IF;
END $$;


-- ── PART 4. ship_to_copies ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ship_to_copies (
  id             serial      NOT NULL,
  "soNumber"     text        NULL,       -- snapshot when known (owner decision above)
  "orderId"      integer     NULL,       -- Floor copy: this bill only
  "moOrderId"    integer     NULL,       -- Billing copy: every bill of the SO
  "storagePath"  text        NOT NULL,   -- bucket path, never a URL
  "contentType"  text        NOT NULL,
  "sizeBytes"    integer     NOT NULL,
  "uploadedById" integer     NOT NULL,
  "createdAt"    timestamptz NOT NULL DEFAULT now(),
  "removedAt"    timestamptz NULL,       -- soft-remove: the file stays in storage
  "removedById"  integer     NULL,
  CONSTRAINT ship_to_copies_pkey PRIMARY KEY (id),
  CONSTRAINT "ship_to_copies_storagePath_key" UNIQUE ("storagePath"),
  CONSTRAINT "ship_to_copies_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES orders(id) ON DELETE NO ACTION,
  CONSTRAINT "ship_to_copies_moOrderId_fkey"
    FOREIGN KEY ("moOrderId") REFERENCES mo_orders(id) ON DELETE NO ACTION,
  CONSTRAINT "ship_to_copies_uploadedById_fkey"
    FOREIGN KEY ("uploadedById") REFERENCES users(id) ON DELETE NO ACTION,
  CONSTRAINT "ship_to_copies_removedById_fkey"
    FOREIGN KEY ("removedById") REFERENCES users(id) ON DELETE NO ACTION,
  CONSTRAINT chk_ship_to_copies_content_type
    CHECK ("contentType" IN ('image/jpeg', 'image/png', 'application/pdf')),
  CONSTRAINT chk_ship_to_copies_size_positive
    CHECK ("sizeBytes" > 0),
  CONSTRAINT chk_ship_to_copies_owner
    CHECK ("orderId" IS NOT NULL OR "moOrderId" IS NOT NULL),
  CONSTRAINT chk_ship_to_copies_removed_complete
    CHECK (("removedAt" IS NULL) = ("removedById" IS NULL))
);

CREATE INDEX IF NOT EXISTS "ship_to_copies_soNumber_idx"  ON ship_to_copies ("soNumber");
CREATE INDEX IF NOT EXISTS "ship_to_copies_orderId_idx"   ON ship_to_copies ("orderId");
CREATE INDEX IF NOT EXISTS "ship_to_copies_moOrderId_idx" ON ship_to_copies ("moOrderId");

COMMENT ON TABLE ship_to_copies IS
  'Dealer / SO challan copies attached to a typed ship-to (proposed Schema v27.73). One row per file in the private bucket ship-to-challans. Billing copy: moOrderId set, orderId NULL (every bill of the SO). Floor copy: orderId set (that bill only). Soft-removed only; no purge.';

-- Live feed — order-child and mail_order-child shapes, existing functions.
DROP TRIGGER IF EXISTS trg_live_changes_ship_to_copies_ins ON ship_to_copies;
CREATE TRIGGER trg_live_changes_ship_to_copies_ins AFTER INSERT ON ship_to_copies REFERENCING NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_child_ins('order', 'parent', 'orderId');
DROP TRIGGER IF EXISTS trg_live_changes_ship_to_copies_upd ON ship_to_copies;
CREATE TRIGGER trg_live_changes_ship_to_copies_upd AFTER UPDATE ON ship_to_copies REFERENCING OLD TABLE AS lc_old NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_child_upd('order', 'parent', 'orderId');
DROP TRIGGER IF EXISTS trg_live_changes_ship_to_copies_del ON ship_to_copies;
CREATE TRIGGER trg_live_changes_ship_to_copies_del AFTER DELETE ON ship_to_copies REFERENCING OLD TABLE AS lc_old
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_child_del('order', 'parent', 'orderId');

DROP TRIGGER IF EXISTS trg_live_changes_ship_to_copies_mo_ins ON ship_to_copies;
CREATE TRIGGER trg_live_changes_ship_to_copies_mo_ins AFTER INSERT ON ship_to_copies REFERENCING NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_child_ins('mail_order', 'parent', 'moOrderId');
DROP TRIGGER IF EXISTS trg_live_changes_ship_to_copies_mo_upd ON ship_to_copies;
CREATE TRIGGER trg_live_changes_ship_to_copies_mo_upd AFTER UPDATE ON ship_to_copies REFERENCING OLD TABLE AS lc_old NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_child_upd('mail_order', 'parent', 'moOrderId');
DROP TRIGGER IF EXISTS trg_live_changes_ship_to_copies_mo_del ON ship_to_copies;
CREATE TRIGGER trg_live_changes_ship_to_copies_mo_del AFTER DELETE ON ship_to_copies REFERENCING OLD TABLE AS lc_old
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_child_del('mail_order', 'parent', 'moOrderId');


-- ── PART 5. Read-back (read-only, last statement) ──────────────────────────
-- Expect: 5 rows in section 1 (one per new column) · 15 rows in section 2
-- (one per new or rewritten constraint, with its live text) · 5 rows in
-- section 3 (pkey, storagePath unique, 3 indexes) · 6 rows in section 4 (one per trigger, all 'O' =
-- enabled) · section 5: column count 11, rows 0 · section 6: trip_drops rows,
-- 0 failing, 0 using t:.
SELECT * FROM (
  SELECT '1 column'::text AS section,
         (c.table_name::text || '.' || c.column_name::text) AS item,
         (c.data_type::text || ' · nullable ' || c.is_nullable::text) AS detail
    FROM information_schema.columns c
   WHERE c.table_schema = 'public'
     AND ((c.table_name IN ('mo_orders', 'orders') AND c.column_name IN ('shipToText', 'shipToAreaId'))
       OR (c.table_name = 'trip_drops' AND c.column_name = 'shipToText'))
  UNION ALL
  SELECT '2 constraint'::text,
         (con.conrelid::regclass::text || '.' || con.conname::text),
         pg_get_constraintdef(con.oid)::text
    FROM pg_constraint con
   WHERE con.conname IN ('mo_orders_shipToAreaId_fkey', 'chk_mo_orders_ship_to_text',
                         'orders_shipToAreaId_fkey', 'chk_orders_ship_to_text',
                         'chk_trip_drops_key', 'chk_trip_drops_ship_to_text',
                         'ship_to_copies_storagePath_key',
                         'ship_to_copies_orderId_fkey', 'ship_to_copies_moOrderId_fkey',
                         'ship_to_copies_uploadedById_fkey', 'ship_to_copies_removedById_fkey',
                         'chk_ship_to_copies_content_type', 'chk_ship_to_copies_size_positive',
                         'chk_ship_to_copies_owner', 'chk_ship_to_copies_removed_complete')
  UNION ALL
  SELECT '3 index'::text, i.indexname::text, i.indexdef::text
    FROM pg_indexes i
   WHERE i.schemaname = 'public' AND i.tablename = 'ship_to_copies'
  UNION ALL
  SELECT '4 trigger'::text,
         t.tgname::text,
         (p.proname::text || ' · enabled ' || t.tgenabled::text)
    FROM pg_trigger t
    JOIN pg_proc p ON p.oid = t.tgfoid
   WHERE t.tgrelid = to_regclass('public.ship_to_copies') AND NOT t.tgisinternal
  UNION ALL
  SELECT '5 ship_to_copies'::text,
         'columns · rows'::text,
         ((SELECT count(*) FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'ship_to_copies')::text
          || ' · ' || (SELECT count(*) FROM ship_to_copies)::text)
  UNION ALL
  SELECT '6 trip_drops'::text,
         'rows · failing new key · t: rows'::text,
         (count(*)::text
          || ' · ' || count(*) FILTER (WHERE "dropKey" IS DISTINCT FROM
               CASE WHEN "shipToText" IS NOT NULL THEN 't:' || "shipToText"
                    WHEN "customerId" IS NOT NULL THEN 'c:' || "customerId"::text
                    ELSE 's:' || "shipToCode" END)::text
          || ' · ' || count(*) FILTER (WHERE "dropKey" LIKE 't:%')::text)
    FROM trip_drops
) r
ORDER BY r.section, r.item;


-- ═══════════════════════════════════════════════════════════════════════════
-- BUCKET — by hand in Supabase Storage (SQL cannot create it, as for mrn-photos)
-- ═══════════════════════════════════════════════════════════════════════════
--  1. Supabase dashboard → Storage → "New bucket".
--  2. Name: ship-to-challans   (exactly; the code will use this string).
--  3. Public bucket: OFF (private). Files are only ever read through signed
--     URLs (300 s) minted by the server with the service-role key.
--  4. Restrict file size: ON, 4 MB. (The server's own cap stays under Vercel's
--     ~4.5 MB request limit; the bucket limit is the backstop.)
--  5. Allowed MIME types: image/jpeg, image/png, application/pdf
--  6. Save. Add NO policies. Leave the bucket with zero RLS policies, like
--     mrn-photos: only the server (service role) touches it.
--  7. Check: Storage lists ship-to-challans as Private with 4 MB and the three
--     types. Tell Claude when done; nothing in the app uses it until step 5.
--
--  ⚠ Do NOT put these files in attendance-photos. Its purge cron
--    (app/api/cron/attendance-purge) deletes objects from that bucket, and these
--    copies must never be purged. Do not reuse mrn-photos either: one bucket per
--    document kind (CLAUDE_MRN.md §4.1).
-- ═══════════════════════════════════════════════════════════════════════════
