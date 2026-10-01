-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-09-30 — SO order pipeline, PHASE B: drafts + favourites in the database
-- so_saved_drafts · so_live_drafts · so_fav_products · so_starred_dealers
-- Schema version: v27.49 (relabelled 2026-10-01 — drafted as v27.48, but commit 81925d52
-- took v27.48 for the live-feed tint triggers, sql/2026-09-30-live-changes-tint.sql; CORE v120 records this as v27.49).
-- RUN LIVE 2026-09-30 by Smart Flow; verify grid matched (4 tables, all constraints, 4 FKs CASCADE, 0 rows).
-- Decisions: docs/prompts/drafts/web-update-2026-09-30-so-order-pipeline.md (phase B)
-- Login tables this builds on: sql/2026-09-29-so-login-tables.sql (v27.43)
--
-- WRITTEN, NOT RUN. Nothing in the app reads any of this yet.
-- Run in the Supabase SQL Editor, top to bottom, in ONE paste. NO BEGIN/COMMIT
-- (CORE §3). camelCase identifiers, quoted, no @map. SERIAL PKs, timestamptz(6).
-- Safe to re-run: every CREATE uses IF NOT EXISTS; nothing is dropped or altered.
-- Only the LAST statement's result is shown: the read-only verify block at the end.
--
-- WHAT MOVES OFF THE PHONE (app/po2/v2-storage.ts → per SO, keyed on
-- sales_officer_master.id). Sent orders are NOT here — phase E reads mo_orders.
--   po2_saved_drafts    → so_saved_drafts     (cap 20 — CODE)
--   po2_draft           → so_live_drafts      (one row per SO, 24 h expiry — CODE, on read)
--   po2_fav_products    → so_fav_products     (cap 8, refuse the 9th — CODE)
--   po2_starred_dealers → so_starred_dealers  list = 'dealer'  (fuse 200 — CODE)
--   po2_starred_shipto  → so_starred_dealers  list = 'shipto'  (fuse 200 — CODE)
--
-- DESIGN (answers 1-5 of the phase-B brief):
--  1. DRAFTS = ONE jsonb SNAPSHOT PER DRAFT, the exact V2Snapshot shape
--     snapshotOf() builds. Drafts are never queried by content, and
--     migrateLine() must keep running ON READ over old snapshots (tile keys are
--     frozen identifiers that still drift — CLAUDE_PO2.md §6). A normalised line
--     table would freeze today's line shape into columns and force a SQL
--     migration for every tile-key change the code already absorbs for free.
--     "snapshotVersion" = the V2Snapshot shape version (1 today).
--  2. LIVE ORDER = SERVER-SIDE, ONE ROW PER SO, but the PHONE STAYS PRIMARY.
--     localStorage keeps its 400 ms debounce (per keystroke, free). The server
--     copy is written only: on screen change, on pagehide / visibilitychange
--     hidden, and at most once per 60 s while editing (trailing) — and never
--     when the payload is byte-identical to the last one sent. Emptying the
--     order (Send / Clear / Start over) DELETEs the row. 24 h expiry is applied
--     on read, as today. "revision" lets a stale second phone be refused
--     (UPDATE … WHERE "revision" = expected) instead of silently overwriting.
--  3. FAVOURITES + STARS = ONE ROW PER ITEM. A toggle is one tiny INSERT or one
--     DELETE — no read-modify-write of a whole array, so two phones cannot lose
--     each other's taps, and a unique key makes a double tap a no-op. The cost:
--     the caps (8, 200) are row COUNTS, which a CHECK cannot express, so the
--     code counts before inserting (the /po2 "refuse, never evict" rule).
--  4. FIRST LOGIN ON A PHONE WITH po2_* DATA → ASK ONCE, then MERGE (never
--     overwrite). /po2's data carries no salesman stamp (CLAUDE_PO2.md §11) and a
--     depot phone can be shared, so importing silently could file one salesman's
--     drafts under another. Merge = union by key, caps applied, server wins on a
--     clash; the live draft is imported only if the server has none. The answer
--     is remembered per phone per SO in the new page's OWN key prefix; po2_* keys
--     are read, never written or deleted (/po2 and /po9 are still live).
--  5. ON DELETE CASCADE on all four FKs to sales_officer_master. This is personal
--     UI state with no audit value (same call as so_login_codes / so_sessions).
--     In practice it never fires: SOs are deactivated, not deleted, and
--     so_order_access (RESTRICT) already blocks deleting any SO ever granted.
--
-- WRITE BUDGET (🔴 the 2026-09-29 Disk IO outage): per ACTIVE SO per hour —
--   live draft ~10-15 typical (ceiling ≈ 60 trailing + a few hides/screen changes),
--   saved drafts 1-3, favourites/stars 0-2  →  ~15-20 writes/h typical, ~70 ceiling.
--   Rows are small (a 12-line snapshot ≈ 3-4 KB jsonb). NO polling anywhere: the
--   page reads these tables once on load and after the SO's own actions.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 1. so_saved_drafts — named drafts (po2_saved_drafts) ──────────────────
-- "clientId" is the draft's own id as the page mints it (newDraftId(),
-- "d{ms}{rand}"), so an upsert by (SO, clientId) replaces a reopened draft in
-- place exactly as upsertSavedDraft does, and an import is idempotent.
CREATE TABLE IF NOT EXISTS so_saved_drafts (
  "id"              SERIAL         PRIMARY KEY,
  "salesOfficerId"  integer        NOT NULL,
  "clientId"        text           NOT NULL,
  "name"            text           NULL,
  "label"           text           NOT NULL,
  "snapshot"        jsonb          NOT NULL,
  "snapshotVersion" smallint       NOT NULL DEFAULT 1,
  "savedAt"         timestamptz(6) NOT NULL DEFAULT now(),
  "createdAt"       timestamptz(6) NOT NULL DEFAULT now(),
  "updatedAt"       timestamptz(6) NOT NULL DEFAULT now(),
  -- CASCADE: personal UI state, no audit value (header, answer 5).
  CONSTRAINT "so_saved_drafts_salesOfficerId_fkey"
    FOREIGN KEY ("salesOfficerId") REFERENCES sales_officer_master(id) ON DELETE CASCADE,
  CONSTRAINT chk_so_saved_drafts_client_id
    CHECK (char_length("clientId") BETWEEN 1 AND 64),
  CONSTRAINT chk_so_saved_drafts_name
    CHECK ("name" IS NULL OR char_length("name") <= 60),
  CONSTRAINT chk_so_saved_drafts_label
    CHECK (char_length("label") <= 200),
  -- The one structural promise validSnapshot() relies on: an object with lines[].
  CONSTRAINT chk_so_saved_drafts_snapshot_shape
    CHECK (jsonb_typeof("snapshot") = 'object' AND jsonb_typeof("snapshot" -> 'lines') = 'array'),
  -- A fuse, not a policy: a 12-line order is ~3-4 KB.
  CONSTRAINT chk_so_saved_drafts_snapshot_size
    CHECK (octet_length("snapshot"::text) <= 65536),
  CONSTRAINT chk_so_saved_drafts_snapshot_version
    CHECK ("snapshotVersion" >= 1)
);

-- Upsert key + the import's idempotence.
CREATE UNIQUE INDEX IF NOT EXISTS so_saved_drafts_so_client_key
  ON so_saved_drafts ("salesOfficerId", "clientId");
-- The Drafts list, newest first; also serves the CASCADE FK.
CREATE INDEX IF NOT EXISTS so_saved_drafts_so_saved_idx
  ON so_saved_drafts ("salesOfficerId", "savedAt" DESC);


-- ── 2. so_live_drafts — the in-progress order (po2_draft), one row per SO ──
-- PK = salesOfficerId (precedent: load_plan_config keyed on its FK). An empty
-- order DELETEs the row; 24 h expiry is applied on read (code), as today.
CREATE TABLE IF NOT EXISTS so_live_drafts (
  "salesOfficerId"  integer        PRIMARY KEY,
  "snapshot"        jsonb          NOT NULL,
  "snapshotVersion" smallint       NOT NULL DEFAULT 1,
  -- Optimistic concurrency: UPDATE … WHERE "revision" = expected; +1 per write.
  "revision"        integer        NOT NULL DEFAULT 1,
  -- Which phone wrote it last (random id the page keeps in its own storage).
  "deviceId"        text           NULL,
  "createdAt"       timestamptz(6) NOT NULL DEFAULT now(),
  "updatedAt"       timestamptz(6) NOT NULL DEFAULT now(),
  -- CASCADE: personal UI state, no audit value (header, answer 5).
  CONSTRAINT "so_live_drafts_salesOfficerId_fkey"
    FOREIGN KEY ("salesOfficerId") REFERENCES sales_officer_master(id) ON DELETE CASCADE,
  CONSTRAINT chk_so_live_drafts_snapshot_shape
    CHECK (jsonb_typeof("snapshot") = 'object' AND jsonb_typeof("snapshot" -> 'lines') = 'array'),
  CONSTRAINT chk_so_live_drafts_snapshot_size
    CHECK (octet_length("snapshot"::text) <= 65536),
  CONSTRAINT chk_so_live_drafts_snapshot_version
    CHECK ("snapshotVersion" >= 1),
  CONSTRAINT chk_so_live_drafts_revision
    CHECK ("revision" >= 1),
  CONSTRAINT chk_so_live_drafts_device_id
    CHECK ("deviceId" IS NULL OR char_length("deviceId") <= 64)
);
-- No extra index: the PK is the only lookup.


-- ── 3. so_fav_products — favourite board tiles (po2_fav_products) ─────────
-- "tileKey" is V2BoardTile.key — a FROZEN identifier (CLAUDE_PO2.md §6). No
-- label or art stored: both derive from boardTile(key) at render, and a key that
-- has left the board is pruned ON READ by the code, exactly as loadFavProducts.
-- Cap 8, refuse the 9th: CODE (count before insert).
CREATE TABLE IF NOT EXISTS so_fav_products (
  "id"             SERIAL         PRIMARY KEY,
  "salesOfficerId" integer        NOT NULL,
  "tileKey"        text           NOT NULL,
  "addedAt"        timestamptz(6) NOT NULL DEFAULT now(),
  -- CASCADE: personal UI state, no audit value (header, answer 5).
  CONSTRAINT "so_fav_products_salesOfficerId_fkey"
    FOREIGN KEY ("salesOfficerId") REFERENCES sales_officer_master(id) ON DELETE CASCADE,
  CONSTRAINT chk_so_fav_products_tile_key
    CHECK (char_length("tileKey") BETWEEN 1 AND 200)
);

-- One row per (SO, tile): a double tap is a no-op. Also the per-SO list + FK.
CREATE UNIQUE INDEX IF NOT EXISTS so_fav_products_so_tile_key
  ON so_fav_products ("salesOfficerId", "tileKey");


-- ── 4. so_starred_dealers — both star lists (po2_starred_dealers / _shipto) ─
-- "list" keeps the two lists APART (CLAUDE_PO2.md §9): the same code may be
-- starred on one, both or neither. name/area are a display copy of the V2Star
-- entry; the code is what matters and is re-resolved against the live dealer
-- list. Fuse 200 per list: CODE.
CREATE TABLE IF NOT EXISTS so_starred_dealers (
  "id"             SERIAL         PRIMARY KEY,
  "salesOfficerId" integer        NOT NULL,
  "list"           text           NOT NULL,
  "customerCode"   text           NOT NULL,
  "name"           text           NOT NULL,
  "area"           text           NULL,
  "starredAt"      timestamptz(6) NOT NULL DEFAULT now(),
  -- CASCADE: personal UI state, no audit value (header, answer 5).
  CONSTRAINT "so_starred_dealers_salesOfficerId_fkey"
    FOREIGN KEY ("salesOfficerId") REFERENCES sales_officer_master(id) ON DELETE CASCADE,
  CONSTRAINT chk_so_starred_dealers_list
    CHECK ("list" IN ('dealer', 'shipto')),
  CONSTRAINT chk_so_starred_dealers_code
    CHECK (char_length(btrim("customerCode")) BETWEEN 1 AND 40),
  CONSTRAINT chk_so_starred_dealers_name
    CHECK (char_length("name") <= 200)
);

-- One star per (SO, list, dealer): toggling is INSERT / DELETE on this key.
-- Also serves "this SO's list" (≤ 200 rows, sorted by starredAt in code) + FK.
CREATE UNIQUE INDEX IF NOT EXISTS so_starred_dealers_so_list_code_key
  ON so_starred_dealers ("salesOfficerId", "list", "customerCode");


-- ── VERIFY (read-only) — the only result the editor shows ──────────────────
-- Expect after a clean first run:
--   4 table rows (columns 10 / 7 / 4 / 7) ·
--   constraints — so_saved_drafts 8 (1 p, 1 f, 6 c) · so_live_drafts 7 (1 p, 1 f, 5 c)
--                 · so_fav_products 3 (1 p, 1 f, 1 c) · so_starred_dealers 5 (1 p, 1 f, 3 c) ·
--   indexes — so_saved_drafts 3 (pkey, so_client_key, so_saved_idx) · so_live_drafts 1 (pkey)
--             · so_fav_products 2 (pkey, so_tile_key) · so_starred_dealers 2 (pkey, so_list_code_key) ·
--   4 fk_target rows, all → sales_officer_master ON DELETE CASCADE ·
--   row counts 0.
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
  WHERE t.relname IN ('so_saved_drafts', 'so_live_drafts', 'so_fav_products', 'so_starred_dealers')
    AND t.relkind = 'r'

  UNION ALL
  SELECT '2 constraint'::text,
         con.conrelid::regclass::text,
         con.conname::text,
         con.contype::text,
         pg_get_constraintdef(con.oid)::text
  FROM pg_constraint con
  WHERE con.conrelid::regclass::text IN ('so_saved_drafts', 'so_live_drafts', 'so_fav_products', 'so_starred_dealers')

  UNION ALL
  SELECT '3 index'::text,
         i.tablename::text,
         i.indexname::text,
         ''::text,
         i.indexdef::text
  FROM pg_indexes i
  WHERE i.schemaname = 'public'
    AND i.tablename IN ('so_saved_drafts', 'so_live_drafts', 'so_fav_products', 'so_starred_dealers')

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
  WHERE con.conrelid::regclass::text IN ('so_saved_drafts', 'so_live_drafts', 'so_fav_products', 'so_starred_dealers')
    AND con.contype = 'f'

  UNION ALL
  SELECT '5 rows'::text, 'so_saved_drafts'::text, 'rows'::text, ''::text,
         (SELECT COUNT(*) FROM so_saved_drafts)::text
  UNION ALL
  SELECT '5 rows'::text, 'so_live_drafts'::text, 'rows'::text, ''::text,
         (SELECT COUNT(*) FROM so_live_drafts)::text
  UNION ALL
  SELECT '5 rows'::text, 'so_fav_products'::text, 'rows'::text, ''::text,
         (SELECT COUNT(*) FROM so_fav_products)::text
  UNION ALL
  SELECT '5 rows'::text, 'so_starred_dealers'::text, 'rows'::text, ''::text,
         (SELECT COUNT(*) FROM so_starred_dealers)::text
) v
ORDER BY q, tbl, name;


-- ═══════════════════════════════════════════════════════════════════════════
-- CAPS — where each one is enforced
--   SQL (CHECK): snapshot shape (object + lines[]), snapshot ≤ 64 KB, draft
--     name ≤ 60, label ≤ 200, clientId 1-64, tileKey 1-200, star list ∈
--     {dealer, shipto}, customerCode non-blank ≤ 40, revision ≥ 1; one row per
--     (SO, clientId) / (SO, tile) / (SO, list, code) via the unique indexes;
--     one live draft per SO via the PK.
--   CODE (row counts — a CHECK cannot count rows, and a trigger is not worth it):
--     20 saved drafts per SO (oldest dropped on save, as upsertSavedDraft) ·
--     8 favourite tiles per SO (9th REFUSED, never evicted) · 200 stars per list
--     (fuse) · 24 h live-draft expiry (on read) · dead tile keys pruned on read ·
--     migrateLine on every snapshot read.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- PRISMA MODEL TEXT — for the BUILD commit (hand-mirror; never db push / db pull).
-- Every relation to sales_officer_master is NAMED (that model already carries
-- named relations: CustomerSOLinks, ContactSOLinks, SoOrderAccessOfficer, …).
-- ═══════════════════════════════════════════════════════════════════════════
--
-- // SO saved drafts (v27.49, 2026-09-30) — po2_saved_drafts moved to the DB.
-- // snapshot = the V2Snapshot shape (app/po2/v2-storage.ts snapshotOf), migrated
-- // ON READ by migrateLine. Cap 20 per SO is enforced in code.
-- // CHECKs not expressible here: chk_so_saved_drafts_client_id / _name / _label /
-- // _snapshot_shape / _snapshot_size / _snapshot_version.
-- model so_saved_drafts {
--   id              Int                  @id @default(autoincrement())
--   salesOfficerId  Int
--   salesOfficer    sales_officer_master @relation("SoSavedDraftOfficer", fields: [salesOfficerId], references: [id], onDelete: Cascade)
--   clientId        String
--   name            String?
--   label           String
--   snapshot        Json
--   snapshotVersion Int                  @default(1) @db.SmallInt
--   savedAt         DateTime             @default(now()) @db.Timestamptz(6)
--   createdAt       DateTime             @default(now()) @db.Timestamptz(6)
--   updatedAt       DateTime             @default(now()) @updatedAt @db.Timestamptz(6)
--
--   @@unique([salesOfficerId, clientId], map: "so_saved_drafts_so_client_key")
--   @@index([salesOfficerId, savedAt(sort: Desc)], map: "so_saved_drafts_so_saved_idx")
-- }
--
-- // SO live (in-progress) draft (v27.49) — po2_draft moved to the DB, ONE row per
-- // SO. The phone stays primary; the server copy is written on screen change,
-- // page hide, and at most once per 60 s while editing. Empty order → DELETE.
-- // 24 h expiry applied on read. UPDATE … WHERE revision = expected.
-- model so_live_drafts {
--   salesOfficerId  Int                  @id
--   salesOfficer    sales_officer_master @relation("SoLiveDraftOfficer", fields: [salesOfficerId], references: [id], onDelete: Cascade)
--   snapshot        Json
--   snapshotVersion Int                  @default(1) @db.SmallInt
--   revision        Int                  @default(1)
--   deviceId        String?
--   createdAt       DateTime             @default(now()) @db.Timestamptz(6)
--   updatedAt       DateTime             @default(now()) @updatedAt @db.Timestamptz(6)
-- }
--
-- // SO favourite board tiles (v27.49) — po2_fav_products moved to the DB.
-- // tileKey = V2BoardTile.key (FROZEN, CLAUDE_PO2.md §6). Cap 8, 9th refused — code.
-- model so_fav_products {
--   id             Int                  @id @default(autoincrement())
--   salesOfficerId Int
--   salesOfficer   sales_officer_master @relation("SoFavProductOfficer", fields: [salesOfficerId], references: [id], onDelete: Cascade)
--   tileKey        String
--   addedAt        DateTime             @default(now()) @db.Timestamptz(6)
--
--   @@unique([salesOfficerId, tileKey], map: "so_fav_products_so_tile_key")
-- }
--
-- // SO starred dealers, BOTH lists (v27.49) — po2_starred_dealers ('dealer') and
-- // po2_starred_shipto ('shipto'); chk_so_starred_dealers_list. Fuse 200 per list — code.
-- model so_starred_dealers {
--   id             Int                  @id @default(autoincrement())
--   salesOfficerId Int
--   salesOfficer   sales_officer_master @relation("SoStarredDealerOfficer", fields: [salesOfficerId], references: [id], onDelete: Cascade)
--   list           String
--   customerCode   String
--   name           String
--   area           String?
--   starredAt      DateTime             @default(now()) @db.Timestamptz(6)
--
--   @@unique([salesOfficerId, list, customerCode], map: "so_starred_dealers_so_list_code_key")
-- }
--
-- // ADD to model sales_officer_master (back-relations):
-- //   savedDrafts     so_saved_drafts[]    @relation("SoSavedDraftOfficer")
-- //   liveDraft       so_live_drafts?      @relation("SoLiveDraftOfficer")
-- //   favProducts     so_fav_products[]    @relation("SoFavProductOfficer")
-- //   starredDealers  so_starred_dealers[] @relation("SoStarredDealerOfficer")
--
-- ═══════════════════════════════════════════════════════════════════════════
-- DRAFT CORE §7 CHAIN ENTRY (write it in the build commit, not now):
--
-- - **v27.49** · 2026-09-30 · SQL `sql/2026-09-30-so-drafts-favourites.sql` (Prisma models in
--   the same commit) · SO order pipeline phase B — `/po2`'s phone-only state moved to the
--   database per sales officer (decisions `docs/prompts/drafts/web-update-2026-09-30-so-order-pipeline.md`).
--   Four new tables, every FK → `sales_officer_master` ON DELETE CASCADE (personal UI state,
--   no audit value; never fires in practice — SOs are deactivated, and `so_order_access`
--   RESTRICT already blocks deleting a granted SO). **`so_saved_drafts`** (10 columns) — one
--   jsonb `snapshot` per named draft in the `V2Snapshot` shape, migrated on read by
--   `migrateLine`; `so_saved_drafts_salesOfficerId_fkey`; CHECKs `chk_so_saved_drafts_client_id`,
--   `_name`, `_label`, `_snapshot_shape`, `_snapshot_size` (≤ 64 KB), `_snapshot_version`;
--   unique `so_saved_drafts_so_client_key` ("salesOfficerId","clientId"), index
--   `so_saved_drafts_so_saved_idx` ("salesOfficerId","savedAt" DESC). **`so_live_drafts`**
--   (7 columns, PK `salesOfficerId`) — the in-progress order, one row per SO, `revision` for
--   optimistic concurrency; `so_live_drafts_salesOfficerId_fkey`; CHECKs
--   `chk_so_live_drafts_snapshot_shape`, `_snapshot_size`, `_snapshot_version`, `_revision`,
--   `_device_id`. **`so_fav_products`** (4 columns) — one row per favourite tile;
--   `so_fav_products_salesOfficerId_fkey`; `chk_so_fav_products_tile_key`; unique
--   `so_fav_products_so_tile_key`. **`so_starred_dealers`** (7 columns) — both star lists,
--   `list` ∈ {dealer, shipto} (`chk_so_starred_dealers_list`), `chk_so_starred_dealers_code`,
--   `chk_so_starred_dealers_name`; unique `so_starred_dealers_so_list_code_key`. Relations
--   `SoSavedDraftOfficer`, `SoLiveDraftOfficer`, `SoFavProductOfficer`, `SoStarredDealerOfficer`.
--   Row-count caps (20 drafts, 8 favourites refused-not-evicted, 200-star fuse) and the 24 h
--   live-draft expiry are CODE rules. Write budget ~15-20 writes per active SO per hour
--   (ceiling ~70); no polling. No `live_changes` trigger — no staff screen reads these
--   tables. [RUN LIVE <date> and verified — fill in from the verify grid.]
-- ═══════════════════════════════════════════════════════════════════════════
