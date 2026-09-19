-- ════════════════════════════════════════════════════════════════════════════
-- sql-2026-09-18-canon-sweep-live-check.sql
--
-- READ-ONLY live check for the questions in
--   docs/prompts/drafts/code-discovery-2026-09-18-canon-sweep.md  §3 + §8 (Q1–Q9)
-- plus Q10 (column existence for §3's unversioned columns) and Q11 (mo_orders
-- triggers).
--
-- • SELECT ONLY. No INSERT / UPDATE / DELETE / DDL. No BEGIN / COMMIT.
-- • ONE statement: the Supabase SQL Editor shows only the last result, so every
--   question is a branch of a single UNION ALL. Output = one grid,
--   three text columns: section | label | value.
-- • Every value is cast to text. Rows are ordered by section, then label.
-- • Table / column names taken from prisma/schema.prisma (2026-09-18, HEAD
--   ec6343ba). No model here uses @@map, so table name = model name.
-- • Role "slug" is DERIVED, not stored: lib/auth.ts:217 computes
--   lower(role_master.name) with whitespace → "_". Q7/Q8 use the same rule.
--
-- Paste the whole file into the SQL Editor and run it once.
-- ════════════════════════════════════════════════════════════════════════════

SELECT section, label, value
FROM (

  -- ── Q1 · billing_settings — every row (is the Billing rollout ALL_USERS?) ──
  SELECT
    'Q01 billing_settings'::text                          AS section,
    ('scope=' || bs.scope)::text                          AS label,
    ('rolloutStage=' || bs."rolloutStage"
      || ' | updatedAt=' || coalesce(bs."updatedAt"::text, 'null')
      || ' | updatedById=' || coalesce(bs."updatedById"::text, 'null'))::text AS value
  FROM billing_settings bs

  UNION ALL
  -- Q1 guard: say so explicitly if the table is empty (flag.ts reads that as OFF)
  SELECT 'Q01 billing_settings', 'row count', count(*)::text
  FROM billing_settings

  -- ── Q2 · ACCESS_SOURCE — stored in system_config (lib/access/source.ts) ─────
  -- Only the exact trimmed/lower-cased string "user" turns user mode on;
  -- anything else (incl. a missing row) means "role".
  UNION ALL
  SELECT
    'Q02 ACCESS_SOURCE',
    'system_config.value (raw, quoted)',
    coalesce('"' || sc.value || '"', 'ROW MISSING → role mode')
  FROM (SELECT 'ACCESS_SOURCE'::text AS k) want
  LEFT JOIN system_config sc ON sc.key = want.k

  UNION ALL
  SELECT
    'Q02 ACCESS_SOURCE',
    'effective mode',
    CASE WHEN lower(trim(coalesce(sc.value, ''))) = 'user' THEN 'user' ELSE 'role' END
  FROM (SELECT 'ACCESS_SOURCE'::text AS k) want
  LEFT JOIN system_config sc ON sc.key = want.k

  -- ── Q3a · user_page_access — counts per page key ───────────────────────────
  -- Zero-row keys still appear (LEFT JOIN from the wanted list).
  UNION ALL
  SELECT
    'Q03a user_page_access counts',
    k.page_key,
    ('rows=' || count(upa.id)::text
      || ' | canView=' || (count(upa.id) FILTER (WHERE upa."canView"))::text
      || ' | canEdit=' || (count(upa.id) FILTER (WHERE upa."canEdit"))::text
      || ' | canExport=' || (count(upa.id) FILTER (WHERE upa."canExport"))::text)::text
  FROM (VALUES
    ('billing_picking'), ('billing_print'), ('billing_hold'), ('billing_slot'),
    ('billing_urgent'), ('billing_ship_to'), ('place_order_ship_to'),
    ('tint_panel_items'), ('tint_panel_details'), ('tint_panel_activity'),
    ('reports_tint_summary'), ('reports_ti_report'), ('mrn'), ('ci'), ('floor')
  ) AS k(page_key)
  LEFT JOIN user_page_access upa ON upa."pageKey" = k.page_key
  GROUP BY k.page_key

  -- ── Q3b · who holds canView on tint_panel_* and reports_* ──────────────────
  UNION ALL
  SELECT
    'Q03b holders (canView)',
    k.page_key,
    coalesce(
      (SELECT string_agg(u.name || ' (#' || u.id::text || CASE WHEN u."isActive" THEN '' ELSE ', inactive' END || ')',
                         ', ' ORDER BY u.name)
       FROM user_page_access upa
       JOIN users u ON u.id = upa."userId"
       WHERE upa."pageKey" = k.page_key AND upa."canView"),
      'NOBODY')
  FROM (VALUES
    ('tint_panel_items'), ('tint_panel_details'), ('tint_panel_activity'),
    ('reports_tint_summary'), ('reports_ti_report')
  ) AS k(page_key)

  -- ── Q4 · app_settings — every row (is picking.visibilityGate ON?) ──────────
  UNION ALL
  SELECT
    'Q04 app_settings',
    s."settingKey",
    ('isEnabled=' || s."isEnabled"::text
      || ' | updatedAt=' || coalesce(s."updatedAt"::text, 'null')
      || ' | updatedBy=' || coalesce(u.name, s."updatedById"::text, 'null'))::text
  FROM app_settings s
  LEFT JOIN users u ON u.id = s."updatedById"

  UNION ALL
  -- Q4 guard: the gate key specifically (no row ⇒ gate OFF, per visibility-gate.ts)
  SELECT
    'Q04 app_settings',
    'picking.visibilityGate (effective)',
    CASE WHEN s.id IS NULL THEN 'ROW MISSING → OFF'
         WHEN s."isEnabled" THEN 'ON' ELSE 'OFF' END
  FROM (SELECT 'picking.visibilityGate'::text AS k) want
  LEFT JOIN app_settings s ON s."settingKey" = want.k

  -- ── Q5a · constraints on trips / trip_drops / trip_activity / app_tag_settings
  UNION ALL
  SELECT
    'Q05a constraints',
    (cl.relname::text || '.' || con.conname::text || ' [' || con.contype::text || ']')::text,
    pg_get_constraintdef(con.oid)::text
  FROM pg_constraint con
  JOIN pg_class cl      ON cl.oid = con.conrelid
  JOIN pg_namespace ns  ON ns.oid = cl.relnamespace
  WHERE ns.nspname = 'public'
    AND cl.relname IN ('trips', 'trip_drops', 'trip_activity', 'app_tag_settings')

  -- ── Q5b · indexes on the same four tables ──────────────────────────────────
  UNION ALL
  SELECT
    'Q05b indexes',
    (ix.tablename::text || '.' || ix.indexname::text)::text,
    ix.indexdef::text
  FROM pg_indexes ix
  WHERE ix.schemaname = 'public'
    AND ix.tablename IN ('trips', 'trip_drops', 'trip_activity', 'app_tag_settings')

  -- ── Q6a · mrn_lines."deliveryNo" default (was the deferred DROP DEFAULT run?)
  UNION ALL
  SELECT
    'Q06a mrn_lines.deliveryNo',
    'column_default | is_nullable | data_type',
    (coalesce(c.column_default::text, 'NULL (no default — DROP DEFAULT was run)')
      || ' | ' || c.is_nullable::text || ' | ' || c.data_type::text)::text
  FROM (SELECT 1 AS one) dummy
  LEFT JOIN information_schema.columns c
    ON c.table_schema = 'public' AND c.table_name = 'mrn_lines' AND c.column_name = 'deliveryNo'

  -- ── Q6b · constraint names + definitions on mrn and mrn_photos ─────────────
  UNION ALL
  SELECT
    'Q06b mrn constraints',
    (cl.relname::text || '.' || con.conname::text || ' [' || con.contype::text || ']')::text,
    pg_get_constraintdef(con.oid)::text
  FROM pg_constraint con
  JOIN pg_class cl      ON cl.oid = con.conrelid
  JOIN pg_namespace ns  ON ns.oid = cl.relnamespace
  WHERE ns.nspname = 'public'
    AND cl.relname IN ('mrn', 'mrn_photos')

  -- ── Q7a · role_master count + derived slugs ────────────────────────────────
  UNION ALL
  SELECT 'Q07a role_master', 'row count', count(*)::text
  FROM role_master

  UNION ALL
  SELECT
    'Q07a role_master',
    ('id ' || lpad(rm.id::text, 3, '0'))::text,
    (rm.name || '  → slug ' || regexp_replace(lower(rm.name), '\s+', '_', 'g'))::text
  FROM role_master rm

  -- ── Q7b · users holding floor_access (primary role OR user_roles) ──────────
  UNION ALL
  SELECT
    'Q07b floor_access holders',
    (u.name || ' (#' || u.id::text || ')')::text,
    ('via ' || string_agg(DISTINCT src.via, ' + ')
      || CASE WHEN u."isActive" THEN '' ELSE ' | INACTIVE' END)::text
  FROM (
    SELECT u2.id AS user_id, 'primary role' AS via
    FROM users u2
    JOIN role_master r ON r.id = u2."roleId"
    WHERE regexp_replace(lower(r.name), '\s+', '_', 'g') = 'floor_access'
    UNION ALL
    SELECT ur."userId", 'user_roles'
    FROM user_roles ur
    JOIN role_master r ON r.id = ur."roleId"
    WHERE regexp_replace(lower(r.name), '\s+', '_', 'g') = 'floor_access'
  ) src
  JOIN users u ON u.id = src.user_id
  GROUP BY u.id, u.name, u."isActive"

  UNION ALL
  SELECT 'Q07b floor_access holders', 'total distinct users', count(DISTINCT x.user_id)::text
  FROM (
    SELECT u2.id AS user_id FROM users u2 JOIN role_master r ON r.id = u2."roleId"
    WHERE regexp_replace(lower(r.name), '\s+', '_', 'g') = 'floor_access'
    UNION ALL
    SELECT ur."userId" FROM user_roles ur JOIN role_master r ON r.id = ur."roleId"
    WHERE regexp_replace(lower(r.name), '\s+', '_', 'g') = 'floor_access'
  ) x

  -- ── Q7c · floor canView TRUE but canEdit FALSE (would hit the trips-403) ───
  UNION ALL
  SELECT
    'Q07c floor view-only',
    (u.name || ' (#' || u.id::text || ')')::text,
    ('canView=true canEdit=false' || CASE WHEN u."isActive" THEN '' ELSE ' | INACTIVE' END)::text
  FROM user_page_access upa
  JOIN users u ON u.id = upa."userId"
  WHERE upa."pageKey" = 'floor' AND upa."canView" AND NOT upa."canEdit"

  UNION ALL
  SELECT 'Q07c floor view-only', 'count', count(*)::text
  FROM user_page_access upa
  WHERE upa."pageKey" = 'floor' AND upa."canView" AND NOT upa."canEdit"

  -- ── Q8 · Chandresh — primary role + every user_roles row (looked up by NAME)
  UNION ALL
  SELECT
    'Q08 Chandresh roles',
    (u.name || ' (#' || u.id::text || ') primary')::text,
    (pr.name || CASE WHEN u."isActive" THEN '' ELSE ' | INACTIVE' END)::text
  FROM users u
  JOIN role_master pr ON pr.id = u."roleId"
  WHERE u.name ILIKE '%chandresh%'

  UNION ALL
  SELECT
    'Q08 Chandresh roles',
    (u.name || ' (#' || u.id::text || ') user_roles')::text,
    coalesce(string_agg(r.name, ', ' ORDER BY r.name), 'NO user_roles ROWS')
  FROM users u
  LEFT JOIN user_roles ur  ON ur."userId" = u.id
  LEFT JOIN role_master r  ON r.id = ur."roleId"
  WHERE u.name ILIKE '%chandresh%'
  GROUP BY u.id, u.name

  UNION ALL
  SELECT 'Q08 Chandresh roles', 'users matched by name', count(*)::text
  FROM users u
  WHERE u.name ILIKE '%chandresh%'

  -- ── Q9 · orders at workflowStage = 'dispatched' ────────────────────────────
  UNION ALL
  SELECT 'Q09 dispatched', 'orders.workflowStage = dispatched (all)', count(*)::text
  FROM orders o
  WHERE o."workflowStage" = 'dispatched'

  UNION ALL
  SELECT 'Q09 dispatched', 'orders.workflowStage = dispatched AND NOT isRemoved', count(*)::text
  FROM orders o
  WHERE o."workflowStage" = 'dispatched' AND o."isRemoved" = false

  -- ── Q10a · column existence for §3's unversioned columns ───────────────────
  UNION ALL
  SELECT
    'Q10a columns',
    (w.tbl || '.' || w.col)::text,
    CASE WHEN c.column_name IS NULL THEN 'MISSING'
         ELSE (c.data_type::text || ' | nullable=' || c.is_nullable::text
               || ' | default=' || coalesce(c.column_default::text, 'none')) END
  FROM (VALUES
    ('orders', 'tripDropId'), ('orders', 'pickVisibleAt'), ('orders', 'pickVisibleById'),
    ('orders', 'loadedAt'), ('orders', 'loadedById'),
    ('route_master', 'bayNumber'),
    ('transporter_master', 'isRealTransporter'),
    ('users', 'notesFontSize'),
    ('mo_orders', 'updatedAt'),
    ('app_tag_settings', 'scope'), ('app_tag_settings', 'roleSlug'), ('app_tag_settings', 'userId')
  ) AS w(tbl, col)
  LEFT JOIN information_schema.columns c
    ON c.table_schema = 'public' AND c.table_name = w.tbl AND c.column_name = w.col

  -- ── Q10b · table existence ─────────────────────────────────────────────────
  UNION ALL
  SELECT
    'Q10b tables',
    w.tbl,
    CASE WHEN t.table_name IS NULL THEN 'MISSING' ELSE 'exists (' || t.table_type::text || ')' END
  FROM (VALUES ('trips'), ('trip_drops'), ('trip_activity'), ('app_settings')) AS w(tbl)
  LEFT JOIN information_schema.tables t
    ON t.table_schema = 'public' AND t.table_name = w.tbl

  -- ── Q11 · triggers on mo_orders (trg_mo_orders_updated_at expected) ────────
  UNION ALL
  SELECT
    'Q11 mo_orders triggers',
    tr.trigger_name::text,
    (tr.action_timing::text || ' ' || tr.event_manipulation::text || ' → ' || tr.action_statement::text)::text
  FROM information_schema.triggers tr
  WHERE tr.event_object_schema = 'public' AND tr.event_object_table = 'mo_orders'

  UNION ALL
  SELECT 'Q11 mo_orders triggers', 'trigger rows (0 = none)', count(*)::text
  FROM information_schema.triggers tr
  WHERE tr.event_object_schema = 'public' AND tr.event_object_table = 'mo_orders'

) AS sweep
ORDER BY section, label;
