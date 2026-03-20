-- Migration: add dispatchStatus and priorityLevel to order_splits
-- Run this in Supabase SQL Editor

ALTER TABLE order_splits ADD COLUMN IF NOT EXISTS "dispatchStatus" TEXT;
ALTER TABLE order_splits ADD COLUMN IF NOT EXISTS "priorityLevel"  INTEGER NOT NULL DEFAULT 3;
