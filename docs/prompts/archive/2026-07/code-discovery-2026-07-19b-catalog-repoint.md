# Code Discovery — Catalog Repoint to `sku_master_v2`
# 2026-07-19b · DIAGNOSIS ONLY · No code, no schema edit, no DB writes
# Schema v27.11 · Verified read-only against production

**Question this session had to settle:** `import_enriched_line_items.skuId` is an
`Int?` FK to `sku_master.id`. `sku_master_v2` was poured with FRESH serial ids. Can we
repoint the FK, and what happens to the 8,852 historical pointers?

**Answer, up front: DO NOT repoint the FK.** Not a single existing pointer survives the
swing — verified, not reasoned. Recommendation is **Option B** (resolve by `material`,
leave the FK alone). Detail below.

---

## 0. HEADLINE FINDING — the id spaces share nothing

Read-only verification (`scripts/_diagnose-skuid-collision.ts`, count/findMany only):

```
import_enriched_line_items total      : 9,902
  with skuId NOT NULL (live pointers) : 8,852
  with skuId NULL (never enriched)    : 1,050

sku_master (OLD) rows                 : 1,051
sku_master_v2 (NEW) rows              : 1,743

=== ID-SPACE COMPARISON (old id -> what lives at that id in NEW) ===
  same id, SAME material code  :   0
  same id, DIFFERENT material  : 477   <-- silent mispoint
  old id absent from new table : 574   <-- FK would break
```

**Zero.** Not "a few collisions" — there is *no* id at which both tables hold the same
material code. The pour ordered rows by `mo_sku_lookup_v2`'s own sequence, which has no
relationship to the order `sku_master` was built in over the preceding years.

Weighted by actual live pointers (5,000 most recent enriched rows, cross-checked against
each row's true SAP code via `rawLineItem.skuCodeRaw`):

```
  pointer would still be CORRECT :     0
  pointer would MISPOINT         : 2,065
  pointer would DANGLE (no row)  : 2,935
```

Concrete samples — what a naive FK repoint would silently do:

| enriched id | `skuId` | TRUE SAP code (from raw line) | New table would say |
|---|---|---|---|
| 9901 | 1422 | `IN28916271` | `5906723` |
| 9897 | 1396 | `IN28905771` | `5838855` |
| 9896 | 1236 | `5908365` | `5948192` |
| 9895 | 1433 | `IN28045671` | `IN27309677` |
| 9894 | 1688 | `5579817` | `IN27309072` |

These are not near-misses. `IN28916271` is a different *product* from `5906723`. A
repoint without remapping turns every historical enriched line into a confidently-wrong
product name and pack size on the picking detail screen and the removed-lines view.

---

## 1. FK DECLARATION

`prisma/schema.prisma:593-605`:

```prisma
model import_enriched_line_items {
  id            Int                   @id @default(autoincrement())
  rawLineItemId Int                   @unique
  rawLineItem   import_raw_line_items @relation(fields: [rawLineItemId], references: [id])
  skuId         Int?
  sku           sku_master?           @relation(fields: [skuId], references: [id])   // <-- UNNAMED
  ...
}
```

Back-relation, `sku_master` (`:246`): `enrichedLineItems import_enriched_line_items[]`.

DB-level constraint: `import_enriched_line_items_skuId_fkey` → `sku_master(id)`
(`prisma/migrations/phase2_schema_v11.sql:130-133`), made nullable later by
`prisma/migrations/make_enriched_sku_optional.sql`.

### Named-relation implication (CORE §3 / §7.3) — **NOT triggered**

Worth stating precisely, because the rule is easy to over-apply. The dual-relation trap
fires when **one model holds two relations to the SAME table** (the `orders` →
`delivery_point_master` case: `customer` + `shipToOverrideCustomer`, both needing
explicit `@relation` names on both sides).

Here, `import_enriched_line_items` → `sku_master` and → `sku_master_v2` would be
relations to **two different models**. Prisma disambiguates by target type; no explicit
names are required, and each target model still carries exactly one back-relation. This
holds whether we *replace* the relation or run *both* side by side during a transition.

So the named-relation rule does not constrain this work. **The FK's danger here is not
Prisma ambiguity — it is the id-space mismatch in §0.**

---

## 2. HOW ENRICHMENT LOOKS UP TODAY — all call sites

All in `app/api/import/obd/route.ts`. Every read is keyed by `skuCode` (the material).
**No read anywhere looks up by internal id.**

| # | Call site | Path | Reads by | Selects | Writes | Consumed at |
|---|---|---|---|---|---|---|
| 1 | `:684-688` | manual SAP preview | `skuCode IN (...)` | `skuCode` | — | `:795` warning gate (`existingSkuSet`) |
| 2 | `:1055-1058` | manual SAP confirm | `skuCode IN (...)` | `id`, `skuCode` | — | `:1062` → `skuByCode` map |
| 3 | `:1327` | manual enrichment write | — | — | **`skuId: sku?.id ?? null`** | via `:1324` `skuByCode.get(line.skuCodeRaw)` |
| 4 | `:1455-1459` | auto preview | `skuCode IN (...)` | `skuCode` | — | `:1496` warning gate |
| 5 | `:2519-2523` | auto pre-check | `skuCode IN (...)` | `skuCode` | — | `:2621` warning gate |
| 6 | `:2861-2864` | auto confirm | `skuCode IN (...)` | `id`, `skuCode` | — | `:2868` → `confirmSkuByCode` map |
| 7 | `:3125` | auto enrichment write | — | — | **`skuId: sku?.id ?? null`** | via `:3122` `confirmSkuByCode.get(...)` |

**Shape of the dependency:**

- **4 of 6 reads (#1, #4, #5) select `skuCode` ONLY** — they build a `Set<string>` used
  purely as a *warning gate* ("Unknown SKU — manual mapping required"). They never touch
  an id. Repointing these is a one-word table-name swap plus `skuCode:` → `material:`.
- **2 reads (#2, #6) select `id` alongside `skuCode`** solely to feed the two write sites.
- **2 writes (#3, #7) are the ONLY places an internal id enters the data.**

So the entire id coupling in the import pipeline is **two lines**: `:1327` and `:3125`.

**CORE §3 check:** #2 and #6 sit inside `Promise.all([...])` (`:1043`, `:2849`), **not**
`prisma.$transaction`. Compliant — verified by reading, no remediation needed. (Contrast
`app/api/admin/skus/route.ts:61` which *does* use `$transaction` — pre-existing, out of
scope here.)

**Quirk worth noting, not fixing:** `lineWeight: sku ? 0 : null` (`:1329`, `:3127`) —
a resolved SKU stores weight `0`, an unresolved one stores `null`. The comment at `:1320`
explains it: `sku_master.grossWeightPerUnit not yet in schema`. `sku_master_v2` has no
weight column either, so this behaviour is unchanged by any repoint.

---

## 3. HOW PICKING + REMOVED-LINES READ TODAY

**Both ride the FK relation. Neither queries the catalog independently.**

### Picking detail — `app/api/picking/order/[orderId]/route.ts:56-80`

```ts
const rawLines = await prisma.import_raw_line_items.findMany({
  where: { obdNumber: order.obdNumber, lineStatus: "active" },
  select: {
    id: true, skuCodeRaw: true, skuDescriptionRaw: true, unitQty: true,
    enrichedLineItem: { select: { sku: { select: { skuName: true, packSize: true } } } },
  },
  ...
});
const lines = rawLines.map((l) => ({
  name: l.enrichedLineItem?.sku?.skuName ?? l.skuDescriptionRaw ?? null,   // :76
  sku:  l.skuCodeRaw,                                                      // :77 <-- raw, not catalog
  pack: l.enrichedLineItem?.sku?.packSize ?? null,                         // :78
  qty:  l.unitQty,
}));
```

Needs exactly **two** catalog fields: `skuName`, `packSize`. Note `:77` — the SKU code
shown to the picker already comes from `skuCodeRaw`, **not** the catalog. The catalog is
only decorating the row with a nicer name and a pack label.

### Removed-lines — `app/api/orders/[id]/removed-lines/route.ts:59-71`

```ts
enrichedLineItem: { select: { lineWeight: true, sku: { select: { skuCode: true, skuName: true } } } },
...
skuCode:        r.enrichedLineItem?.sku?.skuCode ?? r.skuCodeRaw,      // :70
skuDescription: r.enrichedLineItem?.sku?.skuName ?? r.skuDescriptionRaw ?? "—",  // :71
```

Needs `skuCode`, `skuName`. Both already fall back to the raw SAP values.

**The critical consequence:** because both readers traverse `skuId` → `sku`, they inherit
whatever the FK points at. If the FK is repointed without remapping, **these two screens
are exactly where the §0 corruption becomes visible** — a picker sees a confidently wrong
product name and pack size on a real bill. That is worse than the current blank, which at
least reads as "unknown" (`CLAUDE_PICKING.md §7` treats a blank pack as a mis-pick
*preventer*).

---

## 4. THE SAFE PATH — recommend **Option B**

### Option A — repoint the FK, write new ids ❌ NOT RECOMMENDED

Requires, in one indivisible change:
1. Swing the Prisma relation + the DB `FOREIGN KEY` constraint to `sku_master_v2`.
2. Rewrite `:1327` / `:3125` to write new-table ids.
3. **A mandatory backfill remap of all 8,852 historical rows** — re-resolve each row's
   correct new id via `rawLineItem.skuCodeRaw` → `sku_master_v2.material`. Skipping this
   is not "slightly stale data", it is 100% wrong data (§0).
4. Handle the 2,935-in-5,000 rows whose codes have **no** row in the new table — they must
   be nulled, not left dangling.

And the DB constraint creation itself will **ERROR** while dangling ids exist, so the
backfill must complete *before* the constraint swings — a strict multi-step ordering with
a window where code and data disagree. This is a migration, not a repoint.

### Option B — resolve by `material`, leave the FK untouched ✅ RECOMMENDED

Readers stop traversing `skuId` and instead resolve `sku_master_v2` **by `material`**,
matched against `import_raw_line_items.skuCodeRaw` — which every raw line already carries,
is never null, and is the stable natural key identical across both tables.

- **Import enrichment:** point the 4 warning-gate reads (#1, #4, #5 — and #2/#6's
  `skuCode` half) at `sku_master_v2.material`. Leave `:1327` / `:3125` writing the OLD
  id, or write `null` — decide separately; either is safe because nothing will read it.
- **Picking detail + removed-lines:** replace the `enrichedLineItem.sku` traversal with a
  batched lookup keyed on the `skuCodeRaw` values already selected. One extra `findMany`
  per request, sequential await (CORE §3), no `$transaction`.

**Why it is safer, concretely:**

| | Option A | Option B |
|---|---|---|
| Historical rows at risk | 8,852 | **0** |
| Backfill required | Yes, mandatory | **None** |
| DB constraint change | Yes (ordering-sensitive, can error) | **None** |
| `schema.prisma` change | Yes | **None** |
| Old `sku_master` | Becomes stale/wrong-by-reference | Untouched, still valid |
| Rollback | Revert code + reverse the backfill | **`git revert` one commit** |
| Blast radius if wrong | Silent wrong product on a live picking bill | Falls back to raw SAP text |

Option B also makes the eventual deletion of `sku_master` trivial: once nothing traverses
the relation, dropping the old table and its 3 FK helpers is a schema-only change with no
data migration. Option A would have to be *undone* first.

**One honest cost of Option B:** `skuId` becomes a vestigial column — written but never
read. That is mild untidiness, and it is precisely what makes rollback free. Clean it up
in the same future session that drops `sku_master`, not now.

---

## 5. HISTORICAL DATA — explicit verdict

> **Do existing `skuId` values still resolve correctly after a repoint?**
> **NO. Zero of them do.** 0 correct / 2,065 mispointing / 2,935 dangling in a 5,000-row
> sample; 0 same-id-same-code across the entire 1,051-row id space. Evidence in §0.

**Under Option B this question is moot** — the FK is not repointed, `sku_master` is not
modified, and `skuId` keeps pointing at exactly the row it always did. **No backfill, no
remap, no historical risk.** This is the single strongest argument for Option B.

---

## 6. ⚠️ COVERAGE CLAIM CORRECTION — read before deciding

The session brief describes `sku_master_v2` as **"~99% coverage"**. Measured against what
the import pipeline actually encounters, it is not:

```
=== COVERAGE (distinct ACTIVE raw SAP codes: 1,152) ===
  resolvable in OLD sku_master   : 660  (57%)
  resolvable in NEW sku_master_v2: 843  (73%)
  in NEITHER                     : 309  (27%)
```

The ~99% figure comes from `CLAUDE_MAIL_ORDERS.md §4.1` — Table C's coverage of
**app-format email lines**, a different population entirely. Against real SAP import
codes the gain is **57% → 73% (+183 distinct codes)**.

That is a genuine, worthwhile improvement and it does not change the recommendation. But
**309 codes (27%) will still resolve to nothing**, so:
- The picking detail blank-pack symptom (`CLAUDE_PICKING.md §7`) is **reduced, not
  eliminated**. Do not close that landmine on the back of this work.
- "Unknown SKU — manual mapping required" notes will keep appearing.
- Anyone expecting near-total resolution after the repoint will read the result as a
  failure. Set the expectation before shipping.

---

## 7. PER-SPOT CHANGE LIST (for the implementation session)

| # | File · line | Change under Option B |
|---|---|---|
| 1 | `app/api/import/obd/route.ts:684-688` | `sku_master`→`sku_master_v2`; `skuCode`→`material` |
| 2 | `:1055-1058` | same; drop `id` from select (unused once #3 settled) |
| 3 | `:1327` | leave as-is OR write `null` — decide; nothing reads it |
| 4 | `:1455-1459` | `sku_master`→`sku_master_v2`; `skuCode`→`material` |
| 5 | `:2519-2523` | same |
| 6 | `:2861-2864` | same; drop `id` from select |
| 7 | `:3125` | mirror of #3 |
| 8 | `app/api/picking/order/[orderId]/route.ts:56-80` | drop `enrichedLineItem.sku` traversal; batch-resolve `sku_master_v2` by `material` ∈ the page's `skuCodeRaw` set; map `description`→name, `packCode`+`unit`→pack |
| 9 | `app/api/orders/[id]/removed-lines/route.ts:59-71` | same pattern; `material`→`skuCode`, `description`→`skuName` |
| 10 | `app/(admin)/admin/page.tsx:25` | `sku_master.count({where:{isActive:true}})` → `sku_master_v2` (new table has `isActive`, semantics now correct) |

**Field bridges** (from the 2026-07-19 discovery): `skuCode`→`material`,
`skuName`→`description`, `packSize`→ derive from `packCode`+`unit` via `formatPack`
(`lib/place-order/pack.ts`). **`isPrimary` is NOT a filter here** — enrichment must resolve
*any* real SAP code, including a duplicate twin. Filtering `isPrimary=true` would
re-introduce resolution gaps. Only the order-entry surfaces filter on it.

**Do not touch:** Tint Manager, Tint Operator, Delivery Challan, Sampling Library, Support
board, Warehouse, Trip Report — all confirmed zero readers of `sku_master`. The `skuId`
identifiers in tint code alias `rawLineItemId`, not a catalog id
(`components/tint/tint-operator-content.tsx:2479`).

---

## 8. ROLLBACK IN ONE COMMIT

Because Option B changes **only route files** — no `schema.prisma`, no DB constraint, no
data — rollback is:

```
git revert <commit>   &&   git push origin main
```

Vercel redeploys and behaviour is byte-identical to today. Nothing to un-backfill, no
constraint to swing back, no window where code and data disagree. `sku_master` and every
`skuId` value remain untouched throughout, so the old path is always intact underneath.

Ship it as **one commit touching those 4 files**, so the revert is a single operation. If
it is split across commits, a partial revert could leave picking reading the new table
while enrichment still gates on the old one — inconsistent, though still not corrupting.

---

## 9. OPEN ITEMS (not blockers)

- **`skuId` write decision** (#3/#7) — keep writing old ids, or write `null`? Keeping them
  preserves an audit trail and keeps rollback trivial; nulling starts decommissioning the
  column. Recommend **keep as-is** for this pass; revisit when `sku_master` is dropped.
- **309 unresolvable codes** — worth a follow-up: are they genuinely obsolete, or just
  never mastered? Needs Chandresh/depot input (already flagged in `CLAUDE_PICKING.md §7`).
- **Docs pass** — `CLAUDE_CORE.md` still reads v27.10 in its header/§7 chain; the
  `sku_master_v2` model landed as v27.11 (commit `916fcd39`).
- `scripts/_diagnose-skuid-collision.ts` and `scripts/_diagnose-tools-645.ts` are on disk,
  untracked, underscore-prefixed (outside the `tsc` gate). Read-only. Kept per CORE §3.

---

*Diagnosis only · No code written · No schema edited · No DB writes · 2026-07-19*
