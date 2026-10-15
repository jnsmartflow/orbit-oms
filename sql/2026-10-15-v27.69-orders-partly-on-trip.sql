-- ============================================================================
-- 2026-10-15 · Schema v27.69 · Add invoices, Phase 5 commit 2 (P5-2):
-- orders."partlyOnTrip" — a DUAL-WRITTEN flag so the Floor board / marker keep
-- their index plan while reading "per invoice" trip facts.
--
-- WHY (owner decision 5, 2026-10-13: "a dual-written orders column is allowed
-- ONLY if the board query plan regresses"). It did. Reading the invoice rows
-- directly in the board's arms 3 + 4 and the desk rule, measured live
-- 2026-10-15 (EXPLAIN ANALYZE, the Floor marker read, 183 rows every shape):
--   old code 34 ms · rows-based 60 ms (+ Seq Scan on order_invoices, lost
--   orders_tripDropId_idx) · bounded-subquery variant 55 ms (same losses).
-- Owner chose this option on 2026-10-15.
--
-- MEANING:  orders."partlyOnTrip" = true ⇔ the OBD has at least one
--           order_invoices row ON a stop ("tripDropId" NOT NULL) AND at least
--           one row on NO stop. Only a split OBD can be true. Unsplit = false.
-- WRITER:   lib/order-invoices/trip-link.ts setRowsTrip — the ONLY trip-link
--           writer — sets it in the SAME single orders.update that writes the
--           derived orders."tripDropId" (no second orders write; the marker
--           keys on MAX(orders."updatedAt")). Recomputed from ALL the OBD's
--           rows after the row write, exactly like the derived stop.
-- READERS:  lib/floor/queries.ts arm 3 ("has an invoice on no trip" =
--           "tripDropId" IS NULL OR "partlyOnTrip"), arm 4 + lib/trips/
--           live-trips.ts desk rule (old orders shape OR a row check only for
--           "partlyOnTrip" OBDs), lib/tint/base-feed.ts.
-- ⚠ NOT a trigger, on purpose — same as every v27.66 derived rule
--   (app-maintained). A hand edit to order_invoices."tripDropId" must re-run
--   PART 3 below (it is the repair, and is re-runnable).
-- ⚠ Removing a stop: order_invoices_tripDropId_fkey is ON DELETE SET NULL, so a
--   deleted trip_drops row could flip a split OBD to "partly" without the app
--   writing the flag. The app only deletes a stop that holds NO invoice row
--   (lib/trips/drop.ts deleteTripDropIfEmpty), so it cannot happen through the
--   app; a hand DELETE must be followed by PART 3.
--
-- Evidence before (read-only, 2026-10-15): one split OBD live (order 18648,
-- 4 rows, all off any trip) → PART 3 is expected to set 0 rows true.
--
-- HOW TO RUN (Smart Flow, Supabase SQL Editor): run each PART on its own, in
-- order. No BEGIN/COMMIT. The editor shows only the last result. Every step is
-- guarded and re-runnable. Never with session_replication_role = replica
-- (CORE §13 — orders carries live_changes triggers).
-- ============================================================================


-- ============================================================================
-- PART 1 — READ-ONLY PRE-CHECK.
-- Expect: column_exists false · index_exists false · would_be_true 0 ·
--         split_obds 1 · orders <current count>.
-- ============================================================================
SELECT 'column_exists' AS chk,
       (EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'partlyOnTrip'))::text AS value
UNION ALL
SELECT 'index_exists',
       (EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'orders_partly_on_trip_idx'))::text
UNION ALL
SELECT 'would_be_true',
       (SELECT count(*) FROM (
          SELECT "orderId" FROM order_invoices GROUP BY "orderId"
          HAVING bool_or("tripDropId" IS NOT NULL) AND bool_or("tripDropId" IS NULL)) x)::text
UNION ALL
SELECT 'split_obds',
       (SELECT count(DISTINCT "orderId") FROM order_invoices WHERE seq > 1)::text
UNION ALL
SELECT 'orders', (SELECT count(*) FROM orders)::text;


-- ============================================================================
-- PART 2 — DDL. Re-runnable.
-- ADD COLUMN with a constant DEFAULT is metadata-only on Postgres 11+ (no table
-- rewrite, no row UPDATE, no trigger fires).
-- The index is PARTIAL — it holds only the "partlyOnTrip" rows (0 today), so it
-- costs nothing and makes "… OR "partlyOnTrip"" an index probe, not a scan.
-- Not expressible in Prisma (partial) → recorded as a model comment in
-- schema.prisma, never @@index (the order_invoices_held_idx precedent).
-- ============================================================================
ALTER TABLE orders ADD COLUMN IF NOT EXISTS "partlyOnTrip" boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS orders_partly_on_trip_idx ON orders (id) WHERE "partlyOnTrip";


-- ============================================================================
-- PART 3 — BACK-FILL / REPAIR. Re-runnable (IS DISTINCT FROM: writes only rows
-- whose flag is wrong). Expected on the first run: 0 rows (no split OBD is on a
-- trip today). Each changed row fires the orders live_changes trigger — the
-- intended feed for an open Floor.
-- ============================================================================
UPDATE orders o
   SET "partlyOnTrip" = x.v
  FROM (
        SELECT oi."orderId",
               (bool_or(oi."tripDropId" IS NOT NULL) AND bool_or(oi."tripDropId" IS NULL)) AS v
          FROM order_invoices oi
         GROUP BY oi."orderId"
       ) x
 WHERE x."orderId" = o.id
   AND o."partlyOnTrip" IS DISTINCT FROM x.v;


-- ============================================================================
-- PART 4 — RUN LAST, ALONE. READ-ONLY VERIFY.
-- Expect: column "boolean · NOT NULL · default false" · index definition
-- "CREATE INDEX orders_partly_on_trip_idx ON public.orders USING btree (id)
-- WHERE "partlyOnTrip"" · rows_true 0 · flag_mismatch 0 · orders_without_rows 0
-- · orders <current count>.
-- ============================================================================
SELECT 'column' AS chk,
       (SELECT data_type || ' · ' || CASE WHEN is_nullable = 'NO' THEN 'NOT NULL' ELSE 'NULL' END
               || ' · default ' || coalesce(column_default, 'none')
          FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'partlyOnTrip')::text AS value
UNION ALL
SELECT 'index', (SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'orders_partly_on_trip_idx')::text
UNION ALL
SELECT 'rows_true', (SELECT count(*) FROM orders WHERE "partlyOnTrip")::text
UNION ALL
SELECT 'flag_mismatch',
       (SELECT count(*) FROM orders o
          LEFT JOIN (SELECT "orderId", bool_or("tripDropId" IS NOT NULL) AND bool_or("tripDropId" IS NULL) AS v
                       FROM order_invoices GROUP BY "orderId") x ON x."orderId" = o.id
         WHERE o."partlyOnTrip" IS DISTINCT FROM coalesce(x.v, false))::text
UNION ALL
SELECT 'orders_without_rows',
       (SELECT count(*) FROM orders o WHERE NOT EXISTS (SELECT 1 FROM order_invoices oi WHERE oi."orderId" = o.id))::text
UNION ALL
SELECT 'orders', (SELECT count(*) FROM orders)::text;
