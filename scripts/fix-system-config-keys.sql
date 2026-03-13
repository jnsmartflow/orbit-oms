-- ── Fix system_config key names ─────────────────────────────────────────────
-- Run this once in Supabase SQL Editor if soft_lock / hard_lock show as 0 in UI.
-- Safe to run multiple times (idempotent).

-- 1. Rename old key → new key (only if new key doesn't already exist)
UPDATE system_config
SET key = 'soft_lock_minutes_before_cutoff'
WHERE key = 'soft_lock_minutes'
  AND NOT EXISTS (
    SELECT 1 FROM system_config WHERE key = 'soft_lock_minutes_before_cutoff'
  );

UPDATE system_config
SET key = 'hard_lock_minutes_before_cutoff'
WHERE key = 'hard_lock_minutes'
  AND NOT EXISTS (
    SELECT 1 FROM system_config WHERE key = 'hard_lock_minutes_before_cutoff'
  );

-- 2. Delete old keys if both old + new rows somehow exist
DELETE FROM system_config WHERE key IN ('soft_lock_minutes', 'hard_lock_minutes');

-- 3. Insert missing keys with defaults (covers case where neither old nor new existed)
INSERT INTO system_config (key, value, "updatedAt")
SELECT 'soft_lock_minutes_before_cutoff', '30', NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM system_config WHERE key = 'soft_lock_minutes_before_cutoff'
);

INSERT INTO system_config (key, value, "updatedAt")
SELECT 'hard_lock_minutes_before_cutoff', '15', NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM system_config WHERE key = 'hard_lock_minutes_before_cutoff'
);

-- Verify result
SELECT key, value FROM system_config ORDER BY id;
