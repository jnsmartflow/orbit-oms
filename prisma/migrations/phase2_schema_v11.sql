-- ============================================================
-- Orbit OMS — Phase 2 Schema Migration (Schema v11)
-- Strategy: ALTER TABLE ADD COLUMN IF NOT EXISTS only.
--           All 10 tables exist as stubs (id + createdAt).
--           Columns added first, constraints added after.
--
-- Apply via: Supabase SQL Editor → run entire file
-- Safe to re-run: every statement is idempotent
-- ============================================================

BEGIN;

-- ──────────────────────────────────────────────────────────────
-- 1. import_batches
-- ──────────────────────────────────────────────────────────────

ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS "batchRef"     TEXT;
ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS "importedById" INTEGER;
ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS "headerFile"   TEXT;
ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS "lineFile"     TEXT;
ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS "totalObds"    INTEGER     NOT NULL DEFAULT 0;
ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS "skippedObds"  INTEGER     NOT NULL DEFAULT 0;
ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS "failedObds"   INTEGER     NOT NULL DEFAULT 0;
ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS status         TEXT        NOT NULL DEFAULT 'processing';
ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS "updatedAt"    TIMESTAMPTZ NOT NULL DEFAULT now();

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_batches_batchRef_key') THEN
        ALTER TABLE import_batches ADD CONSTRAINT "import_batches_batchRef_key" UNIQUE ("batchRef");
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_batches_importedById_fkey') THEN
        ALTER TABLE import_batches
            ADD CONSTRAINT "import_batches_importedById_fkey"
            FOREIGN KEY ("importedById") REFERENCES users(id);
    END IF;
END $$;

-- ──────────────────────────────────────────────────────────────
-- 2. import_raw_summary
-- ──────────────────────────────────────────────────────────────

ALTER TABLE import_raw_summary ADD COLUMN IF NOT EXISTS "batchId"             INTEGER;
ALTER TABLE import_raw_summary ADD COLUMN IF NOT EXISTS "obdNumber"           TEXT;
ALTER TABLE import_raw_summary ADD COLUMN IF NOT EXISTS "sapStatus"           TEXT;
ALTER TABLE import_raw_summary ADD COLUMN IF NOT EXISTS smu                   TEXT;
ALTER TABLE import_raw_summary ADD COLUMN IF NOT EXISTS "smuCode"             TEXT;
ALTER TABLE import_raw_summary ADD COLUMN IF NOT EXISTS "materialType"        TEXT;
ALTER TABLE import_raw_summary ADD COLUMN IF NOT EXISTS "natureOfTransaction" TEXT;
ALTER TABLE import_raw_summary ADD COLUMN IF NOT EXISTS warehouse             TEXT;
ALTER TABLE import_raw_summary ADD COLUMN IF NOT EXISTS "obdEmailDate"        TIMESTAMPTZ;
ALTER TABLE import_raw_summary ADD COLUMN IF NOT EXISTS "obdEmailTime"        TEXT;
ALTER TABLE import_raw_summary ADD COLUMN IF NOT EXISTS "totalUnitQty"        INTEGER;
ALTER TABLE import_raw_summary ADD COLUMN IF NOT EXISTS "grossWeight"         DOUBLE PRECISION;
ALTER TABLE import_raw_summary ADD COLUMN IF NOT EXISTS volume                DOUBLE PRECISION;
ALTER TABLE import_raw_summary ADD COLUMN IF NOT EXISTS "billToCustomerId"    TEXT;
ALTER TABLE import_raw_summary ADD COLUMN IF NOT EXISTS "billToCustomerName"  TEXT;
ALTER TABLE import_raw_summary ADD COLUMN IF NOT EXISTS "shipToCustomerId"    TEXT;
ALTER TABLE import_raw_summary ADD COLUMN IF NOT EXISTS "shipToCustomerName"  TEXT;
ALTER TABLE import_raw_summary ADD COLUMN IF NOT EXISTS "invoiceNo"           TEXT;
ALTER TABLE import_raw_summary ADD COLUMN IF NOT EXISTS "invoiceDate"         TIMESTAMPTZ;
ALTER TABLE import_raw_summary ADD COLUMN IF NOT EXISTS "rowStatus"           TEXT        NOT NULL DEFAULT 'valid';
ALTER TABLE import_raw_summary ADD COLUMN IF NOT EXISTS "rowError"            TEXT;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_raw_summary_batchId_fkey') THEN
        ALTER TABLE import_raw_summary
            ADD CONSTRAINT "import_raw_summary_batchId_fkey"
            FOREIGN KEY ("batchId") REFERENCES import_batches(id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "import_raw_summary_batchId_idx" ON import_raw_summary ("batchId");

-- ──────────────────────────────────────────────────────────────
-- 3. import_raw_line_items
-- ──────────────────────────────────────────────────────────────

ALTER TABLE import_raw_line_items ADD COLUMN IF NOT EXISTS "rawSummaryId"      INTEGER;
ALTER TABLE import_raw_line_items ADD COLUMN IF NOT EXISTS "obdNumber"         TEXT;
ALTER TABLE import_raw_line_items ADD COLUMN IF NOT EXISTS "lineId"            INTEGER;
ALTER TABLE import_raw_line_items ADD COLUMN IF NOT EXISTS "skuCodeRaw"        TEXT;
ALTER TABLE import_raw_line_items ADD COLUMN IF NOT EXISTS "skuDescriptionRaw" TEXT;
ALTER TABLE import_raw_line_items ADD COLUMN IF NOT EXISTS "batchCode"         TEXT;
ALTER TABLE import_raw_line_items ADD COLUMN IF NOT EXISTS "unitQty"           INTEGER;
ALTER TABLE import_raw_line_items ADD COLUMN IF NOT EXISTS "volumeLine"        DOUBLE PRECISION;
ALTER TABLE import_raw_line_items ADD COLUMN IF NOT EXISTS "isTinting"         BOOLEAN     NOT NULL DEFAULT false;
ALTER TABLE import_raw_line_items ADD COLUMN IF NOT EXISTS "rowStatus"         TEXT        NOT NULL DEFAULT 'valid';
ALTER TABLE import_raw_line_items ADD COLUMN IF NOT EXISTS "rowError"          TEXT;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_raw_line_items_rawSummaryId_fkey') THEN
        ALTER TABLE import_raw_line_items
            ADD CONSTRAINT "import_raw_line_items_rawSummaryId_fkey"
            FOREIGN KEY ("rawSummaryId") REFERENCES import_raw_summary(id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "import_raw_line_items_rawSummaryId_idx" ON import_raw_line_items ("rawSummaryId");

-- ──────────────────────────────────────────────────────────────
-- 4. import_enriched_line_items
-- ──────────────────────────────────────────────────────────────

ALTER TABLE import_enriched_line_items ADD COLUMN IF NOT EXISTS "rawLineItemId" INTEGER;
ALTER TABLE import_enriched_line_items ADD COLUMN IF NOT EXISTS "skuId"         INTEGER;
ALTER TABLE import_enriched_line_items ADD COLUMN IF NOT EXISTS "unitQty"       INTEGER;
ALTER TABLE import_enriched_line_items ADD COLUMN IF NOT EXISTS "volumeLine"    DOUBLE PRECISION;
ALTER TABLE import_enriched_line_items ADD COLUMN IF NOT EXISTS "lineWeight"    DOUBLE PRECISION;
ALTER TABLE import_enriched_line_items ADD COLUMN IF NOT EXISTS "isTinting"     BOOLEAN;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_enriched_line_items_rawLineItemId_key') THEN
        ALTER TABLE import_enriched_line_items
            ADD CONSTRAINT "import_enriched_line_items_rawLineItemId_key" UNIQUE ("rawLineItemId");
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_enriched_line_items_rawLineItemId_fkey') THEN
        ALTER TABLE import_enriched_line_items
            ADD CONSTRAINT "import_enriched_line_items_rawLineItemId_fkey"
            FOREIGN KEY ("rawLineItemId") REFERENCES import_raw_line_items(id);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_enriched_line_items_skuId_fkey') THEN
        ALTER TABLE import_enriched_line_items
            ADD CONSTRAINT "import_enriched_line_items_skuId_fkey"
            FOREIGN KEY ("skuId") REFERENCES sku_master(id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "import_enriched_line_items_rawLineItemId_idx"
    ON import_enriched_line_items ("rawLineItemId");

-- ──────────────────────────────────────────────────────────────
-- 5. orders (stub: id + createdAt)
-- ──────────────────────────────────────────────────────────────

ALTER TABLE orders ADD COLUMN IF NOT EXISTS "obdNumber"            TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS "batchId"              INTEGER;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS "customerId"           INTEGER;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS "shipToCustomerId"     TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS "shipToCustomerName"   TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS "orderType"            TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS "workflowStage"        TEXT        NOT NULL DEFAULT 'order_created';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS "dispatchSlot"         TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS "dispatchSlotDeadline" TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS "priorityLevel"        INTEGER     NOT NULL DEFAULT 3;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS "dispatchStatus"       TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS "invoiceNo"            TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS "invoiceDate"          TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS "obdEmailDate"         TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS "sapStatus"            TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS "materialType"         TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS "natureOfTransaction"  TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS warehouse              TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS "totalUnitQty"         INTEGER;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS "grossWeight"          DOUBLE PRECISION;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS volume                 DOUBLE PRECISION;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS "isActive"             BOOLEAN     NOT NULL DEFAULT true;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS "updatedAt"            TIMESTAMPTZ NOT NULL DEFAULT now();

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_obdNumber_key') THEN
        ALTER TABLE orders ADD CONSTRAINT "orders_obdNumber_key" UNIQUE ("obdNumber");
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_batchId_fkey') THEN
        ALTER TABLE orders
            ADD CONSTRAINT "orders_batchId_fkey"
            FOREIGN KEY ("batchId") REFERENCES import_batches(id);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_customerId_fkey') THEN
        ALTER TABLE orders
            ADD CONSTRAINT "orders_customerId_fkey"
            FOREIGN KEY ("customerId") REFERENCES delivery_point_master(id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "orders_obdNumber_idx"     ON orders ("obdNumber");
CREATE INDEX IF NOT EXISTS "orders_workflowStage_idx" ON orders ("workflowStage");
CREATE INDEX IF NOT EXISTS "orders_orderType_idx"     ON orders ("orderType");

-- ──────────────────────────────────────────────────────────────
-- 6. import_obd_query_summary
--    (references orders.id — must come after orders columns added)
-- ──────────────────────────────────────────────────────────────

ALTER TABLE import_obd_query_summary ADD COLUMN IF NOT EXISTS "obdNumber"    TEXT;
ALTER TABLE import_obd_query_summary ADD COLUMN IF NOT EXISTS "orderId"      INTEGER;
ALTER TABLE import_obd_query_summary ADD COLUMN IF NOT EXISTS "totalLines"   INTEGER;
ALTER TABLE import_obd_query_summary ADD COLUMN IF NOT EXISTS "totalUnitQty" INTEGER;
ALTER TABLE import_obd_query_summary ADD COLUMN IF NOT EXISTS "totalWeight"  DOUBLE PRECISION;
ALTER TABLE import_obd_query_summary ADD COLUMN IF NOT EXISTS "totalVolume"  DOUBLE PRECISION;
ALTER TABLE import_obd_query_summary ADD COLUMN IF NOT EXISTS "hasTinting"   BOOLEAN;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_obd_query_summary_obdNumber_key') THEN
        ALTER TABLE import_obd_query_summary
            ADD CONSTRAINT "import_obd_query_summary_obdNumber_key" UNIQUE ("obdNumber");
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_obd_query_summary_orderId_key') THEN
        ALTER TABLE import_obd_query_summary
            ADD CONSTRAINT "import_obd_query_summary_orderId_key" UNIQUE ("orderId");
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_obd_query_summary_orderId_fkey') THEN
        ALTER TABLE import_obd_query_summary
            ADD CONSTRAINT "import_obd_query_summary_orderId_fkey"
            FOREIGN KEY ("orderId") REFERENCES orders(id);
    END IF;
END $$;

-- ──────────────────────────────────────────────────────────────
-- 7. order_splits
-- ──────────────────────────────────────────────────────────────

ALTER TABLE order_splits ADD COLUMN IF NOT EXISTS "orderId" INTEGER;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_splits_orderId_fkey') THEN
        ALTER TABLE order_splits
            ADD CONSTRAINT "order_splits_orderId_fkey"
            FOREIGN KEY ("orderId") REFERENCES orders(id);
    END IF;
END $$;

-- ──────────────────────────────────────────────────────────────
-- 8. tint_assignments
-- ──────────────────────────────────────────────────────────────

ALTER TABLE tint_assignments ADD COLUMN IF NOT EXISTS "orderId"      INTEGER;
ALTER TABLE tint_assignments ADD COLUMN IF NOT EXISTS "assignedToId" INTEGER;
ALTER TABLE tint_assignments ADD COLUMN IF NOT EXISTS "assignedById" INTEGER;
ALTER TABLE tint_assignments ADD COLUMN IF NOT EXISTS status         TEXT        NOT NULL DEFAULT 'assigned';
ALTER TABLE tint_assignments ADD COLUMN IF NOT EXISTS "startedAt"    TIMESTAMPTZ;
ALTER TABLE tint_assignments ADD COLUMN IF NOT EXISTS "completedAt"  TIMESTAMPTZ;
ALTER TABLE tint_assignments ADD COLUMN IF NOT EXISTS "updatedAt"    TIMESTAMPTZ NOT NULL DEFAULT now();

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tint_assignments_orderId_fkey') THEN
        ALTER TABLE tint_assignments
            ADD CONSTRAINT "tint_assignments_orderId_fkey"
            FOREIGN KEY ("orderId") REFERENCES orders(id);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tint_assignments_assignedToId_fkey') THEN
        ALTER TABLE tint_assignments
            ADD CONSTRAINT "tint_assignments_assignedToId_fkey"
            FOREIGN KEY ("assignedToId") REFERENCES users(id);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tint_assignments_assignedById_fkey') THEN
        ALTER TABLE tint_assignments
            ADD CONSTRAINT "tint_assignments_assignedById_fkey"
            FOREIGN KEY ("assignedById") REFERENCES users(id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "tint_assignments_orderId_idx" ON tint_assignments ("orderId");

-- ──────────────────────────────────────────────────────────────
-- 9. tint_logs  (INSERT-ONLY — never UPDATE or DELETE)
-- ──────────────────────────────────────────────────────────────

ALTER TABLE tint_logs ADD COLUMN IF NOT EXISTS "orderId"       INTEGER;
ALTER TABLE tint_logs ADD COLUMN IF NOT EXISTS action          TEXT;
ALTER TABLE tint_logs ADD COLUMN IF NOT EXISTS "performedById" INTEGER;
ALTER TABLE tint_logs ADD COLUMN IF NOT EXISTS note            TEXT;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tint_logs_orderId_fkey') THEN
        ALTER TABLE tint_logs
            ADD CONSTRAINT "tint_logs_orderId_fkey"
            FOREIGN KEY ("orderId") REFERENCES orders(id);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tint_logs_performedById_fkey') THEN
        ALTER TABLE tint_logs
            ADD CONSTRAINT "tint_logs_performedById_fkey"
            FOREIGN KEY ("performedById") REFERENCES users(id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "tint_logs_orderId_idx" ON tint_logs ("orderId");

-- ──────────────────────────────────────────────────────────────
-- 10. order_status_logs  (INSERT-ONLY — never UPDATE or DELETE)
-- ──────────────────────────────────────────────────────────────

ALTER TABLE order_status_logs ADD COLUMN IF NOT EXISTS "orderId"     INTEGER;
ALTER TABLE order_status_logs ADD COLUMN IF NOT EXISTS "fromStage"   TEXT;
ALTER TABLE order_status_logs ADD COLUMN IF NOT EXISTS "toStage"     TEXT;
ALTER TABLE order_status_logs ADD COLUMN IF NOT EXISTS "changedById" INTEGER;
ALTER TABLE order_status_logs ADD COLUMN IF NOT EXISTS note          TEXT;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_status_logs_orderId_fkey') THEN
        ALTER TABLE order_status_logs
            ADD CONSTRAINT "order_status_logs_orderId_fkey"
            FOREIGN KEY ("orderId") REFERENCES orders(id);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_status_logs_changedById_fkey') THEN
        ALTER TABLE order_status_logs
            ADD CONSTRAINT "order_status_logs_changedById_fkey"
            FOREIGN KEY ("changedById") REFERENCES users(id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "order_status_logs_orderId_idx" ON order_status_logs ("orderId");

COMMIT;
