# code-update-2026-07-16 — Customer intake: two-table reality + CORE §7 corrections

**Target canonical files:** `CLAUDE_CORE.md` §7 (customer master), `CLAUDE_PLACE_ORDER.md` §8 (join mechanism)
**Session type:** discovery + data work (SQL only, no code changes)

---

## 1. CORRECTION — order surfaces do NOT read `delivery_point_master`

**Docs implied the customer master feeds the order pages. It does not.**

All three order surfaces read their customer list from **`mo_customer_keywords`**, a separate flat table:

| Surface | File | Line |
|---|---|---|
| Desktop `/place-order` | `app/api/place-order/data/route.ts` | 55-62 |
| Mobile `/po` + `/order` | `app/api/order/data/route.ts` | 33-36 |

Both run `prisma.mo_customer_keywords.findMany({ select: { customerCode, customerName, area }, orderBy: { customerName: "asc" } })`, then a dedup loop (place-order 106-119, order 65-78) collapses to one entry per `customerCode`, keeping the first `customerName` and back-filling `area` from a later row if the first was null.

**Neither route touches `delivery_point_master` at all.**

### Consequence — the two-address-book rule

A customer needs a row in **BOTH** tables:

- `mo_customer_keywords` → makes them **searchable** in `/po`, `/place-order`, `/order`
- `delivery_point_master` → the **official record** (admin CRUD, FK-linked area/route/type; used by tint, challans, reports)

Master-only = invisible to the sales team. Keyword-only = no official record.

**This is a live, recurring gap.** SAP/import creates `delivery_point_master` rows without keyword rows, so customers exist officially but can't be found in order entry. Audit query:

```sql
SELECT dpm."customerCode", dpm."customerName", am.name AS area
FROM delivery_point_master dpm
LEFT JOIN area_master am ON am.id = dpm."areaId"
WHERE dpm."isActive" = true
  AND dpm."customerTypeId" IN (SELECT id FROM customer_type_master WHERE name ILIKE 'dealer')
  AND NOT EXISTS (
    SELECT 1 FROM mo_customer_keywords k WHERE k."customerCode" = dpm."customerCode"
  )
ORDER BY dpm."customerName";
```

(Drop the `customerTypeId` clause to include Sites; shop-only is usually what's wanted — Sites are construction projects and vastly outnumber shops.)

---

## 2. `mo_customer_keywords` — real shape

| Column | Type | NOT NULL | Default |
|---|---|---|---|
| id | Int | yes | autoincrement (PK) |
| customerCode | String | yes | — |
| customerName | String | yes | — |
| area | String? | no | — |
| deliveryType | String? | no | — |
| route | String? | no | — |
| keyword | String | yes | — |
| createdAt | DateTime | yes | now() |

**LANDMINE — no unique constraint on `customerCode`.** Not `@unique`, no `@@unique`. Many rows per code are legal by design (one per keyword). Therefore:

- **`ON CONFLICT ("customerCode")` is unusable** — Postgres needs a real unique/exclusion constraint on the conflict target.
- Guard inserts with `WHERE NOT EXISTS (SELECT 1 FROM mo_customer_keywords WHERE "customerCode" = ...)` instead.

**`keyword` is NOT NULL but unused by the order search.** Neither data route selects it (nor `deliveryType`/`route`). It presumably feeds the mail-order enrichment matcher. Fill it with the customer name so the insert is valid.

**Minimum for findability:** `customerCode` + `customerName`. `area` is the only extra field displayed (grey `· {area}` suffix on customer rows, per PLACE_ORDER §15.4). `deliveryType` and `route` have **zero visible effect** on these three surfaces — but existing rows populate them consistently, so match the pattern.

**Search is client-side.** Neither route filters server-side; both return the full deduped table and matching happens in the browser on whatever the payload carries.

---

## 3. `delivery_point_master` — corrections

### 3a. CORRECTION — `deliveryTypeOverride` does not exist

CORE §7.1 names a `deliveryTypeOverride` column. **Not in the live schema.** The real columns are two separate FKs:

- `dispatchDeliveryTypeId` Int? → `delivery_type_master.id`
- `reportingDeliveryTypeId` Int? → `delivery_type_master.id`

### 3b. Area / route / type are FK ids, not text

| Concept | Column | Target | Notes |
|---|---|---|---|
| Area | `areaId` Int **NOT NULL** | `area_master.id` | name col `name`, **not** `@unique` |
| Sub-area | `subAreaId` Int? | `sub_area_master.id` | scoped by areaId, not globally unique |
| Route | `primaryRouteId` Int? | `route_master.id` | `name` is `@unique` |
| Delivery type | `dispatchDeliveryTypeId`, `reportingDeliveryTypeId` Int? | `delivery_type_master.id` | `name` is `@unique` |

`delivery_type_master` ids (stable): **1=Local, 2=Upcountry, 5=IGT, 6=Cross**.

### 3c. Required columns for a raw INSERT

NOT NULL with no default: **`customerCode`** (the only unique besides id — usable for ON CONFLICT), **`customerName`**, **`areaId`**.

Everything else is nullable or Prisma-defaulted (`isKeyCustomer`/`isKeySite` false, `acceptsPartialDelivery`/`isActive` true, `createdAt` auto).

### 3d. LANDMINE — `updatedAt` is NOT NULL with NO db default

Prisma stamps `updatedAt` via `@updatedAt`. **Raw SQL bypasses Prisma, so the column stays null and Postgres rejects the insert:**

```
ERROR: 23502: null value in column "updatedAt" of relation
"delivery_point_master" violates not-null constraint
```

**Every hand-written INSERT/UPDATE to `delivery_point_master` must set `"updatedAt" = now()` explicitly.** Hit live this session. `createdAt` is fine — it has a db-level `now()` default.

### 3e. `noDeliveryDays`

`String[]`, `is_nullable = YES`, **no db default** (confirmed via `information_schema`). Every code path supplies `[]` explicitly. Raw inserts should set `'{}'`.

### 3f. Intake reference paths

- `app/api/admin/customers/route.ts` POST — manual create. Zod-validated, 409 on duplicate code, trims+uppercases `customerCode`, nested contact create. Also backfills orphaned `orders` rows (`shipToCustomerId = customerCode AND customerId IS NULL`) → sets `customerId`, clears `customerMissing`.
- `app/api/admin/customers/import/route.ts` POST — CSV bulk. Resolves `areaName`/`routeName`/`deliveryTypeName`/etc. to ids via case-insensitive name maps, upserts by `customerCode`, **fully replaces** `delivery_point_contacts` (delete-then-recreate). `customerRating` accepts A/B/C else null.

---

## 4. LANDMINE — area name matching (double-h)

`ILIKE '%varacha%'` **misses** `Varachha`. Gujarati area names commonly carry a doubled consonant. Use the shortest safe stem: `'%varach%'`.

These are **four distinct areas**, not duplicates:

| id | name |
|---|---|
| 211 | Mota Varachha |
| 217 | Nana Varachha |
| 231 | New Varachha Road |
| 353 | Varachha |

Cost this session: a customer was nearly repointed to the wrong area because the first search pattern hid the correct one. **Always widen the pattern and eyeball the full match list before picking an `areaId`.**

Related: `area_master.name` has no unique constraint, so near-duplicate names can legitimately coexist. Check the full result set, never take the first hit.

---

## 5. Reusable template

New file: **`docs/sql-templates/customer-intake.sql`**

Fill-in-the-blanks runbook for future customer adds. Encodes: STEP 1 lookup (area/route/type ids + existence check) → STEP 2 keyword insert → STEP 3 master insert/update → STEP 4 verify both tables. All four landmines above are baked in as header comments.

Supersedes the need for a diagnosis session per customer add.

---

## 6. Data work completed this session

- **106058 Shivshakti HW** — keyword area `MOTA VARACHHA` → `VARACHA`; master repointed `areaId` 211 → **353** (Varachha).
- **18 shops** added to `mo_customer_keywords` (were master-only, unfindable in search).
- **33 shops** added to `delivery_point_master` (were keyword-only or absent).
- Earlier batch: 3560896 Nilkanth (Ashtagam/Chikhli), 106382 Meenaz (Bharuch), 3590607 Arham (Althan), 3554516 Jay Khodiyar (Mota Varachha) — all were already in master, missing only keyword rows.
- Skipped as junk (Dealer-typed but not real shops): `DUMMY` (code 0), `Employee Billing` (899371), `Q53D Institution` (899199), `Q53D SLOB CUSTOMER` (899460).

### Parked → ROADMAP

- **Disha Paint & Hardware (3258444)** and **Nitin Sales (501966)** — blank area in the NTS source. `delivery_point_master.areaId` is NOT NULL, so neither can enter the master until an area is supplied. Keyword rows also not created (kept consistent).
