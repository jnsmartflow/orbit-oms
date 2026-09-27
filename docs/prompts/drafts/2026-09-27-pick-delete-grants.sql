-- 2026-09-27 · Billing Pick delete · build step 9 — grants (DATA, never seed)
-- billing_pick_delete canView + canEdit to exactly five users, resolved by name.
-- Supabase SQL Editor: no BEGIN/COMMIT.
-- RUN LIVE 2026-09-27 by Smart Flow: verify returned 5 rows, all billing_pick_delete view+edit.
--
-- FAIL SAFE: a name is granted only when it matches EXACTLY ONE user (active or
-- not). 0 or 2+ matches → nothing inserted for that name; the verify row shows
-- its match count so the gap is visible.
-- Target: UNIQUE ("userId","pageKey") user_page_access_user_page_key (real
-- constraint, CORE §7.14). DO UPDATE only raises a pre-existing row that is not
-- already view+edit — a re-run inserts nothing and touches nothing.
-- Other flags (canImport/canExport/canDelete) take their DB default false;
-- createdAt/updatedAt take DEFAULT now() (the columns carry a DB default).

INSERT INTO user_page_access ("userId", "pageKey", "canView", "canEdit")
SELECT m.id, 'billing_pick_delete', true, true
FROM (
  SELECT t.name, MIN(u.id) AS id, COUNT(u.id) AS matches
  FROM (VALUES ('Deepanshu Thakur'), ('Prakash'), ('Bankim'),
               ('Chandresh Kolgha'), ('Operations User')) AS t(name)
  LEFT JOIN users u ON lower(trim(u.name)) = lower(t.name)
  GROUP BY t.name
) m
WHERE m.matches = 1
ON CONFLICT ON CONSTRAINT user_page_access_user_page_key
DO UPDATE SET "canView" = true, "canEdit" = true, "updatedAt" = now()
WHERE user_page_access."canView" = false OR user_page_access."canEdit" = false;

-- Verify (the only result the Editor shows). One row per name + one total row.
-- Tick columns read "view/edit"; "-" = no row (≡ all false).
SELECT label, user_id, matches, billing_print, billing_telephonic, billing_pick_delete
FROM (
  SELECT 1 AS ord,
         t.name::text AS label,
         CASE WHEN COUNT(DISTINCT u.id) = 1 THEN MIN(u.id)::text ELSE 'NOT GRANTED' END AS user_id,
         COUNT(DISTINCT u.id)::text AS matches,
         COALESCE(MAX(CASE WHEN a."pageKey" = 'billing_print'
                  THEN a."canView"::text || '/' || a."canEdit"::text END), '-') AS billing_print,
         COALESCE(MAX(CASE WHEN a."pageKey" = 'billing_telephonic'
                  THEN a."canView"::text || '/' || a."canEdit"::text END), '-') AS billing_telephonic,
         COALESCE(MAX(CASE WHEN a."pageKey" = 'billing_pick_delete'
                  THEN a."canView"::text || '/' || a."canEdit"::text END), '-') AS billing_pick_delete
  FROM (VALUES ('Deepanshu Thakur'), ('Prakash'), ('Bankim'),
               ('Chandresh Kolgha'), ('Operations User')) AS t(name)
  LEFT JOIN users u ON lower(trim(u.name)) = lower(t.name)
  LEFT JOIN user_page_access a
         ON a."userId" = u.id
        AND a."pageKey" IN ('billing_print', 'billing_telephonic', 'billing_pick_delete')
  GROUP BY t.name

  UNION ALL

  SELECT 2,
         'TOTAL billing_pick_delete rows'::text,
         COUNT(*)::text,
         (COUNT(*) FILTER (WHERE "canView" AND "canEdit"))::text || ' view+edit',
         '-', '-', '-'
  FROM user_page_access
  WHERE "pageKey" = 'billing_pick_delete'
) v
ORDER BY ord, label;
-- Expected after the first run: five rows, matches = 1 each, billing_pick_delete
-- = true/true beside billing_print / billing_telephonic; TOTAL row = 5, 5 view+edit.
