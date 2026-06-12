-- 2026-06-12 · Hide feature (OBD visibility)
-- Run in Supabase SQL Editor. NO transaction wrapper (BEGIN/COMMIT fails silently).
-- Plain statements only. camelCase identifiers quoted.

-- Hide rules (Feature A bulk)
CREATE TABLE obd_visibility_rules (
  id                SERIAL PRIMARY KEY,
  "ruleName"        TEXT NOT NULL,
  "conditionType"   TEXT NOT NULL,            -- 'tag' | 'daysOld'
  "conditionTag"    TEXT,                     -- 'HOLD' | 'URGENT' | 'MISSING_CUSTOMER'
  "conditionDaysGt" INTEGER,
  "isActive"        BOOLEAN NOT NULL DEFAULT true,
  "createdById"     INTEGER NOT NULL,
  "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedById"     INTEGER,
  "updatedAt"       TIMESTAMPTZ
);

-- Manual one-off hide (Feature A) on orders
ALTER TABLE orders
  ADD COLUMN "isHidden"     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "hiddenById"   INTEGER,
  ADD COLUMN "hiddenReason" TEXT,
  ADD COLUMN "hiddenAt"     TIMESTAMPTZ;

-- Tag on/off switches (Feature B)
CREATE TABLE app_tag_settings (
  id            SERIAL PRIMARY KEY,
  "tagKey"      TEXT NOT NULL UNIQUE,
  "isEnabled"   BOOLEAN NOT NULL DEFAULT true,
  "updatedById" INTEGER,
  "updatedAt"   TIMESTAMPTZ
);

CREATE INDEX idx_orders_ishidden ON orders ("isHidden");
CREATE INDEX idx_obd_rules_active ON obd_visibility_rules ("isActive");
