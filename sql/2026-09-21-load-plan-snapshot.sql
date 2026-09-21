-- ============================================================================
-- 2026-09-21 · Floor · LOAD PLAN CHECK — the snapshot table
--
-- What the Upcountry load plan SUGGESTED, kept so the admin "Load plan check"
-- page can compare it BY BILL with the trips the planners actually made
-- (planners may never press Make trip, so cards cannot be matched to trips).
--
--   date      the IST day the plan is for
--   takenAt   when it was taken
--   source    'auto'   — the 21:00 IST cron (/api/cron/load-plan-snapshot):
--                        ALL of that day's Upcountry bills — on that day's
--                        trips and still pending — AT MOST ONE PER DAY
--                        (partial unique index below)
--             'replan' — every press of Replan on the Load plan tab (all kept)
--   cards     jsonb array, one element per card:
--             { cardNo, type, vehicle, billIds, kg, stops, places }
--             type    ace | big | gc | bulk | direct | hold | waiting
--             vehicle ace | big | gc | null (a hire bulk, hold, waiting, direct)
--             places  area names, far first
--
-- 🔴 NO RATES, NO RUPEES. Nothing in this table is money; the check page
-- prices plan vs actual at read time, server-side, and shows a % only.
--
-- ONE SCRIPT, ALL OR NOTHING. Paste the whole file and run it once.
-- 🔴 NO BEGIN/COMMIT — THE DO BLOCK IS THE TRANSACTION (Supabase SQL Editor
-- house rule): the table and both indexes are created together or not at all.
-- ⚠ A SECOND RUN FAILS (the table exists) and changes nothing.
-- The app survives this table not existing yet: the cron and Replan skip the
-- save and the check page says "no snapshots". Run it before or after deploy.
-- ============================================================================

DO $$
BEGIN
  CREATE TABLE load_plan_snapshot (
    id        serial          PRIMARY KEY,
    date      date            NOT NULL,
    "takenAt" timestamptz(6)  NOT NULL DEFAULT now(),
    source    text            NOT NULL,
    cards     jsonb           NOT NULL,
    CONSTRAINT chk_load_plan_snapshot_source CHECK (source IN ('auto', 'replan')),
    CONSTRAINT chk_load_plan_snapshot_cards  CHECK (jsonb_typeof(cards) = 'array')
  );

  -- The report reads one day at a time, the 21:00 one first.
  CREATE INDEX load_plan_snapshot_date_idx ON load_plan_snapshot (date, source, "takenAt");

  -- At most one AUTO snapshot per day: a cron retry cannot write a second.
  CREATE UNIQUE INDEX load_plan_snapshot_auto_key ON load_plan_snapshot (date) WHERE source = 'auto';
END $$;

-- ── CHECK (read-only) — expect 5 columns and 0 rows ─────────────────────────
SELECT column_name, data_type, is_nullable,
       (SELECT count(*) FROM load_plan_snapshot) AS row_count
FROM information_schema.columns
WHERE table_name = 'load_plan_snapshot'
ORDER BY ordinal_position;
