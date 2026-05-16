# Stage A — Pass 6 raw findings — External consumers

Generated: 2026-05-07

---

## Summary

- OBD import path hits: 0 (`applyMailOrderEnrichment` defined in `app/api/import/obd/route.ts:226`, used 4× — does NOT query `mo_sku_lookup`)
- Admin endpoint hits: 0 (51 admin routes scanned)
- Scripts touching `mo_sku_lookup`: 4 of 9
- Other pipeline route hits: 0 (planning, support, warehouse, tint, operations all clean)
- Backfill endpoint hits: 0 outside the mail-orders module
- `sku_master` vs `mo_sku_lookup` separation: clean — zero file overlap
- Cron/scheduled hits: 0 (no `vercel.json` exists)
- Total external consumers found: 0

---

## Step 1 — OBD import path

Files scanned: `app/api/import/obd/route.ts` (only file in `app/api/import/`).

`mo_sku_lookup` direct hits: 0.

`applyMailOrderEnrichment` references found:

- `app/api/import/obd/route.ts:226` — function definition
- `app/api/import/obd/route.ts:1005` — call site (initial OBD import)
- `app/api/import/obd/route.ts:1539` — call site (per-effect dispatch)
- `app/api/import/obd/route.ts:2751` — call site (auto-import)
- `lib/import-upsert/effects.ts:5` — comment reference (effect kind documented, not invoked)
- `lib/import-upsert.ts:80` — JSDoc reference

The function name is mail-order-related, but its body operates on `mo_orders` (matching by `soNumber` to apply dispatchStatus/priorityLevel/remarks/orderDateTime/overrides to imported OBDs) — not on `mo_sku_lookup`. The OBD import pipeline does not read SKU enrichment data; it only consumes the order-level metadata that the mail-orders ingest path produced earlier.

Confirmed: zero `mo_sku_lookup` exposure from the OBD import path.

## Step 2 — Admin endpoints

Files scanned: 51 routes under `app/api/admin/` (full list captured during glob).

`mo_sku_lookup` hits: 0.

`app/admin/` directory does not exist; admin pages live under `app/(admin)/admin/` (Next.js route group). Grep against `app/(admin)/` returned 0 hits for `mo_sku_lookup`.

The admin SKU master pages (`app/(admin)/admin/skus/*`, `app/api/admin/skus/*`) operate exclusively on `sku_master` — see Step 6.

## Step 3 — Scripts directory

| File | Touches `mo_sku_lookup`? | Purpose |
|---|---|---|
| `scripts/fix-admin-password.ts` | no | Resets admin user password (operates on `users` table) |
| `scripts/backup-mo-order-form-index.ts` | no | Backs up `mo_order_form_index` rows to JSON before reseed |
| `scripts/phase1-backup-current-index.ts` | no | Phase 1 backup snapshot of `mo_order_form_index` |
| `scripts/phase1-restore-from-backup.ts` | yes (comment-only ref + restore docs) | Restores `mo_order_form_index` from backup JSON; comments document the SKU↔index join |
| `scripts/phase1-rollback-verify-tmp.ts` | no | Phase 1 rollback verification (`mo_order_form_index` counts only) |
| `scripts/phase1-seed-mo-order-form-index.ts` | yes (comment-only refs) | Reseeds `mo_order_form_index` from preview JSON |
| `scripts/phase1-spotcheck-tmp.ts` | no | Spotcheck `mo_order_form_index` counts/rows |
| `scripts/preview-new-taxonomy.ts` | yes (`prisma.mo_sku_lookup.findMany`) | Phase 1 dry-run preview generator — reads SKU triples, runs taxonomy mapping, writes JSON |
| `scripts/preview-new-taxonomy-from-csv.ts` | yes (CSV input path string `mo_sku_lookup-triples-2026-05-06.csv`) | CSV-input variant of the preview generator (DB-free) |

The 4 scripts flagged were already covered in Pass 1 (file-by-file findings). Of these 4:
- `preview-new-taxonomy.ts` is the only script that performs a runtime `prisma.mo_sku_lookup.findMany` read.
- The other three reference `mo_sku_lookup` in comments / file path strings only.

## Step 4 — Other pipeline routes

| Path | `mo_sku_lookup` hits |
|---|---|
| `app/api/orders/` | path does not exist |
| `app/api/dispatch/` | path does not exist |
| `app/api/warehouse/` | 0 |
| `app/api/tint/` | 0 |
| `app/api/planning/` | 0 |
| `app/api/support/` | 0 |
| `app/api/operations/` | 0 |

All non-mail-orders pipelines confirmed clean.

## Step 5 — Backfill endpoints

Backfill / one-time endpoints discovered:
- `app/api/admin/fix-slots/route.ts` — backfills `orderDateTime` + recalculates slotId
- `app/api/admin/fix-challans/route.ts` — creates missing delivery_challans
- `app/api/mail-orders/backfill-customers/route.ts` — TEMPORARY customer backfill
- `app/api/mail-orders/backfill-enrich/route.ts` — already in Pass 1 (mo_sku_lookup reader)

`mo_sku_lookup` references in non-mail-orders backfill routes: 0.

The two `app/api/admin/fix-*` routes operate on `orders` and `delivery_challans` tables only.

## Step 6 — `sku_master` separation

Files using `sku_master`/`skuMaster` (from grep): 11

- `app/api/import/obd/route.ts`
- `app/(tint)/tint/manager/skus/page.tsx`
- `app/(support)/support/skus/page.tsx`
- `app/(dispatcher)/dispatcher/skus/page.tsx`
- `app/(admin)/admin/skus/page.tsx`
- `app/(admin)/admin/page.tsx`
- `app/(admin)/admin/skus/[id]/sub-skus/page.tsx`
- `app/api/admin/skus/route.ts`
- `app/api/admin/skus/import/route.ts`
- `app/api/admin/skus/[id]/route.ts`
- `app/api/admin/skus/[id]/sub-skus/route.ts`

Files using `mo_sku_lookup` (from Pass 1, runtime readers only): 8

- `lib/fini-resolver.ts`
- `app/api/mail-orders/skus/route.ts`
- `app/api/mail-orders/re-enrich/route.ts`
- `app/api/mail-orders/backfill-enrich/route.ts`
- `app/api/mail-orders/lines/[lineId]/resolve/route.ts`
- `app/api/mail-orders/ingest/route.ts`
- `app/api/mail-orders/debug-enrich/route.ts`
- `app/api/order/data/route.ts`

Files using both: **none**. The two namespaces are cleanly separated. `sku_master` is the SAP-side normalised catalogue (used by OBD import, admin, role-specific SKU browsers); `mo_sku_lookup` is the mail-orders fuzzy matching catalogue.

## Step 7 — Cron / scheduled

`vercel.json` does not exist in the repo. No `cron` declarations checked into `next.config.*`. No scheduled triggers configured at the platform level. The `Auto-Import.ps1` external task scheduler (per `docs/CLAUDE_CORE.md §4`) runs on the depot PC and POSTs to `/api/import/obd` — already covered in Step 1, no `mo_sku_lookup` exposure.

## End of Pass 6
