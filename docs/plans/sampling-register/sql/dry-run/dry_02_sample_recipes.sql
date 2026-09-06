-- dry_02_sample_recipes.sql
-- Generated: 2026-05-27
-- Purpose: 15 recipe rows for the 10 sample parents.
-- Run after dry_01 succeeds.
-- ON CONFLICT ("samplingNo", "skuCode", "packCode") DO NOTHING.
-- Unique index uses NULLS NOT DISTINCT (Step 3a) — duplicate null-pack rows ARE dedup'd.
-- Schema note: sampling_recipes has no needsReview column — flag omitted.

INSERT INTO "sampling_recipes" ("samplingNo", "skuCode", "productName", "packCode", "tinQty", "YOX", "LFY", "GRN", "TBL", "WHT", "MAG", "FFR", "BLK", "OXR", "HEY", "HER", "COB", "COG", "YE2", "YE1", "XY1", "XR1", "WH1", "RE2", "RE1", "OR1", "NO2", "NO1", "MA1", "GR1", "BU2", "BU1", "isPrimary", "usageCount", "firstUsedAt", "lastUsedAt", "createdAt", "updatedAt") VALUES
  ('7', '5818102', 'WS PU Elastomeric Wht base(90) 20Ltr', '20L'::"PackCode", 1, 0, 0, 175, 210, 0, 0, 0, 0, 370, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, TRUE, 2, '2025-12-20'::timestamp, '2025-12-31'::timestamp, '2025-12-20'::timestamp, '2025-12-20'::timestamp),
  ('23', '5984367', NULL, NULL, 4, 70, 0, 0, 0, 0, 0, 25, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, TRUE, 1, '2025-12-23'::timestamp, '2025-12-23'::timestamp, '2025-12-23'::timestamp, '2025-12-23'::timestamp),
  ('51', 'IN28099281', 'DN SAT FIN INTERMEDIATE BASE 18 LT', '18L'::"PackCode", 1, 385, 0, 0, 0, 0, 0, 0, 1080, 110, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, TRUE, 1, '2025-12-29'::timestamp, '2025-12-29'::timestamp, '2025-12-29'::timestamp, '2025-12-29'::timestamp),
  ('234', 'IN36819281', 'PS WS E1000 Intermediate Base 18L', '18L'::"PackCode", 10, 9.25, 0, 0, 0, 0, 0, 0, 11.45, 3.25, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, TRUE, 7, '2026-02-19'::timestamp, '2026-05-04'::timestamp, '2026-02-19'::timestamp, '2026-02-19'::timestamp),
  ('247', 'IN28209071', 'DN GLOSS WHITE BASE NEW 4L', '4L'::"PackCode", 1, 84.4, 0, 0, 0, 0, 0, 0, 107.4, 35.64, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, FALSE, 1, '2026-01-31'::timestamp, '2026-01-31'::timestamp, '2026-01-31'::timestamp, '2026-01-31'::timestamp),
  ('247', 'IN28209081', 'DN GLOSS WHITE BASE NEW 20L', '20L'::"PackCode", 1, 422, 0, 0, 0, 0, 0, 0, 537, 178.2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, TRUE, 1, '2026-04-15'::timestamp, '2026-04-15'::timestamp, '2026-01-31'::timestamp, '2026-01-31'::timestamp),
  ('266', 'IN45109281', 'DN WS PROJ INTERMEDIATE BASE 18LT', '18L'::"PackCode", 2, 0, 245, 0, 0, 0, 0, 140, 770, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, TRUE, 1, '2026-02-04'::timestamp, '2026-02-04'::timestamp, '2026-02-04'::timestamp, '2026-02-04'::timestamp),
  ('341', 'IN28209081', 'DN GLOSS WHITE BASE NEW 20L', '20L'::"PackCode", 1, 40, 0, 0, 0, 0, 0, 20, 50, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, TRUE, 2, '2026-02-20'::timestamp, '2026-03-10'::timestamp, '2026-02-20'::timestamp, '2026-02-20'::timestamp),
  ('341', 'IN28109071', NULL, NULL, 1, 8, 0, 0, 0, 0, 0, 4, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, FALSE, 1, '2026-03-05'::timestamp, '2026-03-05'::timestamp, '2026-02-20'::timestamp, '2026-02-20'::timestamp),
  ('341', 'IN28209071', 'DN GLOSS WHITE BASE NEW 4L', '4L'::"PackCode", 1, 8, 0, 0, 0, 0, 0, 4, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, FALSE, 1, '2026-03-10'::timestamp, '2026-03-10'::timestamp, '2026-02-20'::timestamp, '2026-02-20'::timestamp),
  ('456', 'IN44709281', 'PS WS UltraClean Intermediate Base 20L', '20L'::"PackCode", 25, 152.5, 0, 0, 0, 0, 0, 10, 395, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, FALSE, 1, '2026-03-19'::timestamp, '2026-03-19'::timestamp, '2026-03-19'::timestamp, '2026-03-19'::timestamp),
  ('456', '5844390', 'WS Prima E900 Int.Base(92) 20L', '20L'::"PackCode", 15, 152.5, 0, 0, 0, 0, 0, 10, 395, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, TRUE, 1, '2026-05-15'::timestamp, '2026-05-15'::timestamp, '2026-03-19'::timestamp, '2026-03-19'::timestamp),
  ('132458', 'IN46359081', NULL, '20L'::"PackCode", 10, 320, 0, 0, 190, 0, 0, 0, 0, 205, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, TRUE, 4, '2022-05-25'::timestamp, '2022-08-30'::timestamp, '2022-05-25'::timestamp, '2022-05-25'::timestamp),
  ('133255', '5811510', 'PS WS PU ELASTOMERIC INTERMED BAS 20L', '20L'::"PackCode", 5, 77.5, 0, 70, 0, 0, 0, 0, 0, 87.5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, FALSE, 8, '2025-04-30'::timestamp, '2025-10-10'::timestamp, '2025-04-30'::timestamp, '2025-04-30'::timestamp),
  ('133255', '5818104', 'WS PU Elastomeric Int base(92) 20Ltr', '20L'::"PackCode", 30, 77.5, 0, 70, 0, 0, 0, 0, 0, 87.5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, TRUE, 11, '2025-10-27'::timestamp, '2026-04-16'::timestamp, '2025-04-30'::timestamp, '2025-04-30'::timestamp)
ON CONFLICT ("samplingNo", "skuCode", "packCode") DO NOTHING;
