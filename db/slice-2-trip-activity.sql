-- ─────────────────────────────────────────────────────────────────────────────
-- SLICE 2 — trip_activity
-- Run in the Supabase SQL Editor. 2026-09-14.
--
-- RUN THIS BEFORE DEPLOYING THE CODE. This is the opposite order from slice 1.
-- Slice 1 removed a value, so the code could safely ship first; slice 2 ADDS a
-- table the code writes to, so the code must not reach production before the
-- table exists. Nothing breaks catastrophically if it does — every write goes
-- through writeActivity(), which swallows its own failure — but every trip
-- action would silently record nothing and the server log would fill with P2021.
--
-- Safe to re-run: every statement is IF NOT EXISTS or guarded.
-- No backfill. Existing stamps on `trips` stay exactly where they are.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS trip_activity (
  id          SERIAL PRIMARY KEY,
  "tripId"    INTEGER     NOT NULL,
  action      TEXT        NOT NULL,
  "actorId"   INTEGER     NOT NULL,
  summary     TEXT        NOT NULL,
  detail      JSONB,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- 🔴 RESTRICT, NOT CASCADE, AND THAT IS THE POINT.
  -- Trips are never hard-deleted — cancelling is a status, not a DELETE — so
  -- this costs nothing today and turns that convention into a guarantee the
  -- database enforces. Cascade would let one DELETE erase a trip's whole
  -- history silently, which is the one thing an audit table must never do.
  -- trip_drops uses CASCADE because a drop is PART of the trip; this is a
  -- record ABOUT the trip and is meant to outlive it.
  CONSTRAINT trip_activity_trip_fkey
    FOREIGN KEY ("tripId") REFERENCES trips(id) ON DELETE RESTRICT,

  CONSTRAINT trip_activity_actor_fkey
    FOREIGN KEY ("actorId") REFERENCES users(id)
);

-- The vocabulary fence. lib/trips/activity.ts owns these strings; this is the
-- backstop that stops a typo reaching a row (CORE §3's status-string rule).
--
-- ⚠ 'released' AND 'dispatched' MUST STAY IN THIS LIST after slice 3 and slice 4
-- delete the routes that write them. Rows written now outlive their writers, and
-- a log that stops explaining its own old rows is worse than one carrying two
-- retired verbs.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_trip_activity_action'
  ) THEN
    ALTER TABLE trip_activity
      ADD CONSTRAINT chk_trip_activity_action
      CHECK (action IN (
        'created',
        'bills_added',
        'bills_removed',
        'vehicle_changed',
        'details_changed',
        'cancelled',
        'released',
        'dispatched'
      ));
  END IF;
END $$;

-- THE read: one trip's rows, oldest first. Answered from the index alone.
CREATE INDEX IF NOT EXISTS trip_activity_trip_idx
  ON trip_activity ("tripId", "createdAt");

-- For a future cross-trip audit view. No caller today.
CREATE INDEX IF NOT EXISTS trip_activity_created_idx
  ON trip_activity ("createdAt" DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify (read-only). Expect: 8 actions in the CHECK, 2 indexes, 0 rows.
-- ─────────────────────────────────────────────────────────────────────────────
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conname = 'chk_trip_activity_action';
-- SELECT indexname FROM pg_indexes WHERE tablename = 'trip_activity';
-- SELECT count(*) FROM trip_activity;
