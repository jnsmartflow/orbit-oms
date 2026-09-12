-- ═══════════════════════════════════════════════════════════════════════════
-- user_page_access — the FOUR billing action ticks, one row per user per key
-- 2026-09-11 · Register half of the Hold / Slot / Urgent / ship-to conversion
--
-- Run in the Supabase SQL Editor.  NO transaction wrapper — BEGIN/COMMIT fails
-- silently there (CORE §3).  Plain statements only.  camelCase identifiers
-- quoted.  Idempotent, and safely re-runnable — see the conflict arm.
--
-- 🔴 THIS FILE IS THE RECORD OF WHAT WAS ACTUALLY RUN, rewritten after the fact.
-- The version committed in c73ee93b inserted rows ONLY for the five people who
-- were to be granted.  The owner ran this corrected version instead, and the
-- difference matters in two ways:
--
--   1. ROWS FOR EVERY USER, NOT JUST THE GRANTED FIVE.  /admin/access counts a
--      person's rows against ALL_PAGE_KEYS and warns when any are missing; four
--      new keys granted to five people would have left the other 35 short and
--      put a "page rows are missing" banner on every one of their pages.  An
--      all-false row and an absent row mean exactly the same thing to every
--      resolver (`allPerms[key]?.canEdit === true`, absent ≡ false), so writing
--      the full grid costs nothing and silences a banner that would otherwise
--      be read as a fault.  Live result: 40 users × 4 keys = 160 rows.
--
--   2. THE CONFLICT ARM ONLY EVER RAISES.  `"canEdit" = user_page_access."canEdit"
--      OR excluded."canEdit"` — a re-run can grant somebody who was missed, and
--      can NEVER take a tick back from somebody an admin deliberately revoked on
--      /admin/access.  A plain `= excluded."canEdit"` would silently undo every
--      hand revocation the next time this file was pasted, which is exactly the
--      kind of quiet regression a re-runnable grant script must not have.
--
-- ── WHO IS GRANTED ─────────────────────────────────────────────────────────
--
-- canEdit = true for the people who can press those four buttons TODAY, so the
-- gate commit changes nothing for anybody:
--
--     isActive = true                     -- checked at sign-in
--   AND isSuperuser = false               -- superusers short-circuit to all-true
--                                         -- inside checkAnyPermission
--                                         -- (lib/permissions.ts) and need no row;
--                                         -- granting one would imply the flag is
--                                         -- not what admits them.  Harsh holds
--                                         -- four all-false rows and keeps every
--                                         -- button — that IS the bypass working.
--   AND user_page_access(mail_orders).canEdit = true
--                                         -- the only gate those four buttons had
--                                         -- before the repoint
--                                         -- (api/billing/mail-order/actions)
--
-- Derived from the LIVE table, never a hardcoded id list, so the file cannot go
-- stale between being written and being run.  Live result 2026-09-11: Bankim,
-- Chandresh Kolgha, Deepanshu Thakur, Operations User, Prakash.  ⚠ That is the
-- EXPECTATION, not the instruction — whoever holds mail_orders canEdit when this
-- runs is who gets the ticks.
--
-- ── WHY canView MIRRORS canEdit ────────────────────────────────────────────
--
-- canEdit is the only question the app asks of these keys: "may this person press
-- that button".  canView is written to the SAME value purely so the access screen
-- reads honestly — it draws a View box for every key unconditionally
-- (isActionAvailable returns true for View), and a granted row showing an
-- unticked View box would read as a half-grant.  Nothing reads canView on these
-- four keys.  Import / Export / Delete stay false and DASH on that screen.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- PART 1 — one row per user per key, granted only where earned
--
-- ON CONFLICT names the REAL constraint: user_page_access_user_page_key, a
-- genuine UNIQUE ("userId","pageKey") created as a named constraint precisely so
-- it could be an ON CONFLICT target (sql/2026-09-04-user-page-access.sql:81).
-- "id", "createdAt" and "updatedAt" take their column defaults on insert; every
-- other NOT NULL column is named explicitly.
-- ───────────────────────────────────────────────────────────────────────────

INSERT INTO user_page_access
  ("userId", "pageKey", "canView", "canImport", "canExport", "canEdit", "canDelete")
SELECT
  u.id,
  k."pageKey",
  earned.ok,   -- canView   — mirrors canEdit so the screen reads honestly
  false,       -- canImport
  false,       -- canExport
  earned.ok,   -- canEdit   — THE meaning: may press that button
  false        -- canDelete
FROM users u
CROSS JOIN (VALUES
  ('billing_hold'),
  ('billing_slot'),
  ('billing_urgent'),
  ('billing_ship_to')
) AS k("pageKey")
CROSS JOIN LATERAL (
  SELECT (
    u."isActive" = true
    AND u."isSuperuser" = false
    AND EXISTS (
      SELECT 1 FROM user_page_access mo
       WHERE mo."userId"  = u.id
         AND mo."pageKey" = 'mail_orders'
         AND mo."canEdit" = true
    )
  ) AS ok
) AS earned
ON CONFLICT ON CONSTRAINT user_page_access_user_page_key
DO UPDATE SET
  -- 🔴 RAISE ONLY, NEVER LOWER. A re-run can grant somebody who was missed and
  -- can never undo a revocation made by hand on /admin/access.
  "canView"   = user_page_access."canView" OR excluded."canView",
  "canEdit"   = user_page_access."canEdit" OR excluded."canEdit",
  -- Its DEFAULT now() fires on INSERT only; without this an UPDATE would leave
  -- the old timestamp and the row would lie about when it last moved.
  "updatedAt" = now();


-- ───────────────────────────────────────────────────────────────────────────
-- PART 2 — verification.  ONE SELECT, because the Supabase editor shows only
-- the LAST statement's result.
--
--   GRANTED   one line per person who can now press the buttons — all four
--             columns must read true.  Expect the five named in the header.
--   BYPASS    superusers.  All four false is CORRECT: they never needed a row.
--   NO-GRANT  everybody else, collapsed to a count.  All-false rows, present so
--             the access screen does not report missing rows.
--   TOTALS    expect rows = users × 4, and granted = granted-people × 4.
-- ───────────────────────────────────────────────────────────────────────────

WITH per_user AS (
  SELECT
    u.id,
    u.name,
    u."isSuperuser",
    bool_or(a."pageKey" = 'billing_hold'    AND a."canEdit") AS hold,
    bool_or(a."pageKey" = 'billing_slot'    AND a."canEdit") AS slot,
    bool_or(a."pageKey" = 'billing_urgent'  AND a."canEdit") AS urgent,
    bool_or(a."pageKey" = 'billing_ship_to' AND a."canEdit") AS ship_to
  FROM users u
  LEFT JOIN user_page_access a
    ON  a."userId"  = u.id
    AND a."pageKey" IN ('billing_hold','billing_slot','billing_urgent','billing_ship_to')
  GROUP BY u.id, u.name, u."isSuperuser"
)
SELECT 1 AS sort_order, 'GRANTED' AS line_type, name AS person,
       COALESCE(hold,false)::text    AS hold,
       COALESCE(slot,false)::text    AS slot,
       COALESCE(urgent,false)::text  AS urgent,
       COALESCE(ship_to,false)::text AS ship_to
  FROM per_user
 WHERE COALESCE(hold,false)
UNION ALL
SELECT 2, 'BYPASS', name || ' (superuser — sees every button without a tick)',
       COALESCE(hold,false)::text, COALESCE(slot,false)::text,
       COALESCE(urgent,false)::text, COALESCE(ship_to,false)::text
  FROM per_user
 WHERE "isSuperuser"
UNION ALL
SELECT 3, 'NO-GRANT', count(*)::text || ' other people — all-false rows present', '', '', '', ''
  FROM per_user
 WHERE NOT COALESCE(hold,false) AND NOT "isSuperuser"
UNION ALL
SELECT 4, 'TOTALS',
       'rows ' || (SELECT count(*)::text FROM user_page_access
                    WHERE "pageKey" IN ('billing_hold','billing_slot','billing_urgent','billing_ship_to'))
               || ' (expect users x 4)',
       'granted ' || (SELECT count(*)::text FROM user_page_access
                       WHERE "pageKey" IN ('billing_hold','billing_slot','billing_urgent','billing_ship_to')
                         AND "canEdit"), '', '', ''
 ORDER BY sort_order, person;
