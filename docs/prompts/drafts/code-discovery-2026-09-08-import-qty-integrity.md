# Code discovery — import quantity integrity (Defect A + Defect B)

**Date:** 2026-09-08 · **Mode:** diagnosis only, no code written · **Scope:** `lib/sap-parser/*`,
`lib/import-upsert*`, `app/api/import/obd/route.ts`

**Files read:** `CLAUDE.md`, `docs/CLAUDE_CORE.md`, `docs/CLAUDE_IMPORT.md` (v1.9 · Schema v27.15),
`docs/CLAUDE_UI.md` (header only), `lib/sap-parser/{index,read-sheet,group-rows,apply-rules,build-obd,cells,types}.ts`,
`lib/import-upsert.ts`, `lib/import-upsert/{lines,header,helpers,audit,state}.ts`,
`app/api/import/obd/route.ts` (manual-SAP preview + confirm, `handleConfirm`, `processAutoImportRows`,
`rebuildQuerySummaryForOrder`).

> **Note on the file list in the prompt:** `lib/import-upsert/index.ts` does not exist. The package
> entry point is `lib/import-upsert.ts` (one level up). Read in its place.

**Code provenance check:** `git status --porcelain -- lib app/api/import` is clean, and no commit has
touched `lib/sap-parser`, `lib/import-upsert*` or `app/api/import/obd/route.ts` since 2026-09-01
(last relevant commit `9de0c55b`, 2026-08-09). The code below is the code that ran on 2026-09-07.

**Read-only SELECTs run (CORE §3):** eight, all `SELECT`. They are quoted inline where they change an
answer. No writes.

---

## Headline

There are **two separate defects here, and they are not the same bug.**

- **Defect B is real, is in the code, and I can point at the missing lines.** `patchHeader()` has no
  `totalUnitQty` / `grossWeight` / `volume` handling at all. The header totals are written **once, at
  create time, and never again.** 146 bills currently disagree with their own line sets.
- **Defect A is not a value-crossing bug.** No code path in this repo can put one SAP row's quantity
  onto another SAP row's line — I traced every field of the stored row back to a single source object
  and could not break that chain. What the stored row looks like, in the live data, is a **faithful
  copy of a real file row** that the pipeline had no rule to reject. The evidence note says that row
  read `qty 0 / vol 0 / net wt 0`; the stored row carries `26 / 520 / 650 / 691.86`. **Those two
  statements cannot both be true**, and §Q3 sets out why I believe the file row is the one that moved,
  plus the one cheap test that settles it either way.

Read Q3 before Q1 if you only read one section.

---

## Q1 — the row's journey, function by function

Entry: `POST /api/import/obd?action=manual-sap-confirm`
(`app/api/import/obd/route.ts:3801` → `handleManualSapConfirm`, `route.ts:1595`).

| # | Function | File:line | What happens to the `Item 10` row |
|---|---|---|---|
| 1 | `handleManualSapConfirm` | `route.ts:1595` | Flag gate `SAP_IMPORT_ENABLED` (`:1596`), form parse (`:1603`), then `parseSapFile(buffer, { fallbackObdEmailDate })` at **`route.ts:1609`** |
| 2 | `parseSapFile` | `lib/sap-parser/index.ts:54` | Orchestrator; four calls at `:58-61` |
| 3 | `readSheet` | `read-sheet.ts:77` | `XLSX.utils.sheet_to_json(sheet, {header:1, raw:true, defval:null})` at **`:102-106`**; header width validated `:114-125`; data loop `:130` |
| 4 | — row → `RawSapRow` | **`read-sheet.ts:140-160`** | One object literal per sheet row. `item: toInt(r[11]) ?? 0` (**`:151`**), `deliveryQuantity: toNum(r[14])` (**`:154`**), `volume: toNum(r[15])` (`:155`), `netWeight: toNum(r[16])` (`:156`), `totalWeight: toNum(r[17])` (`:157`), `batch: toStrOrNull(r[18])` (`:158`). Coercers in `cells.ts:8/14/21/32`. **Row-local: index `i` is fixed for the whole literal** |
| 5 | `groupRows` | `group-rows.ts:32` | Buckets by `r.delivery` into a `Map` (`:37-49`). Non-contiguous re-appearance of a delivery raises `duplicate-delivery-header` (`:42-45`, warning at `:54-59`) but **still merges**. Skip rule D.1 at `:75-82` (needs `delivery.length < 10`; 10-digit OBDs never hit it) |
| 6 | `applyRules` | `apply-rules.ts:60` | D.2 all-ZZRE at `:67-75`; per-row filter loop `:82-154`; **qty-0 drop at `:106-111`** (see Q2) |
| 7 | — surviving row → `LineInterim` | **`apply-rules.ts:161-175`** | Second object literal. `lineId: r.item`, `unitQty: r.deliveryQuantity ?? 0`, `volumeLine: r.volume`, `netWeight: r.netWeight`, `totalWeight: r.totalWeight`, `batchCode: r.batch` — **all eight fields from the same `r`** |
| 8 | `buildObds` | `build-obd.ts:33` | Per delivery: header from `g.rows[0]` (`:60`), `totalUnitQty = lines.reduce(...)` (**`:65`**), `volume`/`grossWeight` via `sumOrNull` (`:66-67`), then per line `lineToObdLineInput` (`:74`) |
| 9 | `lineToObdLineInput` | `build-obd.ts:122-144` | Third object literal, 1:1 from `l`. Adds `article`/`articleTag` from `computeArticleInfo` (`:126`) against the file-wide `PackCatalog` loaded once at `:47` |
| 10 | back in the handler | `route.ts:1636-1708` | Bulk preload of existing orders / summaries / lines / customers; `linesBySummaryId` at `:1688-1692` |
| 11 | `upsertObd` | `lib/import-upsert.ts:92` | `loaded.order === null ?` → `createPath` (`:126-129`) else `patchPath` (`:131`). Called from **`route.ts:1729`** |
| 12 | `patchPath` | `import-upsert.ts:302` | `patchHeader` (`:317`) + `patchLines` (`:318`); executes at `:339-349` |
| 13 | `patchLines` | `lines.ts:49` | Existing keyed by `makeKey(lineId, sku)` at `:69-80`; incoming keyed **and deduped** at `:81-91`; unmatched incoming → `plan.adds` at **`:97-101`**; unmatched existing → `plan.removes` at `:152-164` |
| 14 | `applyLinePatch` | `lines.ts:178` | **`createMany` at `:186-205`** — the INSERT that produced `import_raw_line_items` id 51767. Every column comes from one `inc` (`:188-203`) |
| 15 | `writeAuditLogs` | `audit.ts:33` | `[line_added] lineId 10 (sku IN28140081, qty 26) via manual-sap batch BATCH-20260907-063` — note built at `import-upsert.ts:364-366`, format at `audit.ts:16-23` |
| 16 | effect loop | `route.ts:1762-1795` | `rebuildQuerySummaryForOrder` (`route.ts:551`) recomputes `import_obd_query_summary` from the **live active lines** — so the ghost propagated to the query cache too |

Confirmed against live data (read-only): the batch is **manual-sap**, not auto-import —

```sql
-- read-only
SELECT id, "batchRef", "headerFile", "totalObds" FROM import_batches
WHERE "batchRef" IN ('BATCH-20260907-063','BATCH-20260907-015');
--  2716 | BATCH-20260907-063 | [manual-sap] EXPORT orbit 07.09.2026.XLSX (obdEmailDate: 2026-09-07) | 280
--  2668 | BATCH-20260907-015 | [auto-import] auto-json                                              |   3
```

and the audit notes carry the literal `via manual-sap batch BATCH-20260907-063`. So the path above is
the path that ran; steps 11-14 took the **patch** branch.

**Confidence: high.** Every hop is a direct call, not an import. Step 11's branch is proved by the
audit-note verb (`line_added`/`line_patched` are emitted only from `patchPath`, `import-upsert.ts:361-393`).

---

## Q2 — where the qty-0 drop lives, and when it is skipped

**`lib/sap-parser/apply-rules.ts:106-111`**, inside the per-row loop of `applyRules`:

```ts
      if (r.deliveryQuantity === null || r.deliveryQuantity === 0) {
        // Silent drop — SAP convention: qty=0 means the row carries no
        // pickable quantity (either not yet picked or already fully picked
        // via a counterpart row). We're only interested in qty>0.
        continue;
      }
```

That is the **only** qty filter anywhere in the import pipeline. `grep -n "deliveryQuantity\|unit_qty\|unitQty"`
across `lib/` and `app/api/import/` returns no other guard.

**When it is not reached:**

1. **Earlier `continue`s in the same loop win.** Row-level non-LF at `:87-94` and ZZRE at `:96-104`
   both fire *before* it. A qty-0 row that is also non-LF is recorded as `"non-LF row"`, never as a
   silent drop — a cosmetic difference, but it changes what the preview shows.
2. **The whole delivery was already skipped.** D.1 in `group-rows.ts:75-82` and D.2 (all-ZZRE) in
   `apply-rules.ts:67-75` remove the delivery before `applyRules` reaches the row loop.
3. **The other two import paths do not have this filter at all.**
   - Auto-import (`?action=auto` / `?action=auto-json`) — `processAutoImportRows`, **`route.ts:2684`**:
     `const unitQty = toInt(lr["unit_qty"]) ?? 0;` then an unconditional `lines.push(...)` at `:2723`.
   - Manual-template (`?action=confirm`) — `handleConfirm`, **`route.ts:817`**: identical shape,
     unconditional `return {...}` at `:833`.
   Both **can** store a qty-0 line. **Reachability check (read-only):**
   `SELECT "lineStatus", count(*) FROM import_raw_line_items WHERE "unitQty" = 0 GROUP BY 1;`
   returns **zero rows** — so neither path has ever actually done it in live data. Capability, not
   an active leak. Worth knowing before anyone "harmonises" the three paths.
4. **It is a parse-time filter only.** Nothing re-applies it at write time. If a qty-0 line ever did
   reach `patchLines`, `applyLinePatch` (`lines.ts:186-205`) would insert it without comment.

**Doc drift found while checking this** (report only, do not fix here): `CLAUDE_IMPORT.md §5` prints
the `COL` constants as 0-based; the code (`read-sheet.ts:21-41`) is 1-based with `- 1` applied at each
read. Same map, different convention — but the doc block is not the code. §6 also names
`loadExistingState()`, `dispatchEffects()`, `recordAuditEntry()` and a `UpsertOutcome` of
`'new'|'patched'|'no-change'`; the real names are `loadExistingObd()` (`state.ts:17`), `buildEffects()`
(`effects.ts`), `writeAuditLogs()` (`audit.ts:33`) and `"created"|"patched"|"unchanged"|"errored"`.

**Confidence: high.**

---

## Q3 — ROOT CAUSE of the wrong quantity

### There is no line that does it

I looked for exactly what the brief asked for — a group / map / reduce / key that could let one row's
values land on another row — and the search comes back empty. The three places a `unitQty` is copied
are all single-source object literals:

| Site | File:line | Source |
|---|---|---|
| `RawSapRow` build | `read-sheet.ts:140-160` | one `r = rawArr[i]`, `i` fixed for the literal |
| `LineInterim` build | `apply-rules.ts:162-174` | one `r` from `usableRows` |
| DB row build | `lines.ts:188-203` | one `inc` from `plan.adds` |

The only maps in the pipeline are keyed correctly:

- `group-rows.ts:33` — `Map<delivery, RawSapRow[]>`. Keyed on delivery, but it only *buckets*; it
  never merges values across rows.
- `lines.ts:69-91` — **both** sides keyed on `makeKey(lineId, skuCodeRaw)` (`lines.ts:28-30`), i.e.
  `lineId + "|" + sku`. This is the composite key the brief was pointing at, and it is correct.
- `lib/article-tag.ts` `PackCatalog` — keyed on `material` alone, and this **is** a
  material-only key. But it only supplies `article` / `articleTag`; `computeArticleInfo` receives
  `{ material, unitQty, volumeLine }` per line (`build-obd.ts:126-129`) and returns no quantity. It
  cannot move a qty.

### What the live row actually looks like

```sql
-- read-only
SELECT id,"lineId","skuCodeRaw","batchCode","unitQty","volumeLine","netWeight","totalWeight","lineStatus","createdAt"
FROM import_raw_line_items WHERE "obdNumber"='9109269668' ORDER BY id;
```

| id | lineId | sku | batchCode | unitQty | volumeLine | netWeight | totalWeight | lineStatus | createdAt |
|---|---|---|---|---|---|---|---|---|---|
| 50546 | 900001 | IN28140081 | *null* | 54 | 1080 | *null* | *null* | active | 09-07 05:46:34 |
| … | 900002-900027 | … | *null* | … | … | *null* | *null* | active | 09-07 05:46:34 |
| **51767** | **10** | IN28140081 | ***null*** | **26** | **520** | **650** | **691.86** | **removed_by_import** | 09-07 12:54:27.031 |
| 51768 | 900028 | IN28140081 | T20260901 | 26 | 520 | 650 | 691.86 | active | 09-07 12:54:27.031 |

Two facts the evidence note did not have:

1. **The ghost row carries `netWeight 650` and `totalWeight 691.86`.** The note records the file's
   Item 10 as `Net wt 0`. A row parsed as `0 / 0 / 0` cannot become `26 / 520 / 650 / 691.86` —
   it would not even survive `apply-rules.ts:106`, and if it somehow did, `netWeight` would be `0`.
2. **The ghost row's `batchCode` is `null` while 900028's is `T20260901`.** If some step had copied
   900028's values onto Item 10, `batchCode` sits in the *same object literal* as `unitQty`
   (`apply-rules.ts:166-170`, `lines.ts:192-198`) and would have travelled with them. It did not.

### Why "identical to 900028" is not evidence of copying

The four measures match 900028 exactly. That is expected, not suspicious: both rows are **26 units of
the same SKU**. Volume (26 × 20 L = 520), net weight (26 × 25 kg = 650) and gross weight are all
functions of quantity × SKU. Two rows of the same SKU at the same quantity *must* agree on all four.

The two prior occurrences prove the point, because there the quantities are equal but the **weights
and batches differ**:

```sql
-- read-only: every case where a low-lineId row shadows a 900k row of the same SKU at the same qty
SELECT a."obdNumber", a.id, a."lineId", b."lineId", a."skuCodeRaw", a."unitQty",
       a."batchCode", b."batchCode", a."netWeight", b."netWeight", a."lineStatus", a."createdAt"
FROM import_raw_line_items a
JOIN import_raw_line_items b
  ON a."obdNumber"=b."obdNumber" AND a."skuCodeRaw"=b."skuCodeRaw" AND a."unitQty"=b."unitQty"
WHERE a."lineId" < 900000 AND b."lineId" >= 900000
ORDER BY a."createdAt" DESC;
```

| OBD | low line | high line | sku | qty | low batch | high batch | low netWt | high netWt | when |
|---|---|---|---|---|---|---|---|---|---|
| 9109269668 | 10 | 900028 | IN28140081 | 26 | *null* | T20260901 | 650 | 650 | 2026-09-07 |
| 9107524057 | 10 | 900001 | IN83109023 | 1 | **B20260301** | T20251101 | **1.25** | **1.29** | 2026-06-13 |
| 9107524057 | 20 | 900002 | IN83109223 | 1 | **B20260301** | T20251101 | **1.25** | **1.22** | 2026-06-13 |
| 9107433939 | 10 | 900001 | 5948208 | 1 | **B20260301** | C20260401 | **1** | **1.28** | 2026-06-04 |

In the June cases the low-lineId row carries **its own batch code and its own weights**, different
from the 900-series partner's. Those are unambiguously real, independent rows in the SAP file — no
copying mechanism could produce a *different* weight. And all four rows across all three events were
later soft-removed by a subsequent import, i.e. the *next day's* SAP file no longer contained them
with a quantity.

### The root cause, stated

**The SAP export intermittently emits a parent delivery item carrying a real quantity alongside its
batch sub-item(s) carrying the same stock, and the pipeline has no rule that reconciles a parent item
against its batch sub-items — so it stores both and double-counts.** The parser's contract is
explicitly 1:1 ("STEP 2 — 1:1 mapping. Every surviving row becomes one LineInterim",
`apply-rules.ts:156-159`), a deliberate 2026-05-14 change away from SKU-summing. The qty-0 convention
at `apply-rules.ts:106` is the *only* thing that normally hides parent rows, and it works by accident
of SAP usually zeroing them: **1,662 of 1,663 zeroed parents were dropped by that line.** When SAP
does not zero the parent, nothing catches it.

For 9109269668 this stored 54 + 26 + 26 = 106 units of IN28140081 where SAP's own header says 80.

**This directly contradicts the evidence note's `Item 10 … Delivery qty 0 / Volume 0 / Net wt 0`.**
I am not able to reconcile those and I will not pretend to. Either the note's row reading is of a
different row/version of the file, or something outside `lib/sap-parser` produced four numbers
simultaneously while leaving `lineId` and `batchCode` behind — and I could not find any code, in this
repo, capable of the second.

**The decisive test, which costs about a minute and needs no code change:** open
`EXPORT orbit 07.09.2026.XLSX`, filter column 1 = `9109269668`, and read **column 15** on the
`Item 10` row. The parser is deterministic given the buffer (`CLAUDE_IMPORT.md §5`), so equivalently:
run `parseSapFile()` on that exact buffer in a scratch script and print the lines for that delivery.
If column 15 reads `26`, the finding above stands and the fix belongs in the parent/batch rule. If it
reads `0`, everything in this section is wrong and the investigation has to move to SheetJS row
addressing (a workbook whose cell `r` attributes are inconsistent — which happens with hand-edited /
re-saved files, and the batch filenames in this table are visibly hand-managed: `EXPORT orbit …`,
`EXPORT 22.08.chhh.XLSX`, `SAMPLES.xlsx`, `EXPORT 04.06.2026 CHAA.XLSX`).

**Confidence: ~85% that the file row carried the quantity; near-certain that no line of application
code crossed values between rows.** The second half is what I would stake the report on; the first
half is inference from four rows of live data.

### The gate that would have caught it

`import_raw_summary.totalUnitQty` for this OBD is **1724** (written by auto-import from SAP's own
header field). Sum of active lines *with* the ghost was **1750**; without it, exactly **1724**. SAP's
header total and the line set disagreed by precisely the double-counted 26 — and nothing in the code
compares them. Which is Defect B.

---

## Q4 — create path vs patch path

**On the specific question asked: no difference.** A qty-0 row is dropped by
`apply-rules.ts:106-111`, which runs **once, inside `parseSapFile`, before `upsertObd` is called at
all** (`route.ts:1609` vs `route.ts:1729`). Both branches consume the same `input.lines`:

- `createPath` — `import-upsert.ts:239-258`, `createMany` over `input.lines`
- `patchPath` → `patchLines` — `lines.ts:97-101`, `plan.adds` drawn from `input.lines`

The hypothesis that a new bill drops the row while an existing bill adds it is **refuted**. Live
proof from the same file, same batch, same second: OBD **9109323885** was a *new* bill and got its
`lineId 10` row created too (`id 51766`, qty 100 — a legitimate non-batch-split delivery, part of the
186 low-numbered rows carrying real stock that the brief flags as untouchable).

**But the two paths do differ in a way that matters, and it is worth recording:**

| | createPath | patchPath |
|---|---|---|
| duplicate `(lineId, sku)` in the incoming set | **not deduped** — `import-upsert.ts:239-258` inserts every element of `input.lines` | **deduped, first wins, `console.warn` only** — `lines.ts:83-90` |
| `totalUnitQty` / `grossWeight` / `volume` on `orders` + `import_raw_summary` | written from the parse (`import-upsert.ts:188-190`, `:224-226`) | **never written** — `patchHeader` has no such field (Defect B) |
| `netWeight` / `totalWeight` on lines | written (`import-upsert.ts:250-251`) | written on **adds** only (`lines.ts:197-198`); **never patched** on an existing line, because `ExistingLine`'s select omits both (`state.ts:44-47`) and `patchLines` compares only `unitQty`, `volumeLine`, `isTinting` (`lines.ts:110-122`) |
| `article` / `articleTag` on lines | written | **adds only**; never refreshed on an existing line (matches `CLAUDE_IMPORT.md §15`) |

So the same file, re-uploaded, produces a *different row count* depending on whether the OBD already
existed. Not the cause here, but a real asymmetry.

**Confidence: high.** Both branches read; the counter-example is live data from the same batch.

---

## Q5 — why the header goes stale

**What writes `import_raw_summary.totalUnitQty`** — three sites, all create-only:

| Path | File:line | Value |
|---|---|---|
| manual-sap create | `lib/import-upsert.ts:224` | `input.totalUnitQty` = **summed from lines**, `build-obd.ts:65` (`lines.reduce((acc,l) => acc + l.unitQty, 0)`) |
| manual-template create | `route.ts:866` | `toInt(hr["UnitQty"])` — **taken from the header sheet**, never checked against the lines |
| auto-import create | `route.ts:2756` | `toInt(hr["UnitQty"])` — **taken from the Breakwalls JSON header**, never checked against the lines |

**What never writes it: the patch path.** `patchHeader` (`lib/import-upsert/header.ts:41-145`) handles
`customerId`, `customerMissing`, `shipToCustomerName`, `soNumber`, `invoiceNo`, `invoiceDate`,
`materialType`, `natureOfTransaction`, `warehouse`, `sapStatus`, `smu`, `smuCode`, `obdEmailDate`,
`obdEmailTime`, `orderDateTime`, `slotId`/`originalSlotId`/`dispatchSlot`/`arrivalSlotId`.

`totalUnitQty`, `grossWeight` and `volume` **do not appear in the file at all.** `grep -n
"totalUnitQty\|grossWeight\|volume" lib/import-upsert/header.ts` → no matches. `applyHeaderPatch`
(`:152-163`) therefore never sends them, and `applyLinePatch` (`lines.ts:178-236`) touches only
`import_raw_line_items` and `split_line_items`. When `patchLines` retires, adds or re-quantifies a
line, **nothing anywhere recomputes the header.**

Note that even adding them to the existing machinery would not work: every patchable field goes
through `fillNull` (`header.ts:54-64`), which fires **only** on `null → value`. `totalUnitQty` is a
non-null number on any bill that has one, so a `fillNull("totalUnitQty", …)` would be a permanent
no-op. This needs its own recompute, not another `fillNull` line.

**Header from the SAP header field, or summed from lines?** Both, depending on which path created
the bill — and that is itself a defect source, independent of drift:

- manual-sap: summed from lines → correct **at birth**, drifts afterwards.
- auto-import / manual-template: taken from the payload header → **can be wrong at birth** and never
  reconciled.

**What is fresh:** `import_obd_query_summary.totalUnitQty` **is** recomputed from live active lines on
every patch — `rebuildQuerySummaryForOrder`, `route.ts:570` (`lines.reduce(...)`), upserted at
`:585-606`, fired as the `query-summary-rebuild` effect (`route.ts:1773-1779`). So the app has **two
totals that disagree by design**: a stale one on `import_raw_summary` and a fresh one on
`import_obd_query_summary`. Which one a screen shows depends on which table it reads.

**Confidence: high.** This is an absence in a file I read end to end, and the three write sites are
`grep`-complete.

---

## Q6 — hypotheses for the 29 and the 2

I re-ran your sweep to get the classification right before hypothesising. Read-only:

```sql
-- read-only
WITH s AS (
  SELECT DISTINCT ON ("obdNumber") "obdNumber", id, "batchId", "totalUnitQty", "createdAt"
  FROM import_raw_summary WHERE "totalUnitQty" IS NOT NULL ORDER BY "obdNumber", id ASC
), l AS (
  SELECT "obdNumber",
         SUM(CASE WHEN "lineStatus"='active' THEN "unitQty" ELSE 0 END) AS act,
         COUNT(*) FILTER (WHERE "lineStatus" <> 'active')               AS nret
  FROM import_raw_line_items GROUP BY "obdNumber"
)
SELECT s."obdNumber", b."headerFile", s."totalUnitQty" AS hdr, l.act, l.nret
FROM s JOIN l USING ("obdNumber") JOIN import_batches b ON b.id = s."batchId"
WHERE s."totalUnitQty" <> l.act;
```

146 rows, matching your count. The no-retired-line under-count bucket is **29**, and the over-count
bucket is **2**. `DISTINCT ON … ORDER BY id ASC` mirrors `state.ts:35-38`, which is the summary the
upsert actually patches.

### Hypothesis for the 29 — it is Defect B with a different mutation, plus a birth defect

The 29 split cleanly in two once you look at the audit trail:

**(a) ~19 bills: an in-place `unitQty` patch moved the line sum without adding or retiring anything.**
`patchLines` at `lines.ts:110-113` updates `unitQty` on a matched line and records a `[line_patched]`
entry. No `lineStatus` changes, no row created — so "has retired lines" is `no` and "lines added
later" is `false`, yet the sum moved. Header frozen. Exactly the 9109269668 mechanism minus the ghost.

**(b) ~10 bills: born mismatched on the auto-import path.** `route.ts:2756` writes the header from
`hr["UnitQty"]` while the lines come from the payload's line array. Nothing reconciles them, so these
were never equal — not drift at all. The extreme cases make this obvious: `9107931925` header **471**
vs lines **2**; `9107878744` **184** vs **9**; `9108630612` **293** vs **82`.

**Proving SQL** (one query, decides both):

```sql
-- read-only
SELECT o."obdNumber",
       b."headerFile"                                                    AS created_by,
       count(*) FILTER (WHERE l.note LIKE '[line_patched]%unitQty%')     AS qty_patches,
       count(*) FILTER (WHERE l.note LIKE '[line_%')                     AS line_events
FROM orders o
JOIN import_raw_summary s ON s."obdNumber" = o."obdNumber"
JOIN import_batches b     ON b.id = s."batchId"
LEFT JOIN order_status_logs l ON l."orderId" = o.id
WHERE o."obdNumber" IN (<the 29>)
GROUP BY 1, 2
ORDER BY qty_patches DESC;
```

- **Pass for (a):** `qty_patches >= 1`. Proves the line sum was changed in place by
  `lines.ts:110-113` after the header was written — Defect B, no new sub-defect.
- **Pass for (b):** `qty_patches = 0 AND line_events = 0 AND created_by LIKE '[auto-import]%'`.
  Proves the bill was never patched at all, so the header and lines disagreed from birth — a
  **second, distinct defect** in `route.ts:2756`, which a Defect-B recompute would silently paper over
  rather than fix.
- **Fail (would kill both):** a bill with `qty_patches = 0`, `line_events = 0` and a `[manual-sap]`
  birth. That would mean the create path itself wrote a header that disagreed with its own
  `build-obd.ts:65` sum — impossible by construction, so it would mean something writes
  `import_raw_summary.totalUnitQty` outside the three sites in Q5, and the Q5 answer is incomplete.

I ran this. **19 land in (a), 10 in (b), all ten of the (b) rows created by `[auto-import] auto-json`.
Zero fails.** So the hypothesis is confirmed, not merely testable — but the query is written out above
so it can be re-run after any fix.

### Hypothesis for the 2 — the whole line set was replaced, and the header froze at the smaller original

`9107512395` and `9107512397` are the same shape, six days apart. Read-only:

| OBD | summary batch | hdr | line id | lineId | sku | qty | status | created |
|---|---|---|---|---|---|---|---|---|
| 9107512395 | `[manual-sap] SAMPLES.xlsx` (08-06) | 2 | 38562 | 10 | IN28099272 | 2 | removed_by_import | 08-06 06:42 |
| 9107512395 | | | 39985 | 10 | **5818104** | **30** | active | 08-07 05:33 |
| 9107512397 | `[manual-sap] SAMPLES.xlsx` (08-08) | 2 | 40604 | 10 | IN28079072 | 2 | removed_by_import | 08-08 11:53 |
| 9107512397 | | | 41258 | 10 | **IN36819081** | **15** | active | 08-11 05:36 |

The bill was created with one line of qty 2 (header correctly 2, summed at `build-obd.ts:65`). A later
manual-sap upload carried a **different SKU on the same `lineId` 10**. Because `makeKey` is
`lineId|sku` (`lines.ts:28-30`), the new SKU is a different key: the old line goes to `plan.removes`
(`lines.ts:152-164`) and the new one to `plan.adds` (`lines.ts:97-101`). Header stays 2.

So "over-count" and "under-count" are **not two phenomena**. They are the same frozen header; the sign
just depends on whether the replacement line set was larger or smaller than the original. These two
are "over" only because the original happened to be a 2-unit sample order.

**Proving SQL:**

```sql
-- read-only
SELECT "obdNumber", "lineId", "skuCodeRaw", "unitQty", "lineStatus", "createdAt"
FROM import_raw_line_items
WHERE "obdNumber" IN ('9107512395','9107512397')
ORDER BY "obdNumber", id;
```

- **Pass:** for each OBD, a `removed_by_import` row and an `active` row **sharing a `lineId` but with
  different `skuCodeRaw`**, the removed row's qty equalling the header. Proves SKU-swap-on-same-lineId
  → remove+add, header frozen — same Defect B, no new mechanism, and **nothing to fix beyond B**.
- **Fail:** the two rows share `lineId` *and* `skuCodeRaw`, or the header (2) matches neither the
  removed nor the active qty. That would mean the header was never the line sum even at create, i.e.
  something wrote `import_raw_summary.totalUnitQty` outside `import-upsert.ts:224` — a different bug
  needing its own hunt.

I ran this. **Pass.**

**Confidence: high on both** — the classification query and the two proving queries were executed, not
just drafted.

---

## Confidence summary — and what I could not settle

| Answer | Confidence | Basis |
|---|---|---|
| Q1 journey | High | Every hop a direct call; branch proved by the audit-note verb |
| Q2 drop site + skip conditions | High | Single site, `grep`-complete; the "other two paths" claim checked against live data (zero qty-0 rows ever stored) |
| Q3 "no code crosses values between rows" | High | Three single-source object literals; both maps keyed on `lineId\|sku` |
| Q3 "the file row carried the quantity" | **~85%** | Four live rows across three dates; June cases show *different* weights and batches on the low-lineId row |
| Q4 no create/patch divergence on the drop | High | Drop precedes `upsertObd`; live counter-example in the same batch second |
| Q5 header staleness | High | Absence in a fully-read file; three write sites grep-complete |
| Q6 both hypotheses | High | Proving queries executed, zero fails |

**Not settled — and it is the one thing that matters most:**

1. **What column 15 of the `Item 10` row actually reads in `EXPORT orbit 07.09.2026.XLSX`.** The
   evidence note says `0`; the stored row's four measures say `26 / 520 / 650 / 691.86`. I could not
   obtain the file (`test/fixtures/` holds only the pre-2026-05-14 28-column layout, which the current
   parser rejects outright). **Do not pick a fix for Defect A until this is read.** Options 1 and 3
   below are wrong if the cell says `0`.
2. **Why SAP left that parent un-zeroed.** Three occurrences in four months, always a low-numbered
   parent whose quantity equals its batch sub-item's, always soft-removed by the next day's export.
   That is an SAP-side export-timing question, not answerable from this repo.
3. **Whether the June rows' `B20260301` batch code is meaningful** (a placeholder batch on
   un-picked parents?). If it is, it is a cheap discriminator for a parent row. One depot question.

---

## Fix options — implement none

### Defect A — the double-counted parent row

**Prerequisite for options 1 and 3: read column 15 of that row first (above).**

**A1 — Collapse a parent item against its batch sub-items, per delivery, in `applyRules`.**
Within one delivery, if a row with `lineId < 900000` shares its `skuCodeRaw` with one or more
`lineId >= 900000` rows, drop the parent and keep the batch rows. Fires only on the ambiguous case;
leaves 9109323885's `lineId 10` (no 900-series partner for that SKU) untouched, so the 186 real
low-numbered rows are safe — this is *not* the rejected "ignore all `lineId < 900000`".
- **What could break:** a delivery where a parent row and a batch row legitimately carry *separate*
  stock of the same SKU. Nothing in the four observed rows suggests that exists, but nothing proves it
  doesn't. Also invisible: parents that arrive in a *different* export from their batch rows, where
  the parent is already in the DB and the collapse has no incoming partner to see.
- **Gate that would prove it safe:** replay the last 60 days of SAP exports through the new
  `applyRules` offline and diff the emitted line sets against `import_raw_line_items`. The only
  differences may be the 4 rows in the Q3 table. Any fifth difference kills it.

**A2 — Do not filter; detect. Add a post-patch invariant and surface it.**
After `applyLinePatch`, compare `SUM(active unitQty)` against `import_raw_summary.totalUnitQty` and
raise a warning (preview) / an `import_shadow_log` row (confirm) when they disagree. Changes no
stored quantity; makes the ghost visible the moment it lands. On 9109269668 this fires exactly:
1750 vs 1724.
- **What could break:** nothing stored — but it is **noise-coupled to Defect B**. Until B is fixed,
  146 existing bills would alarm on their next touch. Sequence it after B, or scope it to bills
  whose header was written this batch.
- **Gate:** run it in shadow for one week; the true-positive rate must be near 1 before anyone is
  asked to act on the alarm.

**A3 — Trust SAP's own header total over the parsed line sum.**
Where the file gives a delivery-header quantity, use it to reject a line set that overshoots.
- **What could break:** the manual-SAP 19-column layout **has no header quantity column**
  (`read-sheet.ts:21-41`) — the total is a `reduce` over the very lines in question
  (`build-obd.ts:65`). This only works on the auto-import payload, i.e. exactly the source that is
  *already* unreliable per Q6(b). **I would not pursue this**; listed because it is the obvious idea
  and it should be closed out explicitly.
- **Gate:** none worth designing; the column does not exist.

### Defect B — the frozen header

**B1 — Recompute `totalUnitQty` / `grossWeight` / `volume` from the live active lines at the end of
`patchPath`, whenever `lineHadChanges`.**
Mirror `rebuildQuerySummaryForOrder` (`route.ts:565-573`), which already does exactly this sum for the
other table, and write via `applyHeaderPatch`. Sequential awaits, no `$transaction`. Must **not** go
through `fillNull` — that only fires on `null → value` and would be a permanent no-op (Q5).
- **What could break:** every consumer that today reads `import_raw_summary.totalUnitQty` and has been
  quietly tuned to the frozen value; and the auto-import population from Q6(b), where recomputing
  would *overwrite* SAP's own header figure with a line sum that may be the wrong one (header 471 vs
  lines 2 — recomputing to 2 would destroy the only surviving evidence that 469 units are missing).
- **Gate:** enumerate readers first —
  `rg -n 'totalUnitQty' --glob '!node_modules' app components lib` — and confirm each reader's
  expectation. Then dry-run the recompute over all 13,587 bills and require that the 13,441 already-
  matching bills produce a **zero-row diff**, and that the 146 movers are exactly the 146 identified.

**B2 — Leave the stored header alone; make the mismatch a first-class, queryable signal.**
Add a nightly read-only reconciliation (the Q6 sweep) writing to `import_shadow_log`, and point every
display at `import_obd_query_summary` (already fresh, `route.ts:570`) instead of
`import_raw_summary`.
- **What could break:** nothing in the data — but it **preserves the divergence**, so the 10 auto-import
  birth-mismatches stay wrong forever unless separately fixed, and the two-totals confusion in Q5
  becomes permanent-by-policy rather than accidental.
- **Gate:** the same reader enumeration as B1; the switch is only safe if every reader can be moved.

**B3 — Fix the birth defect only: make auto-import and manual-template write the summed line total
instead of `hr["UnitQty"]`** (`route.ts:866`, `route.ts:2756`), and keep `hr["UnitQty"]` in a
separate column as SAP's claim.
- **What could break:** it silently changes what `totalUnitQty` *means* for two of three sources, and
  a new column is a schema change — Supabase SQL Editor + hand-edit `schema.prisma` + `prisma
  generate` (CORE §3), never `db push`. It also does nothing for the 19 drift bills; B1 or B2 is still
  needed.
- **Gate:** back-compute what the summed total *would have been* for the last 500 auto-import births
  and compare against `hr["UnitQty"]`. If they agree on all but a handful, the header field is
  basically sound and this option is not worth a schema change.

**Sequencing note.** B before A2 — A2's alarm is unreadable while 146 bills are already mismatched.
And A1/A3 should not be chosen at all until the file cell in the "not settled" list is read.

---

*Diagnosis only. No files changed except this report. Eight read-only SELECTs against production
(CORE §3); no INSERT/UPDATE/DELETE/ALTER/DROP, no `prisma db push`, no `prisma.$transaction`.
`removed_by_import` quoted exactly as it appears in `lines.ts:159/219`.*

---
---

# ADDENDUM — 2026-09-08, second session: the reproduction experiment

**Files read:** `docs/CLAUDE_CORE.md §3`, `lib/sap-parser/*.ts` (all seven). **All files read.**
**Method:** one throwaway script (`pass.probe.ts`, gitignored by the existing `pass.*` rule at
`.gitignore:45`), zero DB calls in the parse run; six further read-only SELECTs to identify the file.
Nothing staged, nothing committed, nothing deleted, no fix applied.

## 0. Name check — and it turns out to be the whole story

`docs\vl06O\` contains **exactly one file**: `EXPORT 07.09 orbit.XLSX` (262,751 bytes, mtime
2026-09-08 11:19). **No file matching the recorded name `EXPORT orbit 07.09.2026.XLSX` exists there**,
so the experiment ran on one file only.

The recorded name turns out not to identify anything. Read-only:

```sql
-- read-only
SELECT id, "batchRef", "headerFile", "totalObds", "createdAt" FROM import_batches
WHERE "headerFile" LIKE '[manual-sap]%' AND "createdAt"::date = '2026-09-07' ORDER BY id;
```

| batch | ref | totalObds | at |
|---|---|---|---|
| 2663 | BATCH-20260907-010 | 28 | 05:19 |
| 2669 | BATCH-20260907-016 | 39 | 05:47 |
| 2708 | BATCH-20260907-055 | 254 | 11:34 |
| 2715 | BATCH-20260907-062 | 279 | 12:36 |
| **2716** | **BATCH-20260907-063** | **280** | **12:54** |
| 2718 | BATCH-20260907-065 | 308 | 13:13 |
| 2719 | BATCH-20260907-066 | 310 | 13:28 |

**Seven different uploads on 2026-09-07, every one recorded as `EXPORT orbit 07.09.2026.XLSX`.** The
operator re-exports from SAP through the day and re-uploads under the same name. The filename in
`import_batches.headerFile` is a reused label, not an identifier.

## 1. What the script printed for lineId 10 — verbatim

```
xlsx version: 0.18.5
sheet: Sheet1 !ref: A1:S3585
rawArr.length: 3585

=== STAGE 0: raw SheetJS arrays ===
RAW sheet row 317 (len 19): ["9109269668","IN53","2000","70","3579102","AASHVI PAINTS AND COLOURS","3579102","AASHVI PAINTS AND COLOURS","1046727875","LF","TAN","10","IN28140081","DN SATIN STAY BRIGHT WHITE 20L",0,0,0,0,""]
RAW sheet row 369 (len 19): ["9109269668","IN53","2000","70","3579102","AASHVI PAINTS AND COLOURS","3579102","AASHVI PAINTS AND COLOURS","1046727875","LF","TAN","900028","IN28140081","DN SATIN STAY BRIGHT WHITE 20L",26,520,650,691.86,"T20260901"]

=== STAGE 0b: direct cell reads (no sheet_to_json) ===
row 317: L317="10"  M317="IN28140081"  O317=0  P317=0  Q317=0  R317=0  S317=""
row 369: L369="900028"  M369="IN28140081"  O369=26  P369=520  Q369=650  R369=691.86  S369="T20260901"

=== STAGE 1: readSheet() ===
rows: 3584 totalRows: 3584 warnings: 0
RawSapRow rowNumber=317 {"delivery":"9109269668","item":10,"material":"IN28140081","deliveryQuantity":0,"volume":0,"netWeight":0,"totalWeight":0,"batch":null,"deliveryType":"LF","itemCategory":"TAN"}
RawSapRow rowNumber=369 {"delivery":"9109269668","item":900028,"material":"IN28140081","deliveryQuantity":26,"volume":520,"netWeight":650,"totalWeight":691.86,"batch":"T20260901","deliveryType":"LF","itemCategory":"TAN"}

=== STAGE 2: groupRows() ===
group found: true rows in group: 53
duplicate-delivery warnings for this OBD: 0
  grouped row 317: item=10 qty=0 vol=0 nw=0 tw=0 batch=null
  grouped row 369: item=900028 qty=26 vol=520 nw=650 tw=691.86 batch="T20260901"

=== STAGE 3: applyRules() — emitted lines for 9109269668 ===
line count: 28
  ... 900001 qty 54 vol 1080 nw 1350 tw 1436.94 batch T20260801  (parentRowNumber 342)
  ... 900002 ... 900027 ...
  {"lineId":900028,"skuCodeRaw":"IN28140081","unitQty":26,"volumeLine":520,"netWeight":650,"totalWeight":691.86,"batchCode":"T20260901","parentRowNumber":369}

lineId 10 present? false

=== CONTROL 9109323885 (live id 51766: lineId 10, 5857610, qty 100) ===
[{"lineId":10,"skuCodeRaw":"5857610","unitQty":100,"volumeLine":3000,"netWeight":3000,"totalWeight":3016,"batchCode":null,"parentRowNumber":911}]
```

**For lineId 10 the parser prints nothing — the row is dropped, and `lineId 10 present? false`.**
28 lines emitted, matching the 28 that are active in the DB today.

(The run stops at `applyRules` deliberately: `buildObds` is the one stage that touches the DB
(`build-obd.ts:47` -> `loadPackCatalog`), and the brief said no database calls. `buildObds` is a 1:1
pass-through for all seven printed fields — `build-obd.ts:131-143` — so it cannot change this result.)

## 2. Reproduced: **NO**

`readSheet` reads row 317 exactly as the raw XML holds it — `0,0,0,0` — and
`apply-rules.ts:106-111` drops it. SheetJS 0.18.5 is not at fault: the direct cell reads at Stage 0b
bypass `sheet_to_json` entirely and agree with it cell for cell. No stage of the parser ever puts
row 369's numbers on row 317.

## 3. Not applicable — but the reason is not "the ghost was written after parsing"

The brief offered two branches. The truth is a third: **the file in `docs\vl06O\` is not the file
batch 063 parsed.** It is a later export of the same report. Three independent proofs:

**(a) Delivery count.** The disk file parses to **374 deliveries, 0 skipped**. The confirm handler
writes `totalObds = parseResult.skipped.length + results.length` and
`skippedObds = parseResult.skipped.length` (`route.ts:1806-1807`), and `results` gains one entry per
`parseResult.obds` element with no early `continue` (`route.ts:1719-1739`). Batch 2716 recorded
`totalObds 280, skippedObds 0` -> **the uploaded file parsed to exactly 280 OBDs.** 374 != 280.

**(b) 94 of the disk file's deliveries did not exist yet at 12:54.** Read-only, against the 374
delivery numbers the script wrote out:

```sql
-- read-only
SELECT count(*) AS in_orders,
       count(*) FILTER (WHERE "createdAt" > '2026-09-07 12:54:30') AS created_after_the_upload,
       max("createdAt") AS newest
FROM orders WHERE "obdNumber" IN (<the 374>);
-- 374 | 94 | 2026-09-07 18:27:33
```

All 94 were created at **2026-09-07 13:13:05** by auto-import batch 2717 (`BATCH-20260907-064`) —
nineteen minutes *after* the upload. And **374 - 94 = 280**, exactly batch 063's `totalObds`.

**(c) No batch ever carried 374 OBDs.** The largest 07.09 upload was 310 (batch 066, 13:28); the two
manual-sap batches on 09-08 are 31 and 33 OBDs from `EXPORT orbit 08.09.2026.XLSX`. The disk file was
**never uploaded at all** — its newest constituent delivery was created at 18:27 on 09-07, so it was
exported that evening at the earliest (mtime says 09-08 11:19).

The content check that seemed to identify it — OBD 9109323885, Item 10, `5857610`, qty 100 — passes
because the disk file is a **superset**. Every OBD in the 12:54 file is in it. That check was
necessary but not sufficient.

### What the 12:54 file actually held for 9109269668 — derived from the audit trail

Batch 063 is `manual-sap`, which is **authoritative** in `LINE_AUTHORITY`, so `patchLines`
(`lines.ts:152-164`) soft-removes every active existing line whose `lineId|sku` key is absent from
the incoming set. Working backwards from what it did and did not do:

| Fact | Source | What it proves about the 12:54 file |
|---|---|---|
| No `[line_removed]` audit row, and no row on this OBD carries a `removed_by_import` from batch 063 | `order_status_logs` + `import_raw_line_items.removedReason` | The file contained **all 27** pre-existing keys (900001-900027) |
| `[line_patched] lineId 900001: unitQty 80 -> 54, volumeLine 1600 -> 1080` | log 62935 | It held row 900001 at 54 / 1080 — same as the disk file |
| `[line_added] lineId 900028 (sku IN28140081, qty 26)` | log 62934 | It held row 900028 at 26 / 520 — same as the disk file |
| `[line_added] lineId 10 (sku IN28140081, qty 26)` | log 62933 | It held a row with **item 10, IN28140081, qty 26** |

`plan.adds` is populated only from `incomingByKey` (`lines.ts:97-101`), and `incomingByKey` only from
`input.lines` (`lines.ts:81-91`). An added line's `unitQty` is `inc.unitQty` and nothing else
(`lines.ts:196`). So the 12:54 file's line set for this delivery was **the disk file's 28 lines plus
one more**: `(item 10, IN28140081, qty 26, vol 520, nw 650, tw 691.86, batch blank)`.

The two exports differ on **exactly one row of fifty-three** — row 317, the parent. Every other row
agrees. At 12:54 SAP emitted that parent carrying 26; by the evening export it had zeroed it.

**So the parent-carrying-quantity finding from the first session is not dead — it is confirmed, and
by a stronger argument than the one it was originally made on.** The `qty 0` cell that was said to
kill it belongs to a different export taken at least five and a half hours later.

## 4. Everything that can write `import_raw_line_items` — swept twice

Ripgrep (via the Grep tool, char-class-safe globs) and MSYS `grep -rnE` independently, then
reconciled. **Both return the same eight sites, no more:**

| # | Site | Verb | Can it INSERT? |
|---|---|---|---|
| 1 | `app/api/import/obd/route.ts:924` — `handleConfirm` (manual-template) | `createMany` | yes |
| 2 | `app/api/import/obd/route.ts:2815` — `processAutoImportRows` (auto / auto-json) | `createMany` | yes |
| 3 | `lib/import-upsert.ts:240` — `createPath` | `createMany` | yes |
| 4 | `lib/import-upsert/lines.ts:187` — `applyLinePatch`, `plan.adds` | `createMany` | **yes** |
| 5 | `lib/import-upsert/lines.ts:208` — `applyLinePatch`, `plan.patches` | `update` | no |
| 6 | `lib/import-upsert/lines.ts:215` — `applyLinePatch`, `plan.removes` | `updateMany` | no |
| 7 | `app/api/tint/manager/manual-entry/route.ts:193` | `updateMany` — sets `isTinting: true` only | no |
| 8 | `app/api/tint/manager/manual-entry/revert/route.ts:198` | `updateMany` — sets `isTinting: false` only | no |

Also checked and clean:

- **Raw SQL:** `grep -rniE '(insert into|update|delete from)[[:space:]]+"?import_raw_line_items'` over
  `*.ts *.js *.mjs *.sql *.ps1` -> **zero hits**. Every `$executeRaw*` call site in `scripts/` targets
  sampling / `mo_*` / backup tables; none names this one.
- **`scripts/`:** ~40 files reference the table, all `findMany` / `count` / `groupBy` diagnostics. No
  write verb, no raw write.
- **`docs/dhruv-review/...` and `docs/_backup_2026-08-04/...`** carry `createMany` calls but are
  archived copies of `route.ts` under `docs/`, outside the build. Not call sites.
- **`split_line_items`** cascades (`lines.ts:232`) write `split_line_items`, never this table.

**Which one did it: site 4, `lib/import-upsert/lines.ts:187`,** reached from
`handleManualSapConfirm` -> `upsertObd` -> `patchPath` -> `applyLinePatch` in batch 063. Pinned by
three independent markers: `createdAt` 12:54:27.031 identical to the millisecond on both new rows (one
`createMany` statement), the `[line_added] ... via manual-sap batch BATCH-20260907-063` audit note
whose verb is emitted only from `patchPath` (`import-upsert.ts:361-367`), and `rawSummaryId 14885`
(9109269668's original summary, which only `applyLinePatch`'s `rawSummaryId` argument supplies).

**The insert is not the defect. The defect is upstream of this repo — the SAP export was internally
inconsistent at 12:54, and nothing in the pipeline rejects that.**

## 5. Confidence, and what I could not settle

| Claim | Confidence |
|---|---|
| The parser does not reproduce the ghost from the disk file | **Certain** — executed, output above |
| SheetJS 0.18.5 is not at fault | **Certain** — Stage 0b bypasses `sheet_to_json` and agrees |
| The disk file is not the file batch 063 parsed | **Certain** — 374 vs 280, and 94 of its deliveries did not exist at 12:54 |
| The 12:54 file contained `(item 10, IN28140081, qty 26)` | **Very high** — forced by `plan.adds`'s only possible source plus the absence of any `[line_removed]` |
| Nothing but `applyLinePatch` could have inserted id 51767 | **High** — two independent sweeps agree; only four insert sites exist and the other three write a different `rawSummaryId` / batch |

**Not settled:**

1. **Why SAP emitted a parent row with quantity at 12:54 and a zeroed one that evening.** Between
   batch 062 (12:36 — no audit rows for this OBD, so `unchanged`) and batch 063 (12:54), the item was
   batch-split: 900001 dropped 80 -> 54 and 900028 appeared at 26. The 12:54 export caught the parent
   still carrying the 26. That is an SAP-side export-consistency question, not answerable from here.
2. **How long it persisted.** Batches 065 (13:13) and 066 (13:28) produced **no audit rows at all**
   for this OBD. If those files contained the delivery — very likely, since both are supersets by
   count (308, 310) — then they still carried item 10 at qty 26, because an authoritative import that
   saw it absent would have soft-removed it and logged `[line_removed]`. I cannot prove the delivery
   was in those files without the files.
3. **The original 12:54 file itself is gone** unless the depot PC keeps per-upload copies. The seven
   same-named uploads make recovering it by name impossible; it would have to be found by delivery
   count (280).

### Correction to the first session's report

That report said all four parent rows in the Q3 table were "later soft-removed by a subsequent
import". True for the three June rows — `removedReason` reads `Removed by manual-sap batch 164`,
`166` and `235`. **Not true for id 51767**, which was removed by hand on 2026-09-08 05:28:57 with
`removedReason: 'Manual fix 2026-09-08: SAP parent row duplicating lineId 900028 ...'`. The OBD now
holds 28 active lines summing **1724**, which matches its header exactly.

### Scratch artifacts

`pass.probe.ts` and `pass.totals.json` at repo root — both already ignored by `.gitignore:45`
(`pass.*`), untracked, unstaged. `docs/vl06O/` shows as untracked and was left alone. Nothing was
committed, nothing staged, nothing deleted (CORE §3).

---
---

# FIX APPLIED — 2026-09-08, third session · commit `25fc3c99`

Option **A1** from the fix-options table above, and nothing else. Defect B (the frozen header) is
untouched and remains open.

## The rule

**Rule P — parent item superseded by its batch sub-items.** Per delivery, in `applyRules`:
a row with `item < 900000` is dropped when the SAME delivery holds one or more rows with
`item >= 900000` carrying the SAME `skuCodeRaw` — regardless of the parent's quantity.

| Property | Choice | Why |
|---|---|---|
| Two passes | `skusWithBatchSubItems` built in full **before** the filter loop | Nothing mutated while iterating; row order is irrelevant, so a parent is judged against sub-items that appear after it |
| Comparison | `skuCodeRaw` exactly as read — no trim beyond the cell coercer, no case folding | SAP Material codes are case-sensitive identifiers |
| Visibility | pushes to `skipped[]` with reason `"parent item superseded by batch sub-items"` | **Not** silent like the qty=0 rule. 3 events in 4 months, and the silence is exactly how it stayed invisible. Surfaces in the preview's per-OBD `issues[]` and in `import_batches.skippedObds` |
| Placement | after non-LF, after ZZRE, after qty=0, after item≤0, after missing-material; before the category warnings | The ordinary zeroed parent still takes the cheap path and keeps its silent drop; every other reason code keeps its meaning; and a row with no Material is still reported as `missing-material`, not as superseded |

Files: `lib/sap-parser/apply-rules.ts` (rule + `BATCH_SUB_ITEM_FLOOR = 900000` + header comment),
`lib/sap-parser/types.ts` (the new `SkippedRow.reason` literal). Nothing else — `group-rows.ts`,
`build-obd.ts`, `lib/import-upsert*` and every route are unchanged.

**What it deliberately does not do.** A low-numbered row whose SKU has **no** sub-item sibling in
that delivery is real stock and passes through untouched. Yesterday's export carries 186 such rows /
2,107 units. This is not the rejected blanket `lineId < 900000` rule.

## The gate — all three green

Run parse-only (`readSheet -> groupRows -> applyRules`), no database calls, against
`docs/vl06O/EXPORT 07.09 orbit.XLSX`. Scratch harness `pass.gate.ts` (gitignored via `pass.*`),
snapshotting every emitted line as `lineId|sku|qty|vol|nw|tw|batch|isTinting|category|sourceRow`.

### TEST 1 — regression, whole file, all 374 deliveries

| | |
|---|---|
| lines **before** | **1921** |
| lines **after** | **1921** |
| added | 0 |
| removed | 0 |
| order-changed | 0 |
| **DIFF COUNT** | **0** |
| `skipped[]` identical | true (0 entries both sides) |

**PASS — byte-identical.** Every parent in that export is already zeroed, so rule P never fires on
it; it is a strict no-op. Supporting count from the same run: **0** surviving low-lineId lines in the
whole file share a SKU with a 900k row, so there was nothing for the rule to take.

### TEST 2 — the bug, reconstructed

The 53 real rows of delivery 9109269668, with row 317 restored to what the audit trail proves the
12:54 upload held: `Item 10 / IN28140081 / qty 26 / vol 520 / nw 650 / tw 691.86 / batch blank`.

| | before the change | after the change |
|---|---|---|
| lines emitted | **29** | **28** |
| `lineId 10` present | **true** — `qty 26, vol 520, nw 650, tw 691.86, batch null, sourceRow 317` | **false** |
| IN28140081 lines | `10=26  900001=54  900028=26` (= 106) | `900001=54  900028=26` (= **80**, correct) |
| skip recorded | `[]` | `9109269668 \| parent item superseded by batch sub-items \| 317` |

**PASS.** The "before" column also confirms the reconstruction is faithful: it reproduces the exact
ghost row that is in production as `import_raw_line_items` id 51767.

### TEST 3 — the untouchable case

Delivery 9109323885, `Item 10, material 5857610`, no 900k row for that SKU:

```
[{"lineId":10,"skuCodeRaw":"5857610","skuDescriptionRaw":"DP Exterior texture (90) Rustic 30Kg",
  "batchCode":null,"unitQty":100,"volumeLine":3000,"netWeight":3000,"totalWeight":3016,
  "isTinting":false,"itemCategory":"TAN","parentRowNumber":911}]
```

**PASS** — emitted, unchanged, qty 100. Byte-identical to the pre-change output.

## Type check

`npx tsc --noEmit` → **exit 0, no output**. That run included the two root `pass.*.ts` scratch files,
so it is if anything stricter than the repo alone.

## Commit

**`25fc3c998464490bf17e0a22e5f0e54d79d47d1d`** (`25fc3c99`) on `main`.
Staged explicitly by name, two files only, verified with `git diff --cached --name-only`:

```
lib/sap-parser/apply-rules.ts
lib/sap-parser/types.ts
```

`pass.probe.ts`, `pass.gate.ts`, `pass.gate.*.json`, `pass.totals.json` and `docs/vl06O/` were not
staged and are not in the commit. No dev server was running (`netstat` on 3000/3001 empty) at commit
time. The database was not touched this session — no SQL of any kind, read or write.

## Two follow-ups this change creates — neither actioned here

1. **Canon is now stale by one line.** `CLAUDE_IMPORT.md §8`'s ordered filter list stops at 10 and
   does not mention rule P, and `§7`'s "Qty=0 silent drop" hard rule now has a deliberately
   *non*-silent sibling. Both want a line, plus the `SkippedRow.reason` union in `§5`. Left for a
   reconciliation pass with a proper version bump (`docs/runbooks/reconciliation-method.md`) rather
   than edited in a commit that was about the parser.
2. **A rule-P skip inflates two batch counters.** `route.ts:1806-1807` computes
   `totalObds = parseResult.skipped.length + results.length` and
   `skippedObds = parseResult.skipped.length`, and the preview loop at `route.ts:1559-1569` pushes one
   `outcome: "skipped"` card per `skipped[]` entry — so on a day when a parent survives, that delivery
   appears twice in the preview and `skippedObds` reads 1 for what is a row, not an OBD. This is
   **pre-existing behaviour**, identical to how `"non-LF row"` has always behaved, and putting the
   drop in `skipped[]` is what makes it visible in the batch record as the brief required. Worth a
   decision later on whether row-level skips should be counted separately from delivery-level ones.

**Residual risk worth naming.** The pre-pass builds `skusWithBatchSubItems` from *all* rows of the
delivery, per spec. So a delivery whose only sub-item rows for a SKU are themselves non-LF, ZZRE or
qty-0, while the parent carries real stock, would lose that stock. It cannot happen on the export
tested (Test 1's diff is 0 and the at-risk count is 0), and the brief's MUST-NOT-BREAK is scoped to
parents with **no** sub-item sibling, which this rule never touches. Flagged, not changed.

---
---

# RULE P HARDENED — 2026-09-08, fourth session · commit `a290c116`

Closes the residual risk the previous section flagged in its own last paragraph. One file,
`lib/sap-parser/apply-rules.ts`. No other file touched; the stale header, canon and the batch
counters are all still open and untouched.

## What was wrong with rule P as shipped

`25fc3c99` built `skusWithBatchSubItems` from **every** row at `item >= 900000`, including rows the
filter loop was about to discard:

```ts
for (const r of g.rows) {
  if (r.item >= BATCH_SUB_ITEM_FLOOR && r.material) skusWithBatchSubItems.add(r.material);
}
```

So if a SKU's only sub-item rows were qty-0, ZZRE or non-LF, the parent was still dropped as
superseded — while the sub-item meant to carry the stock had already been thrown away. Net effect:
real units disappear, silently, with a skip reason that says the opposite of what happened.

## The fix — one shared classifier, not two passes

A sub-item now qualifies its SKU **only if it would itself survive rules 0/E/1/J.3/J.4**. The
survivability test is a single function called from both places:

```ts
type RowVerdict =
  | { keep: true;  material: string }
  | { keep: false; reason: "non-LF" | "zzre" | "qty-zero" | "non-positive-item" | "no-material" };

function classifyRow(r: RawSapRow): RowVerdict { /* the five rules, in order */ }
```

The pre-pass:

```ts
for (const r of g.rows) {
  if (r.item < BATCH_SUB_ITEM_FLOOR) continue;
  const verdict = classifyRow(r);
  if (verdict.keep) skusWithBatchSubItems.add(verdict.material);
}
```

The filter loop calls the same `classifyRow` and its `switch` now decides only **how a rejection is
reported** — every message, warning kind and skip reason is byte-for-byte what it was.

### Why the shared classifier and not the two-pass alternative

Both were offered. Two passes — survivors first, then rule P over the survivors — is structurally
the tidier of the two and duplicates nothing by construction, but it would have moved rule P to
**after** the category-warning block. A superseded parent would then pick up
`unknown-item-category` / `zinr-article-tag-pending` warnings on its way out, and rule-P skips would
land in `skipped[]` grouped at the end of each delivery rather than interleaved with the `non-LF row`
skips in row order. Both are behaviour changes outside this brief, and neither would have shown up in
Test 1 (rule P never fires on that file), so they would have shipped unnoticed.

The classifier keeps the loop order, the interleaving and every message identical, which is what
"nothing else changes" asked for. It also pays a bonus: `keep` carries the Material, so rule P no
longer needs the `as string` cast it had.

Cost: `classifyRow` is called twice for sub-item rows instead of once. 3,584 rows on a full day's
export — not measurable.

## The gate — four tests, all green

Harness `pass.gate.ts` (gitignored via `pass.*`), parse-only, **no database calls**, against
`docs/vl06O/EXPORT 07.09 orbit.XLSX`. Baseline regenerated from post-`25fc3c99` code before editing.

### TEST 4 first — against the PRE-change code, to prove it has teeth

A synthetic delivery with exactly two rows for one SKU: `item 10` LF/TAN **qty 40** with real
volume and weights, beside a sub-item that the filters discard.

| variant | lines | item 10 | rule-P skips | all skips |
|---|---|---|---|---|
| 4a sub-item qty 0 | 0 | **ABSENT** | 1 | `["parent item superseded by batch sub-items"]` |
| 4b sub-item ZZRE | 0 | **ABSENT** | 1 | `["parent item superseded by batch sub-items"]` |
| 4c sub-item non-LF | 0 | **ABSENT** | 1 | `["parent item superseded by batch sub-items","non-LF row"]` |

**FAIL on all three** — the 40 units vanish, exactly as predicted. The test is real.

### TESTS 1-4 against the post-change code

**TEST 1 — regression, all 374 deliveries**

| | |
|---|---|
| lines before / after | **1921 / 1921** |
| added / removed / order-changed | 0 / 0 / 0 |
| **diff count** | **0** |
| `skipped[]` identical to the post-`25fc3c99` baseline | **true** |

**PASS — byte-identical.**

**TEST 2 — the bug still dies.** Reconstructed 12:54 set for 9109269668 (row 317 at qty 26 / vol 520
/ nw 650 / tw 691.86 / batch blank): **28 lines, `lineId 10` absent**, skip recorded as
`9109269668 | parent item superseded by batch sub-items | 317`. IN28140081 sums to 80, not 106.
**PASS.**

**TEST 3 — real stock untouched.** 9109323885 item 10, material `5857610`: emitted unchanged at
**qty 100**. **PASS.**

**TEST 4 — the new one**

| variant | lines | item 10 | rule-P skips | all skips |
|---|---|---|---|---|
| 4a sub-item qty 0 | 1 | **qty 40** | 0 | `[]` |
| 4b sub-item ZZRE | 1 | **qty 40** | 0 | `[]` |
| 4c sub-item non-LF | 1 | **qty 40** | 0 | `["non-LF row"]` |

**PASS on all three.** 4c's lone `non-LF row` skip is rule 0 firing on the sub-item — pre-existing
behaviour, unrelated to rule P, and correct.

## Type check

`npx tsc --noEmit` → **exit 0, no output**.

## Commit

**`a290c1168e56ab072c58faf3fd6e50263883fc21`** (`a290c116`) on `main`. Staged by name, one file:

```
lib/sap-parser/apply-rules.ts
```

99 insertions, 56 deletions. No `pass.*` file and no `docs/vl06O/` content is in it. No dev server
was listening at commit time. The database was not touched this session — no SQL of any kind.

## Still open, unchanged by this session

- **Defect B** — `import_raw_summary.totalUnitQty` is never recomputed on the patch path; 146 bills
  disagree with their own line sets. Fix options B1-B3 above.
- **Canon** — `CLAUDE_IMPORT.md §7`/`§8`/`§5` still do not mention rule P, and now also do not
  mention `classifyRow` as the single home of rules 0/E/1/J.3/J.4.
- **Batch counters** — a rule-P skip is a ROW-level entry in `skipped[]`, so it adds 1 to both
  `totalObds` and `skippedObds` and puts a second, `outcome: "skipped"` card in the preview for a
  delivery that also appears as `patch`/`new`. Pre-existing shape, identical to `"non-LF row"`.

---
---

# DEFECT B — GATE · 2026-09-08, fifth session

Read-only. No code written, nothing staged, nothing committed, no INSERT/UPDATE/DELETE/ALTER.
Provenance checked first: `a290c116` is still an ancestor of `HEAD` (`7a9fd300`, a po-v2 commit from
another window touching only `app/po-v2-8f4kd2/v2-storage.ts`), rule P intact at `HEAD`, `lib/` clean.

**Verdict up front: B1 as scoped does not pass. Two of the three conditions fail, and one of them
fails on 7,450 healthy bills. The qty half of B1 is sound; the weight half must be dropped.**

---

## GATE 1 — who reads this number?

Swept twice — Grep tool (ripgrep) and MSYS `grep -rn`, reconciled. The reconcile mattered: the
ripgrep pass truncated at its result cap and missed `app/api/admin/fix-challans/route.ts:32` and
`app/api/admin/fix-slots/route.ts:57` (both read the summary, neither reads the totals). Call sites
checked, not imports.

### Direct readers of `import_raw_summary.totalUnitQty` / `grossWeight` / `volume`

| # | Site | Reads | What it is | Expects | Changes after B1? |
|---|---|---|---|---|---|
| 1 | `app/api/import/obd/route.ts:563-566` — `rebuildQuerySummaryForOrder` | all three | Rebuilds `import_obd_query_summary` after every line-changing patch | `grossWeight` as **the** weight (`:590`, `:601` write it straight into `totalWeight`); `totalUnitQty` only as a fallback when the bill has **zero** active lines (`:582`) | **YES — and this is the one that reaches users** |
| 2 | `app/api/orders/[id]/detail/route.ts:71-88` | all three | Order-detail API | `imp?.totalUnitQty ?? qs?.totalUnitQty` — prefers the stale header over the fresh query summary it already fetched | **No — the route is unreachable** (below) |
| 3 | `app/api/tint/manager/challans/[orderId]/route.ts:94-105` | `grossWeight` | Challan document payload (`:365`) | header weight | **No — never rendered** (below) |
| 4 | `route.ts:1182-1183` + `1309-1310` (manual-template confirm), `3035-3036` + `3164-3165` (auto-import confirm) | `totalUnitQty`, `grossWeight` | Seeds `orders` and `import_obd_query_summary` at CREATE | the values written moments earlier in the same request | No — create path; B1 is patch path |
| 5 | `lib/import-upsert/state.ts:35-38` | **none of them** | `loadExistingObd`'s summary read | — | No |

Two traps worth naming, because both look like readers and are not:

- **`lib/import-upsert/state.ts:30`** selects `totalUnitQty, grossWeight, volume` — but from
  **`prisma.orders`**, not the summary. Same column names, different table.
- **`route.ts:1647`, `:2031`, `:2305`** likewise select those three from `prisma.orders` in the bulk
  preloads.

### Reachability — two readers that cannot show anything to anyone

- **`components/shared/order-detail-panel.tsx` is dead.** It is the only caller of
  `/api/orders/[id]/detail` (`:142`), and nothing imports it: the only occurrences of its path in the
  live tree are two comments saying it was superseded — `components/tint/manager/board-detail-panel.tsx:7-10`
  ("It supersedes BOTH of the old panels… order-detail-panel.tsx simply loses its last import") and
  `components/tint/tint-manager-content.tsx:26`. No `dynamic()`, no `React.lazy`, no barrel re-export.
  So the one reader that prefers the stale header over the fresh query summary is not mounted anywhere.
- **The challan's `grossWeight` is never rendered.** `components/tint/challan-document.tsx:92`
  declares it as a prop and no JSX consumes it; the visible totals block (`:494-497`) reads
  `totals.totalUnitQty` and `totals.totalVolume`, which the route fills from **`querySummary`**
  (`:404-409`), not from the raw summary.

### The reader whose displayed number WOULD change

Reader 1 is the whole story, and it is indirect. `rebuildQuerySummaryForOrder` writes
`import_obd_query_summary.totalWeight = summary?.grossWeight ?? 0` (`:590`, `:601`), and
`totalWeight` **is** displayed:

- `lib/floor/queries.ts:560` + `:759` → Floor Control's `weightKg`
- `lib/picking/queue.ts:465` + `:758` → Picking board's `weightKg`
- `app/api/tint/manager/challans/[orderId]/route.ts:408` → challan totals payload

So recomputing `grossWeight` from the live lines changes the **kg figure on Floor and Picking**. Gate
2 shows what it changes it to, and the answer is: nothing, on most bills.

### Could a screen read the fresh `import_obd_query_summary` instead?

Yes — twice, and neither matters. The dead order-detail route already fetches both and picks the
stale one; the challan route already holds `querySummary.totalWeight` at `:408` while reading
`rawSummary.grossWeight` at `:365`. **No live screen needs re-pointing**, because no live screen
reads the raw summary's totals at all.

---

## GATE 2 — dry run over every bill

Read-only. Earliest summary per OBD (`DISTINCT ON … ORDER BY id ASC`, mirroring `state.ts:35-38`),
against the live active line set.

**Population: 13,621 bills, not 13,587.** The earlier report's sweep used an INNER JOIN to the line
table and silently dropped the 34 bills that have no line rows at all. That difference is the origin
of the third failure below, so it is not a rounding matter.

| bucket | definition | count |
|---|---|---|
| **A** | header == live active line sum | **13,465** |
| **B** | header differs, bill HAS line events | **137** |
| **C** | header differs, bill has NO line events | **19** |

Bucket B units moved: **1,194** (135 under-count, 2 over-count).

### Condition 1 — "bucket A produces a ZERO-row diff" · **FAIL**

| column | bucket-A rows the recompute would change |
|---|---|
| `totalUnitQty` | **0** ✅ |
| `volume` | **309** — but 308 are sub-1-litre float noise |
| `grossWeight` | **7,450** ❌ — of which **7,427 go from a real number to NULL** |

**Why.** Neither auto-import (`route.ts:2795-2810`) nor manual-template (`route.ts:900-916`) writes
`netWeight` / `totalWeight` onto its line rows — both `createMany` field lists stop at `volumeLine`.
And `patchLines` can never backfill them: `ExistingLine`'s select (`state.ts:44-47`) does not even
fetch the two columns, and `lines.ts:110-122` compares only `unitQty`, `volumeLine`, `isTinting`.

Across the 13,611 bills that have active lines:

| | bills | what a recompute would do |
|---|---|---|
| **no** active line carries `totalWeight` | **7,610** | writes NULL over a real header weight |
| **all** active lines carry `totalWeight` | 5,988 | faithful |
| **mixed** — some carry, some don't | 13 | **silently undercounts** (SQL `SUM` skips NULLs) |

The mixed 13 are the nastiest: e.g. `9107789846` header 372 kg → 145.3 kg with 15 of 21 lines
weighed; `9107891606` 115 → 16.0 with 2 of 7. Those are auto-import births later patched by
manual-SAP, so the added lines have weights and the original ones never will.

Net effect if B1 shipped as written: **Floor's and Picking's kg would blank or halve on 56% of the
estate**, one bill at a time, as each next gets a line-changing patch.

The single real volume mover is **`91074040627`** — an 11-digit delivery from a hand-made
`[manual-sap] MANUAL.XLSX` (2026-06-08), header volume 25 L against 500 L of lines, quantity matching
at 25. Named individually as required.

### Condition 2 — "bucket B is exactly the drift population already identified" · **FAIL (numerically), same population**

Expected 112 + 19 + 2 = 133. Actual **137**:

| event signature | bills |
|---|---|
| `removed` | 116 |
| `qtyPatch` | 19 |
| `removed` + `qtyPatch` | 1 |
| adds only | 1 |
| **total** | **137** |

117 of them have retired lines. This is the same phenomenon, counted more completely — the earlier
figures came from the INNER-JOIN sweep and from classifying on `qty_patches` rather than on "any line
event". No new failure mode, but **the 112/19/2 split in the earlier report is wrong and should be
read as 116/19/1 + 1**.

### Condition 3 — "bucket C contains exactly the 10 auto-import bills" · **FAIL**

Bucket C is **19**, and it splits in two:

**(i) Nine** of the Q6(b) auto-import births — `9107878744, 9107900119, 9107931925, 9107946773,
9108203125, 9108547003, 9108630612, 9108798579, 9108886262`. The tenth name from that list,
**`9107895835`, is not here** — it has a line event and correctly sits in bucket B. The earlier report
counted "zero *qty* patches", which is not the same test as "zero line events".

**(ii) Ten bills nobody has looked at, with ZERO line rows at all** — the population the INNER JOIN
hid. Named individually, as required:

| OBD | header qty | line rows | header kg | stage | invoiced |
|---|---|---|---|---|---|
| 9108714570 | 24 | **0** | 1 | dispatched | no |
| 9108718897 | 200 | **0** | 39 | dispatched | yes |
| 9108740751 | 1250 | **0** | 247 | dispatched | yes |
| 9108750985 | 50 | **0** | 9 | dispatched | yes |
| 9108753988 | 25 | **0** | 4 | dispatched | yes |
| 9108758489 | 109 | **0** | 20 | dispatched | yes |
| 9108758491 | 200 | **0** | 39 | dispatched | yes |
| 9108829338 | 46 | **0** | 9 | dispatched | yes |
| 9108839310 | 208 | **0** | 38 | dispatched | yes |
| 9109296263 | 75 | **0** | 14 | pending_picking | yes |

All ten born `[auto-import] auto-json`, none removed, header volume 0 on every one.

---

## GATE 3 — the bucket-C bills: display problem or missing data?

**Missing data. Not display. High confidence, and it should be its own workstream.**

### The ten with no lines at all

Nine of the ten carry an **invoice number** and are `dispatched`; the tenth (`9109296263`, created
2026-09-07 18:27) is `pending_picking` and also invoiced. A bill that was invoiced and shipped while
holding **zero** line rows is not a rendering artefact — the stock existed, left the depot, and was
billed. The header (24 to 1,250 units) is the only record left of what was on it.

### The nine with some lines

| OBD | header | line rows | line units | shortfall | stage |
|---|---|---|---|---|---|
| 9107878744 | 184 | 2 | 9 | 175 | closed |
| 9107900119 | 47 | 1 | 10 | 37 | closed |
| 9107931925 | 471 | 2 | 2 | 469 | closed |
| 9107946773 | 284 | 5 | 234 | **50** | closed |
| 9108203125 | 102 | 2 | 52 | **50** | dispatched |
| 9108547003 | 92 | 3 | 42 | **50** | dispatched |
| 9108630612 | 293 | 13 | 82 | 211 | dispatched |
| 9108798579 | 71 | 2 | 21 | **50** | dispatched |
| 9108886262 | 47 | 5 | 11 | 36 | dispatched |

**Four of the nine are short by exactly 50 units.** A unit-of-measure mismatch would not land on a
round 50 four times; a dropped line of 50 would. Each has exactly one summary row, no line events, and
every one reached `closed` or `dispatched`.

Where the loss is: **upstream of this repo, in the Breakwalls fetch, not in the write.** GUARD 1
(`route.ts:2820-2843`) already verifies `createMany.count === lineItemData.length` and fails the whole
batch on a shortfall — so these lines were never *sent*, not lost on the way in. The header
`UnitQty` came from the payload header (`route.ts:2756`) while the line array was short, and nothing
compares the two at ingest.

---

## Recommendation — amend B1, do not proceed as scoped

**1. Recompute `totalUnitQty` only. Drop `grossWeight` from the recompute entirely.** The line rows
cannot support it: 7,610 of 13,611 bills have no weighed line at all and 13 are partially weighed.
Recomputing weight would replace a correct header figure with NULL or with a half-sum, and it would
show up as Floor's and Picking's kg. If the weight ever needs to become line-derived, the prerequisite
is upstream — auto-import (`route.ts:2795-2810`) and manual-template (`route.ts:900-916`) must write
`netWeight`/`totalWeight`, and `patchLines` must be able to see them (`state.ts:44-47` +
`lines.ts:110-122`). That is a separate change and a separate backfill.

**2. `volume` is optional and low-value.** 308 of its 309 movers are sub-litre float noise; the one
real mover is a hand-made `MANUAL.XLSX` bill. Including it buys almost nothing and adds float churn
to the audit log. Recommend leaving it out of the first cut.

**3. Add a structural guard, not just the "lines changed" gate: skip the recompute when the bill has
zero active lines.** `rebuildQuerySummaryForOrder` already does exactly this at `route.ts:582`
(`totalLines > 0 ? totalUnitQty : summary?.totalUnitQty ?? 0`). Mirroring it protects the ten
zero-line bills by construction rather than by the accident of their never having been patched.

**4. The "no line events" gate does NOT protect the nine — it only means "not yet".** They are live
`dispatched`/`closed` bills; the moment any future SAP upload includes one with a line change, B1
would rewrite its header and erase the shortfall. **Capture the nine and the ten into their own
record before B1 ships**, or add an explicit exclusion. The gating question in the brief was whether
the scoping excludes them: it does today, and it stops doing so the first time one of them is touched.

**5. The effect wiring is already there.** `lib/import-upsert/effects.ts:72` computes
`headerTotalsChanged` over exactly `["grossWeight", "volume", "totalUnitQty"]` and fires
`query-summary-rebuild`. It is dead today because `patchHeader` never emits those fields — evidence
the original design expected this recompute. B1 needs no new effect: `linesChanged` (`effects.ts:67`)
already fires the rebuild in every case B1 would fire in.

**So: proceed with a narrowed B1 — `totalUnitQty` only, guarded on `activeLineCount > 0` — after the
nineteen bucket-C bills are recorded somewhere durable.** The weight is a separate defect with a
separate root cause, and the nineteen are a third one that is about lost data, not stale numbers.

---
---

# AUTO-IMPORT QTY GUARD — 2026-09-08, sixth session · commit `9188699a`

Detect-and-record for the defect Gate 3 established: nothing at ingest compared a payload's declared
header `UnitQty` against the sum of the line array it arrived with. **A measurement pass — it blocks
nothing.** Same rows written, same batch outcome, same response shape.

## The gate — `rowStatus` is NOT safe to reuse

Swept twice (Grep tool + MSYS `grep -rn`, reconciled) for readers of `import_raw_summary.rowStatus`.
Two things had to be separated out first: `import_raw_line_items.rowStatus` is a **different column**
(filtered at `lib/picking/queue.ts:583` and `app/api/picking/order/[orderId]/route.ts:73`), and
`components/floor/status-pill.tsx`'s `rowStatus()` is an **unrelated local function** computing a
floor status. Neither is this field.

Live code that branches on `import_raw_summary.rowStatus`:

| Site | What it does | What a new value would do |
|---|---|---|
| `route.ts:2851` | `validSummaryIds = … filter(s => s.rowStatus === "valid" \|\| === "warning")` | **The OBD never becomes an `orders` row — the bill vanishes from the app** |
| `route.ts:2878-2880` | `rowStatus: { in: ["valid","warning"] }` before order creation (auto) | same |
| `route.ts:1043-1045` | same whitelist (manual-template) | same |
| `route.ts:1185`, `:3038` | `customerMissing: summary.rowStatus === "warning"` | silently clears a real unknown-customer flag |
| `route.ts:1402-1405` | `skippedObds` / `failedObds` counters | miscounts the batch |
| `route.ts:2071` | shadow: `rowStatus === "error"` → `actualOutcome = "errored"` | misreports |
| `route.ts:3265` | `.filter(s => s.rowStatus === "error")` | miscounts |

So the conditional in the brief resolves to its second branch: **`rowStatus` is left entirely alone.**
Writing `"qty_mismatch"` there would not have been a labelling choice, it would have deleted bills
from the application — the exact outcome the gate existed to catch.

**Recording route taken:** `rowError` (free text, read by nothing) + one `import_shadow_log` row per
mismatch + a warning appended to the batch label. No schema change; existing columns only.

## The change

New **`lib/import-qty-guard.ts`** — one shared helper, called from both ingest points, no copy-paste:

- `detectQtyMismatch(obdNumber, declared, lines, rowStatus)` — pure. Returns `null` when `declared`
  is `null` or `0` (**"the source said nothing", not "the source disagreed"**) and when the sums
  agree. Otherwise returns `{declared, observed, difference, lineCount, rowStatus}`.
- `qtyMismatchNote()` / `appendRowError()` — the `[qty_mismatch] …` sentence, appended to any
  existing `rowError` rather than clobbering it.
- `writeQtyMismatchRecords()` — `import_shadow_log.createMany` (`shadowOutcome: "qty_mismatch"`,
  the numbers in `decision`), then appends `⚠ qty-mismatch x{n}: {obd}({declared}→{observed})…` to
  `import_batches.headerFile`. Sequential awaits, no `$transaction`, and **both writes are
  try/caught** — a measurement pass must never be able to fail an import that otherwise succeeded.

### Where it went, and a correction to the brief

The brief named `handleConfirm` for the manual-template path. **`handleConfirm` never sees a
payload.** Despite its name `handlePreview` (`route.ts:619-1040`) is the real ingest — it creates the
`import_batches` row and writes both `import_raw_summary` and `import_raw_line_items`;
`handleConfirm` (`:1041-1483`) reads those summaries back by id and promotes the chosen ones into
`orders`. `awk` over `:1041-1500` finds no `hr[…]`, no `linesByObd`, no `unit_qty`. The comparison
only exists in `handlePreview`, so that is where the guard is.

Not wired into manual-SAP, deliberately: the 19-column layout has no header quantity column and
`build-obd.ts:65` derives the total by summing the very lines that would be compared — vacuous by
construction.

### Batch-record visibility — with a caveat worth recording

`import_batches` has **no free-text status column**. `CLAUDE_IMPORT.md §4` lists an `errorMessage`
field that the live schema does not have (doc drift, noted not fixed). `headerFile` is the label a
human already reads to tell batches apart, so the warning is appended there; the existing
`[auto-import] …` / `[templateId] …` prefix is preserved so every `LIKE`-prefix query still matches.

⚠ **There is no import UI that lists batches.** `import_batches` is read by nothing in `app/`,
`components/` or `lib/` outside the import route itself — the `headerFile`/`lineFile` names in
`components/import/import-page-content.tsx` are file-input state, not renders of the row. So "visible
without a query" is only true of a `SELECT`. Surfacing batches in the admin UI is a separate item.

## Tests — five, all green

| # | Test | Result |
|---|---|---|
| 1 | Healthy auto-json replay — latest completed auto batch (`BATCH-20260908-023`), stored evidence replayed through `detectQtyMismatch` | **PASS** — 0 mismatches |
| 2 | header 100, lines 30 + 20 | **PASS** — logged, `declared 100 observed 50 difference 50 lineCount 2` |
| 3 | header 100, EMPTY line array | **PASS** — logged, `declared 100 observed 0 difference 100 lineCount 0` |
| 4 | `declared = null`, and the `declared = 0` sibling | **PASS** — both exempt, no mismatch, no error |
| 5 | manual-SAP untouched — rule-P gate re-run on `docs/vl06O/EXPORT 07.09 orbit.XLSX` | **PASS** — 1921 lines, diff 0, `skipped[]` identical, rule-P TEST 4 still green |

Test 2's rowError rendering, both fresh and appended to an existing error:

```
[qty_mismatch] header UnitQty 100 vs line sum 50 across 2 line(s); difference 50
Unknown customer: 123 · [qty_mismatch] header UnitQty 100 vs line sum 50 across 2 line(s); difference 50
```

**Test 3 — is the bill still created? YES, and that is unchanged here.** A zero-line summary keeps
`rowStatus: "valid"`, so it passes the `validSummaryIds` whitelist and an `orders` row is created;
the loop at `route.ts:2958` counts `summary.rawLineItems.length` for GUARD 1 but never skips on it.
The live proof is the ten bills themselves — all sitting as `dispatched` / `pending_picking` orders
with zero line rows. Changing that is a blocking decision, not this pass.

### Historical replay — the rate this pass exists to measure

Running the guard over **every header-sourced summary ever written** (7,574 rows, manual-SAP
excluded):

| | |
|---|---|
| mismatches the guard would have logged | **34 (0.45%)** |
| of which zero line rows | **10** |
| exempt (declared null or 0) | **0** |

Sample: `9108839310` 208→0 · `9108714570` 24→0 · `9108630612` 293→82 · `9107931925` 471→2 ·
`9107946773` 284→234 · and small ones like `9107900118` 83→81, `9108360479` 6→5.

Two caveats on that 34. It compares the header against **today's** line state, so a few of the small
deltas (the 1s and 2s) are post-import drift from the 137-bill population rather than ingest loss —
the guard at ingest would not have seen them. And it is a replay of stored evidence, not of the raw
payloads, which are not retained. Treat 34 as an upper bound and the 19 named in ROADMAP as the
hard core.

## Exemption coverage

**0 of 7,574** header-sourced summaries carry a null or zero declared `UnitQty`. The
`declared === null || declared === 0` exemption is therefore a correctness guard, not a population —
every payload the depot has ever sent declares a real number. Worth knowing before anyone argues the
check is noisy: on live history it would have fired 34 times in four months.

## Type check and commit

`npx tsc --noEmit` → **exit 0**. (The `app/po-v2-8f4kd2/` red from the previous session was fixed by
the other window before this one started; nothing was worked around and those files were not touched.)

**`9188699aa2ddb0441628b41d28e44550bd70a2f1`** (`9188699a`) on `main`. Staged by name, two files:

```
app/api/import/obd/route.ts     (+46)
lib/import-qty-guard.ts         (+171, new)
```

No `pass.*` scratch file and no `docs/vl06O/` content is in the commit. No dev server was listening.
No schema change, no write to any table from this session's testing — the only DB access was
read-only `SELECT`s for the replay and the exemption count.

## What this does NOT do

- It does not block, reject, or alter a single imported row. That decision waits on the rate.
- It does not touch the header recompute or the 137 drifted bills.
- It does not fix the nineteen. They are recorded in `docs/ROADMAP.md` → Import Pipeline → 🔴 P1.
- It does not change `rowStatus`, and the gate above is the reason.
