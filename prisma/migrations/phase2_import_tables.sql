-- ============================================================
-- Orbit OMS — Phase 2 Migration
-- Replaces Phase 2 stub tables with full definitions.
-- Paste into Supabase SQL Editor and run in one transaction.
-- ============================================================

BEGIN;

-- ────────────────────────────────────────────────────────────
-- 1. DROP stub tables (Phase 2 + Order group) in reverse-FK order
-- ────────────────────────────────────────────────────────────

DROP TABLE IF EXISTS "order_splits"              CASCADE;
DROP TABLE IF EXISTS "tint_logs"                 CASCADE;
DROP TABLE IF EXISTS "tint_assignments"          CASCADE;
DROP TABLE IF EXISTS "order_status_logs"         CASCADE;
DROP TABLE IF EXISTS "import_obd_query_summary"  CASCADE;
DROP TABLE IF EXISTS "import_enriched_line_items" CASCADE;
DROP TABLE IF EXISTS "orders"                    CASCADE;
DROP TABLE IF EXISTS "import_raw_line_items"     CASCADE;
DROP TABLE IF EXISTS "import_raw_summary"        CASCADE;
DROP TABLE IF EXISTS "import_batches"            CASCADE;

-- ────────────────────────────────────────────────────────────
-- 2. CREATE import_batches
-- ────────────────────────────────────────────────────────────

CREATE TABLE "import_batches" (
    "id"           SERIAL       PRIMARY KEY,
    "batchRef"     TEXT         NOT NULL,
    "importedById" INTEGER      NOT NULL,
    "headerFile"   TEXT         NOT NULL,
    "lineFile"     TEXT         NOT NULL,
    "totalObds"    INTEGER      NOT NULL DEFAULT 0,
    "skippedObds"  INTEGER      NOT NULL DEFAULT 0,
    "failedObds"   INTEGER      NOT NULL DEFAULT 0,
    "status"       TEXT         NOT NULL DEFAULT 'processing',
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_batches_batchRef_key" UNIQUE ("batchRef"),
    CONSTRAINT "import_batches_importedById_fkey"
        FOREIGN KEY ("importedById") REFERENCES "users"("id")
        ON UPDATE CASCADE ON DELETE RESTRICT
);

-- ────────────────────────────────────────────────────────────
-- 3. CREATE import_raw_summary
-- ────────────────────────────────────────────────────────────

CREATE TABLE "import_raw_summary" (
    "id"                  SERIAL       PRIMARY KEY,
    "batchId"             INTEGER      NOT NULL,
    "obdNumber"           TEXT         NOT NULL,
    "sapStatus"           TEXT,
    "smu"                 TEXT,
    "smuCode"             TEXT,
    "materialType"        TEXT,
    "natureOfTransaction" TEXT,
    "warehouse"           TEXT,
    "obdEmailDate"        TIMESTAMP(3),
    "obdEmailTime"        TEXT,
    "totalUnitQty"        INTEGER,
    "grossWeight"         DOUBLE PRECISION,
    "volume"              DOUBLE PRECISION,
    "billToCustomerId"    TEXT,
    "billToCustomerName"  TEXT,
    "shipToCustomerId"    TEXT,
    "shipToCustomerName"  TEXT,
    "invoiceNo"           TEXT,
    "invoiceDate"         TIMESTAMP(3),
    "rowStatus"           TEXT         NOT NULL DEFAULT 'valid',
    "rowError"            TEXT,
    "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_raw_summary_batchId_fkey"
        FOREIGN KEY ("batchId") REFERENCES "import_batches"("id")
        ON UPDATE CASCADE ON DELETE RESTRICT
);

-- ────────────────────────────────────────────────────────────
-- 4. CREATE import_raw_line_items
-- ────────────────────────────────────────────────────────────

CREATE TABLE "import_raw_line_items" (
    "id"               SERIAL       PRIMARY KEY,
    "rawSummaryId"     INTEGER      NOT NULL,
    "obdNumber"        TEXT         NOT NULL,
    "lineId"           INTEGER      NOT NULL,
    "skuCodeRaw"       TEXT         NOT NULL,
    "skuDescriptionRaw" TEXT,
    "batchCode"        TEXT,
    "unitQty"          INTEGER      NOT NULL,
    "volumeLine"       DOUBLE PRECISION,
    "isTinting"        BOOLEAN      NOT NULL DEFAULT FALSE,
    "rowStatus"        TEXT         NOT NULL DEFAULT 'valid',
    "rowError"         TEXT,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_raw_line_items_rawSummaryId_fkey"
        FOREIGN KEY ("rawSummaryId") REFERENCES "import_raw_summary"("id")
        ON UPDATE CASCADE ON DELETE RESTRICT
);

-- ────────────────────────────────────────────────────────────
-- 5. CREATE orders
-- ────────────────────────────────────────────────────────────

CREATE TABLE "orders" (
    "id"                  SERIAL       PRIMARY KEY,
    "obdNumber"           TEXT         NOT NULL,
    "batchId"             INTEGER      NOT NULL,
    "customerId"          INTEGER,
    "shipToCustomerId"    TEXT         NOT NULL,
    "shipToCustomerName"  TEXT,
    "orderType"           TEXT         NOT NULL,
    "workflowStage"       TEXT         NOT NULL DEFAULT 'order_created',
    "dispatchSlot"        TEXT,
    "dispatchSlotDeadline" TIMESTAMP(3),
    "priorityLevel"       INTEGER      NOT NULL DEFAULT 3,
    "dispatchStatus"      TEXT,
    "invoiceNo"           TEXT,
    "invoiceDate"         TIMESTAMP(3),
    "obdEmailDate"        TIMESTAMP(3),
    "sapStatus"           TEXT,
    "materialType"        TEXT,
    "natureOfTransaction" TEXT,
    "warehouse"           TEXT,
    "totalUnitQty"        INTEGER,
    "grossWeight"         DOUBLE PRECISION,
    "volume"              DOUBLE PRECISION,
    "isActive"            BOOLEAN      NOT NULL DEFAULT TRUE,
    "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orders_obdNumber_key" UNIQUE ("obdNumber"),
    CONSTRAINT "orders_batchId_fkey"
        FOREIGN KEY ("batchId") REFERENCES "import_batches"("id")
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT "orders_customerId_fkey"
        FOREIGN KEY ("customerId") REFERENCES "delivery_point_master"("id")
        ON UPDATE CASCADE ON DELETE SET NULL
);

-- ────────────────────────────────────────────────────────────
-- 6. CREATE import_enriched_line_items
-- ────────────────────────────────────────────────────────────

CREATE TABLE "import_enriched_line_items" (
    "id"            SERIAL       PRIMARY KEY,
    "rawLineItemId" INTEGER      NOT NULL,
    "skuId"         INTEGER      NOT NULL,
    "unitQty"       INTEGER      NOT NULL,
    "volumeLine"    DOUBLE PRECISION,
    "lineWeight"    DOUBLE PRECISION NOT NULL,
    "isTinting"     BOOLEAN      NOT NULL,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_enriched_line_items_rawLineItemId_key" UNIQUE ("rawLineItemId"),
    CONSTRAINT "import_enriched_line_items_rawLineItemId_fkey"
        FOREIGN KEY ("rawLineItemId") REFERENCES "import_raw_line_items"("id")
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT "import_enriched_line_items_skuId_fkey"
        FOREIGN KEY ("skuId") REFERENCES "sku_master"("id")
        ON UPDATE CASCADE ON DELETE RESTRICT
);

-- ────────────────────────────────────────────────────────────
-- 7. CREATE import_obd_query_summary
-- ────────────────────────────────────────────────────────────

CREATE TABLE "import_obd_query_summary" (
    "id"           SERIAL       PRIMARY KEY,
    "obdNumber"    TEXT         NOT NULL,
    "orderId"      INTEGER,
    "totalLines"   INTEGER      NOT NULL,
    "totalUnitQty" INTEGER      NOT NULL,
    "totalWeight"  DOUBLE PRECISION NOT NULL,
    "totalVolume"  DOUBLE PRECISION NOT NULL,
    "hasTinting"   BOOLEAN      NOT NULL,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_obd_query_summary_obdNumber_key" UNIQUE ("obdNumber"),
    CONSTRAINT "import_obd_query_summary_orderId_key"   UNIQUE ("orderId"),
    CONSTRAINT "import_obd_query_summary_orderId_fkey"
        FOREIGN KEY ("orderId") REFERENCES "orders"("id")
        ON UPDATE CASCADE ON DELETE SET NULL
);

-- ────────────────────────────────────────────────────────────
-- 8. CREATE order_status_logs  (INSERT-ONLY audit trail)
-- ────────────────────────────────────────────────────────────

CREATE TABLE "order_status_logs" (
    "id"          SERIAL       PRIMARY KEY,
    "orderId"     INTEGER      NOT NULL,
    "fromStage"   TEXT,
    "toStage"     TEXT         NOT NULL,
    "changedById" INTEGER      NOT NULL,
    "note"        TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_status_logs_orderId_fkey"
        FOREIGN KEY ("orderId") REFERENCES "orders"("id")
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT "order_status_logs_changedById_fkey"
        FOREIGN KEY ("changedById") REFERENCES "users"("id")
        ON UPDATE CASCADE ON DELETE RESTRICT
);

-- ────────────────────────────────────────────────────────────
-- 9. CREATE tint_assignments
-- ────────────────────────────────────────────────────────────

CREATE TABLE "tint_assignments" (
    "id"           SERIAL       PRIMARY KEY,
    "orderId"      INTEGER      NOT NULL,
    "assignedToId" INTEGER      NOT NULL,
    "assignedById" INTEGER      NOT NULL,
    "status"       TEXT         NOT NULL DEFAULT 'assigned',
    "startedAt"    TIMESTAMP(3),
    "completedAt"  TIMESTAMP(3),
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tint_assignments_orderId_fkey"
        FOREIGN KEY ("orderId") REFERENCES "orders"("id")
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT "tint_assignments_assignedToId_fkey"
        FOREIGN KEY ("assignedToId") REFERENCES "users"("id")
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT "tint_assignments_assignedById_fkey"
        FOREIGN KEY ("assignedById") REFERENCES "users"("id")
        ON UPDATE CASCADE ON DELETE RESTRICT
);

-- ────────────────────────────────────────────────────────────
-- 10. CREATE tint_logs  (INSERT-ONLY audit trail)
-- ────────────────────────────────────────────────────────────

CREATE TABLE "tint_logs" (
    "id"            SERIAL       PRIMARY KEY,
    "orderId"       INTEGER      NOT NULL,
    "action"        TEXT         NOT NULL,
    "performedById" INTEGER      NOT NULL,
    "note"          TEXT,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tint_logs_orderId_fkey"
        FOREIGN KEY ("orderId") REFERENCES "orders"("id")
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT "tint_logs_performedById_fkey"
        FOREIGN KEY ("performedById") REFERENCES "users"("id")
        ON UPDATE CASCADE ON DELETE RESTRICT
);

-- ────────────────────────────────────────────────────────────
-- 11. CREATE order_splits  (Phase 3 stub with FK)
-- ────────────────────────────────────────────────────────────

CREATE TABLE "order_splits" (
    "id"        SERIAL       PRIMARY KEY,
    "orderId"   INTEGER      NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_splits_orderId_fkey"
        FOREIGN KEY ("orderId") REFERENCES "orders"("id")
        ON UPDATE CASCADE ON DELETE RESTRICT
);

-- ────────────────────────────────────────────────────────────
-- 12. Indexes for common query paths
-- ────────────────────────────────────────────────────────────

CREATE INDEX "import_raw_summary_batchId_idx"          ON "import_raw_summary"("batchId");
CREATE INDEX "import_raw_summary_obdNumber_idx"        ON "import_raw_summary"("obdNumber");
CREATE INDEX "import_raw_line_items_rawSummaryId_idx"  ON "import_raw_line_items"("rawSummaryId");
CREATE INDEX "import_raw_line_items_obdNumber_idx"     ON "import_raw_line_items"("obdNumber");
CREATE INDEX "orders_batchId_idx"                      ON "orders"("batchId");
CREATE INDEX "orders_customerId_idx"                   ON "orders"("customerId");
CREATE INDEX "orders_workflowStage_idx"                ON "orders"("workflowStage");
CREATE INDEX "orders_dispatchStatus_idx"               ON "orders"("dispatchStatus");
CREATE INDEX "order_status_logs_orderId_idx"           ON "order_status_logs"("orderId");
CREATE INDEX "tint_assignments_orderId_idx"            ON "tint_assignments"("orderId");
CREATE INDEX "tint_assignments_assignedToId_idx"       ON "tint_assignments"("assignedToId");
CREATE INDEX "tint_logs_orderId_idx"                   ON "tint_logs"("orderId");

COMMIT;
