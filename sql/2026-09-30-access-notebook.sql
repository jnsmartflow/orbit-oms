-- sql/2026-09-30-access-notebook.sql — the ACCESS NOTEBOOK (Schema v27.44)
--
-- Plan of record: docs/prompts/drafts/code-plan-2026-09-29-auth-access-notebook.md
-- Code:           lib/access/notebook.ts, notebook-store.ts, access-state.ts,
--                 source.ts, lib/permissions.ts, lib/auth.ts,
--                 app/api/admin/access/apply/route.ts
--
-- WHAT THIS DOES
--   1. Adds two system_config keys:
--        ACCESS_VERSION  a counter. Every server instance drops its cached
--                        access ("the notebook") within ~30 s of it changing.
--        ACCESS_CACHE    the notebook's kill switch. Starts 'off' = the
--                        pre-notebook behaviour. Only the exact value 'on'
--                        turns it on; a missing row or any other value = off.
--   2. Adds ONE trigger function, bump_access_version(), that adds 1 to
--      ACCESS_VERSION, and SIX statement-level triggers that call it on every
--      write to the access tables — in the SAME transaction as the write, so a
--      change can never commit without its bump. It covers the app, this SQL
--      Editor and any future writer.
--   ⚠ The function deliberately does NOT swallow errors (owner decision 4,
--     2026-09-29): if the bump fails, the access write fails too, loudly,
--     instead of silently waiting up to 12 h for the cache to expire.
--   ⚠ users: only the columns that decide access bump it — isActive,
--     isSuperuser, roleId, attendanceTestUser, attendanceExempt. NOT
--     attendanceConsentVersion (owner tweak, 2026-09-30: no page reads the
--     claim, and a consent must not reset every user's notebook), and not
--     name / email / password / notes font size.
--
-- HOW TO RUN (Smart Flow, Supabase SQL Editor)
--   a. FIRST run the READ-ONLY PRE-CHECK below on its own (un-comment it,
--      run, re-comment). Every row must read as described.
--   b. Then run this whole file, top to bottom, ONCE, with the database
--      healthy (after hours). It is re-runnable: the INSERTs skip existing
--      keys and every trigger is dropped before it is created.
--   c. The last statement is the verification: 3 key rows + 6 trigger rows.
--   d. After the code deploy is verified, turn the notebook ON (one-liner
--      below). Until then nothing reads ACCESS_VERSION and nothing changes.
--
-- ONE-LINERS (keep out of the block; run on their own)
--   Turn the notebook ON:
--     UPDATE system_config SET value = 'on'  WHERE key = 'ACCESS_CACHE';
--   Turn it OFF (pre-notebook behaviour within ~30 s, no deploy):
--     UPDATE system_config SET value = 'off' WHERE key = 'ACCESS_CACHE';
--   Manual bump ("Apply access changes now" from the SQL Editor):
--     UPDATE system_config SET value = (CASE WHEN value ~ '^[0-9]+$' THEN value::bigint + 1 ELSE 1 END)::text WHERE key = 'ACCESS_VERSION';
--
-- FULL ROLLBACK (only if the triggers themselves must go; the switch above is
-- the fast rollback and leaves them harmlessly in place)
--   DROP TRIGGER IF EXISTS trg_access_version_upa   ON user_page_access;
--   DROP TRIGGER IF EXISTS trg_access_version_rp    ON role_permissions;
--   DROP TRIGGER IF EXISTS trg_access_version_ur    ON user_roles;
--   DROP TRIGGER IF EXISTS trg_access_version_as    ON attendance_settings;
--   DROP TRIGGER IF EXISTS trg_access_version_u_id  ON users;
--   DROP TRIGGER IF EXISTS trg_access_version_u_upd ON users;
--   DROP FUNCTION IF EXISTS bump_access_version();
--   -- keys may stay; to remove them as well:
--   -- DELETE FROM system_config WHERE key IN ('ACCESS_VERSION', 'ACCESS_CACHE');
--
-- ─────────────────────────────────────────────────────────────────────────────
-- READ-ONLY PRE-CHECK — run this on its own FIRST (un-comment, run, re-comment)
-- Expect: pg_version 13 or higher · a UNIQUE constraint on system_config (key)
-- · system_config columns id, key, value, "updatedAt" (the INSERTs below name
-- "updatedAt" explicitly because Prisma's @updatedAt gives it no DB default)
-- · all five users columns present · zero existing trg_access_version_* rows ·
-- the current ACCESS_* keys (ACCESS_SOURCE = user today; the two new ones absent).
-- ─────────────────────────────────────────────────────────────────────────────
-- SELECT 'pg_version' AS chk, current_setting('server_version')::text AS detail
-- UNION ALL
-- SELECT 'system_config unique', conname::text || ' · ' || pg_get_constraintdef(oid)::text
--   FROM pg_constraint WHERE conrelid = 'public.system_config'::regclass AND contype IN ('u','p')
-- UNION ALL
-- SELECT 'system_config column', column_name::text || ' · ' || data_type::text || ' · default ' || coalesce(column_default, 'none')::text
--   FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name = 'system_config'
-- UNION ALL
-- SELECT 'users column', column_name::text
--   FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name = 'users'
--    AND column_name IN ('isActive','isSuperuser','roleId','attendanceTestUser','attendanceExempt')
-- UNION ALL
-- SELECT 'existing trigger', tgname::text FROM pg_trigger WHERE tgname LIKE 'trg_access_version_%'
-- UNION ALL
-- SELECT 'key ' || key, value::text FROM system_config WHERE key LIKE 'ACCESS_%';
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Keys. ACCESS_CACHE starts 'off' — flip it on only after the deploy is verified.
INSERT INTO system_config (key, value, "updatedAt") VALUES ('ACCESS_VERSION', '1', now())
  ON CONFLICT (key) DO NOTHING;
INSERT INTO system_config (key, value, "updatedAt") VALUES ('ACCESS_CACHE', 'off', now())
  ON CONFLICT (key) DO NOTHING;

-- 2. The bump. Atomic, monotonic, tolerant of a hand-mangled value; a missing
--    ACCESS_VERSION row simply updates nothing (no error).
CREATE OR REPLACE FUNCTION bump_access_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE system_config
     SET value = (CASE WHEN value ~ '^[0-9]+$' THEN value::bigint + 1 ELSE 1 END)::text,
         "updatedAt" = now()
   WHERE key = 'ACCESS_VERSION';
  RETURN NULL;
END
$$;

-- 3. Triggers — statement-level (one bump per statement, however many rows).
DROP TRIGGER IF EXISTS trg_access_version_upa ON user_page_access;
CREATE TRIGGER trg_access_version_upa
  AFTER INSERT OR UPDATE OR DELETE ON user_page_access
  FOR EACH STATEMENT EXECUTE FUNCTION bump_access_version();

DROP TRIGGER IF EXISTS trg_access_version_rp ON role_permissions;
CREATE TRIGGER trg_access_version_rp
  AFTER INSERT OR UPDATE OR DELETE ON role_permissions
  FOR EACH STATEMENT EXECUTE FUNCTION bump_access_version();

DROP TRIGGER IF EXISTS trg_access_version_ur ON user_roles;
CREATE TRIGGER trg_access_version_ur
  AFTER INSERT OR UPDATE OR DELETE ON user_roles
  FOR EACH STATEMENT EXECUTE FUNCTION bump_access_version();

DROP TRIGGER IF EXISTS trg_access_version_as ON attendance_settings;
CREATE TRIGGER trg_access_version_as
  AFTER INSERT OR UPDATE OR DELETE ON attendance_settings
  FOR EACH STATEMENT EXECUTE FUNCTION bump_access_version();

DROP TRIGGER IF EXISTS trg_access_version_u_id ON users;
CREATE TRIGGER trg_access_version_u_id
  AFTER INSERT OR DELETE ON users
  FOR EACH STATEMENT EXECUTE FUNCTION bump_access_version();

DROP TRIGGER IF EXISTS trg_access_version_u_upd ON users;
CREATE TRIGGER trg_access_version_u_upd
  AFTER UPDATE OF "isActive", "isSuperuser", "roleId", "attendanceTestUser", "attendanceExempt" ON users
  FOR EACH STATEMENT EXECUTE FUNCTION bump_access_version();

-- 4. Verification (read-only) — the SQL Editor shows only the last result, so
--    keys and triggers come back together. Expect 3 key rows (ACCESS_CACHE off,
--    ACCESS_SOURCE user, ACCESS_VERSION a number) and 6 trigger rows, each
--    enabled = O.
SELECT 'key'::text AS kind, key::text AS name, value::text AS detail
  FROM system_config
 WHERE key IN ('ACCESS_SOURCE', 'ACCESS_VERSION', 'ACCESS_CACHE')
UNION ALL
SELECT 'trigger'::text, tgname::text, (tgrelid::regclass)::text || ' · enabled = ' || tgenabled::text
  FROM pg_trigger
 WHERE tgname LIKE 'trg_access_version_%'
ORDER BY 1, 2;
