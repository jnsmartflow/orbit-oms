-- ═══════════════════════════════════════════════════════════════════════════
-- Tint Manager job-panel TABS — tint_panel_items / tint_panel_details /
-- tint_panel_activity · 2026-09-17
--
-- 🔴 RUN THIS BEFORE THE CODE DEPLOYS. An absent row reads as false, so without
-- these grants Chandresh and Prakash lose all three tabs the moment the gate
-- commit is live. (Harsh is a superuser — all-true, needs no row.)
--
-- Run in the Supabase SQL Editor, in one paste. NO transaction wrapper —
-- BEGIN/COMMIT fails silently there (CORE §3). Idempotent and re-runnable.
--
-- canView is the ONLY meaning of these keys ("may see that tab"). Every other
-- flag is written false.
--
-- ON CONFLICT targets are REAL constraints, confirmed by read-only SELECT on
-- pg_constraint 2026-09-17:
--   user_page_access  → user_page_access_user_page_key         UNIQUE ("userId","pageKey")
--   role_permissions  → role_permissions_roleslug_pagekey_key  UNIQUE ("roleSlug","pageKey")
--
-- The conflict arm only RAISES canView — a re-run can never undo a revocation an
-- admin made by hand on /admin/access. Same rule as
-- sql/2026-09-11-billing-action-ticks.sql.
--
-- ⚠ Rows are written for users 21 and 32 ONLY, not for every user. /admin/access
-- will therefore report these three keys as "missing rows" for everyone else.
-- An absent row and an all-false row mean the same thing to every resolver.
-- ═══════════════════════════════════════════════════════════════════════════


-- PART 1 — user_page_access: 2 users × 3 keys = 6 rows (the live grant)
INSERT INTO user_page_access
  ("userId", "pageKey", "canView", "canImport", "canExport", "canEdit", "canDelete")
SELECT u.id, k."pageKey", true, false, false, false, false
FROM users u
CROSS JOIN (VALUES
  ('tint_panel_items'),
  ('tint_panel_details'),
  ('tint_panel_activity')
) AS k("pageKey")
WHERE u.id IN (21, 32)   -- 21 Chandresh Kolgha (tint_manager), 32 Prakash (operation_manager)
ON CONFLICT ON CONSTRAINT user_page_access_user_page_key
DO UPDATE SET
  "canView"   = user_page_access."canView" OR excluded."canView",
  "updatedAt" = now();


-- PART 2 — role_permissions: 2 roles × 3 keys = 6 rows (the ACCESS_SOURCE='role'
-- fallback, so a rollback shows the same tabs). Matches prisma/seed.ts.
INSERT INTO role_permissions
  ("roleSlug", "pageKey", "canView", "canImport", "canExport", "canEdit", "canDelete")
SELECT r."roleSlug", k."pageKey", true, false, false, false, false
FROM (VALUES ('tint_manager'), ('operation_manager')) AS r("roleSlug")
CROSS JOIN (VALUES
  ('tint_panel_items'),
  ('tint_panel_details'),
  ('tint_panel_activity')
) AS k("pageKey")
ON CONFLICT ON CONSTRAINT role_permissions_roleslug_pagekey_key
DO UPDATE SET
  "canView"   = role_permissions."canView" OR excluded."canView",
  "updatedAt" = now();


-- PART 3 — verification. ONE SELECT (the editor shows only the last result).
-- Expect: 6 user rows all chk = true, 6 role rows all chk = true, source = user.
SELECT 1 AS sort_order, 'user_page_access' AS tbl, u.name AS who, a."pageKey", a."canView"::text AS chk
  FROM user_page_access a JOIN users u ON u.id = a."userId"
 WHERE a."userId" IN (21, 32)
   AND a."pageKey" IN ('tint_panel_items','tint_panel_details','tint_panel_activity')
UNION ALL
SELECT 2, 'role_permissions', rp."roleSlug", rp."pageKey", rp."canView"::text
  FROM role_permissions rp
 WHERE rp."roleSlug" IN ('tint_manager','operation_manager')
   AND rp."pageKey" IN ('tint_panel_items','tint_panel_details','tint_panel_activity')
UNION ALL
SELECT 3, 'system_config', 'ACCESS_SOURCE', '', value
  FROM system_config WHERE key = 'ACCESS_SOURCE'
ORDER BY sort_order, who, "pageKey";
