# Code discovery — import-cohort SKU overlap baseline
# 2026-08-15 · READ-ONLY diagnosis · no feature code written, no DB write, nothing committed
# Script: `scripts/analysis/import-overlap-baseline.ts` (run with `npx tsx`, not imported anywhere)
# CSV: `docs/prompts/drafts/overlap-pairs-2026-08-15.csv`

---

## Verdict

**Grouping bills by shared SKUs is NOT worth building on this evidence.** Only 7.4% of bills have any
partner in their own import batch sharing 2+ SKUs, and the median bill carries just **one** distinct
SKU — there is not enough repetition in a batch for a grouping feature to bite.

**The noise filter is a non-event, and that is itself the finding.** No SKU appears in more than
**3.4%** of bills (the >30% test matched **zero** codes), so the second pass is byte-identical to the
first. The overlap is not being propped up by a few ubiquitous primers — it is simply thin.

**The early-fetch case is real but tiny: 64 pairs in 60 days, about one a day**, and 54% of those go
to different routes, so "fetch them together" would often mean carrying stock to two different
trucks. Revisit only if the cohort definition widens (see *What this cannot see*).

---

## Arrival anchor chosen + why

**Chosen: `orders.batchId` → `import_batches.id`. A real batch id exists; no time bucket was needed.**

`orders.batchId` is a **NON-NULL `Int` FK** (`prisma/schema.prisma`, model `orders`, line 705) —
every bill physically names the import run that created it. Measured null rate over the scope:
**0.0% (0 / 6,484)**. This beats both fallbacks the brief offered, so neither was used.

Why not the fallbacks — both are degraded, and the brief's warning is confirmed:

| Candidate | Null | Date-only (00:00:00.000 UTC) | Verdict |
|---|---|---|---|
| `orders.batchId` | **0 (0.0%)** | n/a — it is an id, not a clock | **chosen** |
| `orders.obdEmailDate` | 0 (0.0%) | **1,107 (17.1%)** | rejected — 1 in 6 carries no clock |
| `orders.orderDateTime` | 0 (0.0%) | **264 (4.1%)** | rejected — anchor exists, no need to degrade |

The date-only counts use `hasClockTime()` from `lib/dispatch/punch-clock.ts` — the single owner of
that test (exactly 00:00:00.000 **UTC**, never IST midnight). It was imported, not re-implemented.
Manual SAP's 19-column layout has no time column, which is why `obdEmailDate` lands at fake midnight
on 17% of bills (`CLAUDE_IMPORT.md §12.1b`).

**COHORT = one `import_batches` row.** What that means concretely (read-only probe on
`import_batches.headerFile`, which carries the source marker — note the schema has no `source`
column, contrary to `CLAUDE_IMPORT.md §4):

| Source (from `headerFile`) | Cohorts | Bills | Mean cohort size | Bill-weighted mean |
|---|---|---|---|---|
| `[auto-import] auto-json` | 1,324 | 5,207 | 3.9 | 8.0 |
| `[manual-sap] EXPORT orbit … .XLSX` | 180 | 1,277 | 7.1 | 24.8 |

⚠ A cohort is therefore **"arrived in the same ~10-minute auto-import tick"**, not "arrived the same
day". This is the single biggest limitation on every number below — see *What this cannot see*.

**Line-item predicate used:** `where: { obdNumber: { in: chunk }, lineStatus: "active" }`, matched on
`obdNumber` — **byte for byte** what `app/api/picking/order/[orderId]/route.ts:115` uses. Deliberately
NOT also filtering `rowStatus: 'valid'`: `lib/picking/queue.ts` does, that route does not, and the
brief said mirror the route (the divergence is documented at the top of the route file). SKUs are
compared **raw code to raw code** (`skuCodeRaw`); the catalog is read exactly once, for Q2 display
descriptions, resolved by `material` — never via `skuId` / old `sku_master` (CORE §13 id-space
landmine). The ~27% catalog gap therefore cannot move a single number in Q1/Q3/Q4.

**Scope:** `isRemoved = false`, `orders.createdAt` within the last 60 days.

---

## Q1 — Can we trust the data?

**Both stop gates PASS.** (b) is 99.9%, far above the 85% floor; (d) median is 3, at the floor.

| Metric | Value |
|---|---|
| a. bills in scope | **6,484** |
| a. date range (batch createdAt) | **2026-06-16 → 2026-08-14** |
| b. bills matching >= 1 active line item | **6,475 / 6,484 = 99.9%** ✅ |
| c. active lines per bill | median **2** · p75 **3** · max **69** |
| c. DISTINCT `skuCodeRaw` per bill | median **1** · p75 **3** · max **61** |
| d. cohorts (import batches) | **1,504** |
| d. bills per cohort | median **3** · p75 **5** · max **109** |
| — bills alone in their cohort | **430 (6.6%)** — no partner is structurally possible |

The `obdNumber` join is effectively total: only **9 bills** in 60 days carry no active line at all.
That is the number the brief flagged as critical, and it is not a problem.

🔴 **Read line (c) before reading anything else.** The median bill has **one distinct SKU**. Half of
all bills cannot share 2 SKUs with anybody, no matter how the cohort is drawn. That single fact caps
every Q3 number below and is not fixable by a better grouping rule.

---

## Q2 — Which SKUs are just noise?

Denominator: the **6,475** bills carrying at least one active line. **1,059 distinct SKUs** in scope.

| # | skuCodeRaw | bills | % of bills | description (`sku_master_v2`, blank = unresolved) |
|---|---|---|---|---|
| 1 | `5599499` | 223 | 3.4% | DN ACOTONE Tinter NO1 COL_IN-SL 1L |
| 2 | `5945465` | 220 | 3.4% | Promise SmartC Acrylic Distemper 20Kg |
| 3 | `IN34220082` | 217 | 3.4% | DN SB CEMENT PRIMER 10L |
| 4 | `IN34220071` | 210 | 3.2% | DN SB CEMENT PRIMER 4L |
| 5 | `5599503` | 206 | 3.2% | DN ACOTONE Tinter XY1 COL_IN-SL 1L |
| 6 | `IN34220081` | 202 | 3.1% | DN SB CEMENT PRIMER 20L |
| 7 | `5908366` | 186 | 2.9% | DN AQUATECH DAMP PROTECT 2IN1 20L |
| 8 | `9055678` | 180 | 2.8% | Promise Freedom 2in1 Primer Int&Ext 20L |
| 9 | `IN28209072` | 174 | 2.7% | DN GLOSS WHITE BASE NEW 1L |
| 10 | `IN28012272` | 168 | 2.6% | DN GLOSS BLACK 1L |
| 11 | `5853012` | 162 | 2.5% | DPP-SUPERCOVER ULTRA BR.WHITE 10L |
| 12 | `5948786` | 161 | 2.5% | DN PROMISE ENAMEL CLASSIC WHITE 4L |
| 13 | `IN65010657` | 158 | 2.4% | DN Stainer Fast Violet 50 ML |
| 14 | `IN34220072` | 153 | 2.4% | DN SB CEMENT PRIMER 1L |
| 15 | `5540670` | 151 | 2.3% | DN Zinc Yellow Metal Primer 4L |
| 16 | `IN28140082` | 150 | 2.3% | DN SATIN STAY BRIGHT WHITE 10L |
| 17 | `5579821` | 149 | 2.3% | PROMISE SMARTCH INT BR WHT/WHT BAS 20L |
| 18 | `5948787` | 146 | 2.3% | DN PROMISE ENAMEL CLASSIC WHITE 10L |
| 19 | `IN28140072` | 146 | 2.3% | DN SATIN STAY BRIGHT WHITE 1L |
| 20 | `5853009` | 143 | 2.2% | DPP-SUPERCOVER ULTRA BR.WHITE 4L |
| 21 | `5853011` | 141 | 2.2% | DPP-SUPERCOVER ULTRA BR.WHITE 20L |
| 22 | `IN28140071` | 136 | 2.1% | DN SATIN STAY BRIGHT WHITE 4L |
| 23 | `5994753` | 131 | 2.0% | Promise 2 in 1 Primer Int & Ext 20 Ltr |
| 24 | `5540669` | 131 | 2.0% | DN Zinc Yellow Metal Primer 1L |
| 25 | `IN28209071` | 127 | 2.0% | DN GLOSS WHITE BASE NEW 4L |

All 25 resolved in `sku_master_v2`; nothing was guessed.

**Distinct SKUs appearing in more than 30% of bills: `0`.** The single most common SKU in the depot's
last 60 days is on **3.4%** of bills. There is no ubiquitous-primer noise floor here — the catalog is
long-tailed, with 1,059 codes spread across 6,475 bills.

---

## Q3 — How much do bills in one cohort actually overlap?

**33,384 pairs** compared (every unordered pair inside a cohort). Denominator: the 6,475 bills with
at least one active line.

| pass | >= 1 shared | >= 2 shared | >= 3 shared |
|---|---|---|---|
| all SKUs | **1,970 (30.4%)** | **481 (7.4%)** | **243 (3.8%)** |
| ignoring SKUs in > 30% of bills | **1,970 (30.4%)** | **481 (7.4%)** | **243 (3.8%)** |

Pairs sharing >= 2 SKUs: **439** (identical on both passes).

> ### The one sentence
>
> **The overlap survives the second pass completely intact — but only because the filter never fired
> (no SKU is on more than 3.4% of bills), so the pass proves nothing about noise; the real finding is
> that the overlap is thin to begin with, at 7.4% of bills having any partner sharing 2+ SKUs.**

Read that as: the 30%-noise hypothesis is simply *false for this depot*. Nothing needed stripping.
What kills the case for grouping is not fake overlap, it is the absence of overlap.

---

## Q4 — The early-fetch case

Among the **439** pairs sharing >= 2 SKUs (all-SKU pass; the noise-stripped pass gives the identical
439 and the identical 64):

| Measure | Count | % of 439 |
|---|---|---|
| DIFFERENT `dispatchWindowId` **or** different `dispatchTargetDate` | **64** | **14.6%** |
| same route | 181 | 41.2% |
| different route | **239** | **54.4%** |
| route unknown on at least one side | 19 | 4.3% |

⚠ **The 14.6% is deflated by nulls and must be read with the line below.** **287 of the 439 pairs
(65.4%) have `dispatchWindowId` AND `dispatchTargetDate` null on BOTH sides** — two nulls compare
equal, so those land in the "same window/date" bucket by default rather than by evidence. Restricted
to the **152 pairs where at least one side actually carries a window or a target date, 64 differ =
42.1%.**

Both readings are in the report on purpose: 14.6% is the honest denominator-of-everything figure,
42.1% is the honest figure among bills that have been slotted at all. Neither is large in absolute
terms — **64 pairs across 60 days is roughly one a day**, and more than half of them are headed to
different routes.

---

## What this cannot see

1. **Cross-cohort partners — the biggest blind spot.** A cohort is one import batch, and the live
   auto-import fires roughly every 10 minutes (`CLAUDE_IMPORT.md §10`), so a single day's ~150 bills
   are split across ~22 cohorts averaging 3.9 bills each. Two bills that arrived 12 minutes apart on
   the same morning are **invisible to this entire analysis**. If the real product question is "what
   arrived TODAY", re-run with a day bucket (or an hour bucket) before accepting the verdict — the
   batch id is the most precise anchor available, but it is deliberately the narrowest one.
2. **430 bills (6.6%) are alone in their cohort** and cannot pair with anything by construction. They
   sit in the denominator, which is correct for "what fraction of bills could benefit", but they are
   not evidence that overlap is absent.
3. **SKU-code identity only — no product/family/shelf notion.** Two bills carrying the 1 L and the
   4 L of the same paint share **zero** codes here (`IN28140072` vs `IN28140071` are different rows
   in Q2 above). A family-level or shelf-adjacency measure would show more overlap; whether that is
   operationally the same thing is a separate question this run does not answer.
4. **No quantity or volume weighting.** One tin and forty tins of the same SKU count identically.
5. **Removed lines excluded, parse-rejected rows included** — `lineStatus: "active"` only, and no
   `rowStatus` filter, mirroring the picking detail route exactly. A bill whose lines were all
   soft-removed by a re-import reads as a zero-SKU bill here.
6. **Catalog descriptions are display-only** (Q2). Every comparison is raw-code to raw-code, so the
   ~27% of SAP codes in neither catalog table (CORE §7.1.c) affect nothing but the blankness of a
   description cell — and in this run, none of the top 25 was blank.
7. **60 days only, and dispatch fields are sparse in it.** Two thirds of the >= 2 pairs have no
   dispatch window or target date at all, so Q4 is measured on a minority of the population.
8. **No seasonality check.** June–August is one slice; a festival or monsoon peak could change the
   repetition profile.

---

*Read-only diagnosis. Every figure above comes from `SELECT`s against production via
`scripts/analysis/import-overlap-baseline.ts` (plus one `import_batches` composition probe). No app
file was modified, no row was written, nothing was committed.*
