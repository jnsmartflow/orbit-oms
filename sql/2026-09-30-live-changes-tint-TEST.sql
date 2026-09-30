-- sql/2026-09-30-live-changes-tint-TEST.sql — prove the 3 delivery_challans live-changes triggers, LEAVING NO TRACE
--
-- Run AFTER sql/2026-09-30-live-changes-tint.sql, in the Supabase SQL Editor, as ONE statement.
-- Works whether or not sql/2026-09-30-live-changes-billing.sql has been run (entity 'order' only).
--
-- 🟢 THE SUCCESS SIGNAL IS AN ERROR:  ERROR:  TEST OK — rolled back (N checks, 0 failed)
--    Raising it aborts the transaction, so every change this test made — to delivery_challans and
--    live_changes — is undone. Any OTHER message ("TEST FAILED …" or a real SQL error) means stop and
--    report it. The NOTICE lines above it list each check.
--
-- WHAT IT DOES (one transaction, always rolled back)
--   On the NEWEST real challan (its "orderId" = the expected entityId):
--     1. NO-OP UPDATE (transporter set to itself)                         → expect 0 lines
--     2. "updatedAt"-ONLY UPDATE (+ 1 second; the test also proves it moved) → expect 0 lines
--     3. a real CHANGE (transporter gets ' ·lctest' appended)             → expect ≥ 1 line, entity 'order', op 'U'
--     4. VOID (isVoided flipped, voidedAt / voidReason set, as the remove route does) → expect ≥ 1 line
--   On a THROW-AWAY challan for the newest order that has none (orderId is UNIQUE):
--     5. INSERT it                                                       → expect ≥ 1 line for that order, op 'U'
--     6. DELETE it again                                                 → expect ≥ 1 line for that order, op 'U'
--   Only the throw-away row is inserted or deleted — never a real challan (delivery_challan_formulas
--   references challans; the throw-away row has none).
--   Only lines written by THIS transaction ("txId" = pg_current_xact_id()) from 'delivery_challans' are
--   counted, so live traffic cannot skew the numbers. No challans / no challan-less order → those checks
--   are SKIPPED with a NOTICE and counted as skipped, not failed.
--
-- "NO TRACE", precisely: no row survives. Not transactional, all harmless: the live_changes identity
-- sequence and the delivery_challans id sequence advance (gaps are expected), a few dead tuples await
-- autovacuum, WAL is written, and the picked challan / order are row-locked for the milliseconds the block
-- runs. The throw-away challan number is 'LCTEST-<txid>' and never becomes visible to another session.

DO $$
DECLARE
  v_tx       xid8 := pg_current_xact_id();
  v_id       int;
  v_order    int;
  v_new_id   int;
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
  -- ── 1–4 on the newest real challan ──────────────────────────────────────────────────────────
  SELECT id, "orderId" INTO v_id, v_order FROM delivery_challans ORDER BY id DESC LIMIT 1;
  IF v_id IS NULL THEN
    RAISE NOTICE 'delivery_challans 1-4 — SKIPPED (no rows)';
    v_skipped := v_skipped + 4;
  ELSE
    -- 1. no-op
    SELECT coalesce(max(seq), 0) INTO v_mark FROM live_changes WHERE "txId" = v_tx;
    UPDATE delivery_challans SET transporter = transporter WHERE id = v_id;
    SELECT count(*) INTO v_n FROM live_changes WHERE "txId" = v_tx AND seq > v_mark AND "sourceTable" = 'delivery_challans';
    v_checked := v_checked + 1;
    IF v_n = 0 THEN RAISE NOTICE '1 no-op — ok (challan %, 0 lines)', v_id;
    ELSE v_failed := v_failed + 1; v_fail_txt := v_fail_txt || format(' 1:no-op=%s', v_n);
         RAISE NOTICE '1 no-op — FAILED (% lines)', v_n; END IF;

    -- 2. "updatedAt" only — prove it moved AND nothing was recorded
    SELECT "updatedAt" INTO v_before FROM delivery_challans WHERE id = v_id;
    SELECT coalesce(max(seq), 0) INTO v_mark FROM live_changes WHERE "txId" = v_tx;
    UPDATE delivery_challans SET "updatedAt" = "updatedAt" + interval '1 second' WHERE id = v_id;
    SELECT "updatedAt" INTO v_after FROM delivery_challans WHERE id = v_id;
    SELECT count(*) INTO v_n FROM live_changes WHERE "txId" = v_tx AND seq > v_mark AND "sourceTable" = 'delivery_challans';
    v_checked := v_checked + 1;
    IF v_n = 0 AND v_after IS DISTINCT FROM v_before THEN
      RAISE NOTICE '2 updatedAt-only — ok (0 lines; % → %)', v_before, v_after;
    ELSE v_failed := v_failed + 1; v_fail_txt := v_fail_txt || format(' 2:updatedAt-only=%s', v_n);
         RAISE NOTICE '2 updatedAt-only — FAILED (% lines; before % after %)', v_n, v_before, v_after; END IF;

    -- 3. a real change
    SELECT coalesce(max(seq), 0) INTO v_mark FROM live_changes WHERE "txId" = v_tx;
    UPDATE delivery_challans SET transporter = coalesce(transporter, '') || ' ·lctest' WHERE id = v_id;
    SELECT count(*) FILTER (WHERE entity = 'order' AND "entityId" = v_order::text AND op = 'U'), count(*)
      INTO v_hits, v_n FROM live_changes WHERE "txId" = v_tx AND seq > v_mark AND "sourceTable" = 'delivery_challans';
    v_checked := v_checked + 1;
    IF v_hits >= 1 THEN RAISE NOTICE '3 change — ok (challan %, order %, % line(s))', v_id, v_order, v_n;
    ELSE v_failed := v_failed + 1; v_fail_txt := v_fail_txt || format(' 3:change hits=%s lines=%s', v_hits, v_n);
         RAISE NOTICE '3 change — FAILED (challan %, order %, % lines, % matching)', v_id, v_order, v_n, v_hits; END IF;

    -- 4. void
    SELECT coalesce(max(seq), 0) INTO v_mark FROM live_changes WHERE "txId" = v_tx;
    UPDATE delivery_challans
       SET "isVoided" = NOT "isVoided", "voidedAt" = now(), "voidReason" = coalesce("voidReason", 'lctest')
     WHERE id = v_id;
    SELECT count(*) FILTER (WHERE entity = 'order' AND "entityId" = v_order::text AND op = 'U'), count(*)
      INTO v_hits, v_n FROM live_changes WHERE "txId" = v_tx AND seq > v_mark AND "sourceTable" = 'delivery_challans';
    v_checked := v_checked + 1;
    IF v_hits >= 1 THEN RAISE NOTICE '4 void — ok (challan %, order %, % line(s))', v_id, v_order, v_n;
    ELSE v_failed := v_failed + 1; v_fail_txt := v_fail_txt || format(' 4:void hits=%s lines=%s', v_hits, v_n);
         RAISE NOTICE '4 void — FAILED (challan %, order %, % lines, % matching)', v_id, v_order, v_n, v_hits; END IF;
  END IF;

  -- ── 5–6 on a throw-away challan ─────────────────────────────────────────────────────────────
  v_order := NULL;
  SELECT o.id INTO v_order
    FROM orders o
   WHERE NOT EXISTS (SELECT 1 FROM delivery_challans c WHERE c."orderId" = o.id)
   ORDER BY o.id DESC LIMIT 1;
  IF v_order IS NULL THEN
    RAISE NOTICE 'delivery_challans 5-6 — SKIPPED (no order without a challan)';
    v_skipped := v_skipped + 2;
  ELSE
    -- 5. insert
    SELECT coalesce(max(seq), 0) INTO v_mark FROM live_changes WHERE "txId" = v_tx;
    INSERT INTO delivery_challans ("orderId", "challanNumber", "createdAt", "updatedAt")
    VALUES (v_order, 'LCTEST-' || v_tx::text, now(), now())
    RETURNING id INTO v_new_id;
    SELECT count(*) FILTER (WHERE entity = 'order' AND "entityId" = v_order::text AND op = 'U'), count(*)
      INTO v_hits, v_n FROM live_changes WHERE "txId" = v_tx AND seq > v_mark AND "sourceTable" = 'delivery_challans';
    v_checked := v_checked + 1;
    IF v_hits >= 1 THEN RAISE NOTICE '5 insert — ok (throw-away challan %, order %, % line(s))', v_new_id, v_order, v_n;
    ELSE v_failed := v_failed + 1; v_fail_txt := v_fail_txt || format(' 5:insert hits=%s lines=%s', v_hits, v_n);
         RAISE NOTICE '5 insert — FAILED (order %, % lines, % matching)', v_order, v_n, v_hits; END IF;

    -- 6. delete (the throw-away row only)
    SELECT coalesce(max(seq), 0) INTO v_mark FROM live_changes WHERE "txId" = v_tx;
    DELETE FROM delivery_challans WHERE id = v_new_id;
    SELECT count(*) FILTER (WHERE entity = 'order' AND "entityId" = v_order::text AND op = 'U'), count(*)
      INTO v_hits, v_n FROM live_changes WHERE "txId" = v_tx AND seq > v_mark AND "sourceTable" = 'delivery_challans';
    v_checked := v_checked + 1;
    IF v_hits >= 1 THEN RAISE NOTICE '6 delete — ok (throw-away challan %, order %, % line(s))', v_new_id, v_order, v_n;
    ELSE v_failed := v_failed + 1; v_fail_txt := v_fail_txt || format(' 6:delete hits=%s lines=%s', v_hits, v_n);
         RAISE NOTICE '6 delete — FAILED (order %, % lines, % matching)', v_order, v_n, v_hits; END IF;
  END IF;

  IF v_failed = 0 AND v_skipped = 0 THEN
    RAISE EXCEPTION 'TEST OK — rolled back (% checks, 0 failed)', v_checked;
  ELSIF v_failed = 0 THEN
    RAISE EXCEPTION 'TEST OK — rolled back (% checks, 0 failed, % skipped)', v_checked, v_skipped;
  ELSE
    RAISE EXCEPTION 'TEST FAILED — rolled back (% checks, % failed:%)', v_checked, v_failed, v_fail_txt;
  END IF;
END
$$;
