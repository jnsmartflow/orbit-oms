-- ═══════════════════════════════════════════════════════════════════════════
-- ALREADY RUN 2026-10-02 by Smart Flow — record only
-- ═══════════════════════════════════════════════════════════════════════════
-- Schema v27.51 · Freight Trips — a report-only "paper trip" layer over HELD bills.
-- Source: docs/prompts/drafts/code-discovery-2026-10-01-freight-trips.md §H, run
-- UNCHANGED (Smart Flow, 2026-10-02). The body below is §H copied verbatim,
-- including its original "DRAFT FOR REVIEW" first line.
--
-- Live verify (2026-10-02, Smart Flow): 3 tables · 23 constraints · 10 indexes,
-- incl. freight_trip_bills_order_active_key … WHERE ("removedAt" IS NULL).
--
-- 🔴 No live_changes trigger on any of the three tables, on purpose (CORE §13):
-- the generic trip trigger would publish freight ids as entity='trip' into
-- Floor's feed, where they are a different id space.
-- 🔴 A freight trip never writes orders, trips, trip_drops, trip_activity or
-- order_status_logs.

-- DRAFT FOR REVIEW — DO NOT RUN. Smart Flow runs the final version in the Supabase SQL Editor.

CREATE TABLE freight_trips (
  id               serial       PRIMARY KEY,
  "tripNumber"     text         NOT NULL,
  "tripDate"       date         NOT NULL,
  seq              integer      NOT NULL,
  "vehicleId"      integer      NULL REFERENCES vehicle_master(id),
  "adhocVehicleNo" text         NULL,
  "transporterId"  integer      NULL REFERENCES transporter_master(id),
  "driverName"     text         NULL,           -- SNAPSHOT, never read through vehicleId
  "driverPhone"    text         NULL,           -- SNAPSHOT
  note             text         NULL,
  status           text         NOT NULL DEFAULT 'active',
  "cancelledAt"    timestamptz(6) NULL,
  "cancelledById"  integer      NULL REFERENCES users(id) ON DELETE SET NULL,
  "createdAt"      timestamptz(6) NOT NULL DEFAULT now(),
  "createdById"    integer      NOT NULL REFERENCES users(id),
  "updatedAt"      timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT "freight_trips_tripNumber_key"     UNIQUE ("tripNumber"),
  CONSTRAINT "freight_trips_tripDate_seq_key"   UNIQUE ("tripDate", seq),
  CONSTRAINT chk_freight_trips_status           CHECK (status IN ('active','cancelled')),
  CONSTRAINT chk_freight_trips_seq_positive     CHECK (seq >= 1),
  CONSTRAINT chk_freight_trips_number_shape     CHECK (
    "tripNumber" = 'F-' || to_char(("tripDate")::timestamp with time zone, 'YYMMDD') || '-'
                   || lpad(seq::text, greatest(2, length(seq::text)), '0')),
  CONSTRAINT chk_freight_trips_vehicle_one_of   CHECK (NOT ("vehicleId" IS NOT NULL AND "adhocVehicleNo" IS NOT NULL)),
  CONSTRAINT chk_freight_trips_cancelled_complete CHECK (
    status <> 'cancelled' OR ("cancelledAt" IS NOT NULL AND "cancelledById" IS NOT NULL))
);
-- The (tripDate, seq) unique's index leads on tripDate: it serves the day's list AND the
-- report's date-range scan. No separate tripDate index needed.

CREATE TABLE freight_trip_bills (
  id               serial       PRIMARY KEY,
  "freightTripId"  integer      NOT NULL REFERENCES freight_trips(id) ON DELETE RESTRICT,
  "orderId"        integer      NOT NULL REFERENCES orders(id)        ON DELETE RESTRICT,
  "addedAt"        timestamptz(6) NOT NULL DEFAULT now(),
  "addedById"      integer      NOT NULL REFERENCES users(id),
  "removedAt"      timestamptz(6) NULL,
  "removedById"    integer      NULL REFERENCES users(id) ON DELETE SET NULL,
  "removedReason"  text         NULL,
  CONSTRAINT chk_freight_trip_bills_removed_reason CHECK (
    "removedReason" IS NULL OR "removedReason" IN ('removed','trip_cancelled')),
  CONSTRAINT chk_freight_trip_bills_removed_complete CHECK (
    ("removedAt" IS NULL) = ("removedReason" IS NULL)
    AND ("removedById" IS NULL OR "removedAt" IS NOT NULL))
);
-- THE rule (decision 4): at most one ACTIVE freight trip per bill. Partial — not modellable in Prisma.
CREATE UNIQUE INDEX freight_trip_bills_order_active_key ON freight_trip_bills ("orderId") WHERE "removedAt" IS NULL;
CREATE INDEX "freight_trip_bills_freightTripId_idx" ON freight_trip_bills ("freightTripId");
CREATE INDEX "freight_trip_bills_orderId_idx"       ON freight_trip_bills ("orderId");   -- one bill's history

CREATE TABLE freight_trip_activity (
  id               serial       PRIMARY KEY,
  "freightTripId"  integer      NOT NULL REFERENCES freight_trips(id) ON DELETE RESTRICT,
  action           text         NOT NULL,
  "actorId"        integer      NOT NULL REFERENCES users(id),
  summary          text         NOT NULL,
  detail           jsonb        NULL,
  "createdAt"      timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT chk_freight_trip_activity_action CHECK (action IN
    ('created','bills_added','bills_removed','vehicle_changed','details_changed','cancelled'))
);
CREATE INDEX "freight_trip_activity_freightTripId_createdAt_idx" ON freight_trip_activity ("freightTripId", "createdAt");
CREATE INDEX freight_trip_activity_created_idx ON freight_trip_activity ("createdAt" DESC);

-- NO trg_live_changes_* trigger on any of the three (see §F12). Record the exception in CORE §13.
