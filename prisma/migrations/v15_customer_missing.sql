-- v15_customer_missing
-- Adds customerMissing flag to orders so that OBDs with an unknown
-- ShipToCustomerId can be imported with a warning instead of being blocked.
-- Run this on the database BEFORE deploying the matching app version.

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS "customerMissing" BOOLEAN NOT NULL DEFAULT false;
