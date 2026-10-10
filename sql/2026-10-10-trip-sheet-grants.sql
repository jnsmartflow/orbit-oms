-- ═══════════════════════════════════════════════════════════════════════════
-- Trip Sheets — page-key grants (user_page_access, page key 'trip_sheet')
-- RUN STATUS: RUN 2026-10-10 by Smart Flow — sections 2a, 2b, 3 executed; verify returned 40 rows · 14 view · 0 edit · 0 without a row. Do not re-run.
-- ═══════════════════════════════════════════════════════════════════════════
-- What: canView = true, canEdit = false on 'trip_sheet' (lib/permissions.ts) for
-- ACTIVE users who are any of:
--   a) role `logistics` — primary (users.roleId) or secondary (user_roles)
--   b) picking canEdit = true — the floor supervisors on /picking
--   c) floor canView = true — the desk users who plan the trips
-- Inactive users never get the grant (shown in the preview for contrast).
--
-- Rules, not ids: the grantee list is DERIVED in every statement, so the preview
-- and the INSERT can never disagree. Live on 2026-10-10 the rule gives 14 users;
-- two of them (Operations User #20, Vinod Sharma #41) ALREADY hold
-- trip_sheet canView = true — the INSERT skips them (ON CONFLICT DO NOTHING).
--
-- Table facts (prisma/schema.prisma, model user_page_access): every boolean
-- defaults false; "createdAt" / "updatedAt" are NOT NULL DEFAULT now(); id is
-- serial. UNIQUE CONSTRAINT user_page_access_user_page_key ("userId","pageKey")
-- — a real constraint (the save route's upsert target), so ON CONFLICT ON
-- CONSTRAINT is safe here.
--
-- Access model (CORE §5): ACCESS_SOURCE = 'user', an ABSENT row = all false.
-- Superusers pass every gate without a row; harmless if they get one.
-- Supabase SQL Editor rules: no BEGIN/COMMIT; UNION ALL columns cast ::text.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 1. PREVIEW (read-only) — who gets it, who does not ──────────────────────
WITH role_names AS (
  SELECT u.id AS "userId", rm.name AS role FROM users u JOIN role_master rm ON rm.id = u."roleId"
  UNION
  SELECT ur."userId", rm.name FROM user_roles ur JOIN role_master rm ON rm.id = ur."roleId"
),
matches AS (
  SELECT u.id, u.name, u."isActive",
         (SELECT string_agg(DISTINCT r.role, ', ') FROM role_names r WHERE r."userId" = u.id) AS roles,
         EXISTS (SELECT 1 FROM role_names r WHERE r."userId" = u.id AND r.role = 'logistics') AS is_a,
         EXISTS (SELECT 1 FROM user_page_access p WHERE p."userId" = u.id AND p."pageKey" = 'picking' AND p."canEdit") AS is_b,
         EXISTS (SELECT 1 FROM user_page_access p WHERE p."userId" = u.id AND p."pageKey" = 'floor' AND p."canView") AS is_c
  FROM users u
)
SELECT (CASE WHEN m."isActive" THEN '1 GRANT' ELSE '2 SKIP (inactive)' END)::text AS section,
       m.id::text AS user_id,
       m.name::text AS name,
       m.roles::text AS roles,
       concat_ws('+', CASE WHEN m.is_a THEN 'a logistics' END,
                      CASE WHEN m.is_b THEN 'b picking edit' END,
                      CASE WHEN m.is_c THEN 'c floor view' END)::text AS why,
       COALESCE((SELECT 'view=' || p."canView" || ' edit=' || p."canEdit"
                   FROM user_page_access p WHERE p."userId" = m.id AND p."pageKey" = 'trip_sheet'), 'no row')::text AS trip_sheet_now,
       (CASE WHEN NOT m."isActive" THEN 'nothing'
             WHEN EXISTS (SELECT 1 FROM user_page_access p WHERE p."userId" = m.id AND p."pageKey" = 'trip_sheet' AND p."canView") THEN 'already granted — skipped'
             WHEN EXISTS (SELECT 1 FROM user_page_access p WHERE p."userId" = m.id AND p."pageKey" = 'trip_sheet') THEN 'row exists, view off — UPDATE turns it on'
             ELSE 'INSERT view=true edit=false' END)::text AS will_do
FROM matches m
WHERE m.is_a OR m.is_b OR m.is_c
ORDER BY 1, 3;


-- ── 2. THE GRANTS — COMMENTED OUT. Uncomment and run after reading the preview.
-- (2a) New rows for grantees with no trip_sheet row.
-- WITH role_names AS (
--   SELECT u.id AS "userId", rm.name AS role FROM users u JOIN role_master rm ON rm.id = u."roleId"
--   UNION
--   SELECT ur."userId", rm.name FROM user_roles ur JOIN role_master rm ON rm.id = ur."roleId"
-- ),
-- grantees AS (
--   SELECT u.id FROM users u
--    WHERE u."isActive" = true
--      AND (   EXISTS (SELECT 1 FROM role_names r WHERE r."userId" = u.id AND r.role = 'logistics')
--           OR EXISTS (SELECT 1 FROM user_page_access p WHERE p."userId" = u.id AND p."pageKey" = 'picking' AND p."canEdit")
--           OR EXISTS (SELECT 1 FROM user_page_access p WHERE p."userId" = u.id AND p."pageKey" = 'floor' AND p."canView"))
-- )
-- INSERT INTO user_page_access ("userId", "pageKey", "canView", "canEdit")
-- SELECT g.id, 'trip_sheet', true, false FROM grantees g
-- ON CONFLICT ON CONSTRAINT user_page_access_user_page_key DO NOTHING;
--
-- (2b) A grantee whose trip_sheet row exists with view OFF gets view ON.
--      canEdit is left as it is. 0 such rows on 2026-10-10 — a guard.
-- WITH role_names AS (
--   SELECT u.id AS "userId", rm.name AS role FROM users u JOIN role_master rm ON rm.id = u."roleId"
--   UNION
--   SELECT ur."userId", rm.name FROM user_roles ur JOIN role_master rm ON rm.id = ur."roleId"
-- ),
-- grantees AS (
--   SELECT u.id FROM users u
--    WHERE u."isActive" = true
--      AND (   EXISTS (SELECT 1 FROM role_names r WHERE r."userId" = u.id AND r.role = 'logistics')
--           OR EXISTS (SELECT 1 FROM user_page_access p WHERE p."userId" = u.id AND p."pageKey" = 'picking' AND p."canEdit")
--           OR EXISTS (SELECT 1 FROM user_page_access p WHERE p."userId" = u.id AND p."pageKey" = 'floor' AND p."canView"))
-- )
-- UPDATE user_page_access SET "canView" = true, "updatedAt" = now()
--  WHERE "pageKey" = 'trip_sheet' AND "canView" = false AND "userId" IN (SELECT id FROM grantees);


-- ── 3. /admin/access "page rows missing" — COMMENTED OUT. Run AFTER section 2.
-- The banner counts, per person, the page keys with NO user_page_access row
-- (app/(admin)/admin/access/page.tsx `missingRows`); the screen lists EVERY
-- user, active or not. This fills an all-false trip_sheet row for everyone who
-- has none, so trip_sheet stops counting. ⚠ It will NOT clear the banner on its
-- own: on 2026-10-10 all 40 users also lack rows for other keys (the
-- tint_* / billing_* / reports_* / place_order_* ticks are sparse by design).
-- Clearing it fully is the 2026-09-04 back-fill job, not this script.
-- INSERT INTO user_page_access ("userId", "pageKey", "canView", "canEdit")
-- SELECT u.id, 'trip_sheet', false, false FROM users u
-- ON CONFLICT ON CONSTRAINT user_page_access_user_page_key DO NOTHING;


-- ── 4. VERIFY (read-only) — run after the writes ────────────────────────────
SELECT 'trip_sheet rows'::text AS item, count(*)::text AS n FROM user_page_access WHERE "pageKey" = 'trip_sheet'
UNION ALL
SELECT 'trip_sheet canView = true', count(*)::text FROM user_page_access WHERE "pageKey" = 'trip_sheet' AND "canView"
UNION ALL
SELECT 'trip_sheet canEdit = true', count(*)::text FROM user_page_access WHERE "pageKey" = 'trip_sheet' AND "canEdit"
UNION ALL
SELECT 'users with no trip_sheet row', count(*)::text FROM users u
 WHERE NOT EXISTS (SELECT 1 FROM user_page_access p WHERE p."userId" = u.id AND p."pageKey" = 'trip_sheet');
