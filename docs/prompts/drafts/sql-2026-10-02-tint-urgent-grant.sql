-- sql-2026-10-02-tint-urgent-grant.sql
-- Tint Manager · Urgent — grants (DATA, never seed). NOT RUN — Smart Flow pastes it.
-- tint_urgent canView + canEdit to users 21 and 32 (owner, 2026-10-02).
-- Supabase SQL Editor: ONE paste, no BEGIN/COMMIT.
--
-- OR-merge, never revoke: DO UPDATE only raises a flag (an existing true stays
-- true, the other flags are untouched); a re-run changes nothing. A user id that
-- does not exist inserts nothing (the JOIN on users) and shows as "missing" below.
-- Target: UNIQUE ("userId","pageKey") user_page_access_user_page_key (CORE §7.14).
-- ⚠ canEdit alone draws nothing: the bar's ⚡ Urgent also needs tint_manager
-- canEdit (lib/tint/manager-bill.ts checkTintAction) — the verify shows that column too.
-- Other flags take their DB default false; createdAt/updatedAt DEFAULT now().

INSERT INTO user_page_access ("userId", "pageKey", "canView", "canEdit")
SELECT u.id, 'tint_urgent', true, true
  FROM users u
 WHERE u.id IN (21, 32)
ON CONFLICT ON CONSTRAINT user_page_access_user_page_key
DO UPDATE SET "canView"   = user_page_access."canView" OR EXCLUDED."canView",
              "canEdit"   = user_page_access."canEdit" OR EXCLUDED."canEdit",
              "updatedAt" = now()
WHERE user_page_access."canView" = false OR user_page_access."canEdit" = false;

-- Verify (the result the Editor shows): one row per target user + one total row.
-- Tick columns read "view/edit"; "-" = no row (≡ all false).
SELECT 1::int AS ord,
       t.uid::text AS user_id,
       COALESCE(u.name, 'missing')::text AS name,
       COALESCE(MAX(CASE WHEN a."pageKey" = 'tint_urgent'
                THEN a."canView"::text || '/' || a."canEdit"::text END), '-')::text AS tint_urgent,
       COALESCE(MAX(CASE WHEN a."pageKey" = 'tint_manager'
                THEN a."canView"::text || '/' || a."canEdit"::text END), '-')::text AS tint_manager
  FROM (VALUES (21), (32)) AS t(uid)
  LEFT JOIN users u ON u.id = t.uid
  LEFT JOIN user_page_access a
         ON a."userId" = t.uid AND a."pageKey" IN ('tint_urgent', 'tint_manager')
 GROUP BY t.uid, u.name
UNION ALL
SELECT 2,
       'TOTAL'::text,
       'tint_urgent rows'::text,
       (COUNT(*))::text || ' rows',
       (COUNT(*) FILTER (WHERE "canView" AND "canEdit"))::text || ' view+edit'
  FROM user_page_access
 WHERE "pageKey" = 'tint_urgent'
ORDER BY 1, 2;
-- Expected after the first run: users 21 and 32 → tint_urgent = true/true
-- (tint_manager should read …/true for the item to show); TOTAL = 2 rows, 2 view+edit.
