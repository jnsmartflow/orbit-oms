# Code Discovery — Flat `sku_master_v2`
# 2026-07-19 · Discovery only · No code, no DB writes, no schema changes
# Schema v27.10 · Read-only session

**Goal of the wider project (context only):** replace the old normalised `sku_master`
(+ its 3 FK helper tables) with a NEW FLAT table shaped like `mo_sku_lookup_v2`, pour v2
data into it, repoint modules, test, and — in a separate future session — drop the old
table and rename.

**This session:** discovery for that flat approach only. Design decision (flat, no FK
helper tables) is already made and is not re-litigated here.

**Out of scope:** `mo_sku_lookup` (v1) + the keyword tables. Not analysed, not touched.

---

## TASK 1 — v2 exact column shape (the baseline)

Source: `prisma/schema.prisma:1464-1482`, `model mo_sku_lookup_v2`.

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | `Int` | no | PK, `@default(autoincrement())`. Surrogate — not the business key. |
| **`material`** | `String` | no | **`@unique`** — the natural key. SAP material code as text. |
| `description` | `String` | no | Full product description. NOT NULL, **no DB default** — every insert must supply it. |
| `category` | `String` | no | Holds the v2 **family** name (`"TOOLS"`, `"GLOSS"`). |
| `product` | `String` | no | SAP-clean stock name. Join key ← `mo_order_form_index_v2.product`. |
| `baseColour` | `String` | no | Variant key, not necessarily a colour (`"90 BASE"`, `"MATT"`, `""` for TOOLS). |
| `packCode` | `String` | no | **TEXT, not the `PackCode` enum** — bare numeric strings (`"1"`, `"4"`, `"10"`, `"500"`, `"400"`, `"12"`, `"25"`). |
| `unit` | `String` | **yes** | `"L"` \| `"ML"` \| `"KG"` \| `"GM"` \| `"PC"`. The real type discriminator. |
| `refMaterial` | `String` | **yes** | Generic/master code paired against the Fini row. |
| `refDescription` | `String` | **yes** | Description for `refMaterial`. |
| `paintType` | `String` | **yes** | |
| `materialType` | `String` | **yes** | |
| `piecesPerCarton` | `Int` | **yes** | ~703 of 1,743 primary rows populated. Read by **no route** today. |
| `createdAt` | `DateTime` | no | `@default(now())`. |
| `isPrimary` | `Boolean` | no | `@default(true)`. False on duplicate twins (~130 rows). Both data routes filter `WHERE isPrimary = true`. |

Model-level: `@@map("mo_sku_lookup_v2")`. No `updatedAt`. No `@@index`. No composite
unique. **Zero Prisma relations** — fully standalone, which is exactly what makes it a
clean template.

**Natural key: `material`** (`String @unique`, NOT NULL). `id` is a surrogate PK.

---

## TASK 2 — Every reader of the OLD `sku_master`

Grepped: `sku_master`, `skuId`, `productCategory`, `productName`, `baseColour`,
`enrichedLineItem`, `product_category`, `product_name`, `base_colour`.

### 2a. Operational readers — the real repoint list

| # | Module | File · line | Fields read | Notes |
|---|---|---|---|---|
| 1 | **Picking** (mobile detail screen) | `app/api/picking/order/[orderId]/route.ts:63-68`, `:76`, `:78` | `sku.skuName`, `sku.packSize` | Via `enrichedLineItem.sku`. Falls back to `skuDescriptionRaw` / `null`. **The only picking route that touches it.** |
| 2 | **Import** — manual SAP preview | `app/api/import/obd/route.ts:684-688` | `skuCode` | Existence check only → `existingSkuSet`. |
| 3 | **Import** — manual SAP confirm | `app/api/import/obd/route.ts:1055-1058` | `id`, `skuCode` | Builds `skuByCode` map. |
| 4 | **Import** — enrichment write (manual) | `app/api/import/obd/route.ts:1327` | writes `skuId: sku?.id ?? null` | The FK write. `lineWeight: sku ? 0 : null`. Unknown SKU → `note: "Unknown SKU — manual mapping required"`. |
| 5 | **Import** — auto preview | `app/api/import/obd/route.ts:1455-1459` | `skuCode` | Existence check. |
| 6 | **Import** — auto pre-check | `app/api/import/obd/route.ts:2519-2523` | `skuCode` | Existence check. |
| 7 | **Import** — auto confirm | `app/api/import/obd/route.ts:2861-2864` | `id`, `skuCode` | Builds `confirmSkuByCode`. |
| 8 | **Import** — enrichment write (auto) | `app/api/import/obd/route.ts:3125` | writes `skuId: sku?.id ?? null` | Mirror of #4. |
| 9 | **Orders** — removed-lines API | `app/api/orders/[id]/removed-lines/route.ts:59-64`, `:70-71` | `sku.skuCode`, `sku.skuName` | Via `enrichedLineItem.sku`. Falls back to raw. Feeds the TM removed-lines view. |
| 10 | **Admin dashboard** | `app/(admin)/admin/page.tsx:25` | `count({ where: { isActive: true } })` | Count tile only — **the only live consumer of `isActive`**. |

### 2b. Admin CRUD surface — the normalised UI (retires with the old table)

These exist to maintain the normalised design via form dropdowns. Per the decision
already made (single admin maintains the catalog by SQL/CSV), this whole surface is what
the flat table is meant to make unnecessary.

| # | File · line | Fields | Notes |
|---|---|---|---|
| 11 | `app/api/admin/skus/route.ts:62-70` | GET list, `include` = `productCategory.name` / `productName.name` / `baseColour.name` | **Uses `prisma.$transaction`** (CORE §3 violation, pre-existing). |
| 12 | `app/api/admin/skus/route.ts:90`, `:95` | POST create — requires `productCategoryId`, `productNameId`, `baseColourId` | Zod schema `:12-22`. |
| 13 | `app/api/admin/skus/[id]/route.ts:45`, `:51` | PATCH — uniqueness check on `skuCode`, then update | |
| 14 | `app/api/admin/skus/import/route.ts:83` | CSV `createMany` | Maps category/productName/baseColour **names → FK ids**; rejects the row if any name is unknown (`:64-66`). This friction is precisely the flat table's justification. |
| 15 | `app/(admin)/admin/skus/page.tsx:24`, `:29` | list + count + 3 helper tables | |
| 16 | `app/(support)/support/skus/page.tsx:23-27` | same | Same `SkusTable` component. |
| 17 | `app/(tint)/tint/manager/skus/page.tsx:23-24` | same | |
| 18 | `app/(dispatcher)/dispatcher/skus/page.tsx:23-24` | same | |
| 19 | `components/admin/skus-table.tsx:265` | `sku.productCategory.name` | Display. |
| 20 | `components/admin/sku-sheet.tsx:22-26`, `:97-171`, `:249-268` | full FK dropdown form | Cascading category → product-name fetch. |
| 21 | `app/api/admin/skus/[id]/sub-skus/route.ts:7`, `:14` | — | Dead endpoint, returns an error string only ("removed in schema v10"). |

### 2c. Scripts (not live)

| # | File · line | Fields | Notes |
|---|---|---|---|
| 22 | `scripts/normalise-sampling-data.ts:313` | `skuCode` | Offline sampling normalisation. Not a runtime path. |
| 23 | `scripts/_diagnose-sku-5961032.ts:9`, `:58` | `skuCode`, `packSize` | Scratch (underscore-prefixed → excluded from `tsc`). The 44%-missing-codes diagnostic behind `CLAUDE_PICKING.md §7`. |

### 2d. CONFIRMED NON-READERS — checked in code, not assumed

| Module | Verdict | Evidence |
|---|---|---|
| **Tint Manager** | **Does NOT read `sku_master`** | `app/api/tint/manager/orders/route.ts` — zero hits. |
| **Tint Operator** | **Does NOT read `sku_master`** | ⚠️ The `skuId` identifiers throughout tint code are a **false positive** — they alias `rawLineItemId`, not a `sku_master.id`. Proof: `components/tint/tint-operator-content.tsx:2479` and `:2503` — `skuId: li.rawLineItemId as number`. Same in `PauseJobModal.tsx`, `MarkDoneConfirmModal.tsx`, `api/tint/operator/pause`, `api/tint/operator/done`. **Do not repoint any of these.** |
| **Delivery Challan** | **Does NOT read `sku_master`** | Reads `import_raw_line_items` + the two TI tables (`CLAUDE_TINT.md §9.10`). |
| **Sampling Library** | **Does NOT read `sku_master`** (live) | Only the offline script #22. See correction below. |
| **Support board** | **Does NOT read `sku_master`** | The one hit under `app/(support)/` is the shared admin SKU browse page (#16), not the Support board. |
| **Warehouse** | Zero hits | |
| **Trip Report** | Zero hits | Standalone NTS mirror, no catalog join. |
| **Picking** — queue / assign / unassign / done / approve | Zero hits | Only the detail route (#1). `lib/picking/queue.ts` builds rows from `orders` + `querySnapshot`. |
| `lib/import-upsert/**` | Zero hits | The upsert brain never touches the catalog; enrichment happens in the route. |

### 2e. Two documentation corrections this trace surfaced

1. **`CLAUDE_SAMPLING_LIBRARY.md §3` (Phase 3) is wrong on two counts.** It names
   "`sku_master.materialCode`" as the source of truth for SKU normalisation.
   (a) There is no `materialCode` column — the column is `skuCode`.
   (b) No live Sampling Library code reads `sku_master` at all; the only reader is the
   offline script `scripts/normalise-sampling-data.ts`. Fix in a docs pass.

2. **The blast radius is much smaller than the module list implies.** Only **3 live
   feature areas** read the catalog: Picking detail, Import enrichment, and the
   removed-lines API — plus one `isActive` count tile. Everything else is the admin CRUD
   surface that the flat design retires anyway.

---

## TASK 3 — Field-need check against v2

Distinct fields the readers actually pull, checked against Task 1's column list.

| Needed field | In v2? | v2 column | Action |
|---|---|---|---|
| `skuCode` (the SAP code) | ✅ yes | **`material`** | **NAME BRIDGE.** Every reader says `skuCode`; v2 says `material`. Codes themselves never change. |
| `skuName` (display name) | ✅ yes | **`description`** | **NAME BRIDGE.** Picking detail (#1) + removed-lines (#9). |
| `id` (Int, FK target for `skuId`) | ✅ yes | `id` | Keep as-is. See PK call in Task 4. |
| `packSize` (e.g. `"1LT"`, `"500ML"`) | ⚠️ **partial** | `packCode` + `unit` | **SHAPE MISMATCH — the one real structural gap.** Old table stores ONE display string; v2 stores TWO fields (`"1"` + `"L"`). Picking detail (#1) renders `packSize` directly into the pack tile. Needs either a derivation at read time or a stored label column. See Task 4. |
| `isActive` (lifecycle: retired?) | ❌ **NO** | — | **GAP.** v2 has no lifecycle flag. Read live by the admin dashboard count (#10). |
| `unitsPerCarton` | ✅ yes | `piecesPerCarton` | **NAME BRIDGE.** Not read by any live route today — carried for parity. |
| `containerType` (`tin`/`drum`/`carton`/`bag`) | ❌ no | — | **GAP, but admin-CRUD-only** (#11-#14, #20). No operational reader. Recommend dropping — do not carry dead columns forward. |
| `productCategory.name` | ✅ yes (flat) | `category` | FK→text. Admin CRUD only. |
| `productName.name` | ✅ yes (flat) | `product` | FK→text. Admin CRUD only. |
| `baseColour.name` | ✅ yes (flat) | `baseColour` | FK→text. Admin CRUD only. |

### Summary

- **3 pure name bridges:** `skuCode`→`material`, `skuName`→`description`,
  `unitsPerCarton`→`piecesPerCarton`. No data problem, only a rename at the read sites.
- **1 real shape gap:** `packSize` (one string) vs `packCode`+`unit` (two fields).
- **1 real missing concept:** `isActive`.
- **1 column to retire:** `containerType`.
- **The 3 FK helper tables collapse into 3 plain text columns** that v2 already has —
  this is the whole win, and it needs no new columns.

---

## TASK 4 — Proposed flat column list for `sku_master_v2`

FLAT. No FKs, no helper tables.

| # | Column | Type | Nullable | Source |
|---|---|---|---|---|
| 1 | `id` | `Int` | no | copied from v2 — PK, autoincrement |
| 2 | **`material`** | `String` | no | copied from v2 — **`@unique`, the natural key** |
| 3 | `description` | `String` | no | copied from v2 (serves old `skuName`) |
| 4 | `category` | `String` | no | copied from v2 (replaces `product_category` FK) |
| 5 | `product` | `String` | no | copied from v2 (replaces `product_name` FK) |
| 6 | `baseColour` | `String` | no | copied from v2 (replaces `base_colour` FK) |
| 7 | `packCode` | `String` | no | copied from v2 |
| 8 | `unit` | `String` | yes | copied from v2 |
| 9 | `refMaterial` | `String` | yes | copied from v2 |
| 10 | `refDescription` | `String` | yes | copied from v2 |
| 11 | `paintType` | `String` | yes | copied from v2 |
| 12 | `materialType` | `String` | yes | copied from v2 |
| 13 | `piecesPerCarton` | `Int` | yes | copied from v2 (serves old `unitsPerCarton`) |
| 14 | `isPrimary` | `Boolean` | no | copied from v2, default `true` |
| 15 | **`isActive`** | `Boolean` | no | **NEW — for admin dashboard (#10) + lifecycle**, default `true` |
| 16 | `createdAt` | `DateTime` | no | copied from v2, default `now()` |
| 17 | **`updatedAt`** | `DateTime` | yes | **NEW — recommended.** v2 has none; a catalog maintained by hand-run SQL/CSV wants a "when did this last change". Cheap now, painful to add later. |

**Not carried forward:** `containerType` (admin-CRUD-only, no operational reader),
`packSize` (see below), and the 3 FK id columns.

### Decision 1 — Does it need BOTH `isPrimary` and `isActive`? **Yes.**

They answer genuinely different questions and conflating them loses information:

- **`isPrimary`** = *"is this the row to show when two SKUs are the same product?"* — a
  **duplicate/dedupe** concern. ~130 twin rows. Both order-entry data routes filter on it.
- **`isActive`** = *"does this SKU still exist as sellable stock?"* — a **lifecycle**
  concern. A discontinued SKU is not a duplicate of anything.

⚠️ **Flag for the pour, not a schema question:** the TOOLS 645xxxx→647xxxx re-code
(`CLAUDE_PLACE_ORDER.md §14`) switched off the old series using `isPrimary = false`,
because `isActive` did not exist on v2. So **some existing `isPrimary = false` rows
actually mean "discontinued", not "duplicate twin"** — the two concepts are already
conflated in the live v2 data. Splitting them correctly during the pour is a data
question that needs a decision (25 TOOLS rows are the known case). Carrying the conflation
into the new table silently would be the easy mistake.

### Decision 2 — `id` vs `material` as PK? **Keep surrogate `id` Int PK + `material` unique.**

Recommending the v2 pattern unchanged, for one concrete reason:

`import_enriched_line_items.skuId` is an **`Int?` FK** (`schema.prisma:597-598`), written
at two import sites (#4, #8). Keeping an `Int` `id` makes the repoint a **pointer swap**
on an existing Int column. Making `material` the PK would force `skuId` to become a
`String` — a column-type migration on the largest table in the import pipeline, plus every
enrichment read/write, for zero functional gain.

`material` stays the natural key and the join key for humans and SQL; `id` stays the
machine pointer. This is exactly how v2 already works.

### Decision 3 — the `packSize` gap: **derive, do not store.** (Lower confidence — your call.)

Only **one** live reader needs a display pack string: the picking detail screen (#1,
`pack: sku.packSize`). Two options:

- **(A) Recommended — derive at read time** from `packCode` + `unit`. A formatter already
  exists (`formatPack` in `lib/place-order/pack.ts`, `CLAUDE_PLACE_ORDER.md §9`) and is
  already the app-wide convention for turning exactly these two fields into a label. One
  call site changes. No denormalised duplicate to drift.
- **(B) Store a `packLabel` column.** Zero code thinking at read time, but it duplicates
  data that `packCode`+`unit` already fully determine, and it will drift the first time
  someone edits one and not the other.

I recommend **(A)**, but flagging it as the least-certain item here: it is the only
proposal that adds a code change to a repoint that is otherwise a pure rename, and if you'd
rather the repoint touch nothing but table/column names, **(B)** is the safer-shaped call
even though it stores redundant data.

### One open question, not resolved this session

The old `sku_master` is **~56% populated** and — per `CLAUDE_PICKING.md §7` — **222 of 500
sampled non-`IN`-prefixed SAP codes (44%) are missing from it entirely**. Pouring v2 in
will change *which* codes resolve during import enrichment. That is the intended
improvement, but it means the first import after the repoint will enrich a materially
different set of lines than the day before. Worth a before/after count as part of the
test-a-few-days step — not a blocker, but not a silent change either.

---

**Awaiting Smart Flow's column approval.**

---

*Discovery only · No code written · No DB writes · No schema changes · 2026-07-19*
