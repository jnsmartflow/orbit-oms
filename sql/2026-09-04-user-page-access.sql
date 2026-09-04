-- ═══════════════════════════════════════════════════════════════════════════
-- user_page_access — the per-user access table, built and filled
-- 2026-09-04 · Step 2 of the role → user access conversion
--
-- WHAT THIS DOES.  Creates one table and fills it with one row per user per
-- page key, holding EXACTLY the permissions the app grants that person today.
-- NOTHING READS THIS TABLE YET.  No application code changes in this step.
-- This file is purely additive: no DELETE, no DROP, no ALTER of any existing
-- object.  Run it in one paste in the Supabase SQL Editor.
--
-- Only the LAST statement's result is displayed by the editor, so Part 3 is a
-- single SELECT whose UNION ALL carries both things the owner must see: the
-- parity diff, and the row counts.
--
-- ── HOW THE VALUES ARE DERIVED ─────────────────────────────────────────────
--
-- Reproduced from lib/permissions.ts getAllPermissionsForRoles(), which is
-- what actually drives the sidebar and the API gates:
--
--   1. roleSlugs = session.user.roles          (lib/auth.ts, see next block)
--   2. if roleSlugs includes "admin"  → ALL_TRUE for every key in
--      ALL_PAGE_KEYS.  ⚠ The admin SHORT-CIRCUITS BEFORE role_permissions is
--      read (lib/permissions.ts:338-340 → :306-308).
--   3. otherwise → OR-merge role_permissions across every slug, per flag
--      (:358-364).  A page key with NO matching row is ABSENT from the merged
--      map, and every consumer reads absent as false
--      (`allPerms[key]?.canView === true`, :159).  Absent ≡ all five false.
--
-- ── THE SLUG DERIVATION — copied, not invented ─────────────────────────────
--
-- lib/auth.ts:204   const primaryRole = user.role.name.toLowerCase().replace(/\s+/g, "_");
-- lib/auth.ts:205-207   const allRoles = user.userRoles.map((ur) =>
--                         ur.role.name.toLowerCase().replace(/\s+/g, "_")
--                       );
-- lib/auth.ts:208   const roles = allRoles.length > 0 ? allRoles : [primaryRole];
--
-- 🔴 TWO TRAPS IN THAT LAST LINE, both reproduced below exactly:
--
--   (a) When a user has ANY user_roles rows, `roles` is EXACTLY those rows.
--       The primary role from users.roleId is NOT appended.  A user whose
--       user_roles rows omit their own primary would LOSE that primary's
--       access.  Verified read-only 2026-09-04: 0 users are in that state
--       today (all 20 users with user_roles rows carry a self-referential row
--       for their own primary).  It is reproduced anyway, because the table
--       must match the app, not match what we wish the app did.
--
--   (b) The fallback is the PRIMARY only, for the 19 users with no user_roles
--       rows at all.
--
-- 🔴 REGEX TRAP — DO NOT "SIMPLIFY" THE DERIVATION BELOW TO '\s+'.
-- In this database `regexp_replace(name, '\s+', '_', 'g')` matches a LITERAL
-- "s", not whitespace.  Verified read-only 2026-09-04 — it silently produced
-- di_patcher / _upport / floor__upervi_or / operation_ / op__admin /
-- logi_tic_ / floor_acce_, mangling 7 of the 13 slugs and orphaning them from
-- role_permissions.  `[[:space:]]+` is correct and is what is used here.
-- (role_master.name holds no whitespace today, so the replace is a no-op —
-- it is kept because the derivation is the contract, and a future role named
-- "Ops Admin" would need it.)
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- PART 1 — the table
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_page_access (
  id          SERIAL         PRIMARY KEY,
  "userId"    INTEGER        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "pageKey"   TEXT           NOT NULL,
  "canView"   BOOLEAN        NOT NULL DEFAULT false,
  "canImport" BOOLEAN        NOT NULL DEFAULT false,
  "canExport" BOOLEAN        NOT NULL DEFAULT false,
  "canEdit"   BOOLEAN        NOT NULL DEFAULT false,
  "canDelete" BOOLEAN        NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

  -- A REAL constraint, not just an index: step 4's writes will need it as the
  -- ON CONFLICT target, and ON CONFLICT can only name a constraint or a
  -- unique index — a plain index would work, a constraint documents intent.
  CONSTRAINT user_page_access_user_page_key UNIQUE ("userId", "pageKey")
);

COMMENT ON TABLE user_page_access IS
  'Per-user page permissions. One row per (user, pageKey) for every key in '
  'ALL_PAGE_KEYS (lib/permissions.ts). Filled 2026-09-04 from the role system '
  'it will replace. Nothing reads it until step 4.';

COMMENT ON COLUMN user_page_access."pageKey" IS
  'One of the 27 ALL_PAGE_KEYS values. Deliberately TEXT and NOT an FK: the '
  'key list lives in TypeScript, not in a table, and inventing a lookup table '
  'here would create a second source of truth for it.';

-- ── Indexes, and why each one ──────────────────────────────────────────────
--
-- The UNIQUE constraint above already creates a btree on ("userId","pageKey").
-- With userId LEADING, that single index serves BOTH hot reads:
--     • "every page for this user"  — the whole sidebar/nav build, one user
--     • "this user, this page"      — every API permission gate
-- So there is deliberately NO separate index on "userId": it would be a
-- redundant prefix of the constraint's index, costing writes and buying
-- nothing.
--
-- This one index is NOT covered by the constraint, because "pageKey" is the
-- trailing column and cannot be used alone:
CREATE INDEX IF NOT EXISTS user_page_access_page_idx
  ON user_page_access ("pageKey");
-- Reverse lookup — "who can reach Floor Control?".  The admin access screen
-- needs exactly this, and step 4's per-page audit view is built on it.
-- 27 distinct values over ~1,053 rows is poor selectivity in the abstract,
-- but the alternative is a full scan of the whole table for every such query,
-- and the table is written rarely and read constantly.
--
-- NO index on the five boolean columns: two distinct values each, never
-- selective, and every real query already filters on userId or pageKey first.


-- ───────────────────────────────────────────────────────────────────────────
-- PART 2 — the fill
--
-- One row per user per page key, for EVERY user, active or not.  A
-- deactivated user keeps their ticks so that reactivating them restores what
-- they had — dropping the rows would silently strip access on return.
--
-- ON CONFLICT DO NOTHING makes a re-run safe.  It deliberately does NOT
-- overwrite: if this file is re-run after the role tables have moved, the
-- existing rows stand and Part 3 REPORTS the drift as a diff, rather than
-- this INSERT silently rewriting rows nobody asked it to touch.
-- ───────────────────────────────────────────────────────────────────────────

WITH page_keys ("pageKey") AS (
  -- ALL_PAGE_KEYS, lib/permissions.ts:237-247 — all 27, in source order.
  VALUES
    ('attendance'), ('attendance_admin'),
    ('operations_tinting'), ('operations_tint_operator'),
    ('picking'), ('floor'),
    ('dashboard'), ('users'), ('system_config'), ('permissions'),
    ('customers'), ('skus'), ('routes_areas'), ('vehicles'),
    ('import_obd'), ('tint_manager'), ('tint_operator'),
    ('place_order'), ('trip_report'), ('mail_orders'), ('mrn'), ('ci'),
    ('delivery_challans'), ('shade_master'), ('sampling_library'), ('ti_report'),
    ('settings_hide')
),
effective AS (
  -- lib/auth.ts:204-208, reproduced exactly. See the header block.
  SELECT
    u.id AS "userId",
    s.slugs,
    ('admin' = ANY (s.slugs)) AS is_admin
  FROM users u
  CROSS JOIN LATERAL (
    SELECT COALESCE(
             NULLIF(
               ARRAY(
                 SELECT lower(regexp_replace(rm2.name, '[[:space:]]+', '_', 'g'))
                 FROM user_roles ur
                 JOIN role_master rm2 ON rm2.id = ur."roleId"
                 WHERE ur."userId" = u.id
               ),
               ARRAY[]::text[]                       -- allRoles.length > 0 ?
             ),
             ARRAY[(                                  -- : [primaryRole]
               SELECT lower(regexp_replace(rm.name, '[[:space:]]+', '_', 'g'))
               FROM role_master rm WHERE rm.id = u."roleId"
             )]
           ) AS slugs
  ) s
)
INSERT INTO user_page_access
  ("userId", "pageKey", "canView", "canImport", "canExport", "canEdit", "canDelete")
SELECT
  e."userId",
  k."pageKey",
  -- Admin short-circuits to ALL_TRUE without reading role_permissions
  -- (lib/permissions.ts:338-340 → :306-308).  bool_or() over the LEFT JOIN is
  -- the OR-merge at :358-364; where no role grants the key, every bool_or is
  -- NULL and COALESCE makes it false — which is what an ABSENT map entry
  -- means to every consumer.
  CASE WHEN e.is_admin THEN true ELSE COALESCE(bool_or(rp."canView"),   false) END,
  CASE WHEN e.is_admin THEN true ELSE COALESCE(bool_or(rp."canImport"), false) END,
  CASE WHEN e.is_admin THEN true ELSE COALESCE(bool_or(rp."canExport"), false) END,
  CASE WHEN e.is_admin THEN true ELSE COALESCE(bool_or(rp."canEdit"),   false) END,
  CASE WHEN e.is_admin THEN true ELSE COALESCE(bool_or(rp."canDelete"), false) END
FROM effective e
CROSS JOIN page_keys k
LEFT JOIN role_permissions rp
       ON rp."roleSlug" = ANY (e.slugs)
      AND rp."pageKey"  = k."pageKey"
GROUP BY e."userId", k."pageKey", e.is_admin
ON CONFLICT ON CONSTRAINT user_page_access_user_page_key DO NOTHING;


-- ───────────────────────────────────────────────────────────────────────────
-- PART 3 — the parity check.  THIS IS THE POINT OF THE STEP.
--
-- ZERO DIFF ROWS  → the fill matches the live role system; step 4 is safe.
-- ANY DIFF ROWS   → that is the list to fix before going further.
--
-- ⚠ WHAT THIS CAN AND CANNOT CATCH, stated honestly.
-- The expected side is recomputed from the SAME source tables as the INSERT,
-- so it cannot catch a MISREADING of getAllPermissionsForRoles — a wrong
-- reading would be wrong identically on both sides.  What it does catch is
-- everything else: missing rows, extra rows, rows lost to a conflict or a
-- constraint, a partial run, and any drift between filling and checking.
-- To make it as independent as SQL allows, the expected side below is written
-- with correlated EXISTS per flag — a DIFFERENT construct from the INSERT's
-- bool_or/GROUP BY.  Two formulations of one spec catch each other's slips.
-- The reading itself was verified against the app by hand; the three worked
-- examples are in the session output that produced this file.
-- ───────────────────────────────────────────────────────────────────────────

WITH page_keys ("pageKey") AS (
  VALUES
    ('attendance'), ('attendance_admin'),
    ('operations_tinting'), ('operations_tint_operator'),
    ('picking'), ('floor'),
    ('dashboard'), ('users'), ('system_config'), ('permissions'),
    ('customers'), ('skus'), ('routes_areas'), ('vehicles'),
    ('import_obd'), ('tint_manager'), ('tint_operator'),
    ('place_order'), ('trip_report'), ('mail_orders'), ('mrn'), ('ci'),
    ('delivery_challans'), ('shade_master'), ('sampling_library'), ('ti_report'),
    ('settings_hide')
),
effective AS (
  SELECT
    u.id AS "userId",
    s.slugs,
    ('admin' = ANY (s.slugs)) AS is_admin
  FROM users u
  CROSS JOIN LATERAL (
    SELECT COALESCE(
             NULLIF(
               ARRAY(
                 SELECT lower(regexp_replace(rm2.name, '[[:space:]]+', '_', 'g'))
                 FROM user_roles ur
                 JOIN role_master rm2 ON rm2.id = ur."roleId"
                 WHERE ur."userId" = u.id
               ),
               ARRAY[]::text[]
             ),
             ARRAY[(
               SELECT lower(regexp_replace(rm.name, '[[:space:]]+', '_', 'g'))
               FROM role_master rm WHERE rm.id = u."roleId"
             )]
           ) AS slugs
  ) s
),
expected AS (
  -- Deliberately EXISTS-per-flag, not bool_or — see the note above.
  SELECT
    e."userId",
    k."pageKey",
    e.is_admin OR EXISTS (SELECT 1 FROM role_permissions rp
      WHERE rp."roleSlug" = ANY (e.slugs) AND rp."pageKey" = k."pageKey" AND rp."canView")   AS "canView",
    e.is_admin OR EXISTS (SELECT 1 FROM role_permissions rp
      WHERE rp."roleSlug" = ANY (e.slugs) AND rp."pageKey" = k."pageKey" AND rp."canImport") AS "canImport",
    e.is_admin OR EXISTS (SELECT 1 FROM role_permissions rp
      WHERE rp."roleSlug" = ANY (e.slugs) AND rp."pageKey" = k."pageKey" AND rp."canExport") AS "canExport",
    e.is_admin OR EXISTS (SELECT 1 FROM role_permissions rp
      WHERE rp."roleSlug" = ANY (e.slugs) AND rp."pageKey" = k."pageKey" AND rp."canEdit")   AS "canEdit",
    e.is_admin OR EXISTS (SELECT 1 FROM role_permissions rp
      WHERE rp."roleSlug" = ANY (e.slugs) AND rp."pageKey" = k."pageKey" AND rp."canDelete") AS "canDelete"
  FROM effective e
  CROSS JOIN page_keys k
),
flags AS (
  -- Render both sides as one VIXED string so a mismatch reads at a glance.
  SELECT
    COALESCE(x."userId", a."userId")   AS uid,
    COALESCE(x."pageKey", a."pageKey") AS pk,
    CASE
      WHEN a."userId" IS NULL THEN 'MISSING — row was never inserted'
      WHEN x."userId" IS NULL THEN 'EXTRA — row exists that the role system does not grant'
      ELSE 'MISMATCH — flags differ'
    END AS problem,
    CASE WHEN x."userId" IS NULL THEN '(no expected row)' ELSE
      (CASE WHEN x."canView"   THEN 'V' ELSE '-' END ||
       CASE WHEN x."canImport" THEN 'I' ELSE '-' END ||
       CASE WHEN x."canExport" THEN 'X' ELSE '-' END ||
       CASE WHEN x."canEdit"   THEN 'E' ELSE '-' END ||
       CASE WHEN x."canDelete" THEN 'D' ELSE '-' END) END AS expected_flags,
    CASE WHEN a."userId" IS NULL THEN '(no actual row)' ELSE
      (CASE WHEN a."canView"   THEN 'V' ELSE '-' END ||
       CASE WHEN a."canImport" THEN 'I' ELSE '-' END ||
       CASE WHEN a."canExport" THEN 'X' ELSE '-' END ||
       CASE WHEN a."canEdit"   THEN 'E' ELSE '-' END ||
       CASE WHEN a."canDelete" THEN 'D' ELSE '-' END) END AS actual_flags
  FROM expected x
  FULL OUTER JOIN user_page_access a
    ON a."userId" = x."userId" AND a."pageKey" = x."pageKey"
  WHERE a."userId" IS NULL
     OR x."userId" IS NULL
     OR x."canView"   IS DISTINCT FROM a."canView"
     OR x."canImport" IS DISTINCT FROM a."canImport"
     OR x."canExport" IS DISTINCT FROM a."canExport"
     OR x."canEdit"   IS DISTINCT FROM a."canEdit"
     OR x."canDelete" IS DISTINCT FROM a."canDelete"
)
SELECT 0 AS sort_order,
       'COUNT' AS line_type,
       'users x pageKeys expected' AS subject,
       (SELECT count(*) FROM users)::text || ' users x 27 keys' AS page_key,
       ((SELECT count(*) FROM users) * 27)::text AS expected,
       (SELECT count(*) FROM user_page_access)::text AS actual
UNION ALL
SELECT 1,
       'COUNT',
       'admin rows (all-true, short-circuit)',
       '',
       ((SELECT count(*) FROM effective WHERE is_admin) * 27)::text,
       -- Joined to `effective` so this counts ADMIN users' all-true rows only,
       -- not every all-true row anywhere. No non-admin holds all five flags on
       -- any page today, so an unjoined count would agree by luck — and would
       -- stop agreeing the first time somebody is granted a full-house page.
       (SELECT count(*) FROM user_page_access a
          JOIN effective e ON e."userId" = a."userId"
         WHERE e.is_admin
           AND a."canView" AND a."canImport" AND a."canExport"
           AND a."canEdit" AND a."canDelete")::text
UNION ALL
SELECT 2,
       'VERDICT',
       CASE WHEN (SELECT count(*) FROM flags) = 0
            THEN 'PARITY OK — new table matches the live role system exactly'
            ELSE 'PARITY FAILED — fix the rows listed below before step 4'
       END,
       '',
       '0 diffs',
       (SELECT count(*) FROM flags)::text || ' diffs'
UNION ALL
SELECT 3,
       'DIFF',
       'u' || f.uid::text,
       f.pk,
       f.expected_flags || '  (' || f.problem || ')',
       f.actual_flags
FROM flags f
ORDER BY sort_order, subject, page_key;
