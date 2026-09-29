-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-09-29 — Sales-officer OTP login: so_order_access · so_login_codes · so_sessions
-- Proposed schema version: v27.43 (CORE header at writing: v112 · Schema v27.42)
-- Discovery: docs/prompts/drafts/code-discovery-2026-09-29-po2-so-login.md (§A Option 2, §C, §G)
--
-- WRITTEN, NOT RUN. Nothing in the app reads any of this yet.
-- Run in the Supabase SQL Editor, top to bottom, in ONE paste. NO BEGIN/COMMIT
-- (CORE §3). camelCase identifiers, quoted, no @map. SERIAL PKs, timestamptz(6).
-- Safe to re-run: every CREATE uses IF NOT EXISTS; nothing is dropped or altered.
-- Only the LAST statement's result is shown: the read-only verify block at the end.
--
-- DESIGN (owner, 2026-09-29):
--  • SO login is SEPARATE from staff NextAuth. lib/auth.ts / auth.config.ts untouched.
--  • An SO may log in only if: sales_officer_master.email matches (lower+btrim),
--    isActive = true, AND a live (revokedAt IS NULL) so_order_access row exists.
--  • Order access is a SEPARATE table on purpose: whoever can edit
--    sales_officer_master must not be able to grant/revoke order access.
--    Grant/revoke is superuser-only (route-level check, built later).
--  • Codes: 6 digits, HASHED only, 10 min, max 5 wrong tries, 60 s resend cooldown
--    (all app logic; the table only makes a plaintext code impossible to store).
--  • Sessions: 30 days, server-side, cookie carries a random token; the DB keeps
--    ONLY its hash. The session check must ALSO re-check the live access row and
--    sales_officer_master.isActive, so a revoke/deactivate ends every session at once.
--
-- ON DELETE choices (one line each, repeated at each FK):
--  • so_order_access → sales_officer_master RESTRICT: the grant history is the audit
--    record; an SO who was ever granted cannot be hard-deleted (deactivate instead —
--    no SO DELETE route exists today anyway).
--  • grantedById → users RESTRICT (same as pick_delete_decisions.decidedById):
--    a grant must always name who made it.
--  • revokedById → users SET NULL (same as pick_delete_decisions.undoneById), so
--    chk_so_order_access_revoke is one-directional on purpose.
--  • so_login_codes / so_sessions → sales_officer_master CASCADE: ephemeral
--    credentials with no audit value; if the SO row goes, they must go with it.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 1. so_order_access — who may place orders ─────────────────────────────
-- PARTIAL UNIQUE (salesOfficerId) WHERE "revokedAt" IS NULL, NOT a plain unique:
--  • keeps HISTORY — a revoke stamps revokedAt/revokedById, a re-grant is a NEW row,
--    so "who granted, who revoked, when" is never overwritten;
--  • still guarantees at most ONE live grant per SO (a double grant hits P2002);
--  • a plain unique would force either overwriting the old grant's actors on re-grant
--    (audit lost) or deleting the row (audit lost).
--  Prisma cannot model a partial index → recorded as a model comment, never @@unique
--  (same class as pick_delete_decisions_*_live_key and so_tags_soNumber_live_key).
CREATE TABLE IF NOT EXISTS so_order_access (
  "id"             SERIAL         PRIMARY KEY,
  "salesOfficerId" integer        NOT NULL,
  "grantedById"    integer        NOT NULL,
  "grantedAt"      timestamptz(6) NOT NULL DEFAULT now(),
  "revokedAt"      timestamptz(6) NULL,
  "revokedById"    integer        NULL,
  "note"           text           NULL,
  "updatedAt"      timestamptz(6) NOT NULL DEFAULT now(),
  -- RESTRICT: grant history is the audit record (see header).
  CONSTRAINT "so_order_access_salesOfficerId_fkey"
    FOREIGN KEY ("salesOfficerId") REFERENCES sales_officer_master(id) ON DELETE RESTRICT,
  -- RESTRICT: a grant always names its grantor.
  CONSTRAINT "so_order_access_grantedById_fkey"
    FOREIGN KEY ("grantedById")    REFERENCES users(id)                ON DELETE RESTRICT,
  -- SET NULL: removing a staff user must not erase the fact of the revoke.
  CONSTRAINT "so_order_access_revokedById_fkey"
    FOREIGN KEY ("revokedById")    REFERENCES users(id)                ON DELETE SET NULL,
  -- A revoker implies a revoke time (one-directional because of SET NULL above).
  CONSTRAINT chk_so_order_access_revoke
    CHECK ("revokedById" IS NULL OR "revokedAt" IS NOT NULL),
  CONSTRAINT chk_so_order_access_revoke_order
    CHECK ("revokedAt" IS NULL OR "revokedAt" >= "grantedAt")
);

-- At most ONE live grant per SO; history rows (revoked) unlimited.
CREATE UNIQUE INDEX IF NOT EXISTS so_order_access_live_key
  ON so_order_access ("salesOfficerId")
  WHERE "revokedAt" IS NULL;
-- History per SO + the referencing side of the RESTRICT FK.
CREATE INDEX IF NOT EXISTS so_order_access_so_idx
  ON so_order_access ("salesOfficerId");


-- ── 2. so_login_codes — one row per code sent ─────────────────────────────
CREATE TABLE IF NOT EXISTS so_login_codes (
  "id"             SERIAL         PRIMARY KEY,
  "salesOfficerId" integer        NOT NULL,
  "email"          text           NOT NULL,
  "codeHash"       text           NOT NULL,
  "expiresAt"      timestamptz(6) NOT NULL,
  "attempts"       integer        NOT NULL DEFAULT 0,
  "usedAt"         timestamptz(6) NULL,
  "requestedIp"    text           NULL,
  "createdAt"      timestamptz(6) NOT NULL DEFAULT now(),
  -- CASCADE: ephemeral credential, no audit value (see header).
  CONSTRAINT "so_login_codes_salesOfficerId_fkey"
    FOREIGN KEY ("salesOfficerId") REFERENCES sales_officer_master(id) ON DELETE CASCADE,
  CONSTRAINT chk_so_login_codes_email_normalised
    CHECK ("email" = lower(btrim("email")) AND "email" <> ''),
  -- A 6-digit plaintext code can never be stored: any real hash (hex SHA-256 = 64)
  -- is far longer than 32 chars.
  CONSTRAINT chk_so_login_codes_hash_not_plain
    CHECK (char_length("codeHash") >= 32),
  CONSTRAINT chk_so_login_codes_attempts
    CHECK ("attempts" >= 0),
  CONSTRAINT chk_so_login_codes_expiry
    CHECK ("expiresAt" > "createdAt"),
  CONSTRAINT chk_so_login_codes_used
    CHECK ("usedAt" IS NULL OR "usedAt" >= "createdAt")
);

-- "Latest code for this SO" (verify) and "sent in the last 60 s?" (cooldown).
-- Also serves the CASCADE FK.
CREATE INDEX IF NOT EXISTS so_login_codes_so_created_idx
  ON so_login_codes ("salesOfficerId", "createdAt" DESC);
-- Per-IP request throttling across emails.
CREATE INDEX IF NOT EXISTS so_login_codes_ip_created_idx
  ON so_login_codes ("requestedIp", "createdAt" DESC);


-- ── 3. so_sessions — server-side sessions (cookie token → hash) ───────────
CREATE TABLE IF NOT EXISTS so_sessions (
  "id"             SERIAL         PRIMARY KEY,
  "tokenHash"      text           NOT NULL,
  "salesOfficerId" integer        NOT NULL,
  "createdAt"      timestamptz(6) NOT NULL DEFAULT now(),
  "expiresAt"      timestamptz(6) NOT NULL,
  "lastSeenAt"     timestamptz(6) NOT NULL DEFAULT now(),
  "revokedAt"      timestamptz(6) NULL,
  "userAgent"      text           NULL,
  "ip"             text           NULL,
  CONSTRAINT "so_sessions_tokenHash_key" UNIQUE ("tokenHash"),
  -- CASCADE: ephemeral credential, no audit value (see header).
  CONSTRAINT "so_sessions_salesOfficerId_fkey"
    FOREIGN KEY ("salesOfficerId") REFERENCES sales_officer_master(id) ON DELETE CASCADE,
  CONSTRAINT chk_so_sessions_hash_not_plain
    CHECK (char_length("tokenHash") >= 32),
  CONSTRAINT chk_so_sessions_expiry
    CHECK ("expiresAt" > "createdAt"),
  CONSTRAINT chk_so_sessions_revoked
    CHECK ("revokedAt" IS NULL OR "revokedAt" >= "createdAt")
);

-- "Revoke every session of this SO" + the CASCADE FK.
CREATE INDEX IF NOT EXISTS so_sessions_so_idx
  ON so_sessions ("salesOfficerId");


-- ═══════════════════════════════════════════════════════════════════════════
-- TEST DATA — FULLY COMMENTED OUT. DATA, NOT SCHEMA. NEVER SEED.
-- Replace BOTH placeholders first:
--   <OWNER_EMAIL_HERE>        the email the TEST sales officer logs in with (lowercase)
--   <OWNER_STAFF_EMAIL_HERE>  the owner's STAFF login email (users.email) → grantedById
--
-- ⚠ The TEST SO row is ACTIVE, so it will appear in the Sales Officer dropdowns of
--   /admin/customers, /tint/manager/customers and /dispatcher/customers (they list
--   isActive = true). Do not assign it to a customer. Deactivate it after the test.
--
-- STEP A — run this SELECT ON ITS OWN first (highlight it, Run). The Editor shows
-- only the last statement's result, so it must not be run together with step B.
-- Any row = a clash. sales_officer_master.email is @unique but CASE-SENSITIVE, so
-- this compares lower(btrim()). A users row with the same email is EXPECTED and
-- harmless (separate logins); an existing SO row with it means step B inserts nothing.
--
-- SELECT 'sales_officer_master'::text AS source, id::text, name::text, email::text,
--        ('isActive=' || "isActive"::text) AS detail
-- FROM sales_officer_master
-- WHERE lower(btrim(email)) = lower(btrim('<OWNER_EMAIL_HERE>'))
-- UNION ALL
-- SELECT 'users (login email)'::text, id::text, name::text, email::text,
--        ('isActive=' || "isActive"::text || ' isSuperuser=' || "isSuperuser"::text)
-- FROM users
-- WHERE lower(btrim(email)) IN (lower(btrim('<OWNER_EMAIL_HERE>')),
--                               lower(btrim('<OWNER_STAFF_EMAIL_HERE>')));
--
-- STEP B — the two inserts. Each is guarded, so a re-run inserts nothing.
-- employeeCode is NOT NULL (not unique) in schema.prisma:748 → a TEST marker.
--
-- INSERT INTO sales_officer_master ("name", "employeeCode", "email", "phone", "isActive", "createdAt")
-- SELECT 'TEST — Smart Flow', 'TEST-SF', lower(btrim('<OWNER_EMAIL_HERE>')), NULL, true, now()
-- WHERE NOT EXISTS (
--   SELECT 1 FROM sales_officer_master
--   WHERE lower(btrim(email)) = lower(btrim('<OWNER_EMAIL_HERE>'))
-- );
--
-- -- Grant: only if exactly ONE staff user matches the staff email (0 or 2+ → nothing).
-- INSERT INTO so_order_access ("salesOfficerId", "grantedById", "note")
-- SELECT so.id, u.id, 'TEST — owner test login, 2026-09-29'
-- FROM sales_officer_master so
-- JOIN (
--   SELECT MIN(id) AS id FROM users
--   WHERE lower(btrim(email)) = lower(btrim('<OWNER_STAFF_EMAIL_HERE>'))
--   HAVING COUNT(*) = 1
-- ) u ON true
-- WHERE lower(btrim(so.email)) = lower(btrim('<OWNER_EMAIL_HERE>'))
--   AND NOT EXISTS (
--     SELECT 1 FROM so_order_access a
--     WHERE a."salesOfficerId" = so.id AND a."revokedAt" IS NULL
--   );
--
-- STEP B is followed by the verify block below (it shows so_order_access row count).
-- ═══════════════════════════════════════════════════════════════════════════


-- ── VERIFY (read-only) — the only result the editor shows ──────────────────
-- Expect after a clean first run:
--   3 table rows ·
--   constraints — so_order_access 6 (1 p, 3 f, 2 c) · so_login_codes 7 (1 p, 1 f, 5 c)
--                 · so_sessions 6 (1 p, 1 u, 1 f, 3 c) ·
--   indexes — so_order_access 3 (pkey, live_key partial unique, so_idx)
--             · so_login_codes 3 (pkey, so_created_idx, ip_created_idx)
--             · so_sessions 3 (pkey, tokenHash_key, so_idx) ·
--   5 fk_target rows (3 on so_order_access, 1 each on the other two) ·
--   row counts 0 (or 1 / 1 for so_order_access after the TEST section).
SELECT q, tbl, name, kind, detail
FROM (
  SELECT '1 table'::text AS q,
         t.relname::text AS tbl,
         t.relname::text AS name,
         t.relkind::text AS kind,
         ('columns=' || (SELECT COUNT(*) FROM pg_attribute a
                          WHERE a.attrelid = t.oid AND a.attnum > 0 AND NOT a.attisdropped)::text) AS detail
  FROM pg_class t
  JOIN pg_namespace n ON n.oid = t.relnamespace AND n.nspname = 'public'
  WHERE t.relname IN ('so_order_access', 'so_login_codes', 'so_sessions') AND t.relkind = 'r'

  UNION ALL
  SELECT '2 constraint'::text,
         con.conrelid::regclass::text,
         con.conname::text,
         con.contype::text,
         pg_get_constraintdef(con.oid)::text
  FROM pg_constraint con
  WHERE con.conrelid::regclass::text IN ('so_order_access', 'so_login_codes', 'so_sessions')

  UNION ALL
  SELECT '3 index'::text,
         i.tablename::text,
         i.indexname::text,
         ''::text,
         i.indexdef::text
  FROM pg_indexes i
  WHERE i.schemaname = 'public'
    AND i.tablename IN ('so_order_access', 'so_login_codes', 'so_sessions')

  UNION ALL
  SELECT '4 fk_target'::text,
         con.conrelid::regclass::text,
         con.conname::text,
         con.confrelid::regclass::text,
         CASE con.confdeltype::text
           WHEN 'r' THEN 'ON DELETE RESTRICT'
           WHEN 'n' THEN 'ON DELETE SET NULL'
           WHEN 'c' THEN 'ON DELETE CASCADE'
           WHEN 'a' THEN 'ON DELETE NO ACTION'
           ELSE 'ON DELETE ' || con.confdeltype::text
         END
  FROM pg_constraint con
  WHERE con.conrelid::regclass::text IN ('so_order_access', 'so_login_codes', 'so_sessions')
    AND con.contype = 'f'

  UNION ALL
  SELECT '5 rows'::text, 'so_order_access'::text, 'live grants'::text, ''::text,
         (SELECT COUNT(*) FROM so_order_access WHERE "revokedAt" IS NULL)::text
  UNION ALL
  SELECT '5 rows'::text, 'so_login_codes'::text, 'rows'::text, ''::text,
         (SELECT COUNT(*) FROM so_login_codes)::text
  UNION ALL
  SELECT '5 rows'::text, 'so_sessions'::text, 'rows'::text, ''::text,
         (SELECT COUNT(*) FROM so_sessions)::text
) v
ORDER BY q, tbl, name;


-- ═══════════════════════════════════════════════════════════════════════════
-- PRISMA MODEL TEXT — for the BUILD commit (hand-mirror; never db push / db pull).
-- Relation names are EXPLICIT everywhere: users is referenced TWICE by
-- so_order_access (grantedBy, revokedBy), and sales_officer_master already has
-- named relations (CustomerSOLinks, ContactSOLinks).
-- ═══════════════════════════════════════════════════════════════════════════
--
-- // Sales-officer order access (v27.43, 2026-09-29). SEPARATE from
-- // sales_officer_master on purpose: editing the SO master must not grant or
-- // revoke order access — only a superuser route does.
-- // 🔴 PARTIAL UNIQUE INDEX so_order_access_live_key ("salesOfficerId")
-- //    WHERE "revokedAt" IS NULL — exists in Supabase only; Prisma cannot model
-- //    it. Never add @@unique([salesOfficerId]): revoked rows are history.
-- model so_order_access {
--   id             Int                  @id @default(autoincrement())
--   salesOfficerId Int
--   salesOfficer   sales_officer_master @relation("SoOrderAccessOfficer", fields: [salesOfficerId], references: [id], onDelete: Restrict)
--   grantedById    Int
--   grantedBy      users                @relation("SoOrderAccessGrantedBy", fields: [grantedById], references: [id], onDelete: Restrict)
--   grantedAt      DateTime             @default(now()) @db.Timestamptz(6)
--   revokedAt      DateTime?            @db.Timestamptz(6)
--   // SET NULL, so chk_so_order_access_revoke is one-directional on purpose.
--   revokedById    Int?
--   revokedBy      users?               @relation("SoOrderAccessRevokedBy", fields: [revokedById], references: [id], onDelete: SetNull)
--   note           String?
--   updatedAt      DateTime             @default(now()) @updatedAt @db.Timestamptz(6)
--
--   @@index([salesOfficerId], map: "so_order_access_so_idx")
-- }
--
-- // One row per OTP sent (v27.43). codeHash only — chk_so_login_codes_hash_not_plain
-- // makes a plaintext 6-digit code unstorable. email is stored lower(btrim()).
-- model so_login_codes {
--   id             Int                  @id @default(autoincrement())
--   salesOfficerId Int
--   salesOfficer   sales_officer_master @relation("SoLoginCodeOfficer", fields: [salesOfficerId], references: [id], onDelete: Cascade)
--   email          String
--   codeHash       String
--   expiresAt      DateTime             @db.Timestamptz(6)
--   attempts       Int                  @default(0)
--   usedAt         DateTime?            @db.Timestamptz(6)
--   requestedIp    String?
--   createdAt      DateTime             @default(now()) @db.Timestamptz(6)
--
--   @@index([salesOfficerId, createdAt(sort: Desc)], map: "so_login_codes_so_created_idx")
--   @@index([requestedIp, createdAt(sort: Desc)], map: "so_login_codes_ip_created_idx")
-- }
--
-- // Server-side SO sessions (v27.43). The cookie carries a random token; only
-- // its hash is stored. Validity = not revoked AND not expired AND a live
-- // so_order_access row AND sales_officer_master.isActive — checked every request.
-- model so_sessions {
--   id             Int                  @id @default(autoincrement())
--   tokenHash      String               @unique(map: "so_sessions_tokenHash_key")
--   salesOfficerId Int
--   salesOfficer   sales_officer_master @relation("SoSessionOfficer", fields: [salesOfficerId], references: [id], onDelete: Cascade)
--   createdAt      DateTime             @default(now()) @db.Timestamptz(6)
--   expiresAt      DateTime             @db.Timestamptz(6)
--   lastSeenAt     DateTime             @default(now()) @db.Timestamptz(6)
--   revokedAt      DateTime?            @db.Timestamptz(6)
--   userAgent      String?
--   ip             String?
--
--   @@index([salesOfficerId], map: "so_sessions_so_idx")
-- }
--
-- // ADD to model sales_officer_master (back-relations):
-- //   orderAccess    so_order_access[]    @relation("SoOrderAccessOfficer")
-- //   loginCodes     so_login_codes[]     @relation("SoLoginCodeOfficer")
-- //   sessions       so_sessions[]        @relation("SoSessionOfficer")
--
-- // ADD to model users (back-relations — two, one per FK):
-- //   soAccessGranted so_order_access[]   @relation("SoOrderAccessGrantedBy")
-- //   soAccessRevoked so_order_access[]   @relation("SoOrderAccessRevokedBy")
--
-- ═══════════════════════════════════════════════════════════════════════════
-- DRAFT CORE §7 CHAIN ENTRY (write it in the build commit, not now):
--
-- - **v27.43** · 2026-09-29 · SQL `sql/2026-09-29-so-login-tables.sql` (Prisma models in
--   the same commit) · Sales-officer OTP login, separate from staff NextAuth (discovery
--   `docs/prompts/drafts/code-discovery-2026-09-29-po2-so-login.md`, Option 2). Three new
--   tables. **`so_order_access`** (8 columns) — the order-access grant, deliberately NOT a
--   column on `sales_officer_master` so SO-master editors cannot grant it; FKs
--   `so_order_access_salesOfficerId_fkey` → sales_officer_master RESTRICT,
--   `so_order_access_grantedById_fkey` → users RESTRICT, `so_order_access_revokedById_fkey`
--   → users SET NULL (two FKs to `users`, relations `SoOrderAccessGrantedBy` /
--   `SoOrderAccessRevokedBy` named on both sides); CHECKs `chk_so_order_access_revoke`,
--   `chk_so_order_access_revoke_order`; 🔴 PARTIAL unique `so_order_access_live_key
--   ("salesOfficerId") WHERE "revokedAt" IS NULL` (model comment, never `@@unique`) + plain
--   `so_order_access_so_idx`. **`so_login_codes`** (9 columns) — hashed 6-digit codes;
--   `so_login_codes_salesOfficerId_fkey` CASCADE; CHECKs `chk_so_login_codes_email_normalised`,
--   `chk_so_login_codes_hash_not_plain`, `chk_so_login_codes_attempts`,
--   `chk_so_login_codes_expiry`, `chk_so_login_codes_used`; indexes
--   `so_login_codes_so_created_idx`, `so_login_codes_ip_created_idx`. **`so_sessions`**
--   (9 columns) — server-side 30-day sessions storing only the token hash;
--   `so_sessions_tokenHash_key` UNIQUE, `so_sessions_salesOfficerId_fkey` CASCADE; CHECKs
--   `chk_so_sessions_hash_not_plain`, `chk_so_sessions_expiry`, `chk_so_sessions_revoked`;
--   index `so_sessions_so_idx`. Code limits (10 min, 5 tries, 60 s cooldown, 30-day session)
--   are app rules, not constraints. [RUN LIVE <date> and verified — fill in from the verify grid.]
-- ═══════════════════════════════════════════════════════════════════════════
