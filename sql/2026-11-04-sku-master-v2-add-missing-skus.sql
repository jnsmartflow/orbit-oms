-- ============================================================================
-- sql/2026-11-04-sku-master-v2-add-missing-skus.sql
-- 2026-11-04 · sku_master_v2 — add the SKUs the depot stocks but the catalog
-- does not know; bring back 15 TOOLS rollers/brushes; retire 2 old Aquatech
-- Damp Protect codes.
--
-- ⚠ DML ONLY — NO SCHEMA CHANGE, NO SCHEMA VERSION IS MINTED. No table,
-- column, CHECK or index is created, altered or dropped; CORE's schema stamp
-- does not move. Prisma needs no edit and no `prisma generate`.
-- RUN 2026-11-04 — read-back clean: 2,102 total · 2,090 active
-- (Written 2026-11-04; run by the owner in the Supabase SQL Editor.)
--
-- ── SOURCE ──────────────────────────────────────────────────────────────────
--   SAP Q53D stock report of 03.11.2026 compared against sku_master_v2.
--   Owner's worksheet: docs/prompts/drafts/sku_master_v2-proposed-additions.xlsx
--   (copied 2026-11-04 from Downloads), sheets "Proposed master rows" (359),
--   "Reactivate in master" (15), "Deactivate in master" (4 — only 2 used, see
--   decision 2). The VALUES below were GENERATED from that sheet, not typed.
--
-- ── DECISIONS (Smart Flow, 2026-11-04) ──────────────────────────────────────
--   1. Every category = 'PROJECT' row gets displayCategory = 'Project' — ONE
--      picking family chip — overriding the per-range names in the xlsx
--      (85 of the 85 PROJECT rows changed). "product" keeps the range name.
--   2. Deactivate ONLY 5908363 and 5908366 (replaced by 9296827 / 9296830).
--      5908364 and 5908365 stay ACTIVE — old stock is still on the floor (54
--      and 1 pcs on 03.11) and the stock-count phone only offers active codes.
--      No other column of those four rows is touched.
--   3. Duco PU and Crest stay category 'AUTO REFINISH', as in the xlsx.
--   4. Data, not schema — see the top.
--
-- ── WHAT THIS FILE DOES ─────────────────────────────────────────────────────
--   INSERT 359 rows, by category:
--     AUTO REFINISH     235
--     PROJECT            85
--     VELVET TOUCH       16
--     WS                  7
--     AQUATECH            4
--     TEXTURE             4
--     VT SPECIALTY        4
--     GLOSS               1
--     PROMISE             1
--     PROMISE INTERIOR    1
--     SUPERCOVER          1
--   UPDATE 15 TOOLS 645xxxx rows: isActive false → true, displayCategory
--     NULL → 'Brush & Roller' (matching the 31 tools already active).
--   UPDATE 2 Aquatech rows (5908363, 5908366): isActive true → false.
--   Nothing is deleted. No other row is touched.
--
-- ── xlsx → table (applied by the generator; discovery 2026-11-04) ───────────
--   · baseColour and packCode are NOT NULL in the live table: a blank cell is
--     written '' (as the 216 existing blank-baseColour rows are), never NULL.
--     This file: baseColour '' on 17 rows, packCode '' on 3 rows.
--   · piecesPerCarton: NULL where blank (337 rows), never 0 — a 0 would make
--     lib/article-tag.ts drop the article tag instead of using its fallback.
--   · unit: NULL where blank (3 rows — the same ones with no pack; unit is nullable).
--   · refMaterial, refDescription, displayName: NULL. paintType / materialType:
--     NULL where blank (none is blank in this sheet).
--   · isPrimary / isActive: real booleans (the xlsx holds the text "true"/"false").
--     5 Gen-tint codes carry isPrimary = false.
--   · material upper-cased and trimmed; description / product / category /
--     baseColour / packCode / unit trimmed. Text is otherwise as in the xlsx.
--   · id comes from sku_master_v2_id_seq (not supplied). createdAt = updatedAt
--     = now() — updatedAt has NO @updatedAt and is hand-maintained (CORE §7.1.c).
--
-- ── EXPECTED (live read 2026-11-04) ─────────────────────────────────────────
--   total rows 1,743 → 2,102 (+359) · active rows 1,718 → 2,090 (+359 +15 −2)
--
-- ── HOW TO RUN (Smart Flow, Supabase SQL Editor) ─────────────────────────────
--   The whole file in ONE paste, top to bottom. No BEGIN/COMMIT (CORE §3). The
--   editor shows only the LAST result — the read-back (section 5).
--   🔴 SINGLE-RUN FILE. Section 2 REFUSES the paste (nothing changed) unless the
--   catalog is exactly in its 2026-11-04 shape — so a second paste stops at
--   once. The editor runs a paste as one implicit transaction, so a failure
--   part-way normally leaves NOTHING behind; confirm by pasting sections 1-2
--   alone (they write only session temp tables): the guard must pass again.
--   Section 5 cannot run alone in a new session — it reads section 2's temp
--   tables.
--   No deploy is needed: every reader queries the table live. The stock-count
--   phone picks the new list up on its next screen open (content-hash version).
-- ============================================================================


-- ============================================================================
-- 1. TIMEOUT (the postgres role's statement_timeout is 30s).
-- ============================================================================

SET statement_timeout = 0;


-- ============================================================================
-- 2. GUARD — refuse the whole paste, changing nothing, unless:
--   · the code list holds exactly 359 codes;
--   · none of the 359 materials already exists (trim + upper-case compare);
--   · all 15 reactivate rows exist and are isActive = false;
--   · 5908363 and 5908366 both exist and are isActive = true.
--   Then print the before counts and keep them for the read-back.
-- ============================================================================

-- The 359 codes, for the guard and the read-back. A session temp table.
DROP TABLE IF EXISTS pg_temp.sku_add_codes;
CREATE TEMP TABLE sku_add_codes (material text PRIMARY KEY);
INSERT INTO sku_add_codes (material) VALUES
    ('9296827'), ('9296829'), ('9296830'), ('9296828'), ('5867133'), ('5883561'), ('5953895'), ('5853035'),
    ('5993732'), ('5921078'), ('5921077'), ('IN37909774'), ('IN37909674'), ('5948218'), ('5948217'), ('5948180'),
    ('5948182'), ('5948382'), ('5948384'), ('5948383'), ('5765908'), ('IN41019068'), ('IN43100068'), ('9079909'),
    ('9079913'), ('9079917'), ('9079905'), ('9079911'), ('9079915'), ('9079907'), ('9079912'), ('9079916'),
    ('9079908'), ('9079910'), ('9079914'), ('9079918'), ('9079906'), ('5967862'), ('5967863'), ('IN19900072'),
    ('IN19905272'), ('IN19900272'), ('IN19910072'), ('IN19903772'), ('IN19900772'), ('IN19909472'), ('IN19908772'), ('IN19901772'),
    ('IN19922072'), ('IN19908072'), ('IN19907272'), ('IN19927372'), ('IN19906472'), ('IN19908672'), ('IN19904372'), ('IN19908472'),
    ('IN19900472'), ('IN19902172'), ('IN19906872'), ('IN19901172'), ('IN19902972'), ('IN19903472'), ('IN19923472'), ('IN19900172'),
    ('IN19900281'), ('IN19900271'), ('IN19903771'), ('IN19929171'), ('IN19922771'), ('IN19900171'), ('IN11029063'), ('IN11025563'),
    ('IN11029263'), ('IN19900073'), ('IN19900273'), ('IN11027672'), ('IN11007072'), ('IN12901972'), ('IN12902772'), ('IN12902272'),
    ('IN11025872'), ('IN11028272'), ('IN12902971'), ('IN11006663'), ('IN60003472'), ('IN15103272'), ('IN51100271'), ('IN11006872'),
    ('IN32000372'), ('IN11000272'), ('IN03045672'), ('IN11001372'), ('IN03012272'), ('IN03012472'), ('IN03652572'), ('IN03043872'),
    ('IN11004972'), ('IN11009672'), ('IN11005172'), ('IN11016372'), ('IN60000672'), ('IN11001772'), ('IN01032872'), ('IN03651072'),
    ('IN11006379'), ('IN60005981'), ('IN03012271'), ('IN01032871'), ('IN03651071'), ('IN11006363'), ('IN13900425'), ('IN60000676'),
    ('5576460'), ('5571449'), ('5571452'), ('5571454'), ('IN11060272'), ('IN15300272'), ('IN11016572'), ('IN11017172'),
    ('IN11041872'), ('IN11060463'), ('IN54650152'), ('5379496'), ('5379497'), ('5379498'), ('5379499'), ('5379500'),
    ('5379501'), ('5379502'), ('5379503'), ('5379505'), ('5379506'), ('5379507'), ('5379508'), ('5379510'),
    ('5379493'), ('5379494'), ('5379495'), ('5379504'), ('5379509'), ('IN61110172'), ('IN61100572'), ('IN61100772'),
    ('IN61101072'), ('IN61110672'), ('IN61112072'), ('IN61119872'), ('IN61120372'), ('IN61120672'), ('IN61123072'), ('IN61123272'),
    ('IN61123372'), ('IN61123672'), ('IN61124372'), ('IN61124672'), ('IN61124872'), ('IN61127672'), ('IN61140072'), ('IN61143472'),
    ('IN61143572'), ('IN61145272'), ('IN61145672'), ('IN61145772'), ('IN61154572'), ('IN61156572'), ('IN61162472'), ('5801998'),
    ('IN61165672'), ('5575543'), ('IN61170072'), ('IN61172372'), ('IN61190372'), ('IN61191072'), ('IN61191172'), ('IN61191272'),
    ('IN61192072'), ('IN61192372'), ('IN61192472'), ('IN61192572'), ('IN61192672'), ('IN61193072'), ('IN61194272'), ('IN61195072'),
    ('IN61195272'), ('IN61195372'), ('IN61195472'), ('IN61195672'), ('IN61195772'), ('IN61195872'), ('IN61196172'), ('IN61196272'),
    ('IN61196472'), ('IN61196672'), ('IN61196872'), ('IN61197072'), ('IN61100271'), ('IN61100371'), ('IN61100471'), ('IN61100671'),
    ('IN61110071'), ('IN61111071'), ('IN61120071'), ('IN61180071'), ('IN61184071'), ('5751240'), ('IN51100672'), ('IN15100472'),
    ('IN51100671'), ('5751241'), ('5679096'), ('IN51100451'), ('IN51000272'), ('IN51000472'), ('IN51000872'), ('IN51000972'),
    ('IN51007772'), ('IN51008872'), ('IN51011172'), ('IN51011272'), ('IN51012172'), ('IN51012272'), ('IN51021172'), ('IN51021372'),
    ('IN51032472'), ('IN51032672'), ('IN51033172'), ('IN51033872'), ('IN51041372'), ('IN51041572'), ('IN51041672'), ('IN51041772'),
    ('IN51051172'), ('IN51051272'), ('IN51051372'), ('IN51061672'), ('IN51061772'), ('IN51071172'), ('IN51081172'), ('IN51081372'),
    ('IN51081672'), ('IN51081872'), ('IN51005572'), ('5916034'), ('5915876'), ('IN54650572'), ('IN54650472'), ('IN54650571'),
    ('IN54650471'), ('IN51014072'), ('IN51016072'), ('IN51023772'), ('IN51043872'), ('IN51045472'), ('IN51056572'), ('IN51065372'),
    ('IN51076772'), ('5553507'), ('5758555'), ('IN64076473'), ('IN64076173'), ('5553506'), ('5487906'), ('IN32301172'),
    ('IN13300203'), ('IN51001472'), ('IN51001272'), ('IN32304372'), ('IN32304271'), ('IN60006472'), ('IN60006172'), ('IN60006481'),
    ('IN60006476'), ('IN51000672'), ('IN84409081'), ('9071758'), ('IN84409481'), ('IN84409581'), ('IN84400081'), ('5749938'),
    ('IN23600081'), ('IN23609081'), ('5862521'), ('IN86409081'), ('IN86409281'), ('IN86400081'), ('IN23359081'), ('IN23350081'),
    ('9061393'), ('IN32256881'), ('5573771'), ('IN36819023'), ('IN36819223'), ('5990192'), ('IN36810023'), ('IN32650081'),
    ('IN36809081'), ('IN36819081'), ('IN36819281'), ('9071774'), ('IN36819481'), ('IN36819581'), ('IN36819681'), ('IN36810081'),
    ('IN46259023'), ('IN46259223'), ('5990190'), ('IN46259423'), ('IN46250023'), ('9071775'), ('IN76519281'), ('IN83109023'),
    ('IN83109223'), ('5990191'), ('5990193'), ('IN83100023'), ('5879693'), ('5844389'), ('5852571'), ('IN83509081'),
    ('5844390'), ('5852572'), ('9071760'), ('5844391'), ('5852573'), ('5844392'), ('5844388'), ('IN45109081'),
    ('IN45109281'), ('IN45109481'), ('IN45109781'), ('5818102'), ('5811510'), ('5818104'), ('5825225'), ('5811485'),
    ('5811515'), ('5811516'), ('5818100'), ('IN74009023'), ('IN74009223'), ('5990188'), ('IN74000023'), ('5901074'),
    ('5912040'), ('5901075'), ('5850762'), ('5901073'), ('IN44709023'), ('IN44709223'), ('5990189'), ('IN44709423'),
    ('IN44700023'), ('IN44709081'), ('IN44709281'), ('9071776'), ('IN44709481'), ('IN44709781'), ('IN44700081');

DO $$
DECLARE
  v_problems text := '';
  v_n        int;
  v_total    bigint;
  v_active   bigint;
BEGIN
  SELECT count(*) INTO v_n FROM sku_add_codes;
  IF v_n <> 359 THEN
    v_problems := v_problems || ' · expected 359 codes in the list, found ' || v_n;
  END IF;

  SELECT count(*) INTO v_n
    FROM sku_master_v2 s JOIN sku_add_codes c ON upper(trim(s.material)) = upper(trim(c.material));
  IF v_n > 0 THEN
    v_problems := v_problems || ' · ' || v_n || ' of the 359 materials already exist in sku_master_v2 (already run?)';
  END IF;

  SELECT count(*) INTO v_n FROM sku_master_v2
   WHERE material IN ('6457581', '6457586', '6457576', '6457577', '6457571', '6457574', '6457575', '6457592', '6457599', '6457604', '6457582', '6457597', '6457598', '6457589', '6457601')
     AND "isActive" = false;
  IF v_n <> 15 THEN
    v_problems := v_problems || ' · expected 15 inactive TOOLS rows to reactivate, found ' || v_n;
  END IF;

  SELECT count(*) INTO v_n FROM sku_master_v2
   WHERE material IN ('5908363', '5908366') AND "isActive" = true;
  IF v_n <> 2 THEN
    v_problems := v_problems || ' · expected 5908363 and 5908366 both active, found ' || v_n || ' active';
  END IF;

  IF v_problems <> '' THEN
    RAISE EXCEPTION 'sku_master_v2 add-missing-skus: not in the 2026-11-04 shape:%. Nothing was changed.', v_problems;
  END IF;

  SELECT count(*), count(*) FILTER (WHERE "isActive") INTO v_total, v_active FROM sku_master_v2;
  RAISE NOTICE 'sku_master_v2 before: % rows · % active (expect 1743 · 1718)', v_total, v_active;
END
$$;

-- The "before" snapshot, for the read-back (notices are easy to miss).
DROP TABLE IF EXISTS pg_temp.sku_add_before;
CREATE TEMP TABLE sku_add_before AS
  SELECT count(*)::bigint AS total, count(*) FILTER (WHERE "isActive")::bigint AS active
    FROM sku_master_v2;


-- ============================================================================
-- 3. INSERT the 359 rows. id from the serial. No ON CONFLICT — section 2 proved
--    none exists, and a duplicate must fail the whole paste on the material
--    UNIQUE (sku_master_v2_material_key) rather than be skipped silently.
-- ============================================================================

INSERT INTO sku_master_v2 (
  "material", "description", "category", "product", "baseColour", "packCode", "unit",
  "refMaterial", "refDescription", "paintType", "materialType", "piecesPerCarton",
  "isPrimary", "isActive", "displayCategory", "displayName", "createdAt", "updatedAt"
) VALUES
  ('9296827', 'DN Aquatech DP 2in1 1L', 'AQUATECH', 'DAMP PROTECT 2IN1', '', '1', 'L', NULL, NULL, 'water', 'waterproofing', 6, true, true, 'Aquatech', NULL, now(), now()),
  ('9296829', 'DN Aquatech DP 2in1 10L', 'AQUATECH', 'DAMP PROTECT 2IN1', '', '10', 'L', NULL, NULL, 'water', 'waterproofing', NULL, true, true, 'Aquatech', NULL, now(), now()),
  ('9296830', 'DN Aquatech DP 2in1 20L', 'AQUATECH', 'DAMP PROTECT 2IN1', '', '20', 'L', NULL, NULL, 'water', 'waterproofing', NULL, true, true, 'Aquatech', NULL, now(), now()),
  ('9296828', 'DN Aquatech DP 2in1 4L', 'AQUATECH', 'DAMP PROTECT 2IN1', '', '4', 'L', NULL, NULL, 'water', 'waterproofing', 4, true, true, 'Aquatech', NULL, now(), now()),
  ('5867133', 'DN 5IN1 93 BASE 0.925L', 'GLOSS', '5IN1 GLOSS', '93 BASE', '1', 'L', NULL, NULL, 'solvent', 'enamel', 6, true, true, 'Gloss', NULL, now(), now()),
  ('5883561', 'DN Promise Exterior 96 Base 22L', 'PROMISE', 'PROMISE EXTERIOR', '96 BASE', '22', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Promise Exterior', NULL, now(), now()),
  ('5953895', 'Promise SmartC Acrylic Dist DTS 20Kg', 'PROMISE INTERIOR', 'PROMISE SMARTCHOICE ACRYLIC DISTEMPER', '', '20', 'KG', NULL, NULL, 'water', 'emulsion', NULL, true, true, 'Promise Smartchoice', NULL, now(), now()),
  ('5853035', 'DPP-SuperCover Ultra 95 base 1LTR', 'SUPERCOVER', 'SUPERCOVER', '95 BASE', '1', 'L', NULL, NULL, 'water', 'interior', 6, true, true, 'Supercover', NULL, now(), now()),
  ('5993732', 'DN WS Texture Ultrafine 25Kg', 'TEXTURE', 'TEXTURE', '', '25', 'KG', NULL, NULL, 'water', 'texture', NULL, true, true, 'Texture', NULL, now(), now()),
  ('5921078', 'DN VT ETERNA MATT 93 BASE  .925L', 'VELVET TOUCH', 'VT ETERNA MATT', '93 BASE', '1', 'L', NULL, NULL, 'water', 'interior', 6, true, true, 'VT Eterna Matt', NULL, now(), now()),
  ('5921077', 'DN VT ETERNA MATT 93 BASE 3.7L', 'VELVET TOUCH', 'VT ETERNA MATT', '93 BASE', '4', 'L', NULL, NULL, 'water', 'interior', 4, true, true, 'VT Eterna Matt', NULL, now(), now()),
  ('IN37909774', 'DN VT FIN GOLD SAMPLER 200ML', 'VT SPECIALTY', 'VT FIN', 'GOLD', '200', 'ML', NULL, NULL, 'water', 'interior', 12, true, true, 'VT Specialty', NULL, now(), now()),
  ('IN37909674', 'DN VT FIN SILVER SAMPLER 200ML', 'VT SPECIALTY', 'VT FIN', 'SILVER', '200', 'ML', NULL, NULL, 'water', 'interior', 12, true, true, 'VT Specialty', NULL, now(), now()),
  ('5948218', 'DN WS Max 10yr 93 Base 10L', 'WS', 'WS MAX', '93 BASE', '10', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Max', NULL, now(), now()),
  ('5948217', 'DN WS Max 10yr 93 Base 4L', 'WS', 'WS MAX', '93 BASE', '4', 'L', NULL, NULL, 'water', 'exterior', 4, true, true, 'Max', NULL, now(), now()),
  ('5948180', 'DN WS PF 15yr 93 Base 1L', 'WS', 'WS POWERFLEXX', '93 BASE', '1', 'L', NULL, NULL, 'water', 'exterior', 6, true, true, 'Powerflexx', NULL, now(), now()),
  ('5948182', 'DN WS PF 15yr 93 Base 10L', 'WS', 'WS POWERFLEXX', '93 BASE', '10', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Powerflexx', NULL, now(), now()),
  ('5948382', 'DN WS RP 8yr 93 Base 1L', 'WS', 'WS PROTECT RAINPROOF', '93 BASE', '1', 'L', NULL, NULL, 'water', 'exterior', 6, true, true, 'Protect Rainproof', NULL, now(), now()),
  ('5948384', 'DN WS RP 8yr 93 Base 10L', 'WS', 'WS PROTECT RAINPROOF', '93 BASE', '10', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Protect Rainproof', NULL, now(), now()),
  ('5948383', 'DN WS RP 8yr 93 Base 4L', 'WS', 'WS PROTECT RAINPROOF', '93 BASE', '4', 'L', NULL, NULL, 'water', 'exterior', 4, true, true, 'Protect Rainproof', NULL, now(), now()),
  ('5765908', 'PS Creation Sandtex Ultrafine 30kg', 'TEXTURE', 'CREATION SANDTEX', '', '30', 'KG', NULL, NULL, 'water', 'texture', NULL, true, true, 'Texture', NULL, now(), now()),
  ('IN41019068', 'PS WS Creation Sandtex 100 Med Dana 30Kg', 'TEXTURE', 'CREATION SANDTEX', '', '30', 'KG', NULL, NULL, 'water', 'texture', NULL, true, true, 'Texture', NULL, now(), now()),
  ('IN43100068', 'PS Creation Sandtex HS 30 Kg', 'TEXTURE', 'CREATION SANDTEX', '', '30', 'KG', NULL, NULL, 'water', 'texture', NULL, true, true, 'Texture', NULL, now(), now()),
  ('9079909', 'Dulux VT Soft Sheen 90base 1L', 'VELVET TOUCH', 'VT SOFT SHEEN', '90 BASE', '1', 'L', NULL, NULL, 'water', 'interior', 6, true, true, 'VT Soft Sheen', NULL, now(), now()),
  ('9079913', 'Dulux VT Soft Sheen 92base 1L', 'VELVET TOUCH', 'VT SOFT SHEEN', '92 BASE', '1', 'L', NULL, NULL, 'water', 'interior', 6, true, true, 'VT Soft Sheen', NULL, now(), now()),
  ('9079917', 'Dulux VT Soft Sheen 93base 1L', 'VELVET TOUCH', 'VT SOFT SHEEN', '93 BASE', '1', 'L', NULL, NULL, 'water', 'interior', 6, true, true, 'VT Soft Sheen', NULL, now(), now()),
  ('9079905', 'Dulux VT Soft Sheen BR White 1L', 'VELVET TOUCH', 'VT SOFT SHEEN', 'BRILLIANT WHITE', '1', 'L', NULL, NULL, 'water', 'interior', 6, true, true, 'VT Soft Sheen', NULL, now(), now()),
  ('9079911', 'Dulux VT Soft Sheen 90base 10L', 'VELVET TOUCH', 'VT SOFT SHEEN', '90 BASE', '10', 'L', NULL, NULL, 'water', 'interior', NULL, true, true, 'VT Soft Sheen', NULL, now(), now()),
  ('9079915', 'Dulux VT Soft Sheen 92base 10L', 'VELVET TOUCH', 'VT SOFT SHEEN', '92 BASE', '10', 'L', NULL, NULL, 'water', 'interior', NULL, true, true, 'VT Soft Sheen', NULL, now(), now()),
  ('9079907', 'Dulux VT Soft Sheen BR White 10L', 'VELVET TOUCH', 'VT SOFT SHEEN', 'BRILLIANT WHITE', '10', 'L', NULL, NULL, 'water', 'interior', NULL, true, true, 'VT Soft Sheen', NULL, now(), now()),
  ('9079912', 'Dulux VT Soft Sheen 90base 20L', 'VELVET TOUCH', 'VT SOFT SHEEN', '90 BASE', '20', 'L', NULL, NULL, 'water', 'interior', NULL, true, true, 'VT Soft Sheen', NULL, now(), now()),
  ('9079916', 'Dulux VT Soft Sheen 92base 20L', 'VELVET TOUCH', 'VT SOFT SHEEN', '92 BASE', '20', 'L', NULL, NULL, 'water', 'interior', NULL, true, true, 'VT Soft Sheen', NULL, now(), now()),
  ('9079908', 'Dulux VT Soft Sheen BR White 20L', 'VELVET TOUCH', 'VT SOFT SHEEN', 'BRILLIANT WHITE', '20', 'L', NULL, NULL, 'water', 'interior', NULL, true, true, 'VT Soft Sheen', NULL, now(), now()),
  ('9079910', 'Dulux VT Soft Sheen 90base 4L', 'VELVET TOUCH', 'VT SOFT SHEEN', '90 BASE', '4', 'L', NULL, NULL, 'water', 'interior', 4, true, true, 'VT Soft Sheen', NULL, now(), now()),
  ('9079914', 'Dulux VT Soft Sheen 92base 4L', 'VELVET TOUCH', 'VT SOFT SHEEN', '92 BASE', '4', 'L', NULL, NULL, 'water', 'interior', 4, true, true, 'VT Soft Sheen', NULL, now(), now()),
  ('9079918', 'Dulux VT Soft Sheen 93base 4L', 'VELVET TOUCH', 'VT SOFT SHEEN', '93 BASE', '4', 'L', NULL, NULL, 'water', 'interior', 4, true, true, 'VT Soft Sheen', NULL, now(), now()),
  ('9079906', 'Dulux VT Soft Sheen BR White 4L', 'VELVET TOUCH', 'VT SOFT SHEEN', 'BRILLIANT WHITE', '4', 'L', NULL, NULL, 'water', 'interior', 4, true, true, 'VT Soft Sheen', NULL, now(), now()),
  ('5967862', 'DN VT Desert Gold Base 1L', 'VT SPECIALTY', 'VT DESERT', 'DESERT GOLD', '1', 'L', NULL, NULL, 'water', 'interior', 6, true, true, 'VT Specialty', NULL, now(), now()),
  ('5967863', 'DN VT Desert Silver Base 1L', 'VT SPECIALTY', 'VT DESERT', 'DESERT SILVER', '1', 'L', NULL, NULL, 'water', 'interior', 6, true, true, 'VT Specialty', NULL, now(), now()),
  ('IN19900072', 'AS Auto Star Aluminium 1L', 'AUTO REFINISH', 'AUTO STAR', 'ALUMINIUM', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN19905272', 'AI Auto Star Bianco 1L', 'AUTO REFINISH', 'AUTO STAR', 'BIANCO', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN19900272', 'AS Auto Star Black 1L', 'AUTO REFINISH', 'AUTO STAR', 'BLACK', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN19910072', 'AS Auto Star Clear 1L', 'AUTO REFINISH', 'AUTO STAR', 'CLEAR', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN19903772', 'AS Auto Star Crystal White 1LT', 'AUTO REFINISH', 'AUTO STAR', 'CRYSTAL WHITE', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN19900772', 'AS Auto Star Dawn Glow 1LT', 'AUTO REFINISH', 'AUTO STAR', 'DAWN GLOW', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN19909472', 'AS Auto Star Dost Cream 1 L', 'AUTO REFINISH', 'AUTO STAR', 'DOST CREAM', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN19908772', 'AS Auto Star Dost Light Blue 1 L', 'AUTO REFINISH', 'AUTO STAR', 'DOST LIGHT BLUE', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN19901772', 'AS Auto Star Golden Brown 1LT', 'AUTO REFINISH', 'AUTO STAR', 'GOLDEN BROWN', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN19922072', 'AS Auto Star Golden Yellow Var 1L', 'AUTO REFINISH', 'AUTO STAR', 'GOLDEN YELLOW VAR', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN19908072', 'AS Auto Star John Deer Green 1 L', 'AUTO REFINISH', 'AUTO STAR', 'JOHN DEER GREEN', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN19907272', 'AI Auto Star Mahindra Grey 1L', 'AUTO REFINISH', 'AUTO STAR', 'MAHINDRA GREY', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN19927372', 'AS Auto Star Mahindra Red 1L', 'AUTO REFINISH', 'AUTO STAR', 'MAHINDRA RED', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN19906472', 'AS Auto Star Massey Red 1L', 'AUTO REFINISH', 'AUTO STAR', 'MASSEY RED', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN19908672', 'AI Auto Star Maximo Diamond White 1L', 'AUTO REFINISH', 'AUTO STAR', 'MAXIMO DIAMOND WHITE', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN19904372', 'AS Auto Star Milky White 1L', 'AUTO REFINISH', 'AUTO STAR', 'MILKY WHITE', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN19908472', 'AS Auto Star New Superior White 1L', 'AUTO REFINISH', 'AUTO STAR', 'NEW SUPERIOR WHITE', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN19900472', 'AS Auto Star Oxford Blue 1L', 'AUTO REFINISH', 'AUTO STAR', 'OXFORD BLUE', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN19902172', 'AS Auto Star Racing Blue 1L', 'AUTO REFINISH', 'AUTO STAR', 'RACING BLUE', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN19906872', 'AS Auto Star Silver Grey 1L', 'AUTO REFINISH', 'AUTO STAR', 'SILVER GREY', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN19901172', 'AS Auto Star Super  White 1LT', 'AUTO REFINISH', 'AUTO STAR', 'SUPER WHITE', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN19902972', 'AS Auto Star Superior White 1L', 'AUTO REFINISH', 'AUTO STAR', 'SUPERIOR WHITE', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN19903472', 'AS Auto Star Tata Blue 1L', 'AUTO REFINISH', 'AUTO STAR', 'TATA BLUE', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN19923472', 'AS Auto Star Tata Cream 1L', 'AUTO REFINISH', 'AUTO STAR', 'TATA CREAM', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN19900172', 'AS Auto Star White 1L', 'AUTO REFINISH', 'AUTO STAR', 'WHITE', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN19900281', 'AS Auto Star Black 20L', 'AUTO REFINISH', 'AUTO STAR', 'BLACK', '20', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN19900271', 'AS Auto Star Black 4L', 'AUTO REFINISH', 'AUTO STAR', 'BLACK', '4', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN19903771', 'AS Auto Star Crystal White 4L', 'AUTO REFINISH', 'AUTO STAR', 'CRYSTAL WHITE', '4', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN19929171', 'AS Auto Star Phiroza Blue 4L', 'AUTO REFINISH', 'AUTO STAR', 'PHIROZA BLUE', '4', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN19922771', 'AS Auto Star SJ Red 3002 4L', 'AUTO REFINISH', 'AUTO STAR', 'SJ RED 3002', '4', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN19900171', 'AI Auto Star White 4L', 'AUTO REFINISH', 'AUTO STAR', 'WHITE', '4', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN11029063', 'AS Auto Star White Base 400ML', 'AUTO REFINISH', 'AUTO STAR', '90 BASE', '400', 'ML', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN11025563', 'AS Auto Star Metallic Base 400ML', 'AUTO REFINISH', 'AUTO STAR', 'METALLIC BASE', '400', 'ML', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN11029263', 'AS Auto Star Neutral Base 400ML', 'AUTO REFINISH', 'AUTO STAR', 'NEUTRAL BASE', '400', 'ML', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN19900073', 'AS Auto Star Aluminium 500ML', 'AUTO REFINISH', 'AUTO STAR', 'ALUMINIUM', '500', 'ML', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN19900273', 'AS Auto Star Black 500ML', 'AUTO REFINISH', 'AUTO STAR', 'BLACK', '500', 'ML', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN11027672', 'Synthetic High Yellow  Tinter', 'AUTO REFINISH', 'AUTOCOLOR', 'SYNTHETIC HIGH YELLOW TINTER', '', NULL, NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN11007072', 'DQ DSA CL TPA Adjustor Clear 1LT', 'AUTO REFINISH', 'AUTOCOLOR', 'DSA CL TPA ADJUSTOR CLEAR', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN12901972', 'AI Autocolor PS Grey 1L', 'AUTO REFINISH', 'AUTOCOLOR', 'PS GREY', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN12902772', 'AI Autocolor PS Grey 1L', 'AUTO REFINISH', 'AUTOCOLOR', 'PS GREY', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN12902272', 'AI Autocolor PS White 1LT', 'AUTO REFINISH', 'AUTOCOLOR', 'PS WHITE', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN11025872', 'Special Fine Aluminium 1L', 'AUTO REFINISH', 'AUTOCOLOR', 'SPECIAL FINE ALUMINIUM', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN11028272', 'Synth HS G White Tinter 1L', 'AUTO REFINISH', 'AUTOCOLOR', 'SYNTH HS G WHITE TINTER', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN12902971', 'AI Autocolor PS White 4L', 'AUTO REFINISH', 'AUTOCOLOR', 'PS WHITE', '4', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN11006663', 'AI DSA Blending Clear 400ML', 'AUTO REFINISH', 'AUTOCOLOR', 'DSA BLENDING CLEAR', '400', 'ML', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN60003472', 'AI CREST GEN PURPOSE PU THIN 1L', 'AUTO REFINISH', 'CREST PU', 'CREST GEN PURPOSE PU THIN', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN15103272', 'CQ Crest PU Matt White - Combi 1L', 'AUTO REFINISH', 'CREST PU', 'CREST PU MATT WHITE - COMBI', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN51100271', 'AI CQ CREST PU MATT CLEAR 4L', 'AUTO REFINISH', 'CREST PU', 'CQ CREST PU MATT CLEAR', '4', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN11006872', 'DO Duco Reg Adjustor Clear 1L', 'AUTO REFINISH', 'DUCO', 'ADJUSTOR CLEAR', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN32000372', 'DO Auto Paints Oil Primer 1LT', 'AUTO REFINISH', 'DUCO', 'AUTO PAINTS OIL PRIMER', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN11000272', 'DO Duco Reg Black HS 1L', 'AUTO REFINISH', 'DUCO', 'BLACK HS', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN03045672', 'D0 Duco Golden Yellow 1LT', 'AUTO REFINISH', 'DUCO', 'GOLDEN YELLOW', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN11001372', 'DO Duco Reg Green HS 1L', 'AUTO REFINISH', 'DUCO', 'GREEN HS', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN03012272', 'DO Duco Jet Black 1LT', 'AUTO REFINISH', 'DUCO', 'JET BLACK', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN03012472', 'DO Duco Matt Black 1LT', 'AUTO REFINISH', 'DUCO', 'MATT BLACK', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN03652572', 'D0 Duco Reg Milky White 1L', 'AUTO REFINISH', 'DUCO', 'MILKY WHITE', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN03043872', 'DO Duco P.O. Red 1LT', 'AUTO REFINISH', 'DUCO', 'P.O. RED', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN11004972', 'DO Duco Reg Pink 1L', 'AUTO REFINISH', 'DUCO', 'PINK', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN11009672', 'DO Duco Reg Red Oxide Redcd Strngth 1L', 'AUTO REFINISH', 'DUCO', 'RED OXIDE REDCD STRNGTH', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN11005172', 'DO Duco Reg Strong Yellow 1L', 'AUTO REFINISH', 'DUCO', 'STRONG YELLOW', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN11016372', 'DO Duco Reg Sun Yellow HS 1L', 'AUTO REFINISH', 'DUCO', 'SUN YELLOW HS', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN60000672', 'DO Duco Thinner 1L', 'AUTO REFINISH', 'DUCO', 'THINNER', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN11001772', 'DO Duco Reg Violet HS 1L', 'AUTO REFINISH', 'DUCO', 'VIOLET HS', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN01032872', 'AD Duco Water White Clear 1L', 'AUTO REFINISH', 'DUCO', 'WATER WHITE CLEAR', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN03651072', 'D0 Duco Reg White 1L', 'AUTO REFINISH', 'DUCO', 'WHITE', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN11006379', 'DO DUCO BASE 2.5L', 'AUTO REFINISH', 'DUCO', 'BASE', '2.5', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN60005981', 'DO PU Universal thinner 20L', 'AUTO REFINISH', 'DUCO', 'PU UNIVERSAL THINNER', '20', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN03012271', 'DO Duco Jet Black 4L', 'AUTO REFINISH', 'DUCO', 'JET BLACK', '4', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN01032871', 'AD Duco Water White Clear 4L', 'AUTO REFINISH', 'DUCO', 'WATER WHITE CLEAR', '4', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN03651071', 'DO Duco Reg White 4LT', 'AUTO REFINISH', 'DUCO', 'WHITE', '4', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN11006363', 'DO Duco Base 400ML', 'AUTO REFINISH', 'DUCO', 'BASE', '400', 'ML', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN13900425', 'DO Soft Cut Putty 5KG', 'AUTO REFINISH', 'DUCO', 'SOFT CUT PUTTY', '5', 'KG', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN60000676', 'DO Duco Thinner 5L', 'AUTO REFINISH', 'DUCO', 'THINNER', '5', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('5576460', 'DP DUCO PU CLEAR COMBI 1L', 'AUTO REFINISH', 'DUCO PU', 'PU CLEAR COMBI', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('5571449', 'DP DUCO PU MATT CLEAR COMBI1L', 'AUTO REFINISH', 'DUCO PU', 'PU MATT CLEAR COMBI', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('5571452', 'DP DUCO PU RM WHITE COMBI 1L', 'AUTO REFINISH', 'DUCO PU', 'PU RM WHITE COMBI', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('5571454', 'DP DUCO PU SEALING FILLER COMBI 1L', 'AUTO REFINISH', 'DUCO PU', 'PU SEALING FILLER COMBI', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN11060272', 'VE Vektor Adjuster Clear 1L', 'AUTO REFINISH', 'VEKTOR', 'ADJUSTER CLEAR', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN15300272', 'VE Belco PU Sealing Filler-Combo 1LT', 'AUTO REFINISH', 'VEKTOR', 'BELCO PU SEALING FILLER-COMBO', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN11016572', 'VE VEKTOR PU+ NEW BLACK HS 1L', 'AUTO REFINISH', 'VEKTOR', 'BLACK HS', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN11017172', 'VE VEKTOR PU+ NEW BRIGHT MAROON HS 1L', 'AUTO REFINISH', 'VEKTOR', 'BRIGHT MAROON HS', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN11041872', 'VE VEKTOR PU+ NEW COARSER BRIGHTER 1L', 'AUTO REFINISH', 'VEKTOR', 'COARSER BRIGHTER', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN11060463', 'VE Vektor PU Plus White Base 400ML', 'AUTO REFINISH', 'VEKTOR', '90 BASE', '400', 'ML', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN54650152', 'VE Vektor PU readymix White Base 835ML', 'AUTO REFINISH', 'VEKTOR', '90 BASE', '835', 'ML', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('5379496', 'WAN 2K TC MM 9330 AS 1L', 'AUTO REFINISH', 'WANDA 2K TOPCOAT MM', 'TC MM 9330', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('5379497', 'WAN 2K TC MM 9332 AS 1L', 'AUTO REFINISH', 'WANDA 2K TOPCOAT MM', 'TC MM 9332', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('5379498', 'WAN 2K TC MM 9333 AS 1L', 'AUTO REFINISH', 'WANDA 2K TOPCOAT MM', 'TC MM 9333', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('5379499', 'WAN 2K TC MM 9370 AS 1L', 'AUTO REFINISH', 'WANDA 2K TOPCOAT MM', 'TC MM 9370', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('5379500', 'WAN 2K TC MM 9371 AS 1L', 'AUTO REFINISH', 'WANDA 2K TOPCOAT MM', 'TC MM 9371', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('5379501', 'WAN 2K TC MM 9372 AS 1L', 'AUTO REFINISH', 'WANDA 2K TOPCOAT MM', 'TC MM 9372', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('5379502', 'WAN 2K TC MM 9373 AS 1L', 'AUTO REFINISH', 'WANDA 2K TOPCOAT MM', 'TC MM 9373', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('5379503', 'WAN 2K TC MM 9431 AS 1L', 'AUTO REFINISH', 'WANDA 2K TOPCOAT MM', 'TC MM 9431', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('5379505', 'WAN 2K TC MM 9450 AS 1L', 'AUTO REFINISH', 'WANDA 2K TOPCOAT MM', 'TC MM 9450', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('5379506', 'WAN 2K TC MM 9452 AS 1L', 'AUTO REFINISH', 'WANDA 2K TOPCOAT MM', 'TC MM 9452', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('5379507', 'WAN 2K TC MM 9540 AS 1L', 'AUTO REFINISH', 'WANDA 2K TOPCOAT MM', 'TC MM 9540', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('5379508', 'WAN 2K TC MM 9560 AS 1L', 'AUTO REFINISH', 'WANDA 2K TOPCOAT MM', 'TC MM 9560', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('5379510', 'WAN 2K TC MM 9760 AS 1L', 'AUTO REFINISH', 'WANDA 2K TOPCOAT MM', 'TC MM 9760', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('5379493', 'WAN 2K TC MM 9100 AS 3.7L', 'AUTO REFINISH', 'WANDA 2K TOPCOAT MM', 'TC MM 9100', '4', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('5379494', 'WAN 2K TC MM 9240 AS 3.7L', 'AUTO REFINISH', 'WANDA 2K TOPCOAT MM', 'TC MM 9240', '4', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('5379495', 'WAN 2K TC MM 9260 AS 3.7L', 'AUTO REFINISH', 'WANDA 2K TOPCOAT MM', 'TC MM 9260', '4', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('5379504', 'WAN 2K TC MM 9432 AS 3.7L', 'AUTO REFINISH', 'WANDA 2K TOPCOAT MM', 'TC MM 9432', '4', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('5379509', 'WAN 2K TC MM 9650 AS 3.7L', 'AUTO REFINISH', 'WANDA 2K TOPCOAT MM', 'TC MM 9650', '4', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN61110172', 'WN Wanda Basecoat SB 3001 1L', 'AUTO REFINISH', 'WANDA BASECOAT SB', '3001', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN61100572', 'WAN BCOAT SB 3005 AS 1L', 'AUTO REFINISH', 'WANDA BASECOAT SB', '3005', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN61100772', 'WN Wanda Basecoat SB 3007 1L', 'AUTO REFINISH', 'WANDA BASECOAT SB', '3007', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN61101072', 'WN Wanda Basecoat SB 3010 1L', 'AUTO REFINISH', 'WANDA BASECOAT SB', '3010', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN61110672', 'WN Wanda Basecoat SB 3106 1L', 'AUTO REFINISH', 'WANDA BASECOAT SB', '3106', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN61112072', 'WAN BCOAT SB 3120 AS 1L', 'AUTO REFINISH', 'WANDA BASECOAT SB', '3120', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN61119872', 'WAN BCOAT SB 3198 AS 1L', 'AUTO REFINISH', 'WANDA BASECOAT SB', '3198', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN61120372', 'WN Wanda Basecoat SB 3203 1L', 'AUTO REFINISH', 'WANDA BASECOAT SB', '3203', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN61120672', 'WN Wanda Basecoat SB 3206 1L', 'AUTO REFINISH', 'WANDA BASECOAT SB', '3206', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN61123072', 'WN Wanda Basecoat SB 3230 1L', 'AUTO REFINISH', 'WANDA BASECOAT SB', '3230', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN61123272', 'WN Wanda Basecoat SB 3232 1L', 'AUTO REFINISH', 'WANDA BASECOAT SB', '3232', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN61123372', 'WN Wanda Basecoat SB 3233 1L', 'AUTO REFINISH', 'WANDA BASECOAT SB', '3233', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN61123672', 'WN Wanda Basecoat SB 3236 1L', 'AUTO REFINISH', 'WANDA BASECOAT SB', '3236', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN61124372', 'WN Wanda Basecoat SB 3243 1L', 'AUTO REFINISH', 'WANDA BASECOAT SB', '3243', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN61124672', 'WN Wanda Basecoat SB 3246 1L', 'AUTO REFINISH', 'WANDA BASECOAT SB', '3246', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN61124872', 'WN Wanda Basecoat SB 3248 1L', 'AUTO REFINISH', 'WANDA BASECOAT SB', '3248', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN61127672', 'WN Wanda Basecoat SB 3276 1L', 'AUTO REFINISH', 'WANDA BASECOAT SB', '3276', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN61140072', 'WN Wanda Basecoat SB 3400 1L', 'AUTO REFINISH', 'WANDA BASECOAT SB', '3400', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN61143472', 'WN Wanda Basecoat SB 3434 1L', 'AUTO REFINISH', 'WANDA BASECOAT SB', '3434', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN61143572', 'WN Wanda Basecoat SB 3435 1L', 'AUTO REFINISH', 'WANDA BASECOAT SB', '3435', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN61145272', 'WN Wanda Basecoat SB 3452 1L', 'AUTO REFINISH', 'WANDA BASECOAT SB', '3452', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN61145672', 'WN Wanda Basecoat SB 3456 1L', 'AUTO REFINISH', 'WANDA BASECOAT SB', '3456', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN61145772', 'WN Wanda Basecoat SB 3457 1L', 'AUTO REFINISH', 'WANDA BASECOAT SB', '3457', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN61154572', 'WN Wanda Basecoat SB 3545 1L', 'AUTO REFINISH', 'WANDA BASECOAT SB', '3545', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN61156572', 'WN Wanda Basecoat SB 3565 1L', 'AUTO REFINISH', 'WANDA BASECOAT SB', '3565', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN61162472', 'WN Wanda Basecoat SB 3624 1L', 'AUTO REFINISH', 'WANDA BASECOAT SB', '3624', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('5801998', 'WAN BCOAT SB 3655 AS 1L', 'AUTO REFINISH', 'WANDA BASECOAT SB', '3655', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN61165672', 'WN Wanda Basecoat SB 3656 1L', 'AUTO REFINISH', 'WANDA BASECOAT SB', '3656', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('5575543', 'WAN BCOAT SB 3681 AS 1L', 'AUTO REFINISH', 'WANDA BASECOAT SB', '3681', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN61170072', 'WN Wanda Basecoat SB 3700 1L', 'AUTO REFINISH', 'WANDA BASECOAT SB', '3700', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN61172372', 'WN Wanda Basecoat SB 3723 1L', 'AUTO REFINISH', 'WANDA BASECOAT SB', '3723', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN61190372', 'WN Wanda Basecoat SB 3903 1L', 'AUTO REFINISH', 'WANDA BASECOAT SB', '3903', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN61191072', 'WN Wanda Basecoat SB 3910 1L', 'AUTO REFINISH', 'WANDA BASECOAT SB', '3910', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN61191172', 'WN Wanda Basecoat SB 3911 1L', 'AUTO REFINISH', 'WANDA BASECOAT SB', '3911', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN61191272', 'WN Wanda Basecoat SB 3912 1L', 'AUTO REFINISH', 'WANDA BASECOAT SB', '3912', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN61192072', 'WN Wanda Basecoat SB 3920 1L', 'AUTO REFINISH', 'WANDA BASECOAT SB', '3920', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN61192372', 'WN Wanda Basecoat SB 3923 1L', 'AUTO REFINISH', 'WANDA BASECOAT SB', '3923', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN61192472', 'WN Wanda Basecoat SB 3924 1L', 'AUTO REFINISH', 'WANDA BASECOAT SB', '3924', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN61192572', 'WN Wanda Basecoat SB 3925 1L', 'AUTO REFINISH', 'WANDA BASECOAT SB', '3925', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN61192672', 'WN Wanda Basecoat SB 3926 1L', 'AUTO REFINISH', 'WANDA BASECOAT SB', '3926', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN61193072', 'WN Wanda Basecoat SB 3930 1L', 'AUTO REFINISH', 'WANDA BASECOAT SB', '3930', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN61194272', 'WN Wanda Basecoat SB 3942 1L', 'AUTO REFINISH', 'WANDA BASECOAT SB', '3942', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN61195072', 'WN Wanda Basecoat SB 3950 1L', 'AUTO REFINISH', 'WANDA BASECOAT SB', '3950', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN61195272', 'WN Wanda Basecoat SB 3952 1L', 'AUTO REFINISH', 'WANDA BASECOAT SB', '3952', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN61195372', 'WN Wanda Basecoat SB 3953 1L', 'AUTO REFINISH', 'WANDA BASECOAT SB', '3953', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN61195472', 'WN Wanda Basecoat SB 3954 1L', 'AUTO REFINISH', 'WANDA BASECOAT SB', '3954', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN61195672', 'WN Wanda Basecoat SB 3956 1L', 'AUTO REFINISH', 'WANDA BASECOAT SB', '3956', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN61195772', 'WN Wanda Basecoat SB 3957 1L', 'AUTO REFINISH', 'WANDA BASECOAT SB', '3957', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN61195872', 'WN Wanda Basecoat SB 3958 1L', 'AUTO REFINISH', 'WANDA BASECOAT SB', '3958', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN61196172', 'WN Wanda Basecoat SB 3961 1L', 'AUTO REFINISH', 'WANDA BASECOAT SB', '3961', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN61196272', 'WN Wanda Basecoat SB 3962 1L', 'AUTO REFINISH', 'WANDA BASECOAT SB', '3962', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN61196472', 'WN Wanda Basecoat SB 3964 1L', 'AUTO REFINISH', 'WANDA BASECOAT SB', '3964', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN61196672', 'WN Wanda Basecoat SB 3966 1L', 'AUTO REFINISH', 'WANDA BASECOAT SB', '3966', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN61196872', 'WN Wanda Basecoat SB 3968 1L', 'AUTO REFINISH', 'WANDA BASECOAT SB', '3968', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN61197072', 'WN Wanda Basecoat SB 3970 1L', 'AUTO REFINISH', 'WANDA BASECOAT SB', '3970', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN61100271', 'WAN BCOAT SB 3002 AS 3.7L', 'AUTO REFINISH', 'WANDA BASECOAT SB', '3002', '4', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN61100371', 'WAN BCOAT SB 3003 AS 3.7L', 'AUTO REFINISH', 'WANDA BASECOAT SB', '3003', '4', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN61100471', 'WAN BCOAT SB 3004 AS 3.7L', 'AUTO REFINISH', 'WANDA BASECOAT SB', '3004', '4', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN61100671', 'WN Wanda Basecoat SB 3006 3.7L', 'AUTO REFINISH', 'WANDA BASECOAT SB', '3006', '4', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN61110071', 'WN Wanda Basecoat SB 3100 3.7L', 'AUTO REFINISH', 'WANDA BASECOAT SB', '3100', '4', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN61111071', 'WN Wanda Basecoat SB 3110 3.7L', 'AUTO REFINISH', 'WANDA BASECOAT SB', '3110', '4', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN61120071', 'WN Wanda Basecoat SB 3200 3.7L', 'AUTO REFINISH', 'WANDA BASECOAT SB', '3200', '4', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN61180071', 'WN Wanda Basecoat SB 3800 3.7L', 'AUTO REFINISH', 'WANDA BASECOAT SB', '3800', '4', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN61184071', 'WN Wanda Basecoat SB 3840 3.7L', 'AUTO REFINISH', 'WANDA BASECOAT SB', '3840', '4', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('5751240', 'WAN 2:1 SMART HV CLEAR AS 1L', 'AUTO REFINISH', 'WANDA CLEAR', '2:1 SMART HV CLEAR', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN51100672', 'WAN CLEAR 2:1 IN 1L', 'AUTO REFINISH', 'WANDA CLEAR', 'CLEAR 2:1', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN15100472', 'WAN ECONOM CLEAR 4:1 SET IN 1L', 'AUTO REFINISH', 'WANDA CLEAR', 'ECONOM CLEAR 4:1 SET', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN51100671', 'WAN CLEAR 2:1 IN  4L', 'AUTO REFINISH', 'WANDA CLEAR', 'CLEAR 2:1', '4', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('5751241', 'WAN 2:1 SMART HV CLEAR AS 5L', 'AUTO REFINISH', 'WANDA CLEAR', '2:1 SMART HV CLEAR', '5', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('5679096', 'WAN EASY CLEAR 4:1 IN 5L', 'AUTO REFINISH', 'WANDA CLEAR', 'EASY CLEAR 4:1', '5', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN51100451', 'WN Wanda Economy clear 800ML', 'AUTO REFINISH', 'WANDA CLEAR', 'WANDA ECONOMY CLEAR', '800', 'ML', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN51000272', 'WAN EASY BC MM 510002 IN 1L', 'AUTO REFINISH', 'WANDA EASY BASECOAT MM', '510002', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN51000472', 'WAN EASY BC MM 510004 IN 1L', 'AUTO REFINISH', 'WANDA EASY BASECOAT MM', '510004', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN51000872', 'WAN EASY BC MM 510008 IN 1L', 'AUTO REFINISH', 'WANDA EASY BASECOAT MM', '510008', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN51000972', 'WAN EASY BC MM 510009 IN 1L', 'AUTO REFINISH', 'WANDA EASY BASECOAT MM', '510009', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN51007772', 'WAN EASY BC MM 510077 IN 1L', 'AUTO REFINISH', 'WANDA EASY BASECOAT MM', '510077', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN51008872', 'WAN EASY BC MM 510088 IN 1L', 'AUTO REFINISH', 'WANDA EASY BASECOAT MM', '510088', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN51011172', 'WAN EASY BC MM 510111 IN 1L', 'AUTO REFINISH', 'WANDA EASY BASECOAT MM', '510111', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN51011272', 'WAN EASY BC MM 510112 IN 1L', 'AUTO REFINISH', 'WANDA EASY BASECOAT MM', '510112', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN51012172', 'WAN EASY BC MM 510121 IN 1L', 'AUTO REFINISH', 'WANDA EASY BASECOAT MM', '510121', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN51012272', 'WAN EASY BC MM 510122 IN 1L', 'AUTO REFINISH', 'WANDA EASY BASECOAT MM', '510122', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN51021172', 'WAN EASY BC MM 510211 IN 1L', 'AUTO REFINISH', 'WANDA EASY BASECOAT MM', '510211', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN51021372', 'WAN EASY BC MM 510213 IN 1L', 'AUTO REFINISH', 'WANDA EASY BASECOAT MM', '510213', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN51032472', 'WAN EASY BC MM 510324 IN 1L', 'AUTO REFINISH', 'WANDA EASY BASECOAT MM', '510324', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN51032672', 'WAN EASY BC MM 510326 IN 1L', 'AUTO REFINISH', 'WANDA EASY BASECOAT MM', '510326', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN51033172', 'WAN EASY BC MM 510331 IN 1L', 'AUTO REFINISH', 'WANDA EASY BASECOAT MM', '510331', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN51033872', 'WAN EASY BC MM 510338 IN 1L', 'AUTO REFINISH', 'WANDA EASY BASECOAT MM', '510338', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN51041372', 'WAN EASY BC MM 510413 IN 1L', 'AUTO REFINISH', 'WANDA EASY BASECOAT MM', '510413', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN51041572', 'WAN EASY BC MM 510415 IN 1L', 'AUTO REFINISH', 'WANDA EASY BASECOAT MM', '510415', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN51041672', 'WAN EASY BC MM 510416 IN 1L', 'AUTO REFINISH', 'WANDA EASY BASECOAT MM', '510416', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN51041772', 'WAN EASY BC MM 510417 IN 1L', 'AUTO REFINISH', 'WANDA EASY BASECOAT MM', '510417', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN51051172', 'WAN EASY BC MM 510511 IN 1L', 'AUTO REFINISH', 'WANDA EASY BASECOAT MM', '510511', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN51051272', 'WAN EASY BC MM 510512 IN 1L', 'AUTO REFINISH', 'WANDA EASY BASECOAT MM', '510512', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN51051372', 'WAN EASY BC MM 510513 IN 1L', 'AUTO REFINISH', 'WANDA EASY BASECOAT MM', '510513', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN51061672', 'WAN EASY BC MM 510616 IN 1L', 'AUTO REFINISH', 'WANDA EASY BASECOAT MM', '510616', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN51061772', 'WAN EASY BC MM 510617 IN 1L', 'AUTO REFINISH', 'WANDA EASY BASECOAT MM', '510617', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN51071172', 'WAN EASY BC MM 510711 IN 1L', 'AUTO REFINISH', 'WANDA EASY BASECOAT MM', '510711', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN51081172', 'WAN EASY BC MM 510811 IN 1L', 'AUTO REFINISH', 'WANDA EASY BASECOAT MM', '510811', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN51081372', 'WAN EASY BC MM 510813 IN 1L', 'AUTO REFINISH', 'WANDA EASY BASECOAT MM', '510813', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN51081672', 'WAN EASY BC MM 510816 IN 1L', 'AUTO REFINISH', 'WANDA EASY BASECOAT MM', '510816', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN51081872', 'WAN EASY BC MM 510818 IN 1L', 'AUTO REFINISH', 'WANDA EASY BASECOAT MM', '510818', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN51005572', 'WAN EASY BC MM BIND IN 1L', 'AUTO REFINISH', 'WANDA EASY BASECOAT MM', 'BIND', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('5916034', 'WAN EZ BC RM PEARL WHITE BC IN 1L', 'AUTO REFINISH', 'WANDA EASY BASECOAT MM', 'EZ BC RM PEARL WHITE BC', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('5915876', 'WAN EZ BC RM STAR DUST IN 1L', 'AUTO REFINISH', 'WANDA EASY BASECOAT MM', 'EZ BC RM STAR DUST', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN54650572', 'WAN EASY RM BLACK IN 1L', 'AUTO REFINISH', 'WANDA EASY READYMIX', 'BLACK', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN54650472', 'WAN EASY RM WHITE IN 1L', 'AUTO REFINISH', 'WANDA EASY READYMIX', 'WHITE', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN54650571', 'WAN EASY RM BLACK IN 4L', 'AUTO REFINISH', 'WANDA EASY READYMIX', 'BLACK', '4', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN54650471', 'WAN EASY RM WHITE IN 4L', 'AUTO REFINISH', 'WANDA EASY READYMIX', 'WHITE', '4', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN51014072', 'WAN EASY TC 510140 IN 1L', 'AUTO REFINISH', 'WANDA EASY TOPCOAT', '510140', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN51016072', 'WAN EASY TC 510160 IN 1L', 'AUTO REFINISH', 'WANDA EASY TOPCOAT', '510160', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN51023772', 'WAN EASY TC 510237 IN 1L', 'AUTO REFINISH', 'WANDA EASY TOPCOAT', '510237', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN51043872', 'WAN EASY TC 510438 IN 1L', 'AUTO REFINISH', 'WANDA EASY TOPCOAT', '510438', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN51045472', 'WAN EASY TC 510454 IN 1L', 'AUTO REFINISH', 'WANDA EASY TOPCOAT', '510454', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN51056572', 'WAN EASY TC 510565 IN 1L', 'AUTO REFINISH', 'WANDA EASY TOPCOAT', '510565', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN51065372', 'WAN EASY TC 510653 IN 1L', 'AUTO REFINISH', 'WANDA EASY TOPCOAT', '510653', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN51076772', 'WAN EASY TC 510767 IN 1L', 'AUTO REFINISH', 'WANDA EASY TOPCOAT', '510767', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('5553507', 'WAN HARD STD AS 1L', 'AUTO REFINISH', 'WANDA HARDENER', 'HARD STD', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('5758555', 'WAN UNIV HARD AS 1L', 'AUTO REFINISH', 'WANDA HARDENER', 'UNIV HARD', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN64076473', 'WAN CLEAR 2:1 HARD IN 0.5L', 'AUTO REFINISH', 'WANDA HARDENER', 'CLEAR 2:1 HARD', '500', 'ML', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN64076173', 'WAN EASY 4:1 HARD IN 0.5L', 'AUTO REFINISH', 'WANDA HARDENER', 'EASY 4:1 HARD', '500', 'ML', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('5553506', 'WAN HARD STD AS 0.5L', 'AUTO REFINISH', 'WANDA HARDENER', 'HARD STD', '500', 'ML', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('5487906', 'WAN EASY PU PS GREY SET IN 1L', 'AUTO REFINISH', 'WANDA PRIMER & FILLER', 'EASY PU PS GREY SET', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN32301172', 'WAN 1K MULTI PLAST PRIM AS 1L', 'AUTO REFINISH', 'WANDA PRIMER & FILLER', 'MULTI PLAST PRIM', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN13300203', 'WAN PE PUT IN 1KG', 'AUTO REFINISH', 'WANDA PRIMER & FILLER', 'PE PUT', '1', 'KG', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN51001472', 'WAN 1K PRIM GREY IN 1L', 'AUTO REFINISH', 'WANDA PRIMER & FILLER', 'PRIM GREY', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN51001272', 'WAN 1K PRIM WHITE IN 1L', 'AUTO REFINISH', 'WANDA PRIMER & FILLER', 'PRIM WHITE', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN32304372', 'WAN PU PS GREY IN 1L', 'AUTO REFINISH', 'WANDA PRIMER & FILLER', 'PU PS GREY', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN32304271', 'WN Wanda PU PS white 4L', 'AUTO REFINISH', 'WANDA PRIMER & FILLER', 'WANDA PU PS WHITE', '4', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN60006472', 'WAN EASY PU THIN IN 1L', 'AUTO REFINISH', 'WANDA THINNER', 'EASY PU THIN', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN60006172', 'WAN SLOW THIN IN 1L', 'AUTO REFINISH', 'WANDA THINNER', 'SLOW THIN', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN60006481', 'WAN EASY PU THIN IN 20L', 'AUTO REFINISH', 'WANDA THINNER', 'EASY PU THIN', '20', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN60006476', 'WAN EASY PU THIN IN 5L', 'AUTO REFINISH', 'WANDA THINNER', 'EASY PU THIN', '5', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN51000672', 'WN WE Toner med bright aluminium 1L', 'AUTO REFINISH', 'WANDA TONER', 'WE TONER MED BRIGHT ALUMINIUM', '1', 'L', NULL, NULL, 'solvent', 'other', NULL, true, true, 'Auto Refinish', NULL, now(), now()),
  ('IN84409081', 'PS Exterior E700 White Base 20L', 'PROJECT', 'EXTERIOR E700', '90 BASE', '20', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Project', NULL, now(), now()),
  ('9071758', 'PS Exterior E700 Accent 93 Base 20L', 'PROJECT', 'EXTERIOR E700', '93 BASE', '20', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Project', NULL, now(), now()),
  ('IN84409481', 'PS Exterior E700 Accent Base 18L', 'PROJECT', 'EXTERIOR E700', '94 BASE', '20', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Project', NULL, now(), now()),
  ('IN84409581', 'PS Exterior E700 Deep Base 18L', 'PROJECT', 'EXTERIOR E700', '95 BASE', '20', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Project', NULL, now(), now()),
  ('IN84400081', 'PS Exterior E700 Brilliant White 20L', 'PROJECT', 'EXTERIOR E700', 'BRILLIANT WHITE', '20', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Project', NULL, now(), now()),
  ('5749938', 'DULUX PS Exterior Hi Build Base Coat', 'PROJECT', 'EXTERIOR HI BUILD BASE COAT', '', '', NULL, NULL, NULL, 'water', 'primer', NULL, true, true, 'Project', NULL, now(), now()),
  ('IN23600081', 'DN IAE PROJ WHITE 20L', 'PROJECT', 'IAE PROJECT', '', '20', 'L', NULL, NULL, 'water', 'interior', NULL, true, true, 'Project', NULL, now(), now()),
  ('IN23609081', 'DN IAE PROJ WHITE BASE 20L', 'PROJECT', 'IAE PROJECT', '90 BASE', '20', 'L', NULL, NULL, 'water', 'interior', NULL, true, true, 'Project', NULL, now(), now()),
  ('5862521', 'Interior A100 Acry Distemper', 'PROJECT', 'INTERIOR A100 DISTEMPER', '', '', NULL, NULL, NULL, 'water', 'emulsion', NULL, true, true, 'Project', NULL, now(), now()),
  ('IN86409081', 'PS Interior A700 White Base 20L', 'PROJECT', 'INTERIOR A700', '90 BASE', '20', 'L', NULL, NULL, 'water', 'interior', NULL, true, true, 'Project', NULL, now(), now()),
  ('IN86409281', 'PS Interior A700 Intermediate Base 20L', 'PROJECT', 'INTERIOR A700', '92 BASE', '20', 'L', NULL, NULL, 'water', 'interior', NULL, true, true, 'Project', NULL, now(), now()),
  ('IN86400081', 'PS Interior A700 Brilliant White 20L', 'PROJECT', 'INTERIOR A700', 'BRILLIANT WHITE', '20', 'L', NULL, NULL, 'water', 'interior', NULL, true, true, 'Project', NULL, now(), now()),
  ('IN23359081', 'PS INTERIOR A900 WHITE BASE 20L', 'PROJECT', 'INTERIOR A900', '90 BASE', '20', 'L', NULL, NULL, 'water', 'interior', NULL, true, true, 'Project', NULL, now(), now()),
  ('IN23350081', 'PS INTERIOR A900 BRILLIANT WHITE 20L', 'PROJECT', 'INTERIOR A900', 'BRILLIANT WHITE', '20', 'L', NULL, NULL, 'water', 'interior', NULL, true, true, 'Project', NULL, now(), now()),
  ('9061393', 'PS Sealer 800 20L', 'PROJECT', 'PROJECT SEALER', '', '20', 'L', NULL, NULL, 'water', 'primer', NULL, true, true, 'Project', NULL, now(), now()),
  ('IN32256881', 'PS Interior Sealer A500 20L', 'PROJECT', 'PROJECT SEALER', '', '20', 'L', NULL, NULL, 'water', 'primer', NULL, true, true, 'Project', NULL, now(), now()),
  ('5573771', 'PS WS Anti Carbonation White 20L', 'PROJECT', 'WS ANTI CARBONATION', '', '20', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Project', NULL, now(), now()),
  ('IN36819023', 'PS WS E1000 White Base 1L', 'PROJECT', 'WS E1000', '90 BASE', '1', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Project', NULL, now(), now()),
  ('IN36819223', 'PS WS E1000 Intermediate Base 0.9L', 'PROJECT', 'WS E1000', '92 BASE', '1', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Project', NULL, now(), now()),
  ('5990192', 'PS WS E1000 93 base 0.925L', 'PROJECT', 'WS E1000', '93 BASE', '1', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Project', NULL, now(), now()),
  ('IN36810023', 'PS WS E1000 Brilliant White 1L', 'PROJECT', 'WS E1000', 'BRILLIANT WHITE', '1', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Project', NULL, now(), now()),
  ('IN32650081', 'PS WS Sealer E1000 20L', 'PROJECT', 'WS E1000', '', '20', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Project', NULL, now(), now()),
  ('IN36809081', 'PS WS E1000 White Base 20L', 'PROJECT', 'WS E1000', '90 BASE', '20', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Project', NULL, now(), now()),
  ('IN36819081', 'PS WS E1000 White Base 20L', 'PROJECT', 'WS E1000', '90 BASE', '20', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Project', NULL, now(), now()),
  ('IN36819281', 'PS WS E1000 Intermediate Base 18L', 'PROJECT', 'WS E1000', '92 BASE', '20', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Project', NULL, now(), now()),
  ('9071774', 'PS WS E1000 93 Base 20L', 'PROJECT', 'WS E1000', '93 BASE', '20', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Project', NULL, now(), now()),
  ('IN36819481', 'PS WS E1000 Accent Base 18L', 'PROJECT', 'WS E1000', '94 BASE', '20', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Project', NULL, now(), now()),
  ('IN36819581', 'PS WS E1000 Deep Base 18L', 'PROJECT', 'WS E1000', '95 BASE', '20', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Project', NULL, now(), now()),
  ('IN36819681', 'PS WS E1000 YOX 18L', 'PROJECT', 'WS E1000', '96 BASE', '20', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Project', NULL, now(), now()),
  ('IN36810081', 'PS WS E1000 Brilliant White 20L', 'PROJECT', 'WS E1000', 'BRILLIANT WHITE', '20', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Project', NULL, now(), now()),
  ('IN46259023', 'PS WS Elastomeric White Base 1L', 'PROJECT', 'WS ELASTOMERIC', '90 BASE', '1', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Project', NULL, now(), now()),
  ('IN46259223', 'PS WS Elastomeric Intermediate Base 0.9L', 'PROJECT', 'WS ELASTOMERIC', '92 BASE', '1', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Project', NULL, now(), now()),
  ('5990190', 'PS WS Elastomeric 93 base 0.925L', 'PROJECT', 'WS ELASTOMERIC', '93 BASE', '1', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Project', NULL, now(), now()),
  ('IN46259423', 'PS WS Elastomeric Accent Base 0.9L', 'PROJECT', 'WS ELASTOMERIC', '94 BASE', '1', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Project', NULL, now(), now()),
  ('IN46250023', 'PS WS Elastomeric Brilliant White 1L', 'PROJECT', 'WS ELASTOMERIC', 'BRILLIANT WHITE', '1', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Project', NULL, now(), now()),
  ('9071775', 'PS WS Elastomeric 93 Base 20L', 'PROJECT', 'WS ELASTOMERIC', '93 BASE', '20', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Project', NULL, now(), now()),
  ('IN76519281', 'PS WS Flexx Intermediate Base 20L', 'PROJECT', 'WS FLEXX', '92 BASE', '20', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Project', NULL, now(), now()),
  ('IN83109023', 'WS Prima E900 90 bas 1 Ltr Smplr', 'PROJECT', 'WS PRIMA E900', '90 BASE', '1', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Project', NULL, now(), now()),
  ('IN83109223', 'WS Prima E900 92 bas 1 Ltr Smplr', 'PROJECT', 'WS PRIMA E900', '92 BASE', '1', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Project', NULL, now(), now()),
  ('5990191', 'WS Prima E900 93 base 0.925L', 'PROJECT', 'WS PRIMA E900', '93 BASE', '1', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Project', NULL, now(), now()),
  ('5990193', 'WS Prima E900 94 base 0.9L', 'PROJECT', 'WS PRIMA E900', '94 BASE', '1', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Project', NULL, now(), now()),
  ('IN83100023', 'WS Prima E900 Brl Wht 1 Ltr Smplr', 'PROJECT', 'WS PRIMA E900', 'BRILLIANT WHITE', '1', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Project', NULL, now(), now()),
  ('5879693', 'PS Weathershield Sealer E900 20L', 'PROJECT', 'WS PRIMA E900', '', '20', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Project', NULL, now(), now()),
  ('5844389', 'WS Prima E900 White base(90) 20L', 'PROJECT', 'WS PRIMA E900', '90 BASE', '20', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Project', NULL, now(), now()),
  ('5852571', 'WS Prima E900 Gen tint White base(90)20L', 'PROJECT', 'WS PRIMA E900', '90 BASE', '20', 'L', NULL, NULL, 'water', 'exterior', NULL, false, true, 'Project', NULL, now(), now()),
  ('IN83509081', 'PS Exterior E900 White Base 20L', 'PROJECT', 'WS PRIMA E900', '90 BASE', '20', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Project', NULL, now(), now()),
  ('5844390', 'WS Prima E900 Int.Base(92) 20L', 'PROJECT', 'WS PRIMA E900', '92 BASE', '20', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Project', NULL, now(), now()),
  ('5852572', 'WS Prima E900 Gen tint Int.Base(92) 20L', 'PROJECT', 'WS PRIMA E900', '92 BASE', '20', 'L', NULL, NULL, 'water', 'exterior', NULL, false, true, 'Project', NULL, now(), now()),
  ('9071760', 'WS Prima E900 93 Base 20L', 'PROJECT', 'WS PRIMA E900', '93 BASE', '20', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Project', NULL, now(), now()),
  ('5844391', 'WS Prima E900 Accent Base(94) 20L', 'PROJECT', 'WS PRIMA E900', '94 BASE', '20', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Project', NULL, now(), now()),
  ('5852573', 'WS Prima E900 Gen tint AccentBase(94)20L', 'PROJECT', 'WS PRIMA E900', '94 BASE', '20', 'L', NULL, NULL, 'water', 'exterior', NULL, false, true, 'Project', NULL, now(), now()),
  ('5844392', 'WS Prima E900 ROX(97) 20L', 'PROJECT', 'WS PRIMA E900', '97 BASE', '20', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Project', NULL, now(), now()),
  ('5844388', 'WS Prima E900 Brilliant White 20L', 'PROJECT', 'WS PRIMA E900', 'BRILLIANT WHITE', '20', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Project', NULL, now(), now()),
  ('IN45109081', 'DN WS PROJ WHITE BASE 20LT', 'PROJECT', 'WS PROJECT', '90 BASE', '20', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Project', NULL, now(), now()),
  ('IN45109281', 'DN WS PROJ INTERMEDIATE BASE 18LT', 'PROJECT', 'WS PROJECT', '92 BASE', '20', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Project', NULL, now(), now()),
  ('IN45109481', 'DN WS PROJ ACCENT BASE 18LT', 'PROJECT', 'WS PROJECT', '94 BASE', '20', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Project', NULL, now(), now()),
  ('IN45109781', 'DN WS PROJ RED BASE 18LT', 'PROJECT', 'WS PROJECT', '97 BASE', '20', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Project', NULL, now(), now()),
  ('5818102', 'WS PU Elastomeric Wht base(90) 20Ltr', 'PROJECT', 'WS PU ELASTOMERIC', '90 BASE', '20', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Project', NULL, now(), now()),
  ('5811510', 'PS WS PU ELASTOMERIC INTERMED BAS 20L', 'PROJECT', 'WS PU ELASTOMERIC', '92 BASE', '20', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Project', NULL, now(), now()),
  ('5818104', 'WS PU Elastomeric Int base(92) 20Ltr', 'PROJECT', 'WS PU ELASTOMERIC', '92 BASE', '20', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Project', NULL, now(), now()),
  ('5825225', 'PS WS PU ELASTOMERIC 92 BAS GENERIC 20L', 'PROJECT', 'WS PU ELASTOMERIC', '92 BASE', '20', 'L', NULL, NULL, 'water', 'exterior', NULL, false, true, 'Project', NULL, now(), now()),
  ('5811485', 'WS PU Elastomeric Accent base(94) 20Ltr', 'PROJECT', 'WS PU ELASTOMERIC', '94 BASE', '20', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Project', NULL, now(), now()),
  ('5811515', 'PS WS PU ELASTOMERIC YOX 20L', 'PROJECT', 'WS PU ELASTOMERIC', '96 BASE', '20', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Project', NULL, now(), now()),
  ('5811516', 'PS WS PU ELASTOMERIC ROX 20L', 'PROJECT', 'WS PU ELASTOMERIC', '97 BASE', '20', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Project', NULL, now(), now()),
  ('5818100', 'WS PU Elastomeric Brl White 20Ltr', 'PROJECT', 'WS PU ELASTOMERIC', 'BRILLIANT WHITE', '20', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Project', NULL, now(), now()),
  ('IN74009023', 'PS WS TR E2000 White Base 1L', 'PROJECT', 'WS TR E2000', '90 BASE', '1', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Project', NULL, now(), now()),
  ('IN74009223', 'PS WS TR E2000 Intermediate Base 1L', 'PROJECT', 'WS TR E2000', '92 BASE', '1', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Project', NULL, now(), now()),
  ('5990188', 'PS WS TR E2000 93 base 0.925L', 'PROJECT', 'WS TR E2000', '93 BASE', '1', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Project', NULL, now(), now()),
  ('IN74000023', 'PS WS TR E2000 Br. White 1L', 'PROJECT', 'WS TR E2000', 'BRILLIANT WHITE', '1', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Project', NULL, now(), now()),
  ('5901074', 'WS TR E2000 90 base 20L', 'PROJECT', 'WS TR E2000', '90 BASE', '20', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Project', NULL, now(), now()),
  ('5912040', 'WS PU TR E2000 Gen tint 90 base 20L', 'PROJECT', 'WS TR E2000', '90 BASE', '20', 'L', NULL, NULL, 'water', 'exterior', NULL, false, true, 'Project', NULL, now(), now()),
  ('5901075', 'WS TR E2000 92 Base 20Ltr', 'PROJECT', 'WS TR E2000', '92 BASE', '20', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Project', NULL, now(), now()),
  ('5850762', 'WS TR E2000 93 Base 20L', 'PROJECT', 'WS TR E2000', '93 BASE', '20', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Project', NULL, now(), now()),
  ('5901073', 'WS TR E2000 Brilliant White 20L', 'PROJECT', 'WS TR E2000', 'BRILLIANT WHITE', '20', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Project', NULL, now(), now()),
  ('IN44709023', 'PS WS UltraClean White Base 1L', 'PROJECT', 'WS ULTRACLEAN', '90 BASE', '1', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Project', NULL, now(), now()),
  ('IN44709223', 'PS WS UltraClean Intermediate Base 0.9L', 'PROJECT', 'WS ULTRACLEAN', '92 BASE', '1', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Project', NULL, now(), now()),
  ('5990189', 'PS WS UltraClean 93 base 0.925L', 'PROJECT', 'WS ULTRACLEAN', '93 BASE', '1', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Project', NULL, now(), now()),
  ('IN44709423', 'PS WS UltraClean Accent Base 0.9L', 'PROJECT', 'WS ULTRACLEAN', '94 BASE', '1', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Project', NULL, now(), now()),
  ('IN44700023', 'PS WS UltraClean Brilliant White 1L', 'PROJECT', 'WS ULTRACLEAN', 'BRILLIANT WHITE', '1', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Project', NULL, now(), now()),
  ('IN44709081', 'PS WS UltraClean White Base 20L', 'PROJECT', 'WS ULTRACLEAN', '90 BASE', '20', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Project', NULL, now(), now()),
  ('IN44709281', 'PS WS UltraClean Intermediate Base 20L', 'PROJECT', 'WS ULTRACLEAN', '92 BASE', '20', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Project', NULL, now(), now()),
  ('9071776', 'PS WS UltraClean 93 Base 20L', 'PROJECT', 'WS ULTRACLEAN', '93 BASE', '20', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Project', NULL, now(), now()),
  ('IN44709481', 'PS WS UltraClean Accent Base 18L', 'PROJECT', 'WS ULTRACLEAN', '94 BASE', '20', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Project', NULL, now(), now()),
  ('IN44709781', 'PS WS UltraClean ROX 18L', 'PROJECT', 'WS ULTRACLEAN', '97 BASE', '20', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Project', NULL, now(), now()),
  ('IN44700081', 'PS WS UltraClean Brilliant White 20L', 'PROJECT', 'WS ULTRACLEAN', 'BRILLIANT WHITE', '20', 'L', NULL, NULL, 'water', 'exterior', NULL, true, true, 'Project', NULL, now(), now());


-- ============================================================================
-- 4. The two UPDATEs.
-- ============================================================================

-- 4a. Reactivate 15 TOOLS 645xxxx rows (inactive since the 2026-07-19 build).
UPDATE sku_master_v2
   SET "isActive" = true, "displayCategory" = 'Brush & Roller', "updatedAt" = now()
 WHERE material IN ('6457581', '6457586', '6457576', '6457577', '6457571', '6457574', '6457575', '6457592', '6457599', '6457604', '6457582', '6457597', '6457598', '6457589', '6457601')
   AND "isActive" = false;

-- 4b. Retire the two old Aquatech Damp Protect codes. 5908364 / 5908365 are
--     deliberately NOT here (decision 2).
UPDATE sku_master_v2
   SET "isActive" = false, "updatedAt" = now()
 WHERE material IN ('5908363', '5908366')
   AND "isActive" = true;


-- ============================================================================
-- 5. READ-BACK — READ-ONLY, the last statement (the one the editor shows).
-- Expect:
--   before  total 1743 · active 1718
--   after   total 2102 · active 2090
--   inserted 359, by category: AUTO REFINISH 235 · PROJECT 85 · VELVET TOUCH 16 · WS 7 · AQUATECH 4 · TEXTURE 4 · VT SPECIALTY 4 · GLOSS 1 · PROMISE 1 · PROMISE INTERIOR 1 · SUPERCOVER 1
--   PROJECT rows with displayCategory <> 'Project': 0
--   inserted with packCode '': 3 · with baseColour '': 17 · piecesPerCarton <= 0: 0
--   15 reactivated rows: each "true · Brush & Roller"
--   Aquatech old codes: 5908363 false · 5908364 true · 5908365 true · 5908366 false
--   NO 'MISSING' row.
-- ============================================================================

SELECT * FROM (
  SELECT 1 AS sec, 0 AS ord, 'before'::text AS kind, 'total · active'::text AS name,
         (b.total::text || ' · ' || b.active::text)::text AS detail
    FROM sku_add_before b
  UNION ALL
  SELECT 1, 1, 'after'::text, 'total · active'::text,
         (count(*)::text || ' · ' || (count(*) FILTER (WHERE "isActive"))::text)::text
    FROM sku_master_v2
  UNION ALL
  SELECT 2, 0, 'inserted'::text, 'all'::text, count(*)::text
    FROM sku_master_v2 s JOIN sku_add_codes c ON c.material = s.material
  UNION ALL
  SELECT 2, 1, 'inserted by category'::text, s.category::text, count(*)::text
    FROM sku_master_v2 s JOIN sku_add_codes c ON c.material = s.material
   GROUP BY s.category
  UNION ALL
  SELECT 3, 0, 'check'::text, 'PROJECT rows with displayCategory <> Project (must be 0)'::text, count(*)::text
    FROM sku_master_v2 s JOIN sku_add_codes c ON c.material = s.material
   WHERE s.category = 'PROJECT' AND s."displayCategory" IS DISTINCT FROM 'Project'
  UNION ALL
  SELECT 3, 1, 'check'::text, 'inserted with packCode = '''' (expect 3)'::text, count(*)::text
    FROM sku_master_v2 s JOIN sku_add_codes c ON c.material = s.material
   WHERE s."packCode" = ''
  UNION ALL
  SELECT 3, 2, 'check'::text, 'inserted with baseColour = '''' (expect 17)'::text, count(*)::text
    FROM sku_master_v2 s JOIN sku_add_codes c ON c.material = s.material
   WHERE s."baseColour" = ''
  UNION ALL
  SELECT 3, 3, 'check'::text, 'inserted with piecesPerCarton <= 0 (must be 0)'::text, count(*)::text
    FROM sku_master_v2 s JOIN sku_add_codes c ON c.material = s.material
   WHERE s."piecesPerCarton" <= 0
  UNION ALL
  SELECT 4, 0, 'reactivated'::text, s.material::text,
         (s."isActive"::text || ' · ' || COALESCE(s."displayCategory", '(null)'))::text
    FROM sku_master_v2 s
   WHERE s.material IN ('6457581', '6457586', '6457576', '6457577', '6457571', '6457574', '6457575', '6457592', '6457599', '6457604', '6457582', '6457597', '6457598', '6457589', '6457601')
  UNION ALL
  SELECT 5, 0, 'aquatech old'::text, s.material::text, s."isActive"::text
    FROM sku_master_v2 s
   WHERE s.material IN ('5908363', '5908364', '5908365', '5908366')
  UNION ALL
  SELECT 9, 0, 'MISSING'::text, c.material::text, NULL::text
    FROM sku_add_codes c
   WHERE NOT EXISTS (SELECT 1 FROM sku_master_v2 s WHERE s.material = c.material)
) v
ORDER BY sec, ord, name;


-- ============================================================================
-- 6. ROLLBACK — ⚠ READ BEFORE USING. Fully commented out.
--   Use only if the owner says roll back. First, in the same tab, run section
--   1 and the CREATE TEMP TABLE sku_add_codes + its INSERT from section 2 —
--   NOT the DO guard, which would refuse because the rows now exist.
--   ⚠ Delete only if nothing has been counted against these codes: run the
--   SELECT below first; if it returns ANY row, stop and ask. (stock_audit_lines
--   keeps its own description/pack snapshot, so a delete would not break those
--   lines, but they would then name codes the catalog no longer has.)
--   updatedAt is written back to the values read live on 2026-11-04: the 15
--   TOOLS rows 2026-07-19 12:06:20.778154+00, the Aquatech rows
--   2026-08-10 09:17:06.953861+00. The 15 TOOLS rows had displayCategory NULL.
--   Remove the leading "-- " and run as one paste.
-- ============================================================================

-- SELECT l.material, l."inCatalog", count(*) FROM stock_audit_lines l JOIN sku_add_codes c ON c.material = l.material
--  GROUP BY l.material, l."inCatalog";                                   -- must return NO rows
-- DELETE FROM sku_master_v2 s USING sku_add_codes c WHERE s.material = c.material;   -- 359 rows
-- UPDATE sku_master_v2
--    SET "isActive" = false, "displayCategory" = NULL, "updatedAt" = '2026-07-19 12:06:20.778154+00'
--  WHERE material IN ('6457581', '6457586', '6457576', '6457577', '6457571', '6457574', '6457575', '6457592', '6457599', '6457604', '6457582', '6457597', '6457598', '6457589', '6457601');
-- UPDATE sku_master_v2
--    SET "isActive" = true, "updatedAt" = '2026-08-10 09:17:06.953861+00'
--  WHERE material IN ('5908363', '5908366');
