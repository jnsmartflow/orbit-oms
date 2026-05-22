-- Sampling Library — page key + role permissions
-- Run in: Supabase SQL Editor
-- Date: 2026-05-21
-- Depends on: 01-schema.sql (run prior), lib/permissions.ts (must be deployed)
--
-- Permission values follow SAMPLING_LIBRARY_DESIGN_SPEC.md:
--   "Grant view+edit to: admin, ops_admin, tint_manager, tint_operator."
-- (Smart Flow confirmed spec wins over earlier tint_operator=read-only draft.)

INSERT INTO role_permissions ("roleSlug", "pageKey", "canView", "canImport", "canExport", "canEdit", "canDelete", "updatedAt")
VALUES
  ('admin',         'sampling_library', true,  true,  true,  true,  true,  now()),
  ('tint_manager',  'sampling_library', true,  false, true,  true,  false, now()),
  ('ops_admin',     'sampling_library', true,  true,  true,  true,  false, now()),
  ('tint_operator', 'sampling_library', true,  false, false, true,  false, now())
ON CONFLICT ("roleSlug", "pageKey") DO NOTHING;

-- Verify
-- SELECT * FROM role_permissions WHERE "pageKey" = 'sampling_library' ORDER BY "roleSlug";
