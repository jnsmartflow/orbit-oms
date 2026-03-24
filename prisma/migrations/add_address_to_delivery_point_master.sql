-- Add address field to delivery_point_master
ALTER TABLE delivery_point_master
  ADD COLUMN IF NOT EXISTS address TEXT;
