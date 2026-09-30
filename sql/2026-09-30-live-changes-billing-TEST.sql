-- sql/2026-09-30-live-changes-billing-TEST.sql — prove the 9 Billing live-changes triggers + the widened CHECK,
-- LEAVING NO TRACE
--
-- Run AFTER sql/2026-09-30-live-changes-billing.sql, in the Supabase SQL Editor, as ONE statement.
--
-- 🟢 THE SUCCESS SIGNAL IS AN ERROR:  ERROR:  TEST OK — rolled back (…)
--    Raising it aborts the transaction, so every change this test made — to mo_orders, so_tags,
--    pick_findings and live_changes — is undone. Any OTHER message ("TEST FAILED …" or a real SQL error)
--    means stop and report it. The NOTICE lines above it list each check.
--
-- WHAT IT DOES (one transaction, always rolled back), on the newest row of each table:
--   mo_orders
--     (a) a real NO-OP UPDATE ("receivedAt" set to itself)                          → expect 0 lines
--     (b) an "updatedAt"-ONLY UPDATE — and trg_mo_orders_updated_at (BEFORE UPDATE) re-stamps it to
--         now() anyway; the test also PROVES that stamp happened (the column really moved)   → expect 0 lines
--     (c) a real CHANGE ("receivedAt" + 1 second)       → expect ≥ 1 line, entity 'mail_order', entityId = the id
--   so_tags
--     (a) no-op ("expiresAt" to itself) → 0 · (b) "updatedAt"-only (+ 1 s) → 0 ·
--     (c) "expiresAt" + 1 second                         → ≥ 1 line, entity 'so_tag', entityId = the id
--   pick_findings (no "updatedAt" column)
--     (a) no-op ("createdAt" to itself) → 0 ·
--     (c) "createdAt" + 1 second                         → ≥ 1 line, entity 'order', entityId = its "orderId"
--   A line that the OLD CHECK would have rejected is swallowed by the trigger as a WARNING — so a
--   'mail_order' / 'so_tag' hit in (c) ALSO proves the CHECK was widened.
--   Only lines written by THIS transaction ("txId" = pg_current_xact_id()) and by that source table are
--   counted, so live traffic cannot skew the numbers. Nothing is INSERTed or DELETEd in a business table
--   (the INSERT / DELETE functions are step 4's generic ones, already proven there).
--   A table with no rows is SKIPPED with a NOTICE (not a failure).
--
-- "NO TRACE", precisely: no row survives. Not transactional, all harmless: the live_changes identity
-- sequence advances (gaps in seq are expected), a few dead tuples await autovacuum, WAL is written, and
-- each picked row is row-locked for the milliseconds the block runs. Run it after hours.

DO $$
DECLARE
  v_tx       xid8 := pg_current_xact_id();
  v_id       int;
  v_parent   int;
  v_mark     bigint;
  v_n        int;
  v_hits     int;
  v_before   timestamptz;
  v_after    timestamptz;
  v_checked  int := 0;
  v_skipped  int := 0;
  v_failed   int := 0;
  v_fail_txt text := '';
BEGIN
  -- ── mo_orders ───────────────────────────────────────────────────────────────────────────────
  SELECT id INTO v_id FROM mo_orders ORDER BY id DESC LIMIT 1;
  IF v_id IS NULL THEN
    RAISE NOTICE 'mo_orders — SKIPPED (no rows)';
    v_skipped := v_skipped + 1;
  ELSE
    -- (a) no-op
    SELECT coalesce(max(seq), 0) INTO v_mark FROM live_changes WHERE "txId" = v_tx;
    UPDATE mo_orders SET "receivedAt" = "receivedAt" WHERE id = v_id;
    SELECT count(*) INTO v_n FROM live_changes WHERE "txId" = v_tx AND seq > v_mark AND "sourceTable" = 'mo_orders';
    v_checked := v_checked + 1;
    IF v_n = 0 THEN RAISE NOTICE 'mo_orders (a) no-op — ok (0 lines)';
    ELSE v_failed := v_failed + 1; v_fail_txt := v_fail_txt || format(' mo_orders(a)=%s', v_n);
         RAISE NOTICE 'mo_orders (a) no-op — FAILED (% lines)', v_n; END IF;

    -- (b) "updatedAt" only — the BEFORE trigger stamps now(); prove it moved AND nothing was recorded.
    SELECT "updatedAt" INTO v_before FROM mo_orders WHERE id = v_id;
    SELECT coalesce(max(seq), 0) INTO v_mark FROM live_changes WHERE "txId" = v_tx;
    UPDATE mo_orders SET "updatedAt" = "updatedAt" - interval '1 day' WHERE id = v_id;
    SELECT "updatedAt" INTO v_after FROM mo_orders WHERE id = v_id;
    SELECT count(*) INTO v_n FROM live_changes WHERE "txId" = v_tx AND seq > v_mark AND "sourceTable" = 'mo_orders';
    v_checked := v_checked + 1;
    IF v_n = 0 AND v_after IS DISTINCT FROM v_before - interval '1 day' THEN
      RAISE NOTICE 'mo_orders (b) updatedAt-only — ok (0 lines; the stamp trigger re-stamped it: % → %)', v_before, v_after;
    ELSE
      v_failed := v_failed + 1; v_fail_txt := v_fail_txt || format(' mo_orders(b)=%s', v_n);
      RAISE NOTICE 'mo_orders (b) updatedAt-only — FAILED (% lines; before % after %)', v_n, v_before, v_after;
    END IF;

    -- (c) real change
    SELECT coalesce(max(seq), 0) INTO v_mark FROM live_changes WHERE "txId" = v_tx;
    UPDATE mo_orders SET "receivedAt" = "receivedAt" + interval '1 second' WHERE id = v_id;
    SELECT count(*) FILTER (WHERE entity = 'mail_order' AND "entityId" = v_id::text), count(*)
      INTO v_hits, v_n FROM live_changes WHERE "txId" = v_tx AND seq > v_mark AND "sourceTable" = 'mo_orders';
    v_checked := v_checked + 1;
    IF v_hits >= 1 THEN RAISE NOTICE 'mo_orders (c) change — ok (id %, % line(s), % mail_order)', v_id, v_n, v_hits;
    ELSE v_failed := v_failed + 1; v_fail_txt := v_fail_txt || format(' mo_orders(c) hits=%s lines=%s', v_hits, v_n);
         RAISE NOTICE 'mo_orders (c) change — FAILED (id %, % lines, % matching) — is the CHECK widened?', v_id, v_n, v_hits; END IF;
  END IF;

  -- ── so_tags ─────────────────────────────────────────────────────────────────────────────────
  v_id := NULL;
  SELECT id INTO v_id FROM so_tags ORDER BY id DESC LIMIT 1;
  IF v_id IS NULL THEN
    RAISE NOTICE 'so_tags — SKIPPED (no rows)';
    v_skipped := v_skipped + 1;
  ELSE
    SELECT coalesce(max(seq), 0) INTO v_mark FROM live_changes WHERE "txId" = v_tx;
    UPDATE so_tags SET "expiresAt" = "expiresAt" WHERE id = v_id;
    SELECT count(*) INTO v_n FROM live_changes WHERE "txId" = v_tx AND seq > v_mark AND "sourceTable" = 'so_tags';
    v_checked := v_checked + 1;
    IF v_n = 0 THEN RAISE NOTICE 'so_tags (a) no-op — ok (0 lines)';
    ELSE v_failed := v_failed + 1; v_fail_txt := v_fail_txt || format(' so_tags(a)=%s', v_n);
         RAISE NOTICE 'so_tags (a) no-op — FAILED (% lines)', v_n; END IF;

    SELECT coalesce(max(seq), 0) INTO v_mark FROM live_changes WHERE "txId" = v_tx;
    UPDATE so_tags SET "updatedAt" = "updatedAt" + interval '1 second' WHERE id = v_id;
    SELECT count(*) INTO v_n FROM live_changes WHERE "txId" = v_tx AND seq > v_mark AND "sourceTable" = 'so_tags';
    v_checked := v_checked + 1;
    IF v_n = 0 THEN RAISE NOTICE 'so_tags (b) updatedAt-only — ok (0 lines)';
    ELSE v_failed := v_failed + 1; v_fail_txt := v_fail_txt || format(' so_tags(b)=%s', v_n);
         RAISE NOTICE 'so_tags (b) updatedAt-only — FAILED (% lines)', v_n; END IF;

    SELECT coalesce(max(seq), 0) INTO v_mark FROM live_changes WHERE "txId" = v_tx;
    UPDATE so_tags SET "expiresAt" = "expiresAt" + interval '1 second' WHERE id = v_id;
    SELECT count(*) FILTER (WHERE entity = 'so_tag' AND "entityId" = v_id::text), count(*)
      INTO v_hits, v_n FROM live_changes WHERE "txId" = v_tx AND seq > v_mark AND "sourceTable" = 'so_tags';
    v_checked := v_checked + 1;
    IF v_hits >= 1 THEN RAISE NOTICE 'so_tags (c) change — ok (id %, % line(s), % so_tag)', v_id, v_n, v_hits;
    ELSE v_failed := v_failed + 1; v_fail_txt := v_fail_txt || format(' so_tags(c) hits=%s lines=%s', v_hits, v_n);
         RAISE NOTICE 'so_tags (c) change — FAILED (id %, % lines, % matching) — is the CHECK widened?', v_id, v_n, v_hits; END IF;
  END IF;

  -- ── pick_findings ───────────────────────────────────────────────────────────────────────────
  v_id := NULL;
  SELECT id, "orderId" INTO v_id, v_parent FROM pick_findings ORDER BY id DESC LIMIT 1;
  IF v_id IS NULL THEN
    RAISE NOTICE 'pick_findings — SKIPPED (no rows)';
    v_skipped := v_skipped + 1;
  ELSE
    SELECT coalesce(max(seq), 0) INTO v_mark FROM live_changes WHERE "txId" = v_tx;
    UPDATE pick_findings SET "createdAt" = "createdAt" WHERE id = v_id;
    SELECT count(*) INTO v_n FROM live_changes WHERE "txId" = v_tx AND seq > v_mark AND "sourceTable" = 'pick_findings';
    v_checked := v_checked + 1;
    IF v_n = 0 THEN RAISE NOTICE 'pick_findings (a) no-op — ok (0 lines)';
    ELSE v_failed := v_failed + 1; v_fail_txt := v_fail_txt || format(' pick_findings(a)=%s', v_n);
         RAISE NOTICE 'pick_findings (a) no-op — FAILED (% lines)', v_n; END IF;

    SELECT coalesce(max(seq), 0) INTO v_mark FROM live_changes WHERE "txId" = v_tx;
    UPDATE pick_findings SET "createdAt" = "createdAt" + interval '1 second' WHERE id = v_id;
    SELECT count(*) FILTER (WHERE entity = 'order' AND "entityId" = v_parent::text), count(*)
      INTO v_hits, v_n FROM live_changes WHERE "txId" = v_tx AND seq > v_mark AND "sourceTable" = 'pick_findings';
    v_checked := v_checked + 1;
    IF v_hits >= 1 THEN RAISE NOTICE 'pick_findings (c) change — ok (id %, order %, % line(s))', v_id, v_parent, v_n;
    ELSE v_failed := v_failed + 1; v_fail_txt := v_fail_txt || format(' pick_findings(c) hits=%s lines=%s', v_hits, v_n);
         RAISE NOTICE 'pick_findings (c) change — FAILED (id %, order %, % lines, % matching)', v_id, v_parent, v_n, v_hits; END IF;
  END IF;

  IF v_failed = 0 THEN
    RAISE EXCEPTION 'TEST OK — rolled back (% checks, % tables skipped with no rows, 0 failed)', v_checked, v_skipped;
  ELSE
    RAISE EXCEPTION 'TEST FAILED — rolled back (% checks, % skipped, % failed:%)', v_checked, v_skipped, v_failed, v_fail_txt;
  END IF;
END
$$;
