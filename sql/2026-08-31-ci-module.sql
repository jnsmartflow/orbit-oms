-- 2026-08-31 · CI module — Goods Return Note (CI-Form) · STEP 1 of 6
-- Spec: docs/prompts/drafts/web-update-2026-08-31-ci-module.md (v3, design locked)
-- Step-0 report: docs/prompts/drafts/code-discovery-2026-08-31-ci-module-readiness.md
--
-- Run in the Supabase SQL Editor. ONE unified block, paste and run start to finish.
-- NO BEGIN/COMMIT wrapper (fails silently in this editor). Plain statements only.
-- camelCase identifiers, double-quoted. Timestamps timestamptz(6).
-- "check" is a reserved word — every CHECK constraint is named chk_*.
--
-- ============================================================================
-- 🔴 RUNNING THIS FILE DOES NOT FINISH THE JOB. SEED IS NOT LIVE.
-- ============================================================================
-- This file writes the LIVE database only:
--   • three tables + their constraints and indexes
--   • the 8 ci_reason_master rows
--   • the 3 LIVE role_permissions rows for pageKey 'ci'
--
-- STILL OWED, and the module does not work without them (spec §13):
--   STEP 2 — prisma/schema.prisma hand-edited to match this file EXACTLY
--            (`npx prisma db pull` fails on the depot machine — IPv4/IPv6, CORE §3),
--            the SAME three grant rows added to prisma/seed.ts, then
--            `npx prisma generate`.
--   Without the seed.ts rows the next wipe-and-reseed SILENTLY REVOKES the live
--   grants written below (CORE §3: "seed is source of truth").
--   STEPS 3-6 — lib/ci/*, API routes, both UIs, nav, router row.
--
-- ============================================================================
-- RESOLVED — "ci_returns"."ciNumber" IS NULLABLE (owner ruling, 2026-09-01)
-- ============================================================================
-- The first draft of this file flagged a contradiction inside spec §6: its
-- column block wrote `ciNumber String @unique` (no `?`, i.e. NOT NULL) while its
-- own "Write order" said "insert the header as status = 'draft' (no CI number
-- yet)" and "a failure part-way leaves a numberless draft".
--
-- 🔴 THE OWNER RULED: NULLABLE. The write order is the intended behaviour — the
--    number is allocated at SUBMIT, and every list filters `status <> 'draft'`
--    so a null-numbered row is never user-visible. The column below is nullable
--    IN THE CREATE TABLE; there is deliberately no follow-up ALTER.
--
-- ✅ SPEC AND FILE AGREE as of spec **v3.1** (2026-09-01). §6's column block now
--   reads `ciNumber String? @unique`, §5 says the column is nullable because the
--   number is allocated at submit, and §6 carries a "ciNumber is NULLABLE"
--   subsection with the reasoning. Step 2 can mirror §6 verbatim — there is no
--   longer a ruling that lives only outside the spec.
--
-- ============================================================================
-- Two more places the spec was SILENT and this file had to choose. Both are
-- one-line changes and both are free while the tables are empty. Change them
-- HERE, before step 2, not after.
-- ============================================================================
--   (a) PRECISION of "litresPerTin" / "returnedQtyLitres". §6 says `Decimal?`
--       with no precision (unlike "ciValue", which it pins at 12,2). Chosen:
--       numeric(12,3) — depot pack sizes carry three decimals (0.925L, 3.7L),
--       so (12,2) would round 0.925 to 0.93 on every sub-litre line.
--   (b) ON DELETE rules the spec does not name: "customerId", "billingOperatorId"
--       and "voidedById" are all nullable, so they take SET NULL; "supervisorId"
--       is NOT NULL so it takes RESTRICT. This mirrors the LIVE `mrn` table
--       exactly (verified 2026-08-31: mrn_createdById_fkey = RESTRICT,
--       mrn_removedById_fkey / mrn_unloadingStartById_fkey / mrn_unloadingEndById_fkey
--       = SET NULL), and matches what Prisma generates by default for an
--       optional relation, so step 2 needs no explicit onDelete for them.
--
-- ============================================================================
-- Naming conventions — matched to the LIVE `mrn` tables (checked 2026-08-31)
-- so that step 2's schema.prisma needs NO `map:` overrides:
--   index  {table}_{column}_idx          e.g. mrn_status_idx
--   unique {table}_{columns}_key         e.g. mrn_mrnDate_srNo_key
--   pkey   {table}_pkey                  (automatic from SERIAL PRIMARY KEY)
--   fkey   {table}_{column}_fkey         (Postgres default)
--   check  chk_{table}_{thing}           e.g. chk_mrn_status
-- ============================================================================


-- ============================================================================
-- SECTION 1 — PRE-FLIGHT. Read this BEFORE running anything below.
-- ============================================================================
-- ⚠ The Supabase SQL Editor shows ONLY THE LAST STATEMENT'S RESULT of a paste.
--   These two SELECTs will therefore NOT be visible on a full-file run. Their
--   content is folded into the final verification SELECT (section 7) so it IS
--   visible. To see them on their own, highlight just this section and run it.

-- (a) THE PRECEDENT BEING COPIED — the live 'mrn' grant. Expected: 3 rows,
--     billing_operator (view+edit+export+delete), floor_supervisor (view+edit),
--     operations (view+edit).
SELECT
  'PRECEDENT — existing mrn rows'      AS "label",
  "roleSlug", "pageKey",
  "canView", "canEdit", "canImport", "canExport", "canDelete"
FROM role_permissions
WHERE "pageKey" = 'mrn'
ORDER BY "roleSlug";

-- (b) ANYTHING ALREADY CLAIMING 'ci'. Expected: ZERO ROWS.
--     🔴 If this returns anything, STOP — do not run section 5. A pre-existing
--     'ci' key means someone else already registered this page and the INSERT
--     below would overwrite their flags.
SELECT
  'PRE-EXISTING ci rows — EXPECT NONE' AS "label",
  "roleSlug", "pageKey",
  "canView", "canEdit", "canImport", "canExport", "canDelete"
FROM role_permissions
WHERE "pageKey" = 'ci'
ORDER BY "roleSlug";


-- ============================================================================
-- SECTION 2 — ci_reason_master (spec §6) + its 8 rows (spec §3.1)
-- ============================================================================
-- A MASTER TABLE, NOT A CHECK CONSTRAINT (spec §3.1): the list will change, and
-- a CHECK makes every change a schema migration. Retire a reason with
-- isActive = false, NEVER DELETE — old CIs must keep pointing at the reason
-- they were raised under, which is also why ci_returns snapshots "reasonLabel".

CREATE TABLE ci_reason_master (
  id          SERIAL       PRIMARY KEY,
  "code"      TEXT         NOT NULL,
  "label"     TEXT         NOT NULL,
  "sortOrder" INTEGER      NOT NULL,
  "isPinned"  BOOLEAN      NOT NULL DEFAULT false,   -- the three common ones
  "isActive"  BOOLEAN      NOT NULL DEFAULT true,    -- retire by flag, never DELETE
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ci_reason_master_code_key ON ci_reason_master ("code");

-- The 8 reasons, spec §3.1, in sortOrder. First three isPinned = true — they sit
-- above a divider in the picker, the rest under "More".
-- One struck-through entry on the owner's sheet is DELIBERATELY EXCLUDED.
INSERT INTO ci_reason_master ("code", "label", "sortOrder", "isPinned") VALUES
  ('WRONG_ORDER_BY_SO',      'Wrong Order by S.O.',    1, true),
  ('PHYSICALLY_CROSS',       'Physically Cross',       2, true),
  ('RETURN_BY_DEALER',       'Return by Dealer',       3, true),
  ('ORDER_CANCEL_BY_DEALER', 'Order Cancel by Dealer', 4, false),
  ('DOUBLE_ORDER',           'Double Order',           5, false),
  ('WRONG_PUNCHING',         'Wrong Punching',         6, false),
  ('RE_BILL',                'Re Bill',                7, false),
  ('COMPLAINT_MATERIAL',     'Complaint Material',     8, false);


-- ============================================================================
-- SECTION 3 — ci_returns (the header, spec §6) — 31 columns
-- ============================================================================

CREATE TABLE ci_returns (
  id                     SERIAL         PRIMARY KEY,
  -- ⚠ NULLABLE, BY OWNER RULING (2026-09-01). A DRAFT CARRIES NO NUMBER.
  --   The number is allocated at SUBMIT, not when the form opens, so the write
  --   order in spec §6 inserts the header first with this blank and fills it in
  --   the third step. A failure part-way therefore leaves a numberless draft,
  --   which is harmless: every list filters `status <> 'draft'`, so a
  --   null-numbered row is never user-visible.
  --   The UNIQUE index below still enforces one number per CI — Postgres treats
  --   NULLs as DISTINCT by default, so any number of concurrent drafts coexist.
  --   🔴 DO NOT ADD `NULLS NOT DISTINCT` to that index: it would permit exactly
  --   ONE draft at a time across the whole depot.
  "ciNumber"             TEXT,                         -- CI-2026-00042, allocated at submit
  "status"               TEXT           NOT NULL,      -- draft | submitted | closed | returned_to_floor

  -- the bill --------------------------------------------------------------
  -- 🔴 orderId IS THE IDENTITY OF THE BILL, never invoiceNo (spec §4).
  "orderId"              INTEGER        NOT NULL,
  "obdNumber"            TEXT           NOT NULL,      -- snapshot; also the TEXT join key to
                                                       -- import_raw_line_items (there is NO FK
                                                       -- from orders to its line items)
  -- ⚠ NULLABLE ON PURPOSE AND LOAD-BEARING (spec §4). 5.0% of bills dispatched
  --   in the last 30 days have no invoice number, 429 `dispatched` rows going
  --   back to 2026-05-15 have never received one. The supervisor is NEVER
  --   BLOCKED: the CI is raised with this blank and the number appears later.
  --   🔴 DO NOT ADD NOT NULL. 🔴 DO NOT BUILD A BACK-FILL JOB — the CI holds
  --   orderId, so any screen reads the invoice number through the order at
  --   render time. This is the ONE place CI deliberately does not snapshot.
  "invoiceNo"            TEXT,
  "invoiceDate"          DATE,
  "soNumber"             TEXT,
  "customerId"           INTEGER,
  "customerCode"         TEXT,
  "customerName"         TEXT,

  -- stage 1 (floor) -------------------------------------------------------
  "returnType"           TEXT           NOT NULL,      -- full | part
  "materialMoved"        TEXT           NOT NULL,      -- moved | not_moved
  "materialReceivedDate" DATE           NOT NULL,
  "reasonId"             INTEGER        NOT NULL,
  "reasonLabel"          TEXT           NOT NULL,      -- snapshot, so a rename never rewrites history
  "reasonRemark"         TEXT,
  "supervisorId"         INTEGER        NOT NULL,
  "submittedAt"          TIMESTAMPTZ(6),

  -- stage 2 (billing) — the "CI details" block ----------------------------
  "ciDate"               DATE,                          -- SAP's CI date
  -- 🔴 TWO SEPARATE NUMBERS, AND ONLY ONE OF THEM IS LABELLED (spec §5).
  --    "ciNumber" above is OrbitOMS's own reference, given at submit.
  --    "sapCiNumber" is SAP's, typed by billing after punching — the billing
  --    screen labels this field plain "CI number", which is why they look
  --    mergeable. THEY ARE NOT. Merging leaves every pending CI with no way to
  --    name it for the hours or days before SAP sees it.
  "sapCiNumber"          TEXT,
  "ciValue"              NUMERIC(12,2),                 -- ₹, the figure circled on the paper form
  "billingOperatorId"    INTEGER,
  "closedAt"             TIMESTAMPTZ(6),

  -- void (never hard-delete a numbered document) --------------------------
  "isVoided"             BOOLEAN        NOT NULL DEFAULT false,
  "voidReason"           TEXT,
  "voidRemark"           TEXT,
  "voidedAt"             TIMESTAMPTZ(6),
  "voidedById"           INTEGER,

  "createdAt"            TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  -- ⚠ DEFAULT now() here covers the INSERT only. Step 2 MUST give this column
  --   Prisma's `@updatedAt` directive so every UPDATE restamps it — NOT a plain
  --   `@default(now())`. push_subscriptions was built the other way and every
  --   write there has to remember to stamp it by hand (CORE §13 landmine). CI's
  --   live marker keys on MAX("updatedAt"); a column that silently stops moving
  --   would freeze the board. The live `mrn` table is the correct precedent.
  "updatedAt"            TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

-- CHECK constraints — chk_ prefix, never the reserved word "check".
-- 🔴 'returned_to_floor' IS IN THE LIST FROM DAY ONE even though no UI uses it
--    (spec §6 + open decision §11.1). Adding a value later means ALTERing a live
--    CHECK; allowing an unused one costs nothing.
ALTER TABLE ci_returns
  ADD CONSTRAINT chk_ci_returns_status
  CHECK ("status" IN ('draft', 'submitted', 'closed', 'returned_to_floor'));

ALTER TABLE ci_returns
  ADD CONSTRAINT chk_ci_returns_return_type
  CHECK ("returnType" IN ('full', 'part'));

ALTER TABLE ci_returns
  ADD CONSTRAINT chk_ci_returns_material_moved
  CHECK ("materialMoved" IN ('moved', 'not_moved'));

-- Foreign keys. RESTRICT on the two the spec names, plus supervisorId (NOT NULL,
-- mirroring mrn_createdById_fkey). SET NULL on the three nullable ones.
ALTER TABLE ci_returns
  ADD CONSTRAINT "ci_returns_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES orders(id) ON DELETE RESTRICT;

ALTER TABLE ci_returns
  ADD CONSTRAINT "ci_returns_reasonId_fkey"
  FOREIGN KEY ("reasonId") REFERENCES ci_reason_master(id) ON DELETE RESTRICT;

ALTER TABLE ci_returns
  ADD CONSTRAINT "ci_returns_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES delivery_point_master(id) ON DELETE SET NULL;

ALTER TABLE ci_returns
  ADD CONSTRAINT "ci_returns_supervisorId_fkey"
  FOREIGN KEY ("supervisorId") REFERENCES users(id) ON DELETE RESTRICT;

ALTER TABLE ci_returns
  ADD CONSTRAINT "ci_returns_billingOperatorId_fkey"
  FOREIGN KEY ("billingOperatorId") REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE ci_returns
  ADD CONSTRAINT "ci_returns_voidedById_fkey"
  FOREIGN KEY ("voidedById") REFERENCES users(id) ON DELETE SET NULL;

-- ⚠ THREE FKs TO `users` ON ONE TABLE (supervisorId / billingOperatorId /
--   voidedById). In step 2 each MUST carry an explicitly NAMED @relation on
--   BOTH sides — @relation("CiReturnSupervisor") / ("CiReturnBillingOperator") /
--   ("CiReturnVoidedBy") per spec §6 — or `prisma generate` throws an
--   AMBIGUITY ERROR, not a warning (CORE §7.3's dual-relation trap; the same
--   discipline pick_assignments' three users relations already follow).

-- Unique + indexes (spec §6: orderId, status, materialReceivedDate, invoiceNo, obdNumber).
CREATE UNIQUE INDEX "ci_returns_ciNumber_key"           ON ci_returns ("ciNumber");
CREATE INDEX        "ci_returns_orderId_idx"            ON ci_returns ("orderId");
CREATE INDEX        "ci_returns_status_idx"             ON ci_returns ("status");
CREATE INDEX        "ci_returns_materialReceivedDate_idx" ON ci_returns ("materialReceivedDate");
-- 🔴 BOTH search keys are indexed — this pair IS the §4 ruling in schema form.
CREATE INDEX        "ci_returns_invoiceNo_idx"          ON ci_returns ("invoiceNo");
CREATE INDEX        "ci_returns_obdNumber_idx"          ON ci_returns ("obdNumber");


-- ============================================================================
-- SECTION 4 — ci_return_lines (spec §6) — 12 columns
-- ============================================================================
-- 🔴 THERE IS DELIBERATELY NO BATCH CHILD TABLE. CI HAS THREE TABLES, NOT FOUR.
--    MRN needs mrn_line_batches because one inbound line can split across
--    manufacturing dates; CI takes a single quantity per line and has nothing to
--    split. Recorded because copying MRN's schema wholesale is the obvious
--    mistake. If mfg dates are ever added they need the child table — a
--    mfgMonth/mfgYear pair on the line cannot express a split — and do NOT copy
--    MRN's bestBeforeMonth/bestBeforeYear, nullable since v27.17 and retired
--    from every surface.

CREATE TABLE ci_return_lines (
  id                  SERIAL         PRIMARY KEY,
  "ciReturnId"        INTEGER        NOT NULL,
  "lineNumber"        INTEGER        NOT NULL,
  -- Nullable pointer back to import_raw_line_items. The spec calls it a
  -- "pointer", NOT a foreign key, and names ON DELETE only for ciReturnId — so
  -- no FK constraint is created here. (Contrast pick_findings, which does carry
  -- a UNIQUE FK to that table.) Left as a plain integer deliberately.
  "rawLineItemId"     INTEGER,

  "skuCode"           TEXT           NOT NULL,   -- the raw SAP material code
                                                 -- 🔴 resolved against
                                                 -- sku_master_v2."material" and NOTHING
                                                 -- else — never a catalog row id
                                                 -- (CORE §13 id-space landmine)
  "skuDescription"    TEXT,                      -- snapshot of the resolved name
  "packCode"          TEXT,                      -- snapshot

  -- ⚠ SNAPSHOT of import_raw_line_items."unitQty", which is SAP's DELIVERY
  --   quantity. THERE IS NO INVOICED-QUANTITY COLUMN ANYWHERE IN THIS DATABASE.
  --   Do not label this "invoiced qty" on any screen or in any later doc.
  --   Snapshotted because a re-import PATCHES the raw line in place, and a
  --   closed CI must not silently change what it claims was delivered.
  "deliveryQty"       INTEGER,
  "returnedQty"       INTEGER        NOT NULL,   -- what came back, in TINS — the only typed number
  -- Litres are CALCULATED, never typed (spec §6):
  --   litresPerTin      = import_raw_line_items."volumeLine" / "unitQty"  (snapshot)
  --   returnedQtyLitres = litresPerTin × returnedQty                      (written at save)
  -- 🔴 GUARD THE DIVISION in step 3: "unitQty" is nullable and could be 0, giving
  --    null/Infinity, which prints as garbage. If it is null or 0, leave
  --    litresPerTin NULL and render the litres cell blank.
  -- ⚠ Confirm "volumeLine" is LITRES, never cubic metres, before wiring the
  --   formula (spec §6 / CORE §8).
  -- Precision (12,3) is this file's choice — the spec gave none. See the header.
  "litresPerTin"      NUMERIC(12,3),
  "returnedQtyLitres" NUMERIC(12,3),

  "createdAt"         TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

ALTER TABLE ci_return_lines
  ADD CONSTRAINT "ci_return_lines_ciReturnId_fkey"
  FOREIGN KEY ("ciReturnId") REFERENCES ci_returns(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX "ci_return_lines_ciReturnId_lineNumber_key"
  ON ci_return_lines ("ciReturnId", "lineNumber");
-- No separate index on "ciReturnId": it is the LEADING column of the unique
-- index above, which already serves every lookup by parent. Do not add one.


-- ============================================================================
-- SECTION 5 — LIVE permission rows for pageKey 'ci'
-- ============================================================================
-- Mirrors the LIVE 'mrn' grant exactly (Step-0 report §F1, SELECT-verified):
--   billing_operator  view + edit + export + delete
--   floor_supervisor  view + edit
--   operations        view + edit
--
-- 🔴 READ SECTION 1(b) FIRST. If any 'ci' row already existed, DO NOT RUN THIS.
--
-- ON CONFLICT targets role_permissions_roleslug_pagekey_key — a REAL existing
-- UNIQUE ("roleSlug","pageKey"), verified 2026-08-31. Makes the file safely
-- re-runnable. "updatedAt" is omitted: the live column is NOT NULL DEFAULT now().

INSERT INTO role_permissions ("roleSlug", "pageKey", "canView", "canEdit", "canImport", "canExport", "canDelete") VALUES
  ('billing_operator', 'ci', true, true, false, true,  true),
  ('floor_supervisor', 'ci', true, true, false, false, false),
  ('operations',       'ci', true, true, false, false, false)
ON CONFLICT ("roleSlug", "pageKey") DO UPDATE SET
  "canView"   = EXCLUDED."canView",
  "canEdit"   = EXCLUDED."canEdit",
  "canImport" = EXCLUDED."canImport",
  "canExport" = EXCLUDED."canExport",
  "canDelete" = EXCLUDED."canDelete";

-- ⚠ AGAIN, BECAUSE IT IS THE EASIEST THING TO FORGET: the three rows above are
--   LIVE ONLY. The matching rows in prisma/seed.ts are STEP 2. A wipe-and-reseed
--   before step 2 lands will revoke all three and the /ci page will 403 in
--   production with nothing in the diff to explain it.


-- ============================================================================
-- SECTION 6 — ROLLBACK (COMMENTED OUT — DESTRUCTIVE, DO NOT RUN CASUALLY)
-- ============================================================================
-- 🔴 EVERY STATEMENT BELOW IS DESTRUCTIVE AND IS COMMENTED OUT DELIBERATELY.
--    Before uncommenting ANY of them, RUN THE VERIFICATION SELECT IN SECTION 7
--    FIRST and read its output — it tells you what exists and how many rows are
--    in it. Dropping ci_returns CASCADEs to ci_return_lines and destroys every
--    numbered CI document, which is exactly what "never hard-delete a numbered
--    document" (spec §6) exists to prevent.
--    Only valid immediately after a failed first run, while all three tables are
--    still empty.
--
-- DELETE FROM role_permissions WHERE "pageKey" = 'ci';
-- DROP TABLE IF EXISTS ci_return_lines;
-- DROP TABLE IF EXISTS ci_returns;
-- DROP TABLE IF EXISTS ci_reason_master;


-- ============================================================================
-- SECTION 7 — VERIFICATION. This MUST be the last statement in the file.
-- ============================================================================
-- The Supabase SQL Editor shows ONLY THE LAST STATEMENT'S RESULT of a paste, so
-- everything worth seeing is folded into this one grid. No LIMIT anywhere (a
-- LIMIT inside UNION ALL must be subquery-wrapped); ordering is via the "ord"
-- column on the outer query. Every value cast to text so the UNION ALL types line up.

SELECT "ord", "section", "item", "detail", "status"
FROM (

  -- ── Tables + column counts ────────────────────────────────────────────────
  SELECT 1 AS "ord", 'TABLE' AS "section", 'ci_reason_master' AS "item",
         count(*)::text || ' columns' AS "detail",
         CASE WHEN count(*) = 7  THEN 'OK — expected 7'  ELSE '🔴 EXPECTED 7'  END AS "status"
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ci_reason_master'

  UNION ALL
  SELECT 2, 'TABLE', 'ci_returns',
         count(*)::text || ' columns',
         CASE WHEN count(*) = 31 THEN 'OK — expected 31' ELSE '🔴 EXPECTED 31' END
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ci_returns'

  UNION ALL
  SELECT 3, 'TABLE', 'ci_return_lines',
         count(*)::text || ' columns',
         CASE WHEN count(*) = 12 THEN 'OK — expected 12' ELSE '🔴 EXPECTED 12' END
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ci_return_lines'

  -- ── The 8 reason rows ─────────────────────────────────────────────────────
  UNION ALL
  SELECT 4, 'REASONS', 'ci_reason_master rows',
         count(*)::text || ' rows, ' || (count(*) FILTER (WHERE "isPinned"))::text || ' pinned',
         CASE WHEN count(*) = 8 AND count(*) FILTER (WHERE "isPinned") = 3
              THEN 'OK — expected 8 rows, 3 pinned' ELSE '🔴 EXPECTED 8 rows, 3 pinned' END
  FROM ci_reason_master

  UNION ALL
  SELECT 5, 'REASONS', "sortOrder"::text || '. ' || "code",
         "label" || CASE WHEN "isPinned" THEN '  [pinned]' ELSE '' END,
         CASE WHEN "isActive" THEN 'active' ELSE '🔴 inactive' END
  FROM ci_reason_master

  -- ── CHECK constraints ─────────────────────────────────────────────────────
  UNION ALL
  -- conname is type `name`, not text — cast explicitly so the UNION ALL types
  -- line up rather than leaning on an implicit coercion.
  SELECT 6, 'CHECKS', conname::text, pg_get_constraintdef(oid), 'OK'
  FROM pg_constraint
  WHERE contype = 'c' AND conrelid = 'ci_returns'::regclass AND conname LIKE 'chk_%'

  UNION ALL
  SELECT 7, 'CHECKS', 'chk_* total on ci_returns', count(*)::text || ' of 3',
         CASE WHEN count(*) = 3 THEN 'OK — status / return_type / material_moved'
              ELSE '🔴 EXPECTED 3' END
  FROM pg_constraint
  WHERE contype = 'c' AND conrelid = 'ci_returns'::regclass AND conname LIKE 'chk_%'

  -- ── Indexes (both search keys must appear) ────────────────────────────────
  UNION ALL
  SELECT 8, 'INDEXES', tablename || ' → ' || indexname, '',
         CASE WHEN indexname IN ('ci_returns_invoiceNo_idx', 'ci_returns_obdNumber_idx')
              THEN 'OK — §4 search key' ELSE 'OK' END
  FROM pg_indexes
  WHERE schemaname = 'public' AND tablename IN ('ci_reason_master', 'ci_returns', 'ci_return_lines')

  -- ── Permissions: the precedent, then the new rows ─────────────────────────
  UNION ALL
  SELECT 9, 'PERMS (precedent)', "roleSlug" || ' → mrn',
         'V=' || "canView"::text || ' E=' || "canEdit"::text || ' I=' || "canImport"::text ||
         ' X=' || "canExport"::text || ' D=' || "canDelete"::text,
         'unchanged — this is what ci copies'
  FROM role_permissions WHERE "pageKey" = 'mrn'

  UNION ALL
  SELECT 10, 'PERMS (new)', "roleSlug" || ' → ci',
         'V=' || "canView"::text || ' E=' || "canEdit"::text || ' I=' || "canImport"::text ||
         ' X=' || "canExport"::text || ' D=' || "canDelete"::text,
         CASE
           WHEN "roleSlug" = 'billing_operator'
             AND ("canView","canEdit","canImport","canExport","canDelete") = (true,true,false,true,true)
             THEN 'OK — matches mrn'
           WHEN "roleSlug" IN ('floor_supervisor','operations')
             AND ("canView","canEdit","canImport","canExport","canDelete") = (true,true,false,false,false)
             THEN 'OK — matches mrn'
           ELSE '🔴 DOES NOT MATCH mrn'
         END
  FROM role_permissions WHERE "pageKey" = 'ci'

  UNION ALL
  SELECT 11, 'PERMS (new)', 'ci rows total', count(*)::text || ' of 3',
         CASE WHEN count(*) = 3 THEN 'OK — expected 3' ELSE '🔴 EXPECTED 3' END
  FROM role_permissions WHERE "pageKey" = 'ci'

  -- ── Standing reminders ────────────────────────────────────────────────────
  UNION ALL
  SELECT 12, 'STILL OWED', 'prisma/seed.ts grant rows',
         'the 3 rows above are LIVE ONLY',
         '🔴 STEP 2 — a reseed before then silently revokes them'

  UNION ALL
  SELECT 13, 'RESOLVED', 'ciNumber nullability',
         'NULLABLE — a draft carries no number; allocated at submit',
         'owner ruling 2026-09-01 · spec on disk is still v3 — v3.1 sync owed'

  -- Proves the ruling actually landed in the table, rather than trusting the
  -- CREATE TABLE text above to have said what it meant.
  UNION ALL
  SELECT 14, 'RESOLVED', 'ci_returns."ciNumber" is_nullable',
         is_nullable,
         CASE WHEN is_nullable = 'YES' THEN 'OK — nullable as ruled'
              ELSE '🔴 STILL NOT NULL — drafts cannot be inserted' END
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'ci_returns' AND column_name = 'ciNumber'

  -- The other half of the ruling: NULLs must stay DISTINCT, or only one draft
  -- can exist across the whole depot.
  UNION ALL
  SELECT 15, 'RESOLVED', 'ci_returns_ciNumber_key nulls handling',
         CASE WHEN indexdef ILIKE '%NULLS NOT DISTINCT%' THEN 'NULLS NOT DISTINCT' ELSE 'NULLS DISTINCT (default)' END,
         CASE WHEN indexdef ILIKE '%NULLS NOT DISTINCT%'
              THEN '🔴 WRONG — allows only ONE draft depot-wide'
              ELSE 'OK — concurrent drafts coexist' END
  FROM pg_indexes
  WHERE schemaname = 'public' AND indexname = 'ci_returns_ciNumber_key'

) AS v
ORDER BY "ord", "item";
