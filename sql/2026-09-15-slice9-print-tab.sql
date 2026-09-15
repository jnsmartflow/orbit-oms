-- ============================================================================
-- 2026-09-15 · Floor trip desk · SLICE 9 — Send to billing and the Print tab
--
-- The planner's Send to billing puts a trip on the Billing screen's new Print
-- tab. Billing copies the trip's invoice numbers into SAP (Orbit prints nothing);
-- the copy is recorded on the trip and in its history. A new page key,
-- `billing_print` ("Billing · Print"), gates the tab.
--
-- Code: lib/billing/print.ts, lib/trips/billing.ts,
--       app/api/floor/trips/[id]/billing/route.ts, app/api/billing/print/*,
--       components/billing/billing-print-tab.tsx
--
-- ── RUN ORDER — EACH STEP IS ITS OWN RUN IN THE SQL EDITOR ──────────────────
--   BEFORE the deploy:  STEP 1 → STEP 2 → STEP 3 → STEP 4
--   THE DEPLOY:         git push (Vercel builds from origin/main)
--   AFTER the deploy:   nothing
--
-- 🔴 WHY 1 AND 2 MUST RUN FIRST. The new code SELECTs trips."sentToBillingAt" and
-- trips."billingCopiedAt" on EVERY trip read — the floor's rail and trip detail
-- included. Deployed without the columns, the floor desk fails to load. And the
-- first Send to billing writes a trip_activity row with action
-- 'sent_to_billing', which the CHECK must already admit.
--
-- ⚠ 3 AND 4 ARE SAFE EITHER SIDE of the deploy — the old code reads neither key —
-- but run them before so the five people see the Print tab the moment it ships.
--
-- No BEGIN/COMMIT (Supabase SQL Editor). Each step ends with its own check.
-- ============================================================================


-- ============================================================================
-- STEP 1 — BEFORE DEPLOY · trips.sentToBillingAt / sentToBillingById,
--                          trips.billingCopiedAt / billingCopiedById
--
-- Null = not sent / never copied. The SIXTH and SEVENTH FKs from trips to users;
-- ON DELETE SET NULL exactly like shownById and its siblings. billingCopiedAt is
-- the LATEST copy; the numbers each copy took live in its activity row.
-- No index: trips holds ~120 rows.
-- ============================================================================

ALTER TABLE trips
  ADD COLUMN "sentToBillingAt"   timestamptz(6),
  ADD COLUMN "sentToBillingById" integer,
  ADD COLUMN "billingCopiedAt"   timestamptz(6),
  ADD COLUMN "billingCopiedById" integer;

ALTER TABLE trips
  ADD CONSTRAINT "trips_sentToBillingById_fkey"
  FOREIGN KEY ("sentToBillingById") REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE trips
  ADD CONSTRAINT "trips_billingCopiedById_fkey"
  FOREIGN KEY ("billingCopiedById") REFERENCES users(id) ON DELETE SET NULL;

-- Check: expect four column rows (two timestamp with time zone, two integer, all
-- nullable) and the two FKs.
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'trips'
  AND column_name IN ('sentToBillingAt', 'sentToBillingById', 'billingCopiedAt', 'billingCopiedById')
UNION ALL
SELECT conname, pg_get_constraintdef(oid), 'fk'
FROM pg_constraint
WHERE conrelid = 'trips'::regclass
  AND conname IN ('trips_sentToBillingById_fkey', 'trips_billingCopiedById_fkey');


-- ============================================================================
-- STEP 2 — BEFORE DEPLOY · three actions join the activity vocabulary
--
-- 'sent_to_billing', 'taken_back_from_billing', 'invoices_copied'.
-- TypeScript twins: TRIP_SENT_TO_BILLING / TRIP_TAKEN_BACK_FROM_BILLING /
-- TRIP_INVOICES_COPIED in lib/trips/activity.ts. Same fence-never-down pattern
-- as slice 8: add under a temporary name, drop the old, rename.
-- ============================================================================

ALTER TABLE trip_activity ADD CONSTRAINT chk_trip_activity_action_v2 CHECK (
  action IN ('created', 'bills_added', 'bills_removed', 'vehicle_changed',
             'details_changed', 'cancelled', 'released', 'dispatched', 'renamed',
             'shown', 'taken_back',
             'sent_to_billing', 'taken_back_from_billing', 'invoices_copied')
);

ALTER TABLE trip_activity DROP CONSTRAINT chk_trip_activity_action;

ALTER TABLE trip_activity RENAME CONSTRAINT chk_trip_activity_action_v2 TO chk_trip_activity_action;

-- Check: expect ONE row ending in 'sent_to_billing', 'taken_back_from_billing',
-- 'invoices_copied'.
SELECT conname, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conrelid = 'trip_activity'::regclass AND conname LIKE 'chk_trip_activity_action%';


-- ============================================================================
-- STEP 3 — BEFORE DEPLOY (safe after) · role_permissions TEMPLATE rows
--
-- ⚠ TEMPLATE ONLY. ACCESS_SOURCE = 'user', so these rows enforce nothing; they
-- are what a new person on those roles would be offered, and the fallback if
-- ACCESS_SOURCE is ever rolled back to 'role' (CORE §5).
--
-- Mirrors the LIVE billing_picking rows flag for flag (owner: same people as
-- Picking). Read 2026-09-15: billing_operator, operations, operation_manager,
-- tint_manager — canView + canEdit, the other three false. Derived from the
-- live rows rather than typed, so it copies whatever is there when it runs.
-- DO NOTHING on conflict: a re-run never overwrites a template somebody edited.
-- ============================================================================

INSERT INTO role_permissions
  ("roleSlug", "pageKey", "canView", "canImport", "canExport", "canEdit", "canDelete")
SELECT "roleSlug", 'billing_print', "canView", "canImport", "canExport", "canEdit", "canDelete"
FROM role_permissions
WHERE "pageKey" = 'billing_picking'
ON CONFLICT ON CONSTRAINT role_permissions_roleslug_pagekey_key DO NOTHING;

-- Check: the two keys side by side — every role's flags must match.
SELECT "pageKey", "roleSlug", "canView", "canEdit", "canImport", "canExport", "canDelete"
FROM role_permissions
WHERE "pageKey" IN ('billing_picking', 'billing_print')
ORDER BY "roleSlug", "pageKey";


-- ============================================================================
-- STEP 4 — BEFORE DEPLOY (safe after) · user_page_access — THE ENFORCED GRANTS
--
-- One row per user, canView / canEdit mirroring that user's billing_picking row
-- (absent row ≡ false). Read 2026-09-15: five holders, all view + edit —
-- Operations User (20), Chandresh Kolgha (21), Deepanshu Thakur (25),
-- Bankim (26), Prakash (32). ⚠ That is the EXPECTATION: whoever holds
-- billing_picking when this runs is who gets billing_print.
--
-- ROWS FOR EVERY USER, all-false for the other 35 — the pattern of
-- sql/2026-09-11-billing-action-ticks.sql, so /admin/access reports no missing
-- rows for the new key. An all-false row and an absent row mean the same thing
-- to every resolver.
--
-- 🔴 THE CONFLICT ARM ONLY EVER RAISES, so a re-run can never undo a revocation
-- made by hand on /admin/access.
-- ============================================================================

INSERT INTO user_page_access
  ("userId", "pageKey", "canView", "canImport", "canExport", "canEdit", "canDelete")
SELECT
  u.id,
  'billing_print',
  COALESCE(bp."canView", false),
  false,
  false,
  COALESCE(bp."canEdit", false),
  false
FROM users u
LEFT JOIN user_page_access bp
  ON bp."userId" = u.id AND bp."pageKey" = 'billing_picking'
ON CONFLICT ON CONSTRAINT user_page_access_user_page_key
DO UPDATE SET
  "canView"   = user_page_access."canView" OR excluded."canView",
  "canEdit"   = user_page_access."canEdit" OR excluded."canEdit",
  "updatedAt" = now();

-- Check: expect GRANTED = the five people above with view and edit both true,
-- MISMATCH = none, and TOTAL rows = the number of users (40 on 2026-09-15).
SELECT 1 AS sort_order, 'GRANTED' AS line_type, u.name AS person,
       p."canView"::text AS can_view, p."canEdit"::text AS can_edit
  FROM user_page_access p JOIN users u ON u.id = p."userId"
 WHERE p."pageKey" = 'billing_print' AND (p."canView" OR p."canEdit")
UNION ALL
SELECT 2, 'MISMATCH', u.name, p."canView"::text, p."canEdit"::text
  FROM user_page_access p
  JOIN users u ON u.id = p."userId"
  LEFT JOIN user_page_access bp ON bp."userId" = p."userId" AND bp."pageKey" = 'billing_picking'
 WHERE p."pageKey" = 'billing_print'
   AND (p."canView" <> COALESCE(bp."canView", false) OR p."canEdit" <> COALESCE(bp."canEdit", false))
UNION ALL
SELECT 3, 'TOTAL', 'rows ' || count(*) || ' · users ' || (SELECT count(*) FROM users), NULL, NULL
  FROM user_page_access WHERE "pageKey" = 'billing_print'
ORDER BY sort_order, person;
