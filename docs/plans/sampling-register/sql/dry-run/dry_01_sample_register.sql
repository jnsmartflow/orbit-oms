-- dry_01_sample_register.sql
-- Generated: 2026-05-27
-- Purpose: dry-run import of 10 sample parent rows covering edge cases.
-- Run order: dry_01 → verify → dry_02 → verify → dry_03 → dry_04.
-- ON CONFLICT DO NOTHING — safe to re-run.
--
-- The 10 sample samplingNos (numeric sort) and their categories:
--   7          CLEAN                    shade="30BB 45/015"
--   23         SINGLE_ROW_UNKNOWN       shade="5309"
--   51         SINGLE_ROW_RESOLVED      shade="8432"
--   234        CLEAN_MULTI_ROW          shade="SPL 8473"
--   247        CASE_FIX_SKU             shade="SPL 0T 2731"
--   266        PREFIX_FIX_SKU           shade="00NN 37/000"
--   341        MULTI_SKU_MIXED          shade="OJ32"
--   456        MULTI_SKU_ALL_RESOLVED   shade="SPL LIGHT"
--   132458     TYPO_SHADE               shade="6126"
--   133255     HIGH_DROP_COUNT          shade="SPL 30YY 59/082"

INSERT INTO "sampling_register" ("samplingNo", "shadeName", "tinterType", "siteNameRaw", "dealerName", "notes", "isActive", "needsReview", "createdById", "createdAt", "updatedAt") VALUES
  ('7', '30BB 45/015', 'TINTER'::"TinterType", 'SHAYONA APARMENT', 'SHREENATHJI COLOUR', NULL, TRUE, FALSE, 1, '2025-12-20'::timestamp, '2025-12-20'::timestamp),  -- CLEAN
  ('23', '5309', 'TINTER'::"TinterType", 'SIEMENS LTD', 'MEGH DHANUSH PAINTS', NULL, TRUE, FALSE, 1, '2025-12-23'::timestamp, '2025-12-23'::timestamp),  -- SINGLE_ROW_UNKNOWN
  ('51', '8432', 'TINTER'::"TinterType", 'LAXMI ROW HOUSE', 'AMBIKA PAINTS', NULL, TRUE, FALSE, 1, '2025-12-29'::timestamp, '2025-12-29'::timestamp),  -- SINGLE_ROW_RESOLVED
  ('234', 'SPL 8473', 'TINTER'::"TinterType", 'SAHAJANAD BANGLOW', 'JAINAM PAINTS', NULL, TRUE, FALSE, 1, '2026-02-19'::timestamp, '2026-02-19'::timestamp),  -- CLEAN_MULTI_ROW
  ('247', 'SPL 0T 2731', 'TINTER'::"TinterType", 'PMAY BHESTAN', 'D.H PATEL', NULL, TRUE, FALSE, 1, '2026-01-31'::timestamp, '2026-01-31'::timestamp),  -- CASE_FIX_SKU
  ('266', '00NN 37/000', 'TINTER'::"TinterType", 'SMC INTEK WELL', 'SHREE SANT DEVAM ENTERPRISE', NULL, TRUE, FALSE, 1, '2026-02-04'::timestamp, '2026-02-04'::timestamp),  -- PREFIX_FIX_SKU
  ('341', 'OJ32', 'TINTER'::"TinterType", 'AMOD POLICE STATION', 'BAJRANG STRUCTURES LLP', NULL, TRUE, FALSE, 1, '2026-02-20'::timestamp, '2026-02-20'::timestamp),  -- MULTI_SKU_MIXED
  ('456', 'SPL LIGHT', 'TINTER'::"TinterType", 'SHREE RESIDENCY', 'HARDI ENTERPRISE', NULL, TRUE, FALSE, 1, '2026-03-19'::timestamp, '2026-03-19'::timestamp),  -- MULTI_SKU_ALL_RESOLVED
  ('132458', '6126', 'TINTER'::"TinterType", 'SHIVSHAKTI HW', 'SHIVSHAKTI HW', NULL, TRUE, FALSE, 1, '2022-05-25'::timestamp, '2022-05-25'::timestamp),  -- TYPO_SHADE
  ('133255', 'SPL 30YY 59/082', 'TINTER'::"TinterType", 'SHIVANSH FLORENZA', 'NILKANTH H/W', NULL, TRUE, FALSE, 1, '2025-04-30'::timestamp, '2025-04-30'::timestamp)  -- HIGH_DROP_COUNT
ON CONFLICT ("samplingNo") DO NOTHING;
