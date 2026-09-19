# Code discovery — SKU overlap across a window ladder (containment measure)
# 2026-08-16 · READ-ONLY diagnosis · no feature code, no DB write, nothing committed
# Script: `scripts/analysis/import-overlap-baseline.ts` §2 (extended, not replaced) · `npx tsx`
# CSVs: `overlap-clusters-w2-2026-08-15.csv` · `overlap-pairs-w2-containment-2026-08-15.csv`
# REPLACES THE MEASURE OF: `code-discovery-2026-08-15-import-overlap-baseline.md` (method intact)

---

## Verdict

**This reverses the previous verdict. Grouping IS worth building — the last run measured the right
thing at the wrong window with the wrong threshold.** At a half-day window, **61.0%** of bills have a
partner covering at least half their distinct SKUs, and **50.4%** are *entirely contained* in another
bill — the picker gets them for free.

**Build it at the half-day (W1), not the day.** W1 is where the capped shelf-visit saving PEAKS:
**1,533 distinct-SKU visits avoided over 60 days (~26/day)**. Widening to a day, 3 days or a week
keeps raising coverage but *lowers* that saving, because groups merge into fewer, larger blobs.

**One hard caveat before anyone designs a screen: only 17.8% of W1 groups are single-route**, and
connected components chain badly (the largest same-day component is 276 bills). The feature must
group *within a route* or under a hard size cap — never by raw connected component.

---

## Corrections applied vs the previous run

| # | Previous run | This run |
|---|---|---|
| 1 | `shared >= 2 SKUs` as the threshold | **Containment** = `shared / min(distinctA, distinctB)` |
| 2 | Cohort = one import batch (avg 3.9 bills) | **Five-width ladder**, W0 batch → W4 week |
| 3 | CSV mixed `shared` (distinct SKUs) beside `linesA/linesB` (active line rows) | **Every column names its unit**: `sharedDistinctSkus`, `distinctSkusA`, `activeLinesA` … |

**Why correction 1 mattered so much.** The median bill carries **one** distinct SKU (3,267 bills —
51.3% of the population — have exactly one). `shared >= 2` is arithmetically unreachable for every one
of them, so the old test excluded half the depot by construction and then reported the result as
"overlap is thin". Under containment, a 1-SKU bill whose SKU appears on any partner scores **1.0** —
fully covered, free. **2,104 of those 3,267 single-SKU bills (64.4%) are covered by a same-day
partner.** That population alone is larger than everything the previous run found.

**Why correction 2 mattered.** The W0 control reproduces the old cohort, and its median best
containment is **0.00** — more than half of all bills have *no partner at all* inside their own import
batch. The batch is a ~10-minute auto-import tick, not a board.

**The control is the same method one day later.** Scope rolled with the clock: **6,375 bills**
(6,366 with lines) vs yesterday's 6,484 (6,475). W0's pair count moved 439 → 412 for that reason
alone. Same predicate, same anchor, same 60-day span — the window slid by one day.

### Method notes required by the brief

- **IST bucketing helper: `istDateString()` from `lib/attendance/date.ts`** — the app's canonical
  exported `en-CA` + `Asia/Kolkata` recipe, imported, not re-implemented. W1's hour-of-day uses the
  fixed `+5:30` shift (`IST_OFFSET_MS`, the idiom `lib/floor/queries.ts` and `lib/picking/queue.ts`
  already use; India has no DST). W3/W4 block keys come from `Date.parse` on a **date-only**
  `YYYY-MM-DD` string, which the ES spec reads as UTC — the safe half of CORE §3's rule. No
  offset-less date-*time* string is parsed anywhere.
- **Inverted index CONFIRMED.** For each bucket the script builds `skuCodeRaw -> [bills in this
  bucket carrying it]` and scores only pairs that co-occur on at least one SKU. This is **exact, not
  a sample**: a pair sharing zero SKUs has containment 0 by definition and can never cross any
  threshold reported here. W4 buckets average 707 bills; the naive comparison would have been ~2.2M
  pairs per bucket.
- **Anchor unchanged:** `orders.batchId` → `import_batches.createdAt` is the arrival instant for
  every W1–W4 bucket, exactly as W0 uses `batchId` itself.
- **Predicate unchanged:** `{ obdNumber: { in: chunk }, lineStatus: "active" }` — byte for byte
  `app/api/picking/order/[orderId]/route.ts:115`. Raw code to raw code; no `skuId`, no `sku_master`
  (CORE §13).
- **Scope unchanged:** `isRemoved = false`, last 60 days. Denominator throughout is the **6,366**
  bills carrying at least one active line.

---

## The ladder table

A bill's **size is its count of DISTINCT `skuCodeRaw`** in every column below. Active line rows are
never used as a denominator.

| W | cohort | a. avg bills/bucket | b. >= 1 shared SKU | c. containment >= 0.5 | d. containment = 1.0 (free bill) | e. best containment median / p75 |
|---|---|---|---|---|---|---|
| **W0** | same import batch (control) | 4.2 | 29.5% | 24.4% | 19.8% | **0.00** / 0.33 |
| **W1** | same half-day (IST, split 13:00) | 63.7 | 66.5% | **61.0%** | **50.4%** | 1.00 / 1.00 |
| **W2** | same day (IST) | 124.8 | 75.9% | 72.7% | 62.8% | 1.00 / 1.00 |
| **W3** | same 3 days (IST blocks) | 303.1 | 86.1% | 85.0% | 77.9% | 1.00 / 1.00 |
| **W4** | same week (IST, Mon–Sun) | 707.3 | 92.5% | 91.9% | 88.1% | 1.00 / 1.00 |

| W | f. clusters 2 / 3–4 / 5–9 / 10+ | f. bills in a 3+ cluster | g. saving median / p75 | g. SKU-visits avoided | h. single-route (of 3+ clusters) |
|---|---|---|---|---|---|
| **W0** | 326 / 125 / 52 / 13 | 904 (14.2%) | 50.0% / 66.7% | 754 | 46.4% of 179 |
| **W1** | 355 / 190 / 81 / 59 | 3,175 (49.9%) | 36.0% / 50.0% | **1,533** | 17.8% of 287 |
| **W2** | 317 / 132 / 65 / 55 | 3,996 (62.8%) | 38.9% / 60.0% | 1,246 | 14.3% of 210 |
| **W3** | 201 / 90 / 27 / 26 | 5,007 (78.7%) | 50.0% / 66.7% | 799 | 11.5% of 113 |
| **W4** | 100 / 71 / 22 / 14 | 5,653 (88.8%) | 66.7% / 66.7% | 555 | 14.5% of 83 |

(g) is computed exactly as briefed: clusters of 3+, capped at the **4 most-connected** members
(degree within the cluster, ties broken by distinct-SKU count then OBD), `separate` = sum of members'
distinct-SKU counts, `together` = distinct SKUs across the group, `saving = 1 − together/separate`.
(h) counts only clusters where *every* member has a known route; the denominator column states how
many that was.

### 🔴 Chaining check — a connected component is NOT an operational group

Components are transitive: A–B and B–C merge even when A and C share nothing. This distorts (f) and
(h) badly and must be read before either:

| W | largest component | bills in a 10+ component | share of the 3+ population |
|---|---|---|---|
| W0 | 42 | 198 | 21.9% |
| W1 | 203 | 2,060 | 64.9% |
| W2 | 276 | 3,156 | **79.0%** |
| W3 | 491 | 4,541 | 90.7% |
| W4 | 892 | 5,279 | 93.4% |

By W2, four fifths of the "bills in a 3+ cluster" figure sits inside blobs of 10+. Columns (b)–(e)
are pair-level and **unaffected** by this — they are the trustworthy half of the table. The 4-member
cap is exactly what keeps (g) meaningful; (f)'s size bands and (h)'s route purity are the ones to
distrust at W2 and beyond.

### Where the numbers stop improving — one sentence

> **The single big step is W0 → W1: batch-to-half-day nearly triples the free-bill rate (19.8% →
> 50.4%); every step after that buys only another ~10–15 points of coverage while costing a whole
> dispatch day of holding, and the capped shelf-visit saving actually *peaks* at W1 (1,533) and falls
> at every wider window — so the half-day is where the buying stops.**

---

## W2 (day) — the 15 largest clusters

Listed because the brief asked for them, but read them **as chains, not as pick groups** — the
route column is the tell: a 276-bill "cluster" spanning 14 routes is a transitive artifact.
`savingPct` here is the capped-4 metric from (g); the two distinct-SKU columns are whole-cluster.

| # | bills | IST day | distinct SKUs together | distinct SKUs separate | saving % (capped 4) | routes |
|---|---|---|---|---|---|---|
| 1 | 276 | 2026-08-06 | 348 | 1,655 | 60.7% | (unknown) · Adajan · Bardoli · Bharuch · Chikhli · Ghod Dod · IGT/CROSS · Kamrej · Navsari · No Route · Olpad · Udhana · Vapi · Varachha |
| 2 | 256 | 2026-07-10 | 259 | 964 | 33.8% | (unknown) · Adajan · Bardoli · Bharuch · Chikhli · Ghod Dod · Kamrej · Navsari · No Route · Olpad · Udhana · Vansda · Vapi · Varachha |
| 3 | 243 | 2026-07-06 | 374 | 1,775 | 35.1% | (unknown) · Adajan · Bardoli · Bharuch · Chikhli · Ghod Dod · IGT/CROSS · Kamrej · Navsari · Udhana · Vansda · Vapi · Varachha |
| 4 | 187 | 2026-08-12 | 281 | 803 | 17.9% | (unknown) · Adajan · Bardoli · Bharuch · Chikhli · Ghod Dod · Kamrej · Navsari · No Route · Olpad · Parvat · Udhana · Vansda · Vapi · Varachha |
| 5 | 160 | 2026-07-15 | 218 | 600 | 13.9% | (unknown) · Adajan · Bardoli · Bharuch · Chikhli · Ghod Dod · Kamrej · Navsari · No Route · Olpad · Parvat · Udhana · Vansda · Vapi · Varachha |
| 6 | 147 | 2026-06-25 | 226 | 658 | 67.2% | (unknown) · Adajan · Bharuch · Chikhli · Ghod Dod · IGT/CROSS · Kamrej · Navsari · Olpad · Udhana · Vapi · Varachha |
| 7 | 130 | 2026-06-22 | 206 | 549 | 23.1% | (unknown) · Adajan · Bharuch · Chikhli · Ghod Dod · Kamrej · Navsari · Parvat · Udhana · Vansda · Vapi · Varachha |
| 8 | 113 | 2026-06-29 | 194 | 424 | 14.4% | (unknown) · Adajan · Bardoli · Bharuch · Chikhli · Ghod Dod · Kamrej · Navsari · No Route · Parvat · Udhana · Vansda · Vapi · Varachha |
| 9 | 100 | 2026-07-25 | 161 | 371 | 36.7% | (unknown) · Adajan · Bardoli · Ghod Dod · Kamrej · Navsari · Udhana · Vapi · Varachha |
| 10 | 99 | 2026-06-20 | 163 | 387 | 8.3% | (unknown) · Adajan · Bardoli · Bharuch · Ghod Dod · Kamrej · Navsari · Parvat · Udhana · Vansda · Vapi · Varachha |
| 11 | 96 | 2026-07-13 | 146 | 300 | 6.3% | (unknown) · Adajan · Bharuch · Chikhli · Ghod Dod · Kamrej · Navsari · No Route · Udhana · Vapi · Varachha |
| 12 | 72 | 2026-08-14 | 147 | 279 | 19.0% | (unknown) · Adajan · Bardoli · Bharuch · Ghod Dod · Kamrej · Navsari · Udhana · Vapi · Varachha |
| 13 | 70 | 2026-08-10 | 123 | 281 | 22.9% | Adajan · Bharuch · Chikhli · Ghod Dod · Kamrej · Navsari · Udhana · Vapi · Varachha |
| 14 | 65 | 2026-06-18 | 115 | 235 | 17.9% | (unknown) · Adajan · Bardoli · Bharuch · Chikhli · Ghod Dod · Kamrej · Navsari · Olpad · Udhana · Vapi · Varachha |
| 15 | 63 | 2026-08-08 | 110 | 269 | 47.0% | Adajan · Bardoli · Bharuch · Ghod Dod · Kamrej · Navsari · No Route · Udhana · Vapi · Varachha |

All 252 W2 clusters of 3+ are in `overlap-clusters-w2-2026-08-15.csv`.

### The early-fetch case at W2 — the null trap closed

Counted **only over members that actually carry a `dispatchWindowId` or `dispatchTargetDate`**, which
is the correction the previous run's Q4 needed (there, two nulls compared equal and silently inflated
the "same window" bucket):

- 3+ clusters at W2: **252**
- **decidable** (>= 2 slotted members): **158 (62.7%)**
- of the decidable, members **disagree** on window/date: **127 (80.4%)**
- undecidable (0 or 1 slotted member — excluded, not assumed): **94**

**Four out of five same-day groups span more than one dispatch window or target date.** That is the
early-fetch case, and it is the norm rather than the exception — the opposite of what the previous
run's 14.6% suggested.

### Single-distinct-SKU bills

- bills with exactly **one** distinct `skuCodeRaw`: **3,267** (51.3% of bills with lines)
- of those, fully covered by a same-day (W2) partner carrying that SKU: **2,104 (64.4%)**

---

## What this still cannot see

1. **Connected components are not pick groups.** Quantified above; the 4-cap saves (g) but (f) and
   (h) inherit the chaining. A real feature needs a bounded grouping rule (route-first, or greedy
   size-capped seeds), and its numbers will differ from (f)/(h) here.
2. **Route purity is measured, not enforced.** 17.8% single-route at W1 means a raw grouping would
   routinely span trucks. Whether a cross-route group is still worth picking together is an
   operations question this run does not answer — the depot may pick to a staging area, not to a
   truck.
3. **Still SKU-code identity only.** 1 L and 4 L of the same paint share nothing here
   (`IN28140072` vs `IN28140071`). A family/shelf-adjacency measure would score higher; whether
   shelf adjacency is the same as code identity is unanswered.
4. **No quantity, volume or weight.** One tin and forty tins of a SKU are identical to this measure,
   so "visits avoided" counts shelf *visits*, never effort.
5. **"Visits avoided" is a shelf-visit proxy, not a time saving.** It assumes one visit per distinct
   SKU per bill and no walking-order effect. No picker was timed.
6. **The W1 13:00 split is arbitrary.** It was specified, not derived; the depot's real morning/
   afternoon boundary may differ, and W1's numbers move with it.
7. **Buckets are hard-edged.** Two bills 10 minutes apart across 13:00 (W1) or midnight (W2) never
   meet, exactly as two bills in adjacent batches never met at W0. A sliding window would score
   higher than every row in the table.
8. **Arrival ≠ pickability.** Bucketing is on import time; a bill held, tint-routed or early-released
   is not on the floor when its bucket-mates are. `heldAt`/`pickEarlyReleasedAt`/`workflowStage` were
   not consulted.
9. **60 days, one depot, no seasonality** — June–August only, and dispatch fields remain sparse
   (37.3% of W2 3+ clusters could not be judged on window/date at all).

---

*Read-only diagnosis. Every figure from `SELECT`s against production via
`scripts/analysis/import-overlap-baseline.ts`. No app file modified, no row written, nothing committed.*
