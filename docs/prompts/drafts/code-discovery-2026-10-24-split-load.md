# Code discovery — Split load (one SAP invoice on two or more vehicles) · 2026-10-24

DIAGNOSIS ONLY. No code, no write SQL, no commit. Every live number below comes from a read-only
SELECT (§6). "Split load" here means: ONE `invoiceNo`, carried as TWO OR MORE `order_invoices` rows of the
SAME OBD, with each line's tins divided between the rows, and each row on its own vehicle (trip). This is
NOT Add invoices, which is several SAP invoices for one OBD.

Method: I read the canon and the code myself for Part A, the writers, Floor drawing and Billing Print.
Two read-only sub-sweeps covered (a) CI, search, picking and exports, and (b) trips, trip sheets, reports
and re-deliveries. Before using either sweep I opened their headline BREAKS claims myself
(`lib/trips/find-bill.ts:80-90`, `lib/reports/freight-report-data.ts:266/452`,
`lib/floor/raise-ci.ts:460-476`, `lib/order-invoices/ci-plan.ts:58`). I also ran the sweep a second way:
`invoiceNo` gives 125 files with both rg and MSYS grep, and `order_invoices` gives 33 files with both.

---

## 1. Files read, and where docs and code disagree

**Read:** `CLAUDE.md` (router v1.14), `docs/CLAUDE_ORDER_INVOICES.md` (v1.0 · Schema v27.74, read in full),
`docs/CLAUDE_CORE.md` (v150 · Schema v27.74: §3, the §7 chain v27.63–v27.74, the §7.3 `order_invoices` /
`order_invoice_lines` blocks, §13), `docs/CLAUDE_FLOOR.md` (v1.10 · v27.74), `docs/CLAUDE_FLOOR_TRIPS.md`
(v1.3 · v27.24), `docs/CLAUDE_BILLING.md` (v1.0 · v27.24), `docs/CLAUDE_UI.md` (v5.40), `docs/CLAUDE_CI.md`
(v1.4 · v27.24), `docs/CLAUDE_TRIP_REPORT.md` (v1.3 · v27.24), and in `prisma/schema.prisma` the models
`order_invoices`, `order_invoice_lines`, `trips`, `trip_drops`, `ci_returns`, `ci_return_lines`,
`TripReport` (`@@map("trip_report")`), `trip_bill_copies` and `trip_redeliveries`. I also read
`sql/2026-10-10-order-invoices-ddl.sql` (the header and PART 2).

Stop-condition check (router §4 item 4): no domain file claims a schema NEWER than CORE's v27.74. The
content checks against the live schema are below.

### Disagreements: the code (or live data) wins

| # | Doc says | Code / live says |
|---|---|---|
| D1 | `CLAUDE.md` router v1.14 (2026-10-03) has **no §3 row for `docs/CLAUDE_ORDER_INVOICES.md`**, and §4 says "an 18th file" | The file exists (v1.0, 2026-10-24); there are now **19** `docs/CLAUDE_*.md` files. Nothing routes a session to the owner of the invoice-row model |
| D2 | CORE §7.3 `order_invoices` block (`CLAUDE_CORE.md:754`): "Back-filled for UNSPLIT OBDs (row := OBD); **written by nothing yet**." | Written since `e0d2989f` (trip), `92dfe7fa` (hold), `4c97fd2f` (dispatched). A stale v27.66-era line |
| D3 | `CLAUDE_BILLING.md:284`: "3. Never a partial set: copyable only when every non-held bill has an invoice number." | `lib/billing/print.ts:29-31`: "Slice 9's 'never a partial set' … was REMOVED on purpose — do not restore it." |
| D4 | `CLAUDE_ORDER_INVOICES.md` §2: kg per invoice = the three-rule ladder (line kg → learned kg per tin → header share "~") | The board does use the ladder (`lib/floor/invoice-rows.ts:159-180`). But the detail panel's Invoices section (`components/floor/detail-invoices.tsx:103`) **always** uses `kgShare` (rule 3 only, always "~"), so one invoice can show two different kg figures on two surfaces |
| D5 | `CLAUDE_ORDER_INVOICES.md` §1 says FLOOR_TRIPS, BILLING, CI, PICKING and IMPORT own the per-invoice screens and flows | Those files contain **0** mentions of `order_invoices` / Add invoices / `orderInvoiceId` (see the list below). The owner file points at sections that do not exist yet |
| D6 | `CLAUDE_ORDER_INVOICES.md` §7: `sap` 20,515 rows | Live today: `sap` **20,538** (§6). Time drift, not a defect |
| D7 | `CLAUDE_ORDER_INVOICES.md` §4.6 calls auto-CI an "open item" | Confirmed in code: auto-CI is whole-OBD (`lib/ci/auto.ts:208`), with `orderInvoiceId` = `linkRowForOrder` = NULL on a split OBD (`lib/order-invoices/links.ts:38-41`). Doc and code agree; listed only because a split load inherits it |

**Canonical files that still read pre-Add-invoices** (0 hits for `order_invoices|add invoices|orderInvoiceId|invoice row`):
`CLAUDE.md` (router), `docs/CLAUDE_FLOOR_TRIPS.md`, `docs/CLAUDE_BILLING.md`, `docs/CLAUDE_CI.md`,
`docs/CLAUDE_TRIP_REPORT.md`, `docs/CLAUDE_PICKING.md`, `docs/CLAUDE_IMPORT.md`, `docs/CLAUDE_MAIL_ORDERS.md`,
`docs/CLAUDE_TINT.md`. Up to date: CORE, FLOOR, UI (5 hits) and ORDER_INVOICES.

**Split load is anticipated in the DDL, not invented later:** `sql/2026-10-10-order-invoices-ddl.sql:29-32`
reads "🔴 SPLIT LOAD (later) MUST STAY POSSIBLE: the row identity is (orderId, seq). There is deliberately NO
unique on (orderId, invoiceNo) — one invoice may later be two rows (two vehicles, tins divided per line).
'Same number typed twice on one OBD' is refused by the APP." CORE `:747` carries the same "(Split load)" note.

## 2. Add invoices commits (git log, not draft "SHIPPED" lines)

`git log --since=2026-10-05 -G'order_invoices|orderInvoice'` (diffs that touch the names):

| Commit | Date | Subject |
|---|---|---|
| `6ac1d51e` | 10-10 | schema v27.63: order_invoices + order_invoice_lines; seq-1 row on every new order |
| `c62a9a11` | 10-10 | Add invoices — permission tick + save/undo API (record only, no UI) |
| `c7fef916` | 10-10 | Add invoices modal + detail panel invoices + '+n' chip (record only) |
| `32578e8e` | 10-10 | schema v27.65: live-feed triggers on order_invoices (run) |
| `bf34baed` | 10-12 | schema v27.66 + Add invoices save edits in place (phase 3 commit 1) |
| `335e874c` | 10-12 | split inside the trip — new rows inherit state |
| `e0d2989f` | 10-12 | phase 3 commit 2: one trip writer — dual-writes invoice rows + OBD |
| `7203d9f3` / `912f17ec` / `a4fcbc72` | 10-12/13 | phase 3 readers A / B / C |
| `e11e7115` | 10-13 | phase 4 commit 1: invoice rows on board payload + search by any invoice |
| `94a18e3f` | 10-13 | schema v27.67: live-feed triggers on order_invoice_lines (run) |
| `e8942595` / `30293890` | 10-13 | one Floor row per invoice / detail panel scoped to an invoice |
| `79274c13` | 10-13 | phase 4: kg per invoice from learned SAP kg per unit |
| `668089fc` | 10-13 | P5-1: per-invoice trip data + totals |
| `c10dffaf` | 10-15 | P5-2: per-invoice trip writer + board rules via rows |
| `366eada2` / `c460367a` | 10-17 | P5-3 per-invoice ticks / move ticked bills between trips |
| `68f10b94` | 10-17 | P5-4: copies + re-deliveries keyed by invoice row |
| `92dfe7fa` | 10-19 | 6.1: hold / release per invoice |
| `3e319529` | 10-19 | 6.3: CI per invoice + held invoice can't join a trip |
| `4c97fd2f` | 10-19 | 6.4: per-invoice dispatched + OBD done rule |
| `a05769b7` | 10-23 | P5-5: per-invoice copies + re-deliveries (+ v27.74 PART 7) |
| `9c9b08f9` | 10-24 | canon B1: CLAUDE_ORDER_INVOICES.md |
| `bf91c1ea` | 10-24 | canon B2: FLOOR + UI — **local only, not on origin/main** (`git log origin/main..main`) |

Also touched in passing: `faf42277`, `c6d6a8c7`, `ce7ec8b6`, `206d1d62`, `975693b4`. **Shipped:**
`a05769b7` is on `origin/main`. `origin/main` is at `e817f01f`.

## 3. Row model facts (Part A)

### 3.1 Columns (live `information_schema.columns`)

`order_invoices` (16 columns): `id` int (serial) · `orderId` int NOT NULL · `invoiceNo` text NULL ·
`invoiceDate` timestamptz NULL · `seq` int NOT NULL · `source` text NOT NULL · `createdById` int NULL ·
`createdAt` / `updatedAt` timestamptz NOT NULL now() · `tripDropId` int NULL · `isHeld` bool NOT NULL false
· `heldAt` timestamptz NULL · `heldById` int NULL · `isDispatched` bool NOT NULL false · `dispatchedAt`
timestamptz NULL · `dispatchedById` int NULL.

`order_invoice_lines` (5 columns): `id` int (serial) · `orderInvoiceId` int NOT NULL · `rawLineItemId` int
NOT NULL · `qty` int NOT NULL (tins) · `createdAt` timestamptz NOT NULL now().

### 3.2 Live constraint and index text (`pg_get_constraintdef` / `pg_indexes`, verbatim)

```
order_invoices
  order_invoices_pkey                    PRIMARY KEY (id)
  order_invoices_orderId_seq_key         UNIQUE ("orderId", seq)
  order_invoices_orderId_fkey            FOREIGN KEY ("orderId") REFERENCES orders(id) ON DELETE RESTRICT
  order_invoices_createdById_fkey        FOREIGN KEY ("createdById") REFERENCES users(id) ON DELETE SET NULL
  order_invoices_heldById_fkey           FOREIGN KEY ("heldById") REFERENCES users(id) ON DELETE SET NULL
  order_invoices_dispatchedById_fkey     FOREIGN KEY ("dispatchedById") REFERENCES users(id) ON DELETE SET NULL
  order_invoices_tripDropId_fkey         FOREIGN KEY ("tripDropId") REFERENCES trip_drops(id) ON DELETE SET NULL
  chk_order_invoices_seq_positive        CHECK ((seq >= 1))
  chk_order_invoices_source              CHECK ((source = ANY (ARRAY['sap'::text, 'manual'::text])))
  chk_order_invoices_manual_has_no       CHECK (((source <> 'manual'::text) OR ("invoiceNo" IS NOT NULL)))
  chk_order_invoices_no_not_blank        CHECK ((("invoiceNo" IS NULL) OR (btrim("invoiceNo") <> ''::text)))
  chk_order_invoices_hold_shape          CHECK (("isHeld" OR (("heldAt" IS NULL) AND ("heldById" IS NULL))))
  chk_order_invoices_dispatch_shape      CHECK (("isDispatched" OR (("dispatchedAt" IS NULL) AND ("dispatchedById" IS NULL))))
  chk_order_invoices_held_not_dispatched CHECK ((NOT ("isHeld" AND "isDispatched")))
  indexes: CREATE UNIQUE INDEX "order_invoices_orderId_seq_key" ON public.order_invoices USING btree ("orderId", seq)
           CREATE INDEX "order_invoices_invoiceNo_idx" ON public.order_invoices USING btree ("invoiceNo")
           CREATE INDEX "order_invoices_tripDropId_idx" ON public.order_invoices USING btree ("tripDropId")
           CREATE INDEX order_invoices_held_idx ON public.order_invoices USING btree ("orderId") WHERE "isHeld"
order_invoice_lines
  order_invoice_lines_pkey                              PRIMARY KEY (id)
  order_invoice_lines_orderInvoiceId_rawLineItemId_key  UNIQUE ("orderInvoiceId", "rawLineItemId")
  order_invoice_lines_orderInvoiceId_fkey               FOREIGN KEY ("orderInvoiceId") REFERENCES order_invoices(id) ON DELETE CASCADE
  order_invoice_lines_rawLineItemId_fkey                FOREIGN KEY ("rawLineItemId") REFERENCES import_raw_line_items(id) ON DELETE RESTRICT
  chk_order_invoice_lines_qty_positive                  CHECK ((qty > 0))
  index: CREATE INDEX "order_invoice_lines_rawLineItemId_idx" … ("rawLineItemId")
FKs INTO order_invoices: ci_returns_orderInvoiceId_fkey · trip_bill_copies_order_invoice_fkey ·
  trip_redeliveries_order_invoice_fkey (all ON DELETE RESTRICT) · order_invoice_lines (CASCADE)
```

**Confirmed: the unique is `(orderId, seq)`, and NOTHING makes `(orderId, invoiceNo)` unique:**
- **Index:** `order_invoices_invoiceNo_idx` is a plain btree, not unique.
- **CHECK:** none of the 9 CHECKs compares two rows.
- **Trigger:** 9 user triggers (6 on `order_invoices`, 3 on `order_invoice_lines`), all `live_changes_*`, all
  enabled `O`. None of their function bodies mentions `invoiceNo` (the `ILIKE '%invoiceNo%'` test on
  `pg_get_functiondef` is false for all 9).
- **App guard:** the ONLY one is `validateSplit`, quoted in 3.4.

### 3.3 `source`, seq 1 vs seq 2..n, and what a row's share means

- **Vocabulary:** `'sap' | 'manual'`, enforced by `chk_order_invoices_source`. **A third value such as
  `'split_load'` needs an ALTER of that CHECK first** (and `chk_order_invoices_manual_has_no` applies only to
  `'manual'`).
- **Every reader of `order_invoices.source`** (rg over app/ lib/ components/ sql/ scripts/):
  - `lib/order-invoices/split.ts:199`: undo/shrink deletes only `source: 'manual'` rows.
  - `split.ts:216`: creates rows as `'manual'`.
  - `split.ts:357`: seq 1 = `seq === 1 && source === 'sap'`.
  - `split.ts:453`: the undo log lists the `'manual'` rows.
  - `lib/order-invoices/sap-row.ts:61,101,107`: the mirror writes only `seq 1, source 'sap'`.
  - `components/floor/detail-invoices.tsx:109`: the "SAP" chip.
  - The repair SQL keys on `seq > 1`, not on `source`. **No other reader exists.**
- **Seq 1 vs seq 2..n:**
  - Seq 1 is always `'sap'`, and its number and date come only from `sap-row.ts`, read back from `orders`,
    NULL-only and never throwing.
  - Seq 2..n are `'manual'`, typed in the dialog and created by `split.ts`. A created row inherits seq 1's
    `tripDropId` / `isHeld` / `heldAt` / `heldById`; `isDispatched` is never written on save.
  - Throughout the code, "split" means a row with `seq > 1` exists (`lib/trips/queries.ts:1196`,
    `lib/order-invoices/invoice-load.ts:37`, the dispatch route `:149`, `app/api/floor/search/route.ts:99`).
    `buildInvoiceRows` uses `rows.length < 2` (`lib/floor/invoice-rows.ts:118`), which is equivalent.
- **A row with NO `order_invoice_lines` = the WHOLE OBD.** It is never "the remainder": Model A allows a
  no-lines row only on an unsplit OBD. On a split OBD EVERY row, seq 1 included, carries lines, and
  Σ tins per raw line == `unitQty` (`rules.ts:148-157`). A split row without lines is a half-written save:
  `stale = rows.some(r => r.lines.length === 0) || detectStale(...)` (`invoice-rows.ts:127`).
- **Per-row tins / litres / kg** (`lib/floor/invoice-rows.ts:129-180`, `lib/order-invoices/entry.ts:35-45`):
  - **tins** = Σ `order_invoice_lines.qty`.
  - **litres** = Σ `lineLitres(volumeLine, unitQty, qty)` = `volumeLine × qty / unitQty`.
  - **kg**, first rule that applies:
    1. Every line has SAP line kg (`totalWeight > 0`): Σ `totalWeight × qty / unitQty`. EXACT.
    2. Every line's SKU has a learned kg per tin (median `totalWeight / unitQty` per SKU,
       `lib/order-invoices/kg-per-unit.ts`): Σ `qty × kg/tin`. EXACT.
    3. Otherwise `kgShare = obdKg × rowLitres / obdLitres`. APPROXIMATE (`kgExact:false`, shown "~"), and
       null when there is no header kg.
  - In a place (stop or trip), `placeLoad` / `invoicesLoad` sum the rows there and return null when every
    row is there (the caller then uses the OBD totals). All of this is keyed on row id, never on the number.
  - The detail panel uses rule 3 only (D4).

### 3.4 The Add invoices save path and the duplicate-number rule

- **Route:** `app/api/floor/orders/[orderId]/invoices/route.ts` (POST). It normalises each number
  (`:91`, `normaliseInvoiceNo`) and calls `saveSplit` (`lib/order-invoices/split.ts:376`).
- **`saveSplit`** calls `validateSplit(activeLines, invoices, sapNo)` (`split.ts:388`), then
  `numbersOnOtherObds` (`split.ts:331-345`, called at `:392`).
- **The refusal of a duplicate number within one OBD**, `lib/order-invoices/rules.ts:98-110`:
  ```ts
  // Numbers: present, the right shape (typed ones), unique within this OBD.
  const seen = new Set<string>();
  invoices.forEach((inv, i) => {
    ...
    if (seen.has(inv.invoiceNo)) {
      errors.push(`${inv.invoiceNo} is entered twice`);
    }
    seen.add(inv.invoiceNo);
  });
  ```
  `seen` includes seq 1, so a typed paper carrying SAP's own number is refused too. `rules.ts:91` also
  insists that invoice 1 is SAP's number, unchanged.
- **Re-validated after the write** (`split.ts:416-417`).
- **Across OBDs** (`split.ts:331-345, 392-399`): a typed number already on ANOTHER OBD gets 409
  "Already on another OBD: …", unless the client confirms (`confirmOtherObd`). That is the invoice-pair
  case, and it excludes the same OBD (`orderId: { not: orderId }`).
- **The rest of the structure already fits a split load:** a raw line may be split across papers, and the
  arithmetic is per line. The blockers are the "entered twice" guard, seq 1 being pinned to SAP's number,
  and the `source` vocabulary.

## 4. Impact — every place that assumes "one row per invoice number" (Part B)

Scenario: rows R1 (seq 1) and R2 (seq k > 1) of one OBD share `invoiceNo` X and sit on trips A and B.
Verdict = what happens to that scenario. Sorted BREAKS → DOUBLE-COUNTS → MERGES SILENTLY → NEEDS A CHOICE → SAFE.

| file:line | what | caller | verdict |
|---|---|---|---|
| `lib/order-invoices/rules.ts:98-110` `validateSplit` | Refuses a number seen twice on one OBD (seq 1 included); `:91` pins invoice 1 to SAP's number | `split.ts:388, :417` ← POST `app/api/floor/orders/[orderId]/invoices` | **BREAKS**: a split load cannot be saved at all today |
| DB `chk_order_invoices_source` | `source IN ('sap','manual')` | every insert | **BREAKS** only if a third source value is chosen (ALTER first) |
| `lib/order-invoices/split.ts:199, :453` | Shrink / undo deletes only `'manual'` rows | `saveSplit` / `undoSplit` | **BREAKS** if split-load rows get a new source: undo could not remove them |
| `lib/trips/find-bill.ts:80-90` `invoiceRowMatches` | orderId → the FIRST row (lowest seq) whose number matches; `!map.has(orderId)` drops the rest | `app/api/floor/search/route.ts:57`, `app/api/floor/trips/lookup/route.ts:67`, `lib/trips/redelivery.ts:398` | **BREAKS**: typing X always resolves to R1; R2 cannot be reached by its own number |
| `app/api/floor/search/route.ts:57-80, 150, 163` | Floor search hit: one per OBD; its trip = `orders.tripDrop` (derived = R1's stop); `matchedInvoiceSeq` = R1's | `components/floor/floor-page.tsx:2163` (fetch), lit row `:2173/:2400` | **BREAKS**: search lands on truck A; truck B carrying X is never shown or lit |
| `lib/trips/redelivery.ts:398, 450-456` `searchForRedelivery` → `redeliveryTargetsOf` (`redelivery-plan.ts:40`) | A split OBD found by invoice offers only the matched row | GET `app/api/floor/trips/[id]/redeliveries` (`route.ts:62`) | **BREAKS**: typing X offers only truck A's half (searching by OBD or SO shows both, "· 1/2", "· 2/2") |
| `lib/reports/freight-report-data.ts:266` (`obdStopIds` → `deriveObdTripDropId`, lowest seq), `:405/:431` vehicle, `:452` whole-OBD `billQuantities`, `:508` `orders.invoiceNo` | Freight / MIS .xlsx: one row per OBD | `app/api/reports/freight-report/route.ts:85` (sole reader) | **BREAKS**: truck B has no row; truck A's row and trip totals carry the whole OBD |
| `freight_trip_bills` (`prisma/schema.prisma:~4621`, orderId only; live partial index `freight_trip_bills_order_active_key` UNIQUE ("orderId") WHERE "removedAt" IS NULL, per `CLAUDE_FREIGHT_TRIPS.md:101`, not modelled in Prisma) + `lib/freight-trips/queries.ts:296-307` (`invoiceRows: []`) | Freight paper trips hold whole OBDs | `lib/freight-trips/*` | **BREAKS** if a split-load OBD is ever put on freight: one active freight trip per OBD, no row key |
| `lib/floor/raise-ci.ts:366-512` `raiseInvoiceCi` (`:463` `orderInvoiceId: row.id`, `:466` `invoiceNo: row.invoiceNo`, `:473` `returnType: "full"`) | Per-invoice CI on a split OBD | `app/api/floor/ci/route.ts:193` | **BREAKS**: each half becomes its own CI under the SAME X, each marked FULL but holding only part of the tins |
| `lib/ci/workbook.ts:227` (col C invoiceNo, col N FULL/PARTIAL) via `getCiRegisterRows` | Billing's CI register .xlsx, one row per CI | `app/api/ci/export/route.ts:75` | **DOUBLE-COUNTS**: two rows, same X, both FULL, each with part of the litres; billing keys these into SAP |
| `lib/trip-sheet/load.ts:298-307, 323, 331` + `lib/trip-sheet/totals.ts:34` | A4 trip sheet / share: litres and kg narrowed per trip (`placeLoad`), but `articles` = typed `articleCount` or whole-OBD `q.articles` | trip-sheet routes | **DOUBLE-COUNTS** articles on both trucks (already true for any split; `PlaceLoad.tins` exists and nothing reads it here). Invoice number, litres and kg are SAFE |
| `lib/reports/trip-detail-data.ts:300-308, 348` | Trip-detail .xlsx, one row per (OBD, trip); kg and litres narrowed, `articles` from the whole OBD | `app/api/reports/trip-detail/route.ts:86`, trip-detail-old `:84` | **DOUBLE-COUNTS** articles; the rest is SAFE |
| `lib/floor/selection.ts:449-457` `selectionCountLabel` | Split rows' numbers go into a `Set` → "n invoices" | Floor selection bar | **MERGES SILENTLY**: R1 + R2 ticked counts as "1 invoice" |
| `lib/trips/activity.ts:819-829` `logTripRedeliveryAdded`, `:853-863` `…Removed` | "OBD · invoiceNo (attempt n, reason)"; items carry `invoiceNo`, no `orderInvoiceId` | `lib/trips/redelivery.ts:785, :871` | **MERGES SILENTLY**: the two halves log identical lines |
| `lib/trips/activity.ts:505, 529-534` `logTripCancelled` | Parallel arrays obd + `redeliveryInvoiceNos`, no row id | `app/api/floor/trips/[id]/cancel/route.ts:222-233` | **MERGES SILENTLY**, same as above |
| `components/floor/trip-redelivery-info.tsx:70` | Shows `r.invoiceNo` only; `invoiceKN` (`lib/trips/queries.ts:1228`) is computed but no component renders it | `floor-page.tsx:4506` | **MERGES SILENTLY**: the two halves' info panels read the same |
| `components/floor/trip-desk.tsx:1154` | Hidden-row re-delivery line prints `invoiceNo`, no k/n | trip-desk render | **MERGES SILENTLY** (cosmetic) |
| `lib/order-invoices/trip-bills.ts:48` `invoiceLabel` (`:93, :143`); `hold.ts:87`; `dispatch.ts:94, :178` | Refusal and log text names the row by `invoiceNo ?? "Invoice {seq}"` | trips/bills route `:270, :292`; floor actions; dispatch route | **MERGES SILENTLY** in TEXT only ("X is on hold" twice); the payloads carry row ids, and the dispatch log names the trip |
| `lib/ci/queries.ts:180-186` `searchCiBills` (lowest seq per OBD), `:344` `getCiBill` | /ci search: one hit per OBD; opening it loads the whole OBD's lines; `matchedInvoiceSeq` read by no CI component | `app/api/ci/search/route.ts:58` | **MERGES SILENTLY**: on /ci you cannot pick which half you are returning |
| `lib/picking/visibility-gate.ts:111-116` (`ON_SHOWN_TRIP_WHERE` = any row on a shown trip) | Pick gate keyed on rows' `trip.shownAt` | `buildPickingWhere` | **MERGES SILENTLY**: either truck shown → the whole OBD is pickable |
| `prisma/schema.prisma:2092` `pick_assignments.orderId @unique`; `:2160` `pick_findings.rawLineItemId @unique` | One pick per OBD, one finding per raw line; picking reads no `order_invoices` except the gate and `countHeldBackWaiting` (`visibility-gate.ts:174-186`) | lib/picking, app/api/picking, components/picking | **MERGES SILENTLY**: the OBD is picked as one unit of all its tins, never per truck. Model A says so on purpose |
| `lib/order-invoices/trip-read.ts:46-53` `deriveObdTripDropId` → `orders."tripDropId"` (written by `trip-link.ts:100` `setRowsTrip`) | OBD stop = lowest-seq row's stop | every `orders.tripDropId` reader (picking, tint, labels, freight, lookup) | **NEEDS A CHOICE**: every OBD-level screen names truck A only. Same as Add invoices today; never use it for "on THIS trip" (owner file §3) |
| `app/api/floor/trips/lookup/route.ts:100-112` | One trip per OBD via `deriveObdTripDropId` | **no live UI caller** (header `:20`; `floor-page.tsx:2153` says `/api/floor/search` replaced it) | **NEEDS A CHOICE** if revived; dead today |
| `lib/floor/search.ts:136` `matchedInvoiceIdsOf` | Search auto-tick ticks EVERY row whose number matches | `floor-page.tsx:2228` | **NEEDS A CHOICE**: pasting X ticks both halves (among visible rows) |
| `lib/order-invoices/ci-plan.ts:58` `invoiceCiDuplicate` (`ciCoversRow :42`) | Duplicate guard per (orderId, ROW id); never compares `invoiceNo` | `raise-ci.ts:445` | **NEEDS A CHOICE**: a second CI on X through R2 passes. One CI per SAP invoice, or one per truck? |
| `lib/order-invoices/copy-plan.ts:83-101` `planCopyRows` / `badSentNo`; `lib/billing/print.ts:540-589` (`invoicePendingNos` = distinct), `:785-860` `copyTripBills` | Copies per invoice ROW per trip (UNIQUE tripId + orderInvoiceId); Copy inv matches the sent numbers against THIS trip's rows | `app/api/billing/print/trip/[id]/copy` | **NEEDS A CHOICE**: mechanically SAFE per trip (A copies R1, B copies R2; with both on one trip the `Set` marks both). But billing will copy SAP invoice X on TWO trips. Is that what the paperwork needs (a second print, a challan for vehicle 2)? |
| `copy-plan.ts:33-45` `splitAtOf` / `isWholeObdCopy` | A copy taken before the first seq ≥ 2 row covers every later row | Print state | **NEEDS A CHOICE**: a split load made after billing copied the whole bill would read copied on both trucks |
| `docs/Powershell/3-PendingFetch.ps1:347-353`, `4-LogisticsEntry.ps1:548, 595, 690` | External Breakwall freight pipeline: reads "Frt Report.xlsx" from an email, keyed on Ref No with duplicates dropped (keep first), posts ONE VehicleNo per row | run on the depot PC, not Orbit | **NEEDS A CHOICE** (outside Orbit): a second vehicle for one Ref No would be dropped. No Orbit code feeds it |
| `lib/floor/invoice-pairs.ts:84-103` `buildPartnerMap`, `lib/floor/queries.ts:695-708` `getInvoicePartnerMap`, `lib/floor/live-merge.ts:128`, `lib/floor/sort.ts:52` `keepPairsAdjacent`, `components/floor/pair-cells.tsx:171`, `floor-table.tsx:1052` (tbody key `…-inv-${invoiceNo}`) | Invoice PAIRS keyed on `orders.invoiceNo` across OBDs; self dropped by orderId; the tbody key is used only for a pair block of ≥ 2 OBDs, and a split OBD is never merged into one | Floor board | **SAFE**: a split load is inside ONE OBD, so it makes no pair |
| `lib/floor/invoice-rows.ts:394-416` `drawRowsOf` / `drawRows`; `:320-353` `awayChipOf` | One draw row per invoice ROW (key `inv:<id>`), k/n by position, amber chip by place | floor-table, pager | **SAFE**: keyed on row id. R1/R2 draw "1/2", "2/2" with the same number; whether that is enough to tell them apart is a UI choice |
| `lib/order-invoices/trip-link.ts` `setRowsTrip` + `trip-bills.ts` `planAddRows` / `planRemoveRows` | Only trip writer, per row id; derived `tripDropId` + `partlyOnTrip` from all rows | trips/bills route, trips cancel route | **SAFE** |
| `lib/order-invoices/hold.ts:109-130` (hold ⇔ every row held) | Per-row hold, OBD hold mirror | `app/api/floor/actions` | **SAFE** |
| `lib/order-invoices/dispatch.ts:56-65` `rowDone` / `obdDone` | Done ⇔ every row dispatched or covered by a full CI AND ≥ 1 row dispatched | trip dispatch route via `lib/floor/dispatch.ts:159` | **SAFE**: per row id (but see the CI "full" BREAKS row: a per-row CI marked full covers that row) |
| `lib/order-invoices/redelivery-plan.ts`, `lib/trips/redelivery.ts:205, 722-764` | Attempts per row id; UNIQUE (tripId, orderInvoiceId); `redeliveryCountsByTrip` key tripId:dropId:orderId | re-delivery route | **SAFE**: two separate attempt lines; the count stays per OBD |
| `lib/trips/queries.ts:1189` `liveInvoiceById` | `orders.invoiceNo` used only for unsplit OBDs; split OBDs read their own row by `orderInvoiceId` (`:1215`) | `getTripDetail` `:1288` | **SAFE** |
| `lib/floor/invoice-rows.ts:217-241` `placeLoad` / `invoicesLoad`; `lib/order-invoices/invoice-load.ts:30`; `kg-per-unit.ts` | Load per place by row id / per SKU | trips queries `:569, :640`, trip sheet, trip detail, print `:340`, load plan | **SAFE** |
| `lib/trip-sheet/search.ts:107-121` | `orders.invoiceNo` on every trip the OBD touches + seq > 1 rows on their own stop | trip-sheets search route | **SAFE**: finds both trucks |
| `lib/ci/auto.ts:127, 208, 333`; `lib/ci/bill-only.ts:179-191`; `raise-ci.ts:109` `raiseFullBillCi`; `app/api/ci/draft/route.ts:151-165` | Whole-OBD CIs: `orderInvoiceId` = `linkRowForOrder` (NULL on a split OBD → covers every row) | auto-CI ← `app/api/picking/findings/confirm/route.ts:369` (via `raiseAutoCi`, `:328`); bill-only ← `lib/billing/telephonic-apply.ts:418`; full bill ← `app/api/floor/ci/route.ts:201`, `app/api/tint/manager/ci/route.ts:139,151`; draft ← `components/ci/new-return.tsx` | **SAFE** |
| `lib/ci/live-ci.ts:44-50` `findLiveCi` | Live-CI guard by row ids or NULL | hold.ts:187, release.ts:163, bill-actions.ts:371, picking cancel, pick-delete, billing actions | **SAFE** |
| `lib/order-invoices/split.ts:331-345` `numbersOnOtherObds` | Cross-OBD number check, same OBD excluded | `saveSplit` | **SAFE** |
| `lib/order-invoices/plan.ts:152-181` | Save diff by seq | `saveSplit` | **SAFE** (keyed on seq) |
| Tint search (`lib/tint/search.ts:29,56`, `app/api/tint/manager/find/route.ts:82`), `app/api/picking/direct-load/undo/route.ts:74`, import `app/api/import/obd/route.ts:4530`, `lib/import-upsert/header.ts` | OBD-level `orders.invoiceNo` only | — | **SAFE**: one SAP number per OBD either way |
| WhatsApp share (`lib/trip-sheet/caption.ts`, `share-groups.ts:98-102`), `lib/picking/share-findings-text.ts` | No invoice numbers in the text | — | **SAFE** |

## 5. Paperwork and outside systems (Part C, facts only)

**C1. NTS mirror on a same-day, two-vehicle delivery.** `trip_report` constraints, live:
`trip_report_pkey PRIMARY KEY ("sourceId")` and `trip_report_delivery_no_dis_date_key UNIQUE ("deliveryNo", "disDate")`.
In `mirror_trip_report_today(rows jsonb)` (live `pg_get_functiondef`):
1. A delete step removes table rows for the batch's dates whose `deliveryNo` is absent from the batch.
2. `deduped` = `select distinct on ("deliveryNo", "disDate") * … order by "deliveryNo", "disDate", ord desc`,
   so **the LAST occurrence in the batch wins and every earlier one is dropped**.
3. `insert … on conflict ("deliveryNo","disDate") do update set … "vehicleNo" = excluded."vehicleNo", "tripNo" = excluded."tripNo" … where trip_report."rowHash" is distinct from excluded."rowHash"`.

In plain words: **if NTS ever sends one delivery on two vehicles the same day, the mirror keeps ONE row,
the vehicle and trip that came last in that pull, and silently discards the other.** Nothing errors and
nothing is counted (it is not in `rowsSkipped`). If NTS's order changes between pulls, the kept vehicle can
flip from cycle to cycle. `CLAUDE_TRIP_REPORT.md:46` already records "NTS sends one duplicate `deliveryNo`
per cycle and the mirror function's dedupe absorbs it (`kept 98 → pushed 97`)". What that duplicate IS
(possibly a two-vehicle delivery) cannot be seen from the repo: the puller (`Pull-TripReport.ps1`) lives
outside the repo, and the dropped row leaves no trace in the table. Live: 353 `deliveryNo`s show more than
one `vehicleNo` and 399 show more than one `disDate`, but always on DIFFERENT days (the unique forbids the
same day). The backfill script joined `deliveryNo = orders.obdNumber` (TRIP_REPORT `:18`), so an NTS
"delivery" is an OBD, not an invoice.

**C2. E-way bill.** Nothing in the repo produces or feeds e-way bill data (no Part-B, no vehicle number per
invoice):
- `e-way`, `eway`, `ewb`, `Part-B`, `partB` across app/, lib/, components/, sql/, docs/, including
  docs/Powershell and docs/Parser, hit only prose:
  - an old archived IMPORT context ("E-way bill JSON export … may land");
  - `ewaybill` as an SAP status code that arrived as a transporter name (`prisma/schema.prisma:541-545`);
  - "Part B" as SQL or prompt section headings;
  - base64 noise in .html files.
- The only outbound vehicle-per-record feed is the external Breakwall freight pipeline
  (`docs/Powershell/4-LogisticsEntry.ps1`), keyed on Ref No, one VehicleNo per row; Orbit code does not feed it.

## 6. Live numbers (Part D)

All **READ-ONLY** (SELECT / information_schema / pg_catalog only), run 2026-10-24 through Prisma
`$queryRawUnsafe` from a scratch script outside the repo. The Part A queries are in §3; the Part D block:

```sql
-- READ-ONLY
SELECT 'rows source='||source AS k, count(*)::int AS v FROM order_invoices GROUP BY source
UNION ALL SELECT 'obds with >1 row', count(*)::int FROM (SELECT "orderId" FROM order_invoices GROUP BY 1 HAVING count(*)>1) x
UNION ALL SELECT 'max rows on one obd', COALESCE(max(n),0)::int FROM (SELECT count(*) n FROM order_invoices GROUP BY "orderId") x
UNION ALL SELECT 'invoiceNo on >1 row (any OBD)', count(*)::int FROM (SELECT "invoiceNo" FROM order_invoices WHERE "invoiceNo" IS NOT NULL GROUP BY 1 HAVING count(*)>1) x
UNION ALL SELECT 'invoiceNo on >1 row of SAME obd', count(*)::int FROM (SELECT "orderId","invoiceNo" FROM order_invoices WHERE "invoiceNo" IS NOT NULL GROUP BY 1,2 HAVING count(*)>1) x
UNION ALL SELECT 'rows with lines', count(DISTINCT "orderInvoiceId")::int FROM order_invoice_lines
UNION ALL SELECT 'rows without lines', count(*)::int FROM order_invoices oi WHERE NOT EXISTS (SELECT 1 FROM order_invoice_lines l WHERE l."orderInvoiceId"=oi.id)
UNION ALL SELECT 'order_invoice_lines rows', count(*)::int FROM order_invoice_lines
UNION ALL SELECT 'obds rows on >1 trip (this week)', count(*)::int FROM (
   SELECT oi."orderId" FROM order_invoices oi JOIN trip_drops d ON d.id=oi."tripDropId" JOIN trips t ON t.id=d."tripId"
   WHERE t."tripDate" >= date_trunc('week', (now() AT TIME ZONE 'Asia/Kolkata'))::date GROUP BY 1 HAVING count(DISTINCT t.id)>1) x
UNION ALL SELECT 'obds rows on >1 trip (today IST)', count(*)::int FROM (
   SELECT oi."orderId" FROM order_invoices oi JOIN trip_drops d ON d.id=oi."tripDropId" JOIN trips t ON t.id=d."tripId"
   WHERE t."tripDate" = (now() AT TIME ZONE 'Asia/Kolkata')::date GROUP BY 1 HAVING count(DISTINCT t.id)>1) x
UNION ALL SELECT 'obds rows on >1 trip (any date)', count(*)::int FROM (
   SELECT oi."orderId" FROM order_invoices oi JOIN trip_drops d ON d.id=oi."tripDropId" GROUP BY 1 HAVING count(DISTINCT d."tripId")>1) x
UNION ALL SELECT 'orders.invoiceNo shared by >1 OBD (pairs)', count(*)::int FROM (SELECT "invoiceNo" FROM orders WHERE "invoiceNo" IS NOT NULL AND NOT "isRemoved" GROUP BY 1 HAVING count(*)>1) x;
```

| Fact | Live 2026-10-24 |
|---|---|
| `order_invoices` by source | `sap` 20,538 · `manual` 3 |
| OBDs with > 1 row | **1** (order 18648) |
| Max rows on one OBD | 4 |
| `invoiceNo` on > 1 row of the SAME OBD | **0** (as expected) |
| `invoiceNo` on > 1 row, any OBD | 22, every one `sap` rows on two DIFFERENT orders (invoice pairs). Matches 22 `orders.invoiceNo` shared by > 1 live OBD. E.g. I536219766 rows 186/197 on orders 7012/7017 … I536232128 rows 36950/36962 on 20179/20191 |
| Rows with `order_invoice_lines` / without | 4 (order 18648's four) / 20,537 |
| `order_invoice_lines` rows | 4 |
| OBDs whose rows sit on different trips: today / this week / any date | 0 / 0 / **1**: order 18648, on L-261006-05 (2026-10-06) and L-261020-05 (2026-10-20) |
| `trip_report` rows | 10,001 · `deliveryNo` with > 1 vehicle (different days) 353 · with > 1 `disDate` 399 |

## 7. What must NOT change for normal (unsplit) bills: the invariants found

1. **An unsplit OBD is exactly ONE row:** seq 1, `'sap'`, NO line rows (= the whole OBD). Its
   `invoiceNo` / `invoiceDate` mirror `orders` through `sap-row.ts` only (read back from `orders`,
   NULL-only, never throws).
2. **For an unsplit OBD the `orders` columns are the truth**: `dispatchStatus`, `workflowStage`,
   `tripDropId`. Its row's `isHeld` / `isDispatched` are a MIRROR (`mirrorObdHoldSafe`,
   `mirrorObdDispatchedSafe`) and are never read for its screens.
3. **"Split" is detected by `seq > 1` (or rows ≥ 2)**, so every split-only branch stays off for an unsplit
   bill. `buildInvoiceRows` returns `[]`, `placeLoad` / `invoicesLoad` return null, and the caller uses the
   OBD totals, so an unsplit bill is byte-for-byte unchanged.
4. **Identity `UNIQUE (orderId, seq)`**; lines keyed on `rawLineItemId` (never SKU); edit in place by seq
   (never delete + re-create: three RESTRICT FKs point at rows).
5. **Exactly one `orders.update` per OBD per trip press** (`setRowsTrip`; the markers key on
   `MAX(orders.updatedAt)`). Write order: rows → OBD → log, with no transaction.
6. **Unsplit copies and re-deliveries go on seq 1** (`planCopyRows`, `linkRowFor`); the unsplit refusal
   wording stays byte for byte (`trip-bills.ts`).
7. **Counts stay per OBD** ("N bills", "+n re-del"); litres and kg go per invoice only for split OBDs.
8. **Picking, tint, cancel, ship-to and Hand stay per OBD** (Model A).
9. **Invoice PAIRS** (one `orders.invoiceNo` on several OBDs) are keyed on `orders.invoiceNo` across OBDs
   and must not be confused with a split load. Today's 22 duplicated row numbers are all pairs.
10. `orders.invoiceNo` stays SAP's one invoice; nothing clears or overwrites it.

## 8. Questions only the owner can answer

1. How often does a split load actually happen, and is it always the depot's own trucks (Orbit trips), or also freight / NTS?
2. On a split load, does SAP stay ONE invoice, or does billing raise a delivery challan (or anything else) for the second vehicle?
3. Who records the split: Floor while loading, or billing? With the Add invoices tick, or a new one?
4. Can one OBD carry BOTH a split load and Add invoices (several invoices, one of which is on two trucks)?
5. Should a split-load row be told apart by a new `source` value (needs a CHECK ALTER), or by some other mark?
6. On Floor, what tells the two halves of one invoice apart: "1/2 · 2/2", the truck, or something else?
7. Billing Print: should invoice X be copied on BOTH trips, or once only?
8. CI: a return on one truck's half. Is it one CI per truck (PARTIAL each?) or one CI per SAP invoice?
9. Searching an invoice number: should it show both trucks, or ask which one?
10. Freight report / MIS: one row per truck with its share of kg, or one row per OBD as today?
11. Trip sheet and trip-detail articles: the truck's own tins, or keep the OBD total?
12. NTS: does NTS ever send one delivery on two vehicles the same day? (If yes, the mirror keeps only the last one.)
13. E-way bill Part-B (vehicle number): handled outside Orbit today? Should Orbit ever hold a vehicle number per invoice?
14. Picking: does the floor pick a split load as one OBD (as today), or per truck?
15. Re-delivery and hold: can one truck's half be held or re-delivered on its own, like an Add invoices row?

---

*Report: `docs/prompts/drafts/code-discovery-2026-10-24-split-load.md` · read-only discovery, no code, no commit.*
