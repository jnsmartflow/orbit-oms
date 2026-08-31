# CI Module — Goods Return Note (CI-Form)

**Draft type:** `web-update` (owner decision record)
**Version:** v3.3 · 2026-09-01 — **design locked, building**

**v3.3 — a draft carries NULL for the stage-1 answers, no placeholders** (owner
ruling). `materialMoved`, `materialReceivedDate`, `reasonId` and `reasonLabel`
are now NULLABLE, guarded by the new `chk_ci_returns_complete_when_not_draft`,
which makes all four mandatory the moment `status` stops being `'draft'` — §6.

**v3.2 folds in the four things step 3a measured against production:** the
litres guard is on `unitQty` only (`volumeLine = 0` is a real value on 346
tool lines, §6) · the dealer's **area is read live via `customerId`, is not a
column**, and is blank for unmastered dealers (§6) · `orders.invoiceNo` was
**unindexed** and `orders_invoiceNo_idx` was added 2026-08-31 (§4) · and the
"confirm `volumeLine`'s unit" instruction is **discharged** — litres, 99.70%
exact over 36,380 lines (§6).

**v3.1 fixed one contradiction Claude Code found in v3:** `ciNumber` was
declared NOT NULL while the write order called for a numberless draft.
**It is nullable** — §6, "ciNumber is NULLABLE". Also settled there:
precision `numeric(12,3)` on the litres columns, and `returned_to_floor`
in the status CHECK from day one.
**Author:** Claude.ai planning session with Smart Flow

**Companion files — save all three together:**

| File | Save to |
|---|---|
| this spec | `docs/prompts/drafts/web-update-2026-08-31-ci-module.md` |
| supervisor mockup | `docs/mockups/ci/supervisor.html` |
| billing mockup | `docs/mockups/ci/billing.html` |
| Step-0 discovery report (already on disk) | `docs/prompts/drafts/code-discovery-2026-08-31-ci-module-readiness.md` |

> ⚠ **v1 of this spec was never saved into the repo**, and the Step-0 prompt pointed Claude Code at
> a path that did not exist. Save all three files before running any build prompt.

**Evidence base:** the Step-0 discovery report (read-only SELECTs against production + source
trace). Nine v1 errors were corrected from it — listed in §12.

⚠ **CORE section numbers cited here were read against CORE v92 / Schema v27.13.** The repo is on
**CORE v96 / Schema v27.18**. Re-derive any `CORE §n` pointer before relying on it.

---

## 1. What this is

Digitises the paper **"Goods Return Note (CI – Form)"** the floor supervisor fills by hand today.

It is the **return** counterpart to MRN, running the opposite way:

| | MRN | CI |
|---|---|---|
| Direction | stock coming **IN** from TPW/CDC | stock coming **BACK** from a customer |
| Starts it | billing operator (desk) | **floor supervisor (phone)** |
| Finishes it | floor supervisor | **billing operator (desk)** |

---

## 2. Scope — v1

**In:** two-stage form supervisor → billing · searchable record · own CI series number · stored link
to the original order.

**Out (owner decision):** no stock adjustment, no change to the original order's `workflowStage` or
any other column, no SAP write-back. Owner's words: *"right now just a searchable record, will
connect with the og order later."* Build the FK, wire no behaviour to it.

---

## 3. Workflow

### Stage 1 — floor supervisor (phone) → `docs/mockups/ci/supervisor.html`

```
Search  →  Bill + lines  →  Next  →  Details  →  Submit
```

1. **Search** by invoice number **or OBD number** (§4). One match opens the bill directly; a list
   appears only when the invoice covers two OBDs.
2. **Full bill** or **Part** — a segmented switch on the bill screen.
   - *Full bill* — every active line filled at its delivered quantity, shown dimmed. Nothing to tap.
   - *Part* — he taps the lines that came back and enters returned quantity per line.
3. **Next** → details step: Material **Moved / Not moved**, **Received on**, **Reason** (§3.1),
   optional **Remark**.
4. **Submit.** CI number allocated at this moment. Status → `submitted`.

**He types quantity in TINS and nothing else.** Litres are calculated (§6). No condition field, no
manufacturing date, no damage counts — those paper-form columns are not carried into v1.

### 3.1 Reason of CI

Supplied 2026-08-31. One struck-through entry on the owner's sheet is deliberately excluded. **The
first three are the common ones** — they sit above a divider in the picker, the rest under *More*.

| sortOrder | code | label | pinned |
|---|---|---|---|
| 1 | `WRONG_ORDER_BY_SO` | Wrong Order by S.O. | ✅ |
| 2 | `PHYSICALLY_CROSS` | Physically Cross | ✅ |
| 3 | `RETURN_BY_DEALER` | Return by Dealer | ✅ |
| 4 | `ORDER_CANCEL_BY_DEALER` | Order Cancel by Dealer | |
| 5 | `DOUBLE_ORDER` | Double Order | |
| 6 | `WRONG_PUNCHING` | Wrong Punching | |
| 7 | `RE_BILL` | Re Bill | |
| 8 | `COMPLAINT_MATERIAL` | Complaint Material | |

**A master table, not a CHECK constraint** — the list will change, and a CHECK makes every change a
schema migration. Retire with `isActive = false`, never `DELETE`: old CIs must keep pointing at the
reason they were raised under.

### Stage 2 — billing operator (desk) → `docs/mockups/ci/billing.html`

Opens the CI, checks what the floor sent, punches it in SAP, then fills three fields and closes it:
**CI date · CI number · Value (₹)** → **Close CI**. Status → `closed`.

Everything the floor entered is **read-only** to billing.

---

## 4. The search key — invoice number is NOT enough

Measured against production 2026-08-31:

| Fact | Number |
|---|---|
| Bills dispatched in the last 30 days with **no** invoice number | **149 of 2,971 — 5.0%** |
| `dispatched` with no invoice number, oldest 2026-05-15 | **429** |
| `pick_checked` with no invoice number, as of that day | **61** |
| Invoice numbers mapping to **two** OBDs | **11** (always sharing one `soNumber`) |

Coverage is 68.8% over 90 days / 55.7% all-time, but **both are misleading** — every invoiced order
in the database falls inside the last 90 days (capture began then). **Among bills that reach
dispatch, coverage is 91–95%.** Quote that figure only.

**Invoice shape:** `I` + 9 digits, length 10, uppercase, no spaces, no padding — uniform across all
6,950 values. Normalising needs only `.trim().toUpperCase()`.

### The ruling (owner, 2026-08-31)

**Search by invoice number OR OBD number. If the bill has no invoice number the CI is raised anyway
with `invoiceNo` blank, and the invoice number appears later on its own. He is never blocked.**

- **`ci_returns.invoiceNo` is NULLABLE.** This is the reason. Do not add NOT NULL.
- **`orderId` is the identity of the bill** — never `invoiceNo`. `obdNumber` is snapshotted beside
  it and is never null (`@unique` on `orders`).
- **Index both** `invoiceNo` and `obdNumber` — on `ci_returns` **and on `orders`**, which is the
  table the search actually reads.
  ⚠ **`orders.invoiceNo` had NO index at all** [found 3a, fixed v3.2]. `orders` carried
  `orders_obdNumber_key` *and* `orders_obdNumber_idx`, but nothing on `invoiceNo` — so half of every
  CI search was a sequential scan over 12.5k rows, and the half a supervisor uses most.
  **`orders_invoiceNo_idx` was created live on 2026-08-31** and mirrored into `prisma/schema.prisma`
  as `@@index([invoiceNo])` on the `orders` model (Prisma's default name matches, so no `map:`).
- 🔴 **Back-fill is a READ, not a write.** Do not build a job that patches `ci_returns.invoiceNo`.
  The CI holds `orderId`; any screen wanting the invoice number reads it through the order at render
  time, so it simply appears once SAP sends it. A patch job would fight the snapshot rule and could
  rewrite a closed document. **This is the one place CI deliberately does not snapshot** — print and
  export must prefer the live order value and fall back to the snapshot, never the reverse.
- Billing is **not** forced to supply the invoice number before closing.
- **Search always returns a list; never `findFirst`.** With exactly one hit the UI skips the list
  and opens the bill — that is a UI shortcut, not a query shortcut.
- **Accept a bare 9-digit entry** and prefix `I` — a supervisor reading paper will omit it.

---

## 5. CI numbering

**`CI-{YYYY}-{5-digit}`.** Copy **`lib/mrn/number.ts` → `lib/ci/number.ts`**, not the challan
allocator.

There is no shared challan allocator to reuse — `CHN-` is built inline at six call sites. MRN's is
the deliberate improvement: year-prefixed scope rather than a global max, ordering on the zero-padded
number itself rather than a surrogate `id`, an explicit `Number.isFinite` guard (a malformed suffix
otherwise formats as `CI-2026-000NaN` and passes the unique index), and **a reset to `00001` each
January**, which `CHN-` does not do.

- 🔴 **No `isVoided` / `isRemoved` filter on the sequence query.** A voided row still owns its number
  under the UNIQUE index; filtering hands out a number that throws P2002 on a screen where the
  operator did nothing wrong.
- **MAX+1, never COUNT+1** — gaps are expected.
- ⚠ **Not atomic, by accepted trade.** Two creates in the same millisecond collide and the UNIQUE
  index is the backstop. Do **not** "fix" it with `prisma.$transaction` (banned, CORE §3). Surface
  P2002 as "please try again".
- **Allocated at submit**, never when the form opens — which is why the
  column is **nullable** (§6). A draft carries no number.

### 🔴 Two numbers, and only one of them is labelled

| | |
|---|---|
| `CI-2026-00042` | **OrbitOMS's own reference.** Given at submit. Shown top-right of the billing pane and on every rail card. Column: `ciNumber`. |
| `85832091` | **SAP's.** Typed by billing after punching. The billing screen labels this field plain "CI number". Column: `sapCiNumber`. |

The paper form carries both — **73989** at the top is the book serial, **CI Order No 85832091** is
SAP's. **They stay two columns whatever the screen calls them.** Merging them leaves every pending
CI with no way to name it, for the hours or days before SAP sees it.

---

## 6. Data model

CORE §3 conventions: camelCase, **no `@map`**, `@db.Timestamptz(6)` on every timestamp, **every FK to
`users` carries an explicitly named `@relation` on both sides**.

### `ci_reason_master`

```
id         Int  PK autoincrement
code       String  @unique
label      String
sortOrder  Int
isPinned   Boolean DEFAULT false     -- the three common ones
isActive   Boolean DEFAULT true      -- retire by flag, NEVER DELETE
createdAt  DateTime @default(now()) @db.Timestamptz(6)
```

### `ci_returns` (header)

```
id                    Int  PK autoincrement
ciNumber              String?  @unique         -- CI-2026-00042. 🔴 NULLABLE — see below
status                String                    -- draft | submitted | closed | returned_to_floor
                                                -- CHECK chk_ci_returns_status

-- the bill
orderId               Int   FK -> orders.id (RESTRICT)  @relation("CiReturnOrder")
obdNumber             String                    -- snapshot; also the join key to line items
invoiceNo             String?                   -- ⚠ NULLABLE — see §4
invoiceDate           DateTime? @db.Date
soNumber              String?
customerId            Int?  FK -> delivery_point_master.id  @relation("CiReturnCustomer")
customerCode          String?
customerName          String?

-- stage 1 (floor)
returnType            String                    -- full | part
                                                -- CHECK chk_ci_returns_return_type
materialMoved         String?                   -- moved | not_moved · 🔴 NULLABLE
                                                -- CHECK chk_ci_returns_material_moved
materialReceivedDate  DateTime? @db.Date        -- 🔴 NULLABLE
reasonId              Int?  FK -> ci_reason_master.id (RESTRICT) @relation("CiReturnReason")
reasonLabel           String?                   -- snapshot, so a rename never rewrites history
reasonRemark          String?
supervisorId          Int   FK -> users.id  @relation("CiReturnSupervisor")
submittedAt           DateTime? @db.Timestamptz(6)

-- stage 2 (billing) — the "CI details" block
ciDate                DateTime? @db.Date        -- SAP's CI date
sapCiNumber           String?                   -- SAP's number; UI label is plain "CI number"
ciValue               Decimal?  @db.Decimal(12,2)   -- ₹, the figure circled on the paper form
billingOperatorId     Int?  FK -> users.id  @relation("CiReturnBillingOperator")
closedAt              DateTime? @db.Timestamptz(6)

-- void (never hard-delete a numbered document)
isVoided              Boolean  DEFAULT false NOT NULL
voidReason            String?
voidRemark            String?
voidedAt              DateTime? @db.Timestamptz(6)
voidedById            Int?  FK -> users.id  @relation("CiReturnVoidedBy")

createdAt             DateTime  @default(now()) @db.Timestamptz(6)
updatedAt             DateTime  @updatedAt      @db.Timestamptz(6)
```

> ⚠ Use a real `@updatedAt`, **not** a plain `@default(now())`. `push_subscriptions` was built the
> other way and every write there has to remember to stamp it by hand (CORE landmine). CI's live
> marker keys on `MAX(updatedAt)` — a column that silently stops moving would freeze the board.

Indexes: `(orderId)`, `(status)`, `(materialReceivedDate)`, `(invoiceNo)`, `(obdNumber)`.

🔴 **The dealer's AREA is NOT a column here, and must not become one** [added v3.2]. Billing's right
pane renders `102492 · OBD 9109145575 · Ghod Dod` — that third part is the area, and it is read
**LIVE** at render through `ci_returns.customerId → delivery_point_master.area.name`, exactly as
`invoiceNo` is read live through `orderId` (§4). It is **blank for an unmastered dealer**
(`customerId` null), which is a normal state and not an error — the pane shows the code and the OBD
and stops. `customerCode` / `customerName` ARE snapshotted; the area is not, because it is depot
master data that can legitimately be corrected after a CI is closed, and a signed return should show
where the dealer *is*, not where the master said they were that afternoon.

### 🔴 A draft carries NULL for the stage-1 answers — no placeholders [v3.3, owner ruling]

`materialMoved`, `materialReceivedDate`, `reasonId` and `reasonLabel` are **NULLABLE**, and the
new CHECK is what makes that safe:

```
chk_ci_returns_complete_when_not_draft
  CHECK (status = 'draft' OR ("materialMoved" IS NOT NULL
         AND "materialReceivedDate" IS NOT NULL
         AND "reasonId" IS NOT NULL AND "reasonLabel" IS NOT NULL))
```

**Nullable in a draft, MANDATORY in a record.**

*Why.* The details screen comes AFTER the line selection, so between the draft insert and the
details step these four genuinely have no value. Under the old NOT NULL shape `POST /api/ci/draft`
had to invent defaults — `"not_moved"`, today's date, reason 1 — to be patched before submit.
**That is how a wrong fact reaches a signed document**: the placeholder is not true, and the day
someone forgets the patch it prints. The workaround is deleted and must not come back.

- `returnType` stays **NOT NULL** — it is answered on the first bill screen (Full bill / Part), so
  a draft cannot exist without it.
- ⚠ A NULL `materialMoved` also satisfies `chk_ci_returns_material_moved`: `NULL = ANY(ARRAY[…])`
  is NULL, and a CHECK passes on anything that is not FALSE. The two compose; neither needed
  changing.
- 🔴 **The CHECK is the BACKSTOP, not the error message.** `POST /api/ci/[ciId]/submit` validates
  all four itself and names the missing one ("This return is missing the date it was received and
  a reason"). A raw `violates check constraint "chk_ci_returns_complete_when_not_draft"` reaching a
  supervisor's phone is not something he can act on. If that string ever surfaces in the UI, the
  route's guard has a hole — **fix the guard, never weaken the CHECK.**
- `getCiDetail()` excludes drafts, so the CHECK guarantees all four are present on anything it
  returns and `CiDetail` types them non-null. If one is null anyway that is an integrity violation,
  and the query returns **null (not found) and logs loudly** rather than fabricating a default.

🔴 **Put `returned_to_floor` in the status CHECK from day one**, even though no UI uses it yet
(§10.1). Adding a value later means an ALTER on a live CHECK constraint; allowing an unused one
costs nothing.

### `ci_return_lines`

```
id                Int  PK autoincrement
ciReturnId        Int  FK -> ci_returns.id  ON DELETE CASCADE
lineNumber        Int
rawLineItemId     Int?                    -- pointer back to import_raw_line_items, nullable

skuCode           String                  -- the raw SAP material code
skuDescription    String?                 -- snapshot of the resolved name
packCode          String?                 -- snapshot

deliveryQty       Int?                    -- ⚠ SNAPSHOT of import_raw_line_items.unitQty.
                                          --   SAP's DELIVERY quantity. There is NO invoiced-qty
                                          --   column anywhere in this database. Do not label it
                                          --   "invoiced qty".
returnedQty       Int                     -- what came back, in tins — the only typed number
litresPerTin      Decimal?  @db.Decimal(12,3)   -- snapshot, see below
returnedQtyLitres Decimal?  @db.Decimal(12,3)   -- = litresPerTin × returnedQty, written at save

createdAt         DateTime  @default(now()) @db.Timestamptz(6)

UNIQUE (ciReturnId, lineNumber)
```

**No batch child table. CI has three tables, not four.** MRN needs `mrn_line_batches` because one
inbound line can split across manufacturing dates; CI takes a single quantity per line and has
nothing to split. Recorded because copying MRN's schema wholesale is the obvious mistake. If mfg
dates are ever added they need the child table — a `mfgMonth`/`mfgYear` pair on the line cannot
express a split — and **do not copy MRN's `bestBeforeMonth`/`bestBeforeYear`**, nullable since
v27.17 and retired from every surface.

### Litres are calculated, never typed

`returnedQtyLitres = litresPerTin × returnedQty`, computed in a pure `lib/ci/derive.ts` (no Prisma,
no clock — MRN's `derive.ts` is the model) and written at save.

- **Source of `litresPerTin`:** `import_raw_line_items.volumeLine ÷ unitQty` — SAP's own figure,
  present on every raw line, so it does not depend on catalog coverage (5.9% of lines never resolve
  to `sku_master_v2`).
- **Snapshot it**, like `deliveryQty`. A re-import patches the raw line in place; a closed CI must
  not silently change its litres.
- 🔴 **Guard the division on `unitQty` ONLY — NEVER on `volumeLine`.** [corrected v3.2] If `unitQty`
  is null or 0, leave `litresPerTin` null and render the cell blank. Live it is never either
  (0 of 40,675 active lines), so that branch is a seatbelt.
  🔴 **`volumeLine = 0` IS A REAL, CORRECT VALUE — 346 active lines (0.85%) carry it**: brushes,
  rollers, scrapers, putty knives, goods that genuinely have no volume. They must produce
  `litresPerTin` **0** and render **"0 L"**. A falsy check (`if (!volumeLine) return null`) would
  blank all 346, and a blank reads as *unknown*, which is a different and wronger claim than *none*.
  **Null ⇒ blank cell. Zero ⇒ "0 L".** Only `volumeLine` being genuinely NULL (2 lines in the whole
  table) is unknown.
- 🔴 **SAP WINS OVER THE CATALOG. Never derive litres from `packCode`, not even as a fallback.**
  [added v3.2] Measured over 36,380 active lines / 815 SKUs / 16 pack sizes: `volumeLine ÷ unitQty`
  agreed with the catalog's declared pack on **99.70%**, and every one of the 109 disagreements is a
  **catalog error** — `5880418` catalog 0.9 L vs SAP 1.0 (60 lines); `5856409` stored as `packCode
  "925"` with `unit "L"`, i.e. *925 litres a tin*, vs SAP 0.925 (31 lines); `5856421` catalog 4 L vs
  SAP 3.7, the real 3.7 L pack (14 lines). A packCode fallback would have been confidently wrong on
  109 lines with nothing on screen to show it. `lib/ci/derive.ts` carries this argument as a file
  header, the way `resolve-lines.ts` carries the id-space one.
- **Precision is `numeric(12,3)`, not `(12,2)`** — pack sizes carry three
  decimals and a 0.925 L pack would round away at two. (Claude Code's
  call, 2026-08-31; accepted.)
- **Header totals are DERIVED at render** from the line snapshots — no stored total column. A line
  whose litres are unknown contributes 0 to the header total (the per-line cell still shows the
  blank, so the gap is visible where it actually is).
- ✅ **Litres, always. Never cubic metres** (CORE §8). **DISCHARGED 2026-08-31** [v3.2] — this said
  "confirm `volumeLine`'s unit in the build step before trusting this formula", and it has been
  confirmed against production: `volumeLine` is `double precision`, and the **mean per tin across
  every active line is 7.08** — paint-tin scale. Cubic metres would put it at ~0.007. Corroborated
  by the pack test above: **99.70% exact over 36,380 lines**, 100% on 10 L and 500 ML.
  **The formula is proven; do not re-litigate it.** What is NOT settled is the catalog, which is
  wrong on the 109 lines named above and is a separate cleanup backlog item.

### Reading the source lines

- **Join `import_raw_line_items` on the `obdNumber` TEXT column.** There is **no FK** from `orders`
  to its line items — Picking and Floor both join on the string.
- 🔴 **Filter `lineStatus: 'active'`.** 113 rows across 100 OBDs are `removed_by_import`; without the
  filter CI offers lines SAP has withdrawn. `rowStatus` needs no filter (100% `valid`).
- 🔴 **SKU resolution is `sku_master_v2.material` against `skuCodeRaw`, and nothing else.** Copy the
  shape and the warning header from `lib/mrn/resolve-lines.ts`. `skuCodeRaw` is never null or blank
  across 40,548 active lines. Line-weighted coverage is **94.1%** — the ~73% in CORE §7.1.c is
  *distinct-code* coverage and answers a different question. **No `isPrimary` filter** — a duplicate
  twin is still a real SAP code that can physically be in the return.

### Write order — no `$transaction`

`prisma.$transaction` is banned (CORE §3). Sequential awaits:

1. Insert the header as `status = 'draft'` (no CI number yet).
2. Insert the lines.
3. Allocate the CI number and flip `status = 'submitted'`.

A failure part-way leaves a numberless draft — invisible to every list, harmless. The reverse order
would leave a numbered CI with no lines on the floor's screen.

### 🔴 `ciNumber` is NULLABLE, and that is what makes the above possible

**Ruling 2026-08-31**, after Claude Code found v3 contradicting itself:
the column block said `String @unique` (NOT NULL) while the write order
above describes "a numberless draft". NOT NULL makes that flow impossible.

- **`ciNumber String? @unique`.** Postgres UNIQUE treats NULLs as distinct
  by default, so any number of concurrent drafts coexist. No
  `NULLS NOT DISTINCT` here — that would allow only one draft at a time
  across the whole depot.
- **Every list, board, marker and search filters `status <> 'draft'`.** A
  draft is an in-flight write, not a record. Nothing user-facing may ever
  show a row with a null `ciNumber`; if one is visible, the filter is
  missing, not the number.
- The alternative — allocate the number first, then write the lines — was
  rejected: it reintroduces exactly the failure the draft step exists to
  prevent, a numbered CI on the floor's screen with nothing in it.
- Abandoned drafts (browser closed mid-write) are harmless and invisible.
  Sweeping them is a ROADMAP item, not a v1 concern. Do **not** reuse
  their numbers — they never had one.

---

## 7. Supervisor UI → `docs/mockups/ci/supervisor.html`

**Chrome is Picking's, unchanged.** The mockup is the reference; this section records only the rules
a build must not lose.

- **Two tabs: `New` and `Submitted`.** The tab bar **disappears once inside a bill** — the bottom
  becomes a single pill button (`Next`, then `Submit`), exactly where Picking puts *Undo*.
- **Header** is the teal bar: rounded back square, **customer name**, **OBD number** underneath,
  kebab and search right. No time, no dispatch window.
- **One sub-header strip**, identical on every screen from bill through submit:
  `22 Aug 2026 · I536225770 · 212 L` — date, invoice number, litres.
- **Pack chips in Part only.** Full bill has nothing to filter, so the row is not drawn — the screen
  gets shorter rather than showing a dead control.
- **Line card** is Picking's: 54px pack panel on its own light ground with a right border, mono SKU
  at 24px, description under it, quantity right at 29px.
  - Part: dash = untouched · black = whole line back · **red = only some of it** · small grey
    "of 8" under the quantity.
  - Full bill: dimmed, no "of n" — the number is the whole line by definition.
- **Quantity sheet** — stepper, tap-to-type for large counts, and an **"All 8"** shortcut, because
  most ticked lines come back whole. Litres shown, never editable.
- **Reason sheet** — three pinned reasons, divider, then *More*.
- **No helper copy anywhere.** No product marketing names, no explanation of what Full bill means,
  no notes under buttons.
- **`items-stretch` on the line row is load-bearing** — Tailwind's `flex` sets display only and a
  `<button>` does not inherit the `align-items: stretch` a `<div>` gets. Without it the pack panel
  renders short. This bit MRN already.
- **Import `sortPackLabels` from `@/lib/picking/pack-sort`** — that is a rule, not a token;
  alphabetical would put "100ML" before "1L".

**Copy the layout, do not import the component.** MRN's `LineRow` is module-private and typed on
`MrnDetailLine`. `line-list.tsx`'s own header records that it was itself copied verbatim from
Picking. CI gets `components/ci/line-list.tsx`, a copy, typed on `CiDetailLine`, every className and
size lifted byte-for-byte.

---

## 8. Billing UI → `docs/mockups/ci/billing.html`

Desk screen, same shape as Mail Orders and MRN: left rail, right detail pane, `<UniversalHeader />`,
fixed table standard.

- **One panel — no Pending/Closed tabs.** Both live in the same rail under their own headings, the
  way Mail Orders keeps pending and done together. Closing a CI moves the card down the list in
  front of the operator instead of sending it to another tab.
- **Rail cards carry two things: CI number and customer name.** No return type, no litres, no value,
  in either section. Closed cards are told apart by weight — grey ground, lighter name.
- Header row 2 carries the counts (`4 pending · 13 closed`) where tabs would be, with Filter and the
  date stepper right.
- **Pane header facts, in this order:** invoice date → invoice no → received on → material →
  **Returned** (`10 tins · 120 L`, both units). Bill first, then the return, then the total.
- **Reason renders as a violet band** under the header — the app's existing note treatment.
- **Full bill is said three times:** teal `FULL BILL` tag beside the customer name, the same tag on
  the rail card, and `WHOLE BILL · all 5 lines` in the table header — against `3 of 12 on the bill`
  for Part.
- **Lines table: Pack · Material · Qty · Litres.** **No sent column.** Footer totals in both units.
- **"CI details" block**, fields in this order: **CI date → CI number → Value**, then **Close CI**.
  Button stays disabled until all three are filled.
- **Everything the floor entered is read-only.** `Close CI` is the only write on the screen.

---

## 9. Roles, routes, permissions

| | |
|---|---|
| Route | `/ci` — free. `app/ci` and `app/api/ci` do not exist |
| Middleware | **no entry needed** — `/ci` falls through to the auth gate exactly like `/mrn` |
| Page key | new `ci` key — no `ci*` table, no `ci` page key exists today |
| Stage 1 | `floor_supervisor` — mobile |
| Stage 2 | `billing_operator` — desk |
| Also | `operations` |

**Mirror MRN's live grant** — `billing_operator` (view+edit+export+delete), `floor_supervisor`
(view+edit), `operations` (view+edit). Seed and live agree on `mrn`, so it is a clean precedent.

🔴 **SEED IS NOT LIVE — write both.** Grants go into `prisma/seed.ts` *and* into live
`role_permissions` via the Supabase SQL Editor. One without the other means the key works in dev and
not in production, or is wiped by the next reseed. `SELECT` the new rows and the rows that must
survive in the same block, labelled.

**Five registration points:** `PageKey` union · `ALL_PAGE_KEYS` · `PAGE_NAV_MAP` · `prisma/seed.ts` ·
`role-sidebar.tsx` `ICON_MAP` (optional — falls back to a default icon).

🔴 **`PAGE_NAV_MAP` position is behaviour, not cosmetics.** MobileShell's phone Home target is
`navItems[0]?.href` and `buildNavItems` preserves array order — **an entry at index ≤ 2 would steal
`floor_supervisor`'s phone Home button from `/picking`.** Insert `ci` **after `mrn`** (index 15+),
the slot and reasoning MRN used. Re-derive against live grants before placing the line.

⚠ A sixth place exists that MRN never registered in: `components/admin/permissions-manager.tsx`
`PAGES_CONFIG`, a separate hardcoded list driving `/admin/permissions`, stale by ~10 keys. **MRN's
permissions cannot be managed from the admin UI at all.** CI inherits that unless we choose
otherwise (§10.4).

**Login landing is unaffected** — `floor_supervisor: "/picking"` is hardcoded in `ROLE_REDIRECTS`,
independent of `role_permissions` and `PAGE_NAV_MAP`.

---

## 10. Live sync

Copy MRN's mechanism, **including its asymmetry**:

```ts
usePickingMarker({
  scope: "openPending",
  url: `/api/ci/marker?tab=${activeTab}`,
  onChange: () => { void refetchBoard(); },
  paused: detailOpen || overlayBusy,
});
```

- 🔴 **The marker's WHERE comes from the same builder the board renders with** (`buildCiWhere()`).
  Never re-declare the predicate — a marker watching a narrower set silently misses updates.
- 🔴 **The marker route is READ-ONLY and load-bearingly so.** A write there bumps `updatedAt` and
  fires a false "changed" on every polling client forever.
- 🔴 **Refresh is a client `fetch` + `setState`, NEVER `router.refresh()`** — CORE §3's action-queue
  rule. Two attempts to fix that by timing shipped green and stayed broken on production.
- The marker is `(count, latest)` in ONE aggregate — `COUNT(*)` **and** `MAX(updatedAt)`. Both halves
  are needed: when a record leaves a tab, `MAX(updatedAt)` over that tab can move *backwards*, so
  only the count reports the departure.
- 🔴 **MRN has no billing-side marker, on purpose.** CI runs the other way, so **the polling side is
  billing** — it is the one waiting on the other. The supervisor's phone does not need to poll: he
  is the one creating the work. Decide this explicitly rather than copying MRN's side by reflex.

---

## 11. Open decisions

| # | Question | Status |
|---|---|---|
| 11.1 | **Return to floor.** If billing sees a mistake, nothing lets them send it back — only close it wrong or leave it. Asked three times, unanswered. **Recommendation: yes, one button with a reason.** Build the `returned_to_floor` status value into the CHECK now either way (§6); the UI can follow. | 🟡 owner |
| 11.2 | The paper form also has **CI Punch by**, **Delivery No.** and a separate **Final CI No.** The owner named only date, number and value. Dropped from the model — confirm they are genuinely dead, especially Delivery No. | 🟡 owner |
| 11.3 | Does a closed CI need an **A4 print sheet** to replace the paper form? MRN has `print-sheet.tsx` + `[mrnId]/sheet/page.tsx` to copy. | 🟡 owner |
| 11.4 | Register CI in the admin Permissions UI (`PAGES_CONFIG`), or follow MRN and skip it? | 🟡 recommend skip |
| 11.5 | Does **Submitted** show other supervisors' CIs, or only his own? Drawn as his own. | 🟡 owner |

**Settled, no answer needed:** search key and blank invoice (§4) · year-resetting CI numbers (§5) ·
two number columns (§5) · qty-in-tins only, litres calculated (§6) · no condition, no mfg dates, no
batch table (§6) · snapshotting delivery qty and litres (§6) · tab names and the vanishing tab bar
(§7) · one-panel billing rail (§8) · `ciValue` (§6).

---

## 12. Corrections folded in from Step 0

Nine places spec v1 was wrong. Kept so they are not re-introduced.

| # | v1 said | Truth |
|---|---|---|
| 1 | `invoicedQty` per line | **No invoiced-qty column exists.** `unitQty` is SAP *delivery* quantity |
| 2 | `mfgMonth`/`mfgYear` on the line | A **child table** — a column pair cannot express a split batch (moot now: CI captures no mfg dates) |
| 3 | invoice-number search | **`invoiceNo` is not unique** (11 values → 2 OBDs) and **5% of dispatches never get one** |
| 4 | reuse MRN's line row | **Not reusable** — private, MRN-typed. Copy it, per the module's own convention |
| 5 | copy the challan allocator | **Copy MRN's** — the challan one does not reset at year end |
| 6 | ~73% SKU coverage | **94.1% line-weighted**; 73% is distinct-code and answers a different question |
| 7 | (silent) | `lineStatus: 'active'` filter is **mandatory** |
| 8 | "follow MRN's mechanism" | MRN has **no billing-side marker, on purpose** — CI's polling side is billing |
| 9 | (silent) | `PAGE_NAV_MAP` insert position can **steal a role's phone Home button** |

---

## 13. Build plan

```
[x] 0. Read + report                          — done, see the discovery report
[ ] 1. SQL — tables, checks, indexes, permission rows
[ ] 2. schema.prisma hand-edit + seed.ts + prisma generate
[ ] 3. API routes + lib/ci/*
[ ] 4. Supervisor mobile screens
[ ] 5. Billing desk screen
[ ] 6. Nav + router row + smoke test + commit
```

One Claude Code prompt per step. Diagnosis separated from implementation.

**Step 1 — SQL.** One unified block: `ci_reason_master` + its 8 seed rows, `ci_returns`,
`ci_return_lines`, CHECKs (`chk_` prefix, never the reserved word `check`), indexes, live permission
rows. No `BEGIN`/`COMMIT`. `ON CONFLICT` needs a real unique constraint. `LIMIT` inside `UNION ALL`
must be subquery-wrapped. The permission block must `SELECT` and label the existing `mrn` rows and
any existing `ci` rows **before** inserting. The editor shows only the last statement's result, so
end with one `UNION ALL` verification SELECT. Claude Code writes the file; **Smart Flow runs it.**

**Step 2 — Prisma.** `db pull` fails on this machine (IPv4). Hand-edit `schema.prisma` to match the
SQL exactly, add the seed grant rows, then `npx prisma generate`.

**Steps 3–5.** `export const dynamic = 'force-dynamic'` on every route. Sequential awaits, never
`$transaction`. Verify `volumeLine`'s unit before wiring the litres formula (§6).

**Step 6.** Add the `ci` row to the repo-root `CLAUDE.md` router. `npx tsc --noEmit` must pass. Stage
files explicitly by name — never `git add .`. Commit straight to `main`, smoke test, push, confirm on
production.

**Verification.** Claude Code has no login credentials — it cannot test a supervisor's phone journey
or a billing operator's save. Those are hand-tests by Smart Flow. Never accept a claimed login test.

---

## 14. Naming

**"CI" already means "Credit Issue"** in this product — a red blocker badge on `/mail-orders`
(`MO_TAG.ci`, label "CI (Credit Issue)"). `billing_operator` holds `mail_orders` and would hold
`ci`, so **one role sees both**.

**No code collision** — `/ci` is free, no `ci*` table, no `ci` page key, and the parser's `\bCI\b`
regexes only run over `mo_orders` remark text. The clash is in vocabulary.

Against that: the paper form the depot uses every day is titled **"Goods Return Note (CI – Form)"**
and the staff call it a CI. Renaming would make the screen and the paper disagree, which is worse.
**Decision: keep "CI". The clash is known and accepted** — a future session should not "discover" it
and rename anything.
