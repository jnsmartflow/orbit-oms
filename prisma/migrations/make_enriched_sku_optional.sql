-- Migration: make_enriched_sku_optional
-- Makes skuId and lineWeight nullable on import_enriched_line_items,
-- and adds a note column for unknown-SKU warnings (best-effort enrichment).

ALTER TABLE "import_enriched_line_items"
  ALTER COLUMN "skuId"      DROP NOT NULL,
  ALTER COLUMN "lineWeight" DROP NOT NULL,
  ADD COLUMN  "note"        TEXT;
