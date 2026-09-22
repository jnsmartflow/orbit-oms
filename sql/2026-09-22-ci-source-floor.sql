-- ═══════════════════════════════════════════════════════════════════════════
-- ALREADY RUN ON LIVE 2026-09-22 by Smart Flow — record only
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Schema v27.40 (CLAUDE_CORE.md §7 chain). Do NOT run this again as part of a
-- deploy: it is the record of a DDL change already applied in the Supabase
-- SQL Editor. Re-running it is harmless (DROP IF EXISTS, then the same ADD),
-- but it is not needed.
--
-- WHAT: chk_ci_returns_source gains a FOURTH value, 'floor' — a full-bill,
-- material-not-moved CI raised from the Floor desk for ticked bills, which
-- also takes each bill off the floor (app/api/floor/ci/route.ts).
--
-- OLD (Schema v27.39, sql/2026-09-22-billing-telephonic.sql PART 3):
--   CHECK ((source = ANY (ARRAY['manual'::text, 'auto_finding'::text, 'auto_bill_only'::text])))
--
-- The code that mirrors this CHECK: CiSource / CI_SOURCES / ciSourceTag in
-- lib/ci/types.ts ("Floor" tag), and the comment block on ci_returns in
-- prisma/schema.prisma. No Prisma model change — `source` is a plain String.

ALTER TABLE ci_returns DROP CONSTRAINT IF EXISTS chk_ci_returns_source;

ALTER TABLE ci_returns
  ADD CONSTRAINT chk_ci_returns_source
  CHECK ("source" IN ('manual', 'auto_finding', 'auto_bill_only', 'floor'));

-- LIVE DEFINITION after the change (pg_get_constraintdef, 2026-09-22):
--   CHECK ((source = ANY (ARRAY['manual'::text, 'auto_finding'::text, 'auto_bill_only'::text, 'floor'::text])))
