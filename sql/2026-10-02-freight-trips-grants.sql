-- ═══════════════════════════════════════════════════════════════════════════
-- Freight Trips — page-key grants (user_page_access, page key 'freight_trips')
-- RUN STATUS: NOT CONFIRMED. The 2026-10-03 docs prompt that asked for this
-- record carried an unfilled "ACCESS_LINE" placeholder where the run status
-- should have been. The owner's live hand-test on 2026-10-03 shows at least one
-- account used /freight-trips — but a superuser passes every gate without a tick,
-- so that proves nothing about these rows. Confirm with the
-- read-only SELECT at the foot BEFORE re-running anything.
-- ═══════════════════════════════════════════════════════════════════════════
-- Canon: docs/CLAUDE_FREIGHT_TRIPS.md §8. Pattern: dense rows for every active
-- user (all false), then view + edit for the named operations users — so
-- /admin/access shows no "page rows missing" banner. Grants are data, never seed.
-- Supabase SQL Editor rules: no BEGIN/COMMIT.
--
-- ── The block as handed over (verbatim) ────────────────────────────────────

INSERT INTO user_page_access ("userId", "pageKey", "canView", "canEdit")
SELECT u.id, 'freight_trips', false, false FROM users u
 WHERE u."isActive" = true
   AND NOT EXISTS (SELECT 1 FROM user_page_access x WHERE x."userId" = u.id AND x."pageKey" = 'freight_trips');
UPDATE user_page_access SET "canView" = true, "canEdit" = true
 WHERE "pageKey" = 'freight_trips' AND "userId" IN (1, 32, 20);

-- ── VERIFY (read-only) ──────────────────────────────────────────────────────
-- SELECT u.id::text, u.name::text, upa."canView"::text, upa."canEdit"::text
--   FROM user_page_access upa JOIN users u ON u.id = upa."userId"
--  WHERE upa."pageKey" = 'freight_trips' AND (upa."canView" OR upa."canEdit")
--  ORDER BY u.id;
