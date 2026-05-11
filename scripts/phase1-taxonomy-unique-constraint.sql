-- Phase 1 taxonomy redesign — schema prep
--
-- Widens mo_order_form_index unique constraint from (subProduct, baseColour)
-- to (family, subProduct, baseColour) so Promise primer variants can be
-- cross-listed under multiple families on /place-order:
--   PROMISE PRIMER (white)        → PRIMER family
--   PROMISE PRIMER (white)        → PROMISE INTERIOR family
--   PROMISE PRIMER (white)        → PROMISE umbrella family
-- All three rows share (subProduct="PROMISE PRIMER", baseColour=null)
-- but differ in `family`.
--
-- DO NOT run with `prisma migrate` (CLAUDE_CORE.md §3 — no prisma db push,
-- no prisma migrate). Apply via Supabase SQL Editor, then `npx prisma
-- generate` locally to refresh client types.
--
-- Application order:
--   1. Run this SQL in Supabase SQL Editor.
--   2. `npx prisma generate` from local repo.
--   3. Phase 1 Prompt 2 reseeds mo_order_form_index using the JSON preview
--      produced by scripts/preview-new-taxonomy.ts.
--
-- Rollback (if needed before reseed):
--   ALTER TABLE mo_order_form_index
--     DROP CONSTRAINT mo_order_form_index_family_subProduct_baseColour_key;
--   ALTER TABLE mo_order_form_index
--     ADD  CONSTRAINT mo_order_form_index_subProduct_baseColour_key
--          UNIQUE ("subProduct","baseColour");

ALTER TABLE mo_order_form_index
  DROP CONSTRAINT IF EXISTS mo_order_form_index_subProduct_baseColour_key;

ALTER TABLE mo_order_form_index
  ADD CONSTRAINT mo_order_form_index_family_subProduct_baseColour_key
      UNIQUE ("family","subProduct","baseColour");
