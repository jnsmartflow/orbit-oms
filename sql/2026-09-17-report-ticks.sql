-- ═══════════════════════════════════════════════════════════════════════════
-- Reports — one tick per report: reports_tint_summary / reports_ti_report
-- 2026-09-17
--
-- 🔴 RUN THIS BEFORE THE CODE DEPLOYS. An absent row reads as false, and the
-- gate commit stops `ti_report` from opening /reports at all, so without these
-- grants Chandresh and Prakash lose both reports, and Operations User loses the
-- Tint Summary he reaches today through the removed job-title bypass.
-- (Harsh is a superuser — all-true, needs no row.)
--
-- Run in the Supabase SQL Editor, in one paste. NO transaction wrapper —
-- BEGIN/COMMIT fails silently there (CORE §3). Idempotent and re-runnable.
--
--   reports_tint_summary  canView               = see Tint Summary (+ its PDF)
--   reports_ti_report     canView               = see TI Report
--                         canExport             = its Download Excel button
--
-- ON CONFLICT targets are REAL constraints, confirmed by read-only SELECT on
-- pg_constraint 2026-09-17:
--   user_page_access  → user_page_access_user_page_key         UNIQUE ("userId","pageKey")
--   role_permissions  → role_permissions_roleslug_pagekey_key  UNIQUE ("roleSlug","pageKey")
--
-- The conflict arm only RAISES flags — a re-run can never undo a revocation an
-- admin made by hand on /admin/access.
-- ═══════════════════════════════════════════════════════════════════════════


-- PART 1 — user_page_access: 5 rows
--   21 Chandresh Kolgha, 32 Prakash → both reports, TI Report with export
--   20 Operations User              → Tint Summary ONLY
INSERT INTO user_page_access
  ("userId", "pageKey", "canView", "canImport", "canExport", "canEdit", "canDelete")
SELECT g."userId", g."pageKey", true, false, g."canExport", false, false
FROM (VALUES
  (21, 'reports_tint_summary', false),
  (21, 'reports_ti_report',    true),
  (32, 'reports_tint_summary', false),
  (32, 'reports_ti_report',    true),
  (20, 'reports_tint_summary', false)
) AS g("userId", "pageKey", "canExport")
JOIN users u ON u.id = g."userId"
ON CONFLICT ON CONSTRAINT user_page_access_user_page_key
DO UPDATE SET
  "canView"   = user_page_access."canView"   OR excluded."canView",
  "canExport" = user_page_access."canExport" OR excluded."canExport",
  "updatedAt" = now();


-- PART 2 — role_permissions: 4 rows (the ACCESS_SOURCE='role' fallback, same
-- values as users 21/32). Matches prisma/seed.ts.
INSERT INTO role_permissions
  ("roleSlug", "pageKey", "canView", "canImport", "canExport", "canEdit", "canDelete")
SELECT r."roleSlug", k."pageKey", true, false, k."canExport", false, false
FROM (VALUES ('tint_manager'), ('operation_manager')) AS r("roleSlug")
CROSS JOIN (VALUES
  ('reports_tint_summary', false),
  ('reports_ti_report',    true)
) AS k("pageKey", "canExport")
ON CONFLICT ON CONSTRAINT role_permissions_roleslug_pagekey_key
DO UPDATE SET
  "canView"   = role_permissions."canView"   OR excluded."canView",
  "canExport" = role_permissions."canExport" OR excluded."canExport",
  "updatedAt" = now();


-- PART 3 — verification. ONE SELECT (the editor shows only the last result).
-- Expect 10 rows:
--   5 user_page_access  — view true on all; export true on the two reports_ti_report rows
--   4 role_permissions  — view true on all; export true on the two reports_ti_report rows
--   1 system_config     — ACCESS_SOURCE = user
SELECT 1 AS sort_order, 'user_page_access' AS tbl, u.name AS who, a."pageKey",
       a."canView"::text AS chk_view, a."canExport"::text AS chk_export
  FROM user_page_access a JOIN users u ON u.id = a."userId"
 WHERE a."userId" IN (20, 21, 32)
   AND a."pageKey" IN ('reports_tint_summary','reports_ti_report')
UNION ALL
SELECT 2, 'role_permissions', rp."roleSlug", rp."pageKey",
       rp."canView"::text, rp."canExport"::text
  FROM role_permissions rp
 WHERE rp."roleSlug" IN ('tint_manager','operation_manager')
   AND rp."pageKey" IN ('reports_tint_summary','reports_ti_report')
UNION ALL
SELECT 3, 'system_config', 'ACCESS_SOURCE', '', value, ''
  FROM system_config WHERE key = 'ACCESS_SOURCE'
ORDER BY sort_order, who, "pageKey";
