-- ═══════════════════════════════════════════════════════════════════════════
-- user_page_access — grant the FOUR billing action ticks
-- 2026-09-11 · Register half of the Hold / Slot / Urgent / ship-to conversion
--
-- Run in the Supabase SQL Editor.  NO transaction wrapper — BEGIN/COMMIT fails
-- silently there (CORE §3).  Plain statements only.  camelCase identifiers
-- quoted.  Idempotent: running it twice changes nothing the first run did not.
--
-- 🔴 RUN THIS ONLY AFTER THE VERCEL DEPLOY OF ITS COMMIT IS LIVE.
-- The four page keys must exist in ALL_PAGE_KEYS before these rows mean
-- anything: /admin/access renders the rows from that list, so granting first
-- would write rows the screen cannot show and nobody could then revoke from the
-- UI.  Nothing BREAKS if it is run early — the rows are inert either way, since
-- no gate reads these keys yet — but the owner would be flying blind.
--
-- ── WHAT THIS DOES ─────────────────────────────────────────────────────────
--
-- Grants canEdit on billing_hold / billing_slot / billing_urgent /
-- billing_ship_to to exactly the people who can press those four buttons TODAY,
-- so that the LATER gate commit changes nothing for anybody.
--
-- The population is DERIVED FROM THE LIVE TABLE, never a hardcoded id list:
--
--     isActive = true                     -- checked at sign-in
--   AND isSuperuser = false               -- superusers short-circuit to all-true
--                                         -- inside checkAnyPermission
--                                         -- (lib/permissions.ts:583-589) and
--                                         -- need no row; giving them one would
--                                         -- imply the flag is what grants them
--   AND user_page_access(mail_orders).canEdit = true
--                                         -- the ONLY gate those four buttons
--                                         -- have today
--                                         -- (api/billing/mail-order/actions:73)
--
-- Deriving it means the file cannot go stale between being written and being
-- run.  Expected result on 2026-09-11: Bankim, Chandresh Kolgha, Deepanshu
-- Thakur, Operations User, Prakash — five people × four keys = 20 rows.  Harsh
-- is the superuser and is deliberately absent.  ⚠ That list is the EXPECTATION,
-- not the instruction: whoever holds mail_orders canEdit when this runs is who
-- gets the ticks.
--
-- ── WHY canEdit ONLY ───────────────────────────────────────────────────────
--
-- canEdit is the one question the app will ask of these keys: "may this person
-- press that button".  canView is written true as well, and it is the ONE thing
-- here that gates nothing: /admin/access draws a View box for every key
-- unconditionally (isActionAvailable returns true for View), so a row reading
-- canView=false would show an admin an unticked box next to a working button
-- and read as a half-grant.  Import / Export / Delete stay false and DASH on
-- that screen, correctly.
--
-- ── WHY DO UPDATE, NOT DO NOTHING ──────────────────────────────────────────
--
-- These rows do not exist yet, so the first run is pure INSERT.  But the
-- conflict arm must still RAISE a row rather than skip it: a person who has been
-- given an all-false row in the meantime — by a save on /admin/access, or by a
-- second run of this file after someone revoked a tick — must end up granted,
-- and DO NOTHING would silently leave them denied.  That is the failure this
-- whole file exists to prevent.
--
-- ⚠ "updatedAt" is set explicitly in the conflict arm.  Its DEFAULT now() fires
-- on INSERT only; without this an UPDATE would leave the old timestamp and the
-- row would lie about when it last moved.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- PART 1 — the grant
--
-- ON CONFLICT names the REAL constraint: user_page_access_user_page_key, a
-- genuine UNIQUE ("userId","pageKey") created as a named constraint precisely so
-- it could be an ON CONFLICT target (sql/2026-09-04-user-page-access.sql:81).
-- "id", "createdAt" and "updatedAt" are left to their column defaults on insert;
-- every other NOT NULL column is named explicitly below.
-- ───────────────────────────────────────────────────────────────────────────

INSERT INTO user_page_access
  ("userId", "pageKey", "canView", "canImport", "canExport", "canEdit", "canDelete")
SELECT
  u.id,
  k."pageKey",
  true,   -- canView   — inert for these keys; see the header
  false,  -- canImport
  false,  -- canExport
  true,   -- canEdit   — THE meaning: may press that button
  false   -- canDelete
FROM users u
JOIN user_page_access mo
  ON  mo."userId"  = u.id
  AND mo."pageKey" = 'mail_orders'
  AND mo."canEdit" = true
CROSS JOIN (VALUES
  ('billing_hold'),
  ('billing_slot'),
  ('billing_urgent'),
  ('billing_ship_to')
) AS k("pageKey")
WHERE u."isActive"    = true
  AND u."isSuperuser" = false
ON CONFLICT ON CONSTRAINT user_page_access_user_page_key
DO UPDATE SET
  "canView"   = true,
  "canEdit"   = true,
  "updatedAt" = now();


-- ───────────────────────────────────────────────────────────────────────────
-- PART 2 — verification.  ONE SELECT, because the Supabase editor shows only
-- the LAST statement's result.
--
-- One line per ACTIVE person who holds mail_orders canEdit, with the four ticks
-- side by side.  Every one of them must read true in all four columns.
--
-- The final GRANTED-ROWS line is the count: expect 4 × the number of people
-- listed above it.  A mismatch means a row did not land, and the person columns
-- say which.
--
-- ⚠ Superusers are shown for completeness with a 'bypass' marker — they are
-- NOT granted and must NOT be, so `false` in their four columns is correct.
-- ───────────────────────────────────────────────────────────────────────────

SELECT 1 AS sort_order,
       u.name                                              AS person,
       CASE WHEN u."isSuperuser" THEN 'bypass (no rows needed)'
            ELSE 'granted' END                             AS status,
       COALESCE(bool_or(a."pageKey" = 'billing_hold'    AND a."canEdit"), false)::text AS hold,
       COALESCE(bool_or(a."pageKey" = 'billing_slot'    AND a."canEdit"), false)::text AS slot,
       COALESCE(bool_or(a."pageKey" = 'billing_urgent'  AND a."canEdit"), false)::text AS urgent,
       COALESCE(bool_or(a."pageKey" = 'billing_ship_to' AND a."canEdit"), false)::text AS ship_to
  FROM users u
  JOIN user_page_access mo
    ON  mo."userId"  = u.id
    AND mo."pageKey" = 'mail_orders'
    AND mo."canEdit" = true
  LEFT JOIN user_page_access a
    ON  a."userId"  = u.id
    AND a."pageKey" IN ('billing_hold','billing_slot','billing_urgent','billing_ship_to')
 WHERE u."isActive" = true
 GROUP BY u.id, u.name, u."isSuperuser"
UNION ALL
SELECT 2,
       'GRANTED-ROWS',
       'expect 4 per person listed above',
       count(*)::text, '', '', ''
  FROM user_page_access
 WHERE "pageKey" IN ('billing_hold','billing_slot','billing_urgent','billing_ship_to')
   AND "canEdit" = true
 ORDER BY sort_order, person;
