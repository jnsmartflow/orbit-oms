-- sql/2026-09-30-live-changes-TEST.sql — prove the `orders` live-changes trigger, LEAVING NO TRACE
--
-- Run AFTER sql/2026-09-30-live-changes.sql, in the Supabase SQL Editor, as ONE statement.
--
-- 🟢 THE SUCCESS SIGNAL IS AN ERROR. The block ends with
--        ERROR:  TEST OK — rolled back (…counts…)
--    That error is deliberate: raising it aborts the transaction, so EVERY change the test made
--    — to orders and to live_changes — is undone. Any OTHER message ("TEST FAILED …",
--    "TEST SKIPPED …", or a real SQL error) means stop and report it.
--
-- WHAT IT DOES (all inside one transaction that is always rolled back)
--   Picks the 3 most recent non-removed orders, then:
--   (e) FIRST — the trigger failing must not fail the order write: search_path is set to
--       pg_catalog for this transaction only (SET LOCAL semantics via set_config(…, true)), so the
--       trigger's `INSERT INTO live_changes` cannot find the table and raises. Expect: the
--       orders UPDATE still succeeds (1 row), the trigger emits a WARNING ("live_changes: orders
--       UPDATE not recorded …" — expected, it is the thing being tested), and 0 lines are
--       written. Done first so no cached plan from the later steps can mask it. No DDL, no locks
--       beyond the one order row, nothing visible to any other session.
--   (a) a no-op UPDATE (remarks = remarks)                          → expect 0 lines
--   (b) an UPDATE that moves only "updatedAt"                       → expect 0 lines
--   (c) a real change to one order (remarks gets a test suffix)     → expect 1 order line
--   (d) one UPDATE statement changing 3 orders                      → expect 3 order lines
--       (one statement = one trigger call; the 3 lines share one INSERT)
--   Trip lines (entity = 'trip', for orders on a trip) are counted and reported separately.
--   Only lines written by THIS transaction are counted ("txId" = pg_current_xact_id()), so
--   concurrent real traffic cannot skew the numbers.
--
-- WHAT "NO TRACE" MEANS, precisely: no row in orders or live_changes survives. Three things are
-- not transactional and do move, all harmless: the live_changes identity sequence advances
-- (gaps in seq are expected — the cursor never assumes contiguous seq), a few dead tuples
-- await autovacuum, and the transaction is written to WAL. The 3 order rows are row-locked for
-- the few milliseconds the block runs — run it after hours.

DO $$
DECLARE
  v_ids       int[];
  v_one       int;
  v_tx        xid8;
  v_mark      bigint;
  v_path      text;
  v_rows      int;
  n_fail      int;
  n_fail_rows int;
  n_noop      int;
  n_upd_only  int;
  n_real      int;
  n_three     int;
  n_trip      int;
BEGIN
  SELECT array_agg(id ORDER BY id DESC) INTO v_ids
    FROM (SELECT id FROM orders WHERE "isRemoved" = false ORDER BY id DESC LIMIT 3) t;
  IF v_ids IS NULL OR array_length(v_ids, 1) < 3 THEN
    RAISE EXCEPTION 'TEST SKIPPED — fewer than 3 non-removed orders';
  END IF;
  v_one := v_ids[1];

  -- (e) trigger failure must not fail the order write
  v_path := current_setting('search_path');
  PERFORM set_config('search_path', 'pg_catalog', true);
  UPDATE public.orders SET remarks = coalesce(remarks, '') || ' [live-feed fail test]' WHERE id = v_one;
  GET DIAGNOSTICS n_fail_rows = ROW_COUNT;
  PERFORM set_config('search_path', v_path, true);

  v_tx := pg_current_xact_id();   -- this transaction's id (assigned by the UPDATE above)
  SELECT count(*) INTO n_fail FROM live_changes WHERE "txId" = v_tx;

  -- (a) no-op
  SELECT coalesce(max(seq), 0) INTO v_mark FROM live_changes WHERE "txId" = v_tx;
  UPDATE orders SET remarks = remarks WHERE id = v_one;
  SELECT count(*) INTO n_noop FROM live_changes WHERE "txId" = v_tx AND seq > v_mark;

  -- (b) only "updatedAt" moves
  SELECT coalesce(max(seq), 0) INTO v_mark FROM live_changes WHERE "txId" = v_tx;
  UPDATE orders SET "updatedAt" = "updatedAt" + interval '1 second' WHERE id = v_one;
  SELECT count(*) INTO n_upd_only FROM live_changes WHERE "txId" = v_tx AND seq > v_mark;

  -- (c) one real change
  SELECT coalesce(max(seq), 0) INTO v_mark FROM live_changes WHERE "txId" = v_tx;
  UPDATE orders SET remarks = coalesce(remarks, '') || ' [live-feed test]' WHERE id = v_one;
  SELECT count(*) INTO n_real FROM live_changes
   WHERE "txId" = v_tx AND seq > v_mark AND entity = 'order' AND "entityId" = v_one::text;

  -- (d) three orders, one statement
  SELECT coalesce(max(seq), 0) INTO v_mark FROM live_changes WHERE "txId" = v_tx;
  UPDATE orders SET remarks = coalesce(remarks, '') || ' [live-feed test 3]' WHERE id = ANY (v_ids);
  SELECT count(*) INTO n_three FROM live_changes
   WHERE "txId" = v_tx AND seq > v_mark AND entity = 'order'
     AND "entityId" = ANY (SELECT unnest(v_ids)::text);

  SELECT count(*) INTO n_trip FROM live_changes WHERE "txId" = v_tx AND entity = 'trip';

  RAISE NOTICE 'orders tested: % · (e) write rows = % (expect 1), lines = % (expect 0) · (a) no-op lines = % (expect 0) · (b) updatedAt-only lines = % (expect 0) · (c) real-change lines = % (expect 1) · (d) 3-order lines = % (expect 3) · trip lines (info) = %',
    v_ids, n_fail_rows, n_fail, n_noop, n_upd_only, n_real, n_three, n_trip;

  IF n_fail_rows = 1 AND n_fail = 0 AND n_noop = 0 AND n_upd_only = 0 AND n_real = 1 AND n_three = 3 THEN
    RAISE EXCEPTION 'TEST OK — rolled back (e: write ok + 0 lines · a: 0 · b: 0 · c: 1 · d: 3 · trip lines: %)', n_trip;
  ELSE
    RAISE EXCEPTION 'TEST FAILED — rolled back (e: rows % lines % · a: % · b: % · c: % · d: % · trip lines: %)',
      n_fail_rows, n_fail, n_noop, n_upd_only, n_real, n_three, n_trip;
  END IF;
END
$$;
