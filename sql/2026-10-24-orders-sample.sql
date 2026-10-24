-- sql/2026-10-24-orders-sample.sql
-- Schema v27.77 · orders."sampleAt" / "sampleById" — the SAMPLE mark.
-- RUN LIVE 2026-10-24 by the owner in the Supabase SQL Editor (Smart Flow).
-- Read-back from live, the same day:
--   orders."sampleAt"   timestamp with time zone, nullable
--   orders."sampleById" integer, nullable
--   orders_sampleById_fkey: FOREIGN KEY ("sampleById") REFERENCES users(id) ON DELETE SET NULL
--
-- A per-ORDER flag: the bill is a sample. Set = "sampleAt" IS NOT NULL.
-- Timestamp + actor, the Hand shape (v27.41): no boolean, no CHECK (ON DELETE
-- SET NULL would fight a both-or-neither rule), no index. The TENTH FK from
-- orders to users — Prisma relation "OrderSampleBy", named on both sides.
-- No BEGIN/COMMIT (SQL Editor). Idempotent: safe to re-run.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS "sampleAt"   timestamptz(6);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS "sampleById" integer;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_sampleById_fkey') THEN
    ALTER TABLE orders ADD CONSTRAINT "orders_sampleById_fkey"
      FOREIGN KEY ("sampleById") REFERENCES users("id") ON DELETE SET NULL;
  END IF;
END $$;

-- Read-back (read-only)
SELECT 'column'::text AS kind, column_name::text AS name, (data_type || ' · nullable ' || is_nullable)::text AS detail
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'orders' AND column_name IN ('sampleAt', 'sampleById')
UNION ALL
SELECT 'constraint'::text, conname::text, pg_get_constraintdef(oid)::text
FROM pg_constraint WHERE conname = 'orders_sampleById_fkey';
