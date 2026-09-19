## Arrival anchor

**Chosen: `orders.batchId` → `import_batches` (a real batch id).**

- `orders.batchId` is a NON-NULL `Int` FK (`prisma/schema.prisma`, model `orders`) — **null rate 0.0%** (0/6375). Every bill names the import run it arrived in, so no time-bucket fallback was needed.
- `orders.orderDateTime` null: 0 (0.0%); date-only (00:00:00.000 UTC, `hasClockTime()`): **230** (3.6%).
- `orders.obdEmailDate` null: 0 (0.0%); date-only: **998** (15.7%).

Cohort composition by `import_batches.batchRef` prefix (bills per prefix):

| batchRef prefix | bills |
|---|---|
| `BATCH` | 6375 |

## Q1 — data trust
- bills in scope: **6375** (isRemoved=false, orders.createdAt within 60d)
- batch date range: **2026-06-17T07:56:24.731Z → 2026-08-14T18:05:28.864Z**
- bills matching >= 1 ACTIVE line item: **6366 / 6375 = 99.9%**
- active lines per bill: median **2** · p75 **3** · max **69**
- DISTINCT skuCodeRaw per bill: median **1** · p75 **3** · max **61**
- cohorts (import batches): **1503**
- bills per cohort: median **3** · p75 **5** · max **56**
- bills alone in their cohort (no possible partner): **430** (6.7%)

## Q2 — which SKUs are just noise?

Denominator throughout: the **6366** bills that carry at least one active line.

| # | skuCodeRaw | bills | % of bills | description (sku_master_v2, blank = unresolved) |
|---|---|---|---|---|
| 1 | `5599499` | 220 | 3.5% | DN ACOTONE Tinter NO1 COL_IN-SL 1L |
| 2 | `5945465` | 219 | 3.4% | Promise SmartC Acrylic Distemper 20Kg |
| 3 | `IN34220082` | 216 | 3.4% | DN SB CEMENT PRIMER 10L |
| 4 | `IN34220071` | 210 | 3.3% | DN SB CEMENT PRIMER 4L |
| 5 | `5599503` | 203 | 3.2% | DN ACOTONE Tinter XY1 COL_IN-SL 1L |
| 6 | `IN34220081` | 202 | 3.2% | DN SB CEMENT PRIMER 20L |
| 7 | `5908366` | 184 | 2.9% | DN AQUATECH DAMP PROTECT 2IN1 20L |
| 8 | `9055678` | 179 | 2.8% | Promise Freedom 2in1 Primer Int&Ext 20L |
| 9 | `IN28209072` | 172 | 2.7% | DN GLOSS WHITE BASE NEW 1L |
| 10 | `IN28012272` | 168 | 2.6% | DN GLOSS BLACK 1L |
| 11 | `5948786` | 161 | 2.5% | DN PROMISE ENAMEL CLASSIC WHITE 4L |
| 12 | `IN34220072` | 153 | 2.4% | DN SB CEMENT PRIMER 1L |
| 13 | `IN65010657` | 152 | 2.4% | DN Stainer Fast Violet 50 ML |
| 14 | `5853012` | 151 | 2.4% | DPP-SUPERCOVER ULTRA BR.WHITE 10L |
| 15 | `IN28140082` | 150 | 2.4% | DN SATIN STAY BRIGHT WHITE 10L |
| 16 | `5540670` | 149 | 2.3% | DN Zinc Yellow Metal Primer 4L |
| 17 | `5948787` | 145 | 2.3% | DN PROMISE ENAMEL CLASSIC WHITE 10L |
| 18 | `IN28140072` | 145 | 2.3% | DN SATIN STAY BRIGHT WHITE 1L |
| 19 | `5579821` | 143 | 2.2% | PROMISE SMARTCH INT BR WHT/WHT BAS 20L |
| 20 | `5853009` | 140 | 2.2% | DPP-SUPERCOVER ULTRA BR.WHITE 4L |
| 21 | `5853011` | 138 | 2.2% | DPP-SUPERCOVER ULTRA BR.WHITE 20L |
| 22 | `IN28140071` | 136 | 2.1% | DN SATIN STAY BRIGHT WHITE 4L |
| 23 | `5994753` | 129 | 2.0% | Promise 2 in 1 Primer Int & Ext 20 Ltr |
| 24 | `5540669` | 129 | 2.0% | DN Zinc Yellow Metal Primer 1L |
| 25 | `IN28209071` | 127 | 2.0% | DN GLOSS WHITE BASE NEW 4L |

- distinct SKUs in scope: **1056**
- distinct SKUs appearing in **more than 30%** of bills: **0**

## Q3 — how much do bills in one cohort overlap?

Pairs compared: **27,498** (every unordered pair inside a cohort).
Denominator below is the **6366** bills carrying at least one active line.

| pass | >= 1 shared | >= 2 shared | >= 3 shared |
|---|---|---|---|
| all SKUs | 1881 (29.5%) | 456 (7.2%) | 229 (3.6%) |
| ignoring SKUs in > 30% of bills | 1881 (29.5%) | 456 (7.2%) | 229 (3.6%) |

Pairs sharing >= 2: **412** all-SKU · **412** noise-stripped.

## Q4 — the early-fetch case (pairs sharing >= 2, all-SKU pass)

- pairs sharing >= 2 SKUs: **412**
- of those, DIFFERENT dispatchWindowId or dispatchTargetDate: **64** (15.5%)
- same route: **176** (42.7%)
- different route: **219** (53.2%)
- route unknown on at least one side: **17** (4.1%)
- same figure on the noise-stripped pairs: **64 / 412** (15.5%) differ on window/date

csvRows=412 truncated=0