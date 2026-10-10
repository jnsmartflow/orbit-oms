-- code-update-2026-10-10-floor-add-invoices-grant.sql
-- Floor · Add invoices — grants (DATA, never seed). ⚠ NOT RUN — Smart Flow pastes it.
-- floor_add_invoices canView + canEdit, one row per user. THE USER LIST IS THE
-- OWNER'S: PART 2 is deliberately left unrunnable until the ids are typed in.
-- Supabase SQL Editor, no BEGIN/COMMIT. The editor shows only the LAST result of
-- a paste, so run each PART on its own, in order.
--
-- OR-merge, never revoke: DO UPDATE only raises a flag (existing true stays true,
-- the other flags are untouched); a re-run changes nothing. A user id that does
-- not exist inserts nothing (the JOIN on users) and shows as "missing" in PART 3.
-- Target: UNIQUE ("userId","pageKey") user_page_access_user_page_key (CORE §7.14).
-- ⚠ canEdit alone draws nothing: Save / Undo also need `floor` canEdit
-- (app/api/floor/orders/[orderId]/invoices gate) — PARTS 1 and 3 show that column.
-- Other flags take their DB default false; createdAt/updatedAt DEFAULT now().
-- Template: docs/prompts/drafts/sql-2026-10-01-tint-shop-delivery-grant.sql.


-- ============================================================================
-- PART 1 — READ-ONLY. Who holds `floor` today, and their floor_add_invoices
-- tick (none yet). Pick the ids for PART 2 from here.
-- Tick columns read "view/edit"; "-" = no row (≡ all false).
-- ============================================================================

SELECT u.id::text                                   AS user_id,
       u.name::text                                 AS name,
       u."isActive"::text                           AS active,
       COALESCE(MAX(CASE WHEN a."pageKey" = 'floor'
                THEN a."canView"::text || '/' || a."canEdit"::text END), '-')::text AS floor,
       COALESCE(MAX(CASE WHEN a."pageKey" = 'floor_add_invoices'
                THEN a."canView"::text || '/' || a."canEdit"::text END), '-')::text AS floor_add_invoices
  FROM users u
  JOIN user_page_access f ON f."userId" = u.id AND f."pageKey" = 'floor' AND f."canView"
  LEFT JOIN user_page_access a
         ON a."userId" = u.id AND a."pageKey" IN ('floor', 'floor_add_invoices')
 GROUP BY u.id, u.name, u."isActive"
 ORDER BY u.name;


-- ============================================================================
-- PART 2 — THE GRANT. ⚠ Replace /*USER_IDS*/ with the owner's ids, e.g. (21, 32).
-- As written it is a syntax error ON PURPOSE, so it cannot run with no list.
-- Type the SAME ids into PART 3's VALUES list.
-- ============================================================================

INSERT INTO user_page_access ("userId", "pageKey", "canView", "canEdit")
SELECT u.id, 'floor_add_invoices', true, true
  FROM users u
 WHERE u.id IN (/*USER_IDS*/)
ON CONFLICT ON CONSTRAINT user_page_access_user_page_key
DO UPDATE SET "canView"   = user_page_access."canView" OR EXCLUDED."canView",
              "canEdit"   = user_page_access."canEdit" OR EXCLUDED."canEdit",
              "updatedAt" = now()
WHERE user_page_access."canView" = false OR user_page_access."canEdit" = false;


-- ============================================================================
-- PART 3 — READ-ONLY verify: one row per target user + one total row.
-- ⚠ Replace the VALUES list with the same ids as PART 2, one (id) each.
-- ============================================================================

SELECT 1::int AS ord,
       t.uid::text AS user_id,
       COALESCE(u.name, 'missing')::text AS name,
       COALESCE(MAX(CASE WHEN a."pageKey" = 'floor_add_invoices'
                THEN a."canView"::text || '/' || a."canEdit"::text END), '-')::text AS floor_add_invoices,
       COALESCE(MAX(CASE WHEN a."pageKey" = 'floor'
                THEN a."canView"::text || '/' || a."canEdit"::text END), '-')::text AS floor
  FROM (VALUES (/*USER_ID_1*/), (/*USER_ID_2*/)) AS t(uid)
  LEFT JOIN users u ON u.id = t.uid
  LEFT JOIN user_page_access a
         ON a."userId" = t.uid AND a."pageKey" IN ('floor_add_invoices', 'floor')
 GROUP BY t.uid, u.name
UNION ALL
SELECT 2,
       'TOTAL'::text,
       'floor_add_invoices rows'::text,
       (COUNT(*))::text || ' rows',
       (COUNT(*) FILTER (WHERE "canView" AND "canEdit"))::text || ' view+edit'
  FROM user_page_access
 WHERE "pageKey" = 'floor_add_invoices'
ORDER BY 1, 2;
-- Expected after PART 2: each target user → floor_add_invoices = true/true (floor
-- should read …/true for Save to work); TOTAL = one row per target, all view+edit.
