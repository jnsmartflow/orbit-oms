-- sql/2026-09-30-live-changes-step4-TEST.sql — prove the 69 step-4 live-changes triggers, LEAVING NO TRACE
--
-- Run AFTER sql/2026-09-30-live-changes-step4.sql, in the Supabase SQL Editor, as ONE statement.
--
-- 🟢 THE SUCCESS SIGNAL IS AN ERROR:  ERROR:  TEST OK — rolled back (…)
--    Raising it aborts the transaction, so EVERY change this test made — to the 23 tables and to
--    live_changes — is undone. Any OTHER message ("TEST FAILED …" or a real SQL error) means stop and
--    report it. The NOTICE lines above it list each table's result.
--
-- WHAT IT DOES (one transaction, always rolled back). For each of the 23 tables:
--   · picks one live row (newest by its key; import_obd_query_summary: one with an orderId) —
--     a table with no rows is SKIPPED with a NOTICE (not a failure);
--   · works out the ids the trigger should write for that row (the order id, the trip id, the
--     expanded pick_delete_decisions."orderIds", or the table name for a config table);
--   · (a) a real NO-OP UPDATE (the chosen column set to itself)        → expect 0 lines from that table;
--   · (b) a real CHANGE of one harmless column (a timestamp + 1 second, a counter + 100000, a flag
--     flipped, a jsonb key added — all undone by the final rollback)  → expect ≥ 1 line with the
--     right entity AND one of the expected ids.
--   Only lines written by THIS transaction ("txId" = pg_current_xact_id()) and by that source table
--   are counted, so live traffic cannot skew the numbers. Nothing is INSERTed or DELETEd in any
--   business table.
--
-- WHAT "NO TRACE" MEANS, precisely: no row in any table survives. Not transactional, all harmless:
-- the live_changes identity sequence advances (gaps in seq are expected), some dead tuples await
-- autovacuum, the transaction is written to WAL, and each picked row is row-locked for the few
-- milliseconds the block runs (incl. one app_settings row and one app_tag_settings row — their
-- flipped values are never visible to any other session). Run it after hours.

DO $$
DECLARE
  v_tx       xid8 := pg_current_xact_id();
  r          record;
  v_key      int;
  v_expected text[];
  v_mark     bigint;
  v_noop     int;
  v_hits     int;
  v_lines    int;
  v_checked  int := 0;
  v_skipped  int := 0;
  v_failed   int := 0;
  v_fail_txt text := '';
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      -- table,                     key column,       row filter,                    entity,   expected-ids expression (text[]),                      column,            change expression
      ('pick_assignments',          'id',             '',                            'order',  'ARRAY[order_id::text]',                                'assigned_at',     'assigned_at + interval ''1 second'''),
      ('tint_assignments',          'id',             '',                            'order',  'ARRAY["orderId"::text]',                               'createdAt',       'coalesce("createdAt", now()) + interval ''1 second'''),
      ('order_splits',              'id',             '',                            'order',  'ARRAY["orderId"::text]',                               'createdAt',       'coalesce("createdAt", now()) + interval ''1 second'''),
      ('import_obd_query_summary',  'id',             'WHERE "orderId" IS NOT NULL', 'order',  'ARRAY["orderId"::text]',                               'createdAt',       'coalesce("createdAt", now()) + interval ''1 second'''),
      ('ci_returns',                'id',             '',                            'order',  'ARRAY["orderId"::text]',                               'createdAt',       'coalesce("createdAt", now()) + interval ''1 second'''),
      ('so_tag_matches',            'id',             '',                            'order',  'ARRAY["orderId"::text]',                               'appliedAt',       'coalesce("appliedAt", now()) + interval ''1 second'''),
      ('pick_delete_decisions',     'id',             '',                            'order',  '"orderIds"::text[]',                                   'createdAt',       'coalesce("createdAt", now()) + interval ''1 second'''),
      ('trips',                     'id',             '',                            'trip',   'ARRAY[id::text]',                                      'createdAt',       'coalesce("createdAt", now()) + interval ''1 second'''),
      ('trip_drops',                'id',             '',                            'trip',   'ARRAY["tripId"::text]',                                'createdAt',       'coalesce("createdAt", now()) + interval ''1 second'''),
      ('trip_activity',             'id',             '',                            'trip',   'ARRAY["tripId"::text]',                                'createdAt',       'coalesce("createdAt", now()) + interval ''1 second'''),
      ('delivery_point_master',     'id',             '',                            'config', 'ARRAY[''delivery_point_master'']',                     'createdAt',       'coalesce("createdAt", now()) + interval ''1 second'''),
      ('area_master',               'id',             '',                            'config', 'ARRAY[''area_master'']',                               'createdAt',       'coalesce("createdAt", now()) + interval ''1 second'''),
      ('route_master',              'id',             '',                            'config', 'ARRAY[''route_master'']',                              'createdAt',       'coalesce("createdAt", now()) + interval ''1 second'''),
      ('delivery_type_master',      'id',             '',                            'config', 'ARRAY[''delivery_type_master'']',                      'createdAt',       'coalesce("createdAt", now()) + interval ''1 second'''),
      ('dispatch_slot_master',      'id',             '',                            'config', 'ARRAY[''dispatch_slot_master'']',                      'createdAt',       'coalesce("createdAt", now()) + interval ''1 second'''),
      ('vehicle_master',            'id',             '',                            'config', 'ARRAY[''vehicle_master'']',                            'createdAt',       'coalesce("createdAt", now()) + interval ''1 second'''),
      ('transporter_master',        'id',             '',                            'config', 'ARRAY[''transporter_master'']',                        'createdAt',       'coalesce("createdAt", now()) + interval ''1 second'''),
      ('route_clubs',               'id',             '',                            'config', 'ARRAY[''route_clubs'']',                               'createdAt',       'coalesce("createdAt", now()) + interval ''1 second'''),
      ('route_club_members',        'id',             '',                            'config', 'ARRAY[''route_club_members'']',                        'sortOrder',       '"sortOrder" + 100000'),
      ('load_plan_config',          'deliveryTypeId', '',                            'config', 'ARRAY[''load_plan_config'']',                          'config',          'config || ''{"_liveFeedTest": true}''::jsonb'),
      ('app_settings',              'id',             '',                            'config', 'ARRAY[''app_settings'']',                              'isEnabled',       'NOT "isEnabled"'),
      ('obd_visibility_rules',      'id',             '',                            'config', 'ARRAY[''obd_visibility_rules'']',                      'createdAt',       'coalesce("createdAt", now()) + interval ''1 second'''),
      ('app_tag_settings',          'id',             '',                            'config', 'ARRAY[''app_tag_settings'']',                          'isEnabled',       'NOT "isEnabled"')
    ) AS t(tbl, keycol, filter, entity, expected_expr, col, change_expr)
  LOOP
    v_key := NULL;
    EXECUTE format('SELECT %I FROM %I %s ORDER BY %I DESC LIMIT 1', r.keycol, r.tbl, r.filter, r.keycol) INTO v_key;
    IF v_key IS NULL THEN
      RAISE NOTICE '% — SKIPPED (no rows)', r.tbl;
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    EXECUTE format('SELECT %s FROM %I WHERE %I = $1', r.expected_expr, r.tbl, r.keycol) INTO v_expected USING v_key;

    -- (a) no-op
    SELECT coalesce(max(seq), 0) INTO v_mark FROM live_changes WHERE "txId" = v_tx;
    EXECUTE format('UPDATE %I SET %I = %I WHERE %I = $1', r.tbl, r.col, r.col, r.keycol) USING v_key;
    SELECT count(*) INTO v_noop FROM live_changes
     WHERE "txId" = v_tx AND seq > v_mark AND "sourceTable" = r.tbl;

    -- (b) real change
    SELECT coalesce(max(seq), 0) INTO v_mark FROM live_changes WHERE "txId" = v_tx;
    EXECUTE format('UPDATE %I SET %I = %s WHERE %I = $1', r.tbl, r.col, r.change_expr, r.keycol) USING v_key;
    SELECT count(*) FILTER (WHERE entity = r.entity AND "entityId" = ANY (v_expected)), count(*)
      INTO v_hits, v_lines
      FROM live_changes
     WHERE "txId" = v_tx AND seq > v_mark AND "sourceTable" = r.tbl;

    v_checked := v_checked + 1;
    IF v_noop = 0 AND v_hits >= 1 THEN
      RAISE NOTICE '% — ok (key %, no-op lines 0, change lines % incl. % matching % %)',
        r.tbl, v_key, v_lines, v_hits, r.entity, v_expected;
    ELSE
      v_failed := v_failed + 1;
      v_fail_txt := v_fail_txt || format(' %s(no-op=%s hits=%s lines=%s)', r.tbl, v_noop, v_hits, v_lines);
      RAISE NOTICE '% — FAILED (key %, no-op lines %, matching change lines %, all change lines %, expected % %)',
        r.tbl, v_key, v_noop, v_hits, v_lines, r.entity, v_expected;
    END IF;
  END LOOP;

  IF v_failed = 0 THEN
    RAISE EXCEPTION 'TEST OK — rolled back (% tables checked, % skipped with no rows, 0 failed)', v_checked, v_skipped;
  ELSE
    RAISE EXCEPTION 'TEST FAILED — rolled back (% checked, % skipped, % failed:%)', v_checked, v_skipped, v_failed, v_fail_txt;
  END IF;
END
$$;
