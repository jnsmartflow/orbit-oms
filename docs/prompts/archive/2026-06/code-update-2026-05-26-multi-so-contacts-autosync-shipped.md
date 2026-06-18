# Session End — Multi-SO per Customer + Contacts Auto-Sync

**Date:** 2026-05-26
**Workstream:** Customer Master — multi-SO + Contacts auto-sync
**Status:** Phases 1–7 SHIPPED to `main` (commit `d1e298da`)
**Phase 8:** Deferred to ROADMAP (see §6)
**Filename for archive:** `code-update-2026-05-26-multi-so-contacts-autosync-shipped.md`

---

## 1. What shipped

The Customer Master flow now supports multiple Sales Officers per customer, each with a role tag (Primary / Backup / Junior). Picking an SO automatically creates a matching contact in the Contacts section with the SO's name, phone, and "Sales Officer" role — no more duplicate manual data entry. The Primary SO auto-claims the "Primary contact" slot.

This applies to:
- Admin Customer Master (full edit form)
- Missing Customer Resolver (TM Kanban / Support board / Mail Orders)
- TM Kanban order/split cards (display)
- Delivery Challan S5 row (display)
- Sampling Library (auto-stamp at TI creation)

All 8 customers with a legacy `salesOfficerId` were migrated to the new structure in a single Supabase SQL Editor session.

---

## 2. Decisions locked in this workstream

| Decision | Outcome |
|---|---|
| One SO per customer, or many? | **Many** (1–N), each tagged Primary / Backup / Junior. Exactly one Primary allowed, enforced by DB partial unique index. |
| Source of truth for "the SO" | Direct SO link via `customer_sales_officers`. SO Group becomes a classification tag only, no longer drives SO. |
| Auto-contact data model | Pointer model with snapshot. Contact row stores name + phone, refreshed from SO master on every save. `linkedSalesOfficerId` is the stamp. |
| SO changes role → contact handling | Contact stays (same SO), badge updates reactively. |
| SO removed from list → contact handling | Auto-contact deleted with it. |
| Operator deletes auto-contact manually | Admin form: confirm modal → `contactDismissed=true` flag persists, contact won't auto-recreate. Missing-customer sheet: ✕ is disabled with tooltip directing to SO list (create-only flow, no dismissal needed). |
| Primary SO and Primary contact relationship | Primary SO's auto-contact is force-checked as Primary contact (Stage E). Old Primary contact gets unchecked. Backup/Junior SO contacts stay unchecked. |
| Sampling Library default | Server auto-stamps the customer's current Primary SO onto new sampling rows at TI creation time. No new UI. Historical entries frozen. |
| Inactive SO master rows in migration | Included (honors operator's historical choice). |
| Existing manual SO contacts during migration | Stamped (linkedSalesOfficerId set) rather than duplicated. Exact case-insensitive name match. |
| Block 4 Stage E auto-fix during migration | Skipped. Operator's manual Primary contact choice respected; Stage E fires naturally on next save. |

---

## 3. Schema additions (v27.3 → v27.4 candidate)

### `customer_sales_officers` (NEW table)

| Column | Type | Notes |
|---|---|---|
| `id` | Int PK autoincrement | |
| `customerId` | Int FK → `delivery_point_master` | ON DELETE CASCADE |
| `salesOfficerId` | Int FK → `sales_officer_master` | ON DELETE RESTRICT |
| `role` | enum `CustomerSalesOfficerRole` | Values: PRIMARY / BACKUP / JUNIOR |
| `contactDismissed` | Boolean default false | True if operator manually removed the auto-contact |
| `createdAt` | TIMESTAMPTZ default now() | |
| `updatedAt` | TIMESTAMPTZ default now() | |

**Constraints:**
- UNIQUE (`customerId`, `salesOfficerId`) — no duplicate SO per customer
- Partial UNIQUE INDEX on (`customerId`) WHERE role = 'PRIMARY' — exactly one Primary per customer

**Indexes:** `salesOfficerId` (reverse lookup), (`customerId`, role) (Primary lookup)

### `delivery_point_contacts.linkedSalesOfficerId` (NEW column)

| Column | Type | Notes |
|---|---|---|
| `linkedSalesOfficerId` | Int? FK → `sales_officer_master` | ON DELETE SET NULL. NULL for manual contacts. Set for auto-managed SO contacts. |

### Enum `CustomerSalesOfficerRole`

Values: `PRIMARY`, `BACKUP`, `JUNIOR`

---

## 4. Files touched (committed `d1e298da`)

20 files, +2151 / -404.

**New files (6):**
- `prisma/schema.prisma` (modified)
- `lib/customers/so-sync.ts` — Phase 2 backend sync engine (Stages B/F/C/D/E)
- `lib/customers/resolve-linked-so.ts` — shared helper, extracted from Phase 3b
- `components/admin/sales-officers-list.tsx` — multi-SO picker UI
- `components/admin/contact-card.tsx` — auto/manual contact card with avatar + badge
- `components/admin/auto-contact-delete-dialog.tsx` — confirm modal for auto-contact deletion
- `docs/mockups/customer-master/customer-master-multi-so.html` — approved Phase 3a mockup

**Modified:**
- `app/api/admin/customers/route.ts` (POST) — calls new sync stages
- `app/api/admin/customers/[id]/route.ts` (PATCH + GET) — sync stages + extended fullInclude
- `app/api/tint/manager/orders/route.ts` — `salesOfficerLinks` include on 5 customer payloads
- `app/api/tint/manager/challans/[orderId]/route.ts` — 4-source cascade on resolvedSalesOfficer
- `app/api/tint/operator/_lib/sampling-resolution.ts` — auto-stamp Primary SO at TI creation
- `components/admin/customer-sheet.tsx` — multi-SO picker + sorted contacts + modal
- `components/admin/customers-split-view.tsx` — same as customer-sheet
- `components/shared/customer-missing-sheet.tsx` — eager sync + disabled ✕ + Basic Info strip
- `components/tint/tint-manager-content.tsx` — `getDisplaySalesOfficerName` helper + type extension
- `app/(admin)/admin/customers/page.tsx` — widen SO select to include phone
- `app/(support)/support/customers/page.tsx` — same
- `app/(dispatcher)/dispatcher/customers/page.tsx` — same
- `app/(tint)/tint/manager/customers/page.tsx` — same

---

## 5. Engineering rules respected (CORE §3)

- No `prisma.$transaction` introduced anywhere in new code. Pre-existing `$transaction` calls in `app/api/admin/customers/route.ts` lines 133 & 186 left untouched (flagged as pre-existing landmines).
- All API routes confirmed to have `export const dynamic = 'force-dynamic'`.
- All schema changes applied via Supabase SQL Editor → hand-edit `schema.prisma` → `npx prisma generate`. Never `prisma db push`.
- Sequential awaits throughout. No parallelism via `Promise.all` on writes.
- `npx tsc --noEmit` clean before commit. Verified at every phase.
- camelCase columns, no `@map`.
- All identifiers double-quoted in SQL.

---

## 6. Phase 8 — Deferred to ROADMAP

Six cleanup items, ordered by priority:

1. **Drop `delivery_point_master.salesOfficerId` column.** The column is now write-ignored from the admin UI but still read by the CSV importer. Drop only after #3.
2. **Update CSV importer** (`app/api/admin/customers/import/route.ts`) to write to `customer_sales_officers` instead of legacy `salesOfficerId`. Required before #1.
3. **CSV template header label** currently says `salesOfficerGroup` but the importer expects `salesofficername` — pre-existing misleading label, rename when #2 ships.
4. **Refresh `docs/CLAUDE_TINT.md §5.5`** to document the new 4-source cascade (Primary SO → SO Group → Ship-To SO contact → null).
5. **Simplify `_lib/detail.ts` cascade** (sampling library detail panel). The legacy fallback is dead code for all post-Phase-6 entries. Cascade still matters for legacy null sampling rows; consider after a one-time backfill of those.
6. **One-time backfill of pre-Phase-6 sampling_register.salesOfficerId** so detail.ts cascade can be fully retired. Optional.

**Add `@deprecated` JSDoc comment to `delivery_point_master.salesOfficerId` in Prisma schema** as part of the Phase 8 work, flagging the field as legacy-only for any developer encountering it via autocomplete.

---

## 7. P2002 race condition — pattern learned

During Phase 3b smoke test, a real bug surfaced: the backend reconcile function in `lib/customers/so-sync.ts` was producing `P2002` errors when an operator swapped the Primary SO. Root cause: insert/update operations were colliding with the partial unique index ("only one Primary per customer") because the loop ordering allowed two Primary rows to exist transiently.

**Fix shipped:** Pre-clear all PRIMARY rows for the customer to BACKUP at the start of reconcile (one `updateMany` call), then run the main upsert loop unconditionally. Drops the role-comparison optimization to avoid stale-cache bugs.

**Pattern to remember:** When a partial unique index enforces "one row of a kind per parent", reconcile loops must demote-then-promote, never promote-then-demote. Pre-clearing the constraint is the safest path.

---

## 8. Migration summary (Phase 7)

Single Supabase SQL Editor session, idempotent, no code changes:

- 8 new `customer_sales_officers` PRIMARY rows inserted
- 2 existing manual SO contacts stamped (linkedSalesOfficerId set)
- 6 fresh auto-contacts inserted
- Total 16 row writes across 2 tables
- All 5 verification queries returned expected results (0 unmigrated, 0 missing auto-contacts, 0 duplicate Primaries)

---

## 9. What changed for operators (user-facing)

**Admin Customer Master:**
- Sales & Classification section now has a "Sales Officers" list (was a single dropdown)
- Add 1–N SOs, tag each as Primary / Backup / Junior
- Contacts section auto-populates with the SO's name + phone, tagged "Sales Officer", with a teal badge "Auto · Primary/Backup/Junior SO"
- Primary SO's contact is automatically the Primary contact
- Deleting an auto-contact shows a confirm modal warning that it won't come back unless the SO is re-added

**Missing Customer Resolver (TM Kanban / Support):**
- Same Sales & Classification multi-SO list
- Contacts tab auto-populates on SO selection
- Auto-contact ✕ is disabled (tooltip: "Remove via Sales Officers tab")

**TM Kanban cards:**
- "SALES OFFICER" row now shows Primary SO name (falls back to SO Group's bound SO if no Primary set yet)

**Delivery Challan PDF:**
- S5 row shows Primary SO name + phone (falls back through 4-source cascade for legacy data)

**Sampling Library:**
- New entries created via TI auto-stamp the customer's current Primary SO
- Historical entries unchanged (frozen-record rule)

---

## 10. Smoke test results

All 8-step end-to-end smoke test passed on local dev:

| # | Test | Result |
|---|---|---|
| 1 | Login as admin | ✓ |
| 2 | GYANDIP SOC (Phase 3 test customer) shows Shivkumar = Primary | ✓ |
| 3 | SWASTIK FORESTAA (migrated) shows Ajay = Primary, auto-contact appears | ✓ |
| 4 | Brand-new customer — empty SO list with "+ Add Sales Officer" | ✓ |
| 5 | TM Kanban card shows Primary SO name | ✓ |
| 6 | Missing-customer resolver flow end-to-end | ✓ |
| 7 | Delivery Challan PDF shows Primary SO in S5 row | ✓ |
| 8 | Admin Customers list SO Group column unchanged | ✓ |

Plus Phase 7 migration verification (5 SQL queries) all green.

---

## 11. Approval gates honored

Across 8 phases, every diagnose → design → implement boundary was a checkpoint. No phase skipped its gate. Major design decisions (multi-SO data model, Primary SO behaviour, Phase 4 Q1/Q2/Q3, customer-table column choice) all approved by Smart Flow before code touched.

---

## 12. Consolidation notes (for CLAUDE_*.md context refresh)

When this draft consolidates into canonical context files:

- **`docs/CLAUDE_CORE.md` §2 (schema):** bump version to v27.4. Add `customer_sales_officers` and `CustomerSalesOfficerRole` enum. Add `delivery_point_contacts.linkedSalesOfficerId` column.
- **`docs/CLAUDE_CORE.md` §3 (engineering rules):** add the P2002 reconcile-loop pattern under "Partial unique indexes".
- **`docs/CLAUDE_TINT.md` §5.5:** rewrite to document the 4-source cascade.
- **`docs/CLAUDE_MAIL_ORDERS.md`:** note that missing-customer resolver now uses multi-SO list, Eager Sync, disabled ✕ on auto-contacts.
- **`docs/CLAUDE_UI.md`:** add the new ContactCard auto/manual visual treatment (teal/blue/amber avatar tints, "Auto · Role SO" badge style).
- **`docs/ROADMAP.md`:** add Phase 8 items as new entries (see §6 of this doc).

---

End of session-end doc.
