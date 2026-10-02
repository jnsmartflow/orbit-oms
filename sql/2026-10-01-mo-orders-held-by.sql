-- ═══════════════════════════════════════════════════════════════════════════
-- ALREADY RUN 2026-10-01 by Smart Flow — record only, do not re-run blindly
-- ═══════════════════════════════════════════════════════════════════════════
-- Schema v27.50 · mo_orders.heldAt / heldById — who pressed ⚑ Hold on a mail order.
-- NULL = the parser set the Hold (or a press before 2026-10-01).
-- Code: app/api/billing/mail-order/actions/route.ts (stamp on transition to /
-- off Hold), app/api/import/obd/route.ts applyMailOrderEnrichment (logs the
-- bill's hold as MAIL_ORDER_BILLING_HOLD_NOTE with that user, else
-- MAIL_ORDER_AUTO_HOLD_NOTE with changedById 1 = system).
-- Discovery: docs/prompts/drafts/code-discovery-2026-10-01-hold-sources.md §7 F1/F2.
--
-- ⚠ NOT A VERBATIM COPY. The statement text Smart Flow ran was not handed to
-- the repo; the DDL below is RECONSTRUCTED to produce exactly the verified
-- live result underneath it. If the original text turns up, replace this block.
--
-- Supabase SQL Editor rules: no BEGIN/COMMIT. Both columns are nullable with no
-- default, so the ALTER is metadata-only (no table rewrite).

ALTER TABLE mo_orders
  ADD COLUMN "heldAt"   timestamptz NULL,
  ADD COLUMN "heldById" integer     NULL;

ALTER TABLE mo_orders
  ADD CONSTRAINT "mo_orders_heldById_fkey"
  FOREIGN KEY ("heldById") REFERENCES users(id) ON DELETE SET NULL;

-- ── VERIFY (read-only) — result returned live 2026-10-01 ────────────────────
--   column      heldAt    timestamp with time zone  NULL
--   column      heldById  integer                   NULL
--   constraint  mo_orders_heldById_fkey  FOREIGN KEY ("heldById") REFERENCES users(id) ON DELETE SET NULL
--
-- SELECT 'column' AS kind, column_name::text AS name, data_type::text AS detail, is_nullable::text AS nullable
--   FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name = 'mo_orders' AND column_name IN ('heldAt', 'heldById')
-- UNION ALL
-- SELECT 'constraint', conname::text, pg_get_constraintdef(oid)::text, NULL::text
--   FROM pg_constraint
--  WHERE conname = 'mo_orders_heldById_fkey';
