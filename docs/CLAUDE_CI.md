# CLAUDE_CI.md — CI, Goods Return Note (CI Form)
# v1.5 · Schema v27.74 · October 2026 · updated 2026-10-24
# Lives in: orbit-oms/docs/
# Load with: CLAUDE.md (repo root) + docs/CLAUDE_CORE.md + docs/CLAUDE_UI.md

---

## 1. What it is, the two faces, and the ownership boundary

A dealer sends material back against a bill SAP has already invoiced. The floor
supervisor raises the **CI** on his phone — which lines came back, how many tins,
why. The billing operator punches it into SAP and closes it with SAP's own CI
number and the credit value. Live at `/ci`.

CI is the return counterpart to MRN: MRN is stock coming **IN** off a depot
truck, CI is stock coming **BACK** from a customer. The two modules are
deliberately shaped alike and diverge only where the work does.

**Two faces on one route, branched by ROLE and never by viewport.**
`app/ci/page.tsx` reads `session.user.role`:

| Role | Face | Shape |
|---|---|---|
| `floor_supervisor` | the phone | `CiShell` — two module tabs, **New** and **Submitted** |
| everyone else who can see CI (`billing_operator`, `operations`, `admin`) | the desk | `CiBillingBoardScreen` — one 344px rail + a working pane |

There is no `md:` switch anywhere in this module and there must not be one:
`/picking` removed its width switch in July 2026 and neither MRN nor CI ever had
one. A supervisor on a desktop still gets the phone face, because the face
follows the JOB, not the screen.

⚠ **There is no `app/ci/layout.tsx` and there cannot be one.** `RoleLayoutClient`
carries `workflowTabs` / `activeTabKey` / `onTabChange` / `hideBar`, every one of
which is owned by client state inside `CiShell` (which tab is showing, whether a
bill has taken the viewport). A server `layout.tsx` cannot supply them, and a
layout rendering a bare `RoleLayoutClient` would permanently lock the supervisor
to the default Home/Menu/You bar.

### CIs that no face raises — three server raisers

Two faces show CIs, but four paths **create** them. Each one writes a `source`
(§3). Only `manual` comes from the faces:

| Raiser | `source` | Where | Shape |
|---|---|---|---|
| The phone face (§7) | `manual` | `POST /api/ci/draft` → lines → submit | full or part, whole OBD |
| **Floor's Raise CI** (since 2026-09-22) | `floor` | `POST /api/floor/ci` → `lib/floor/raise-ci.ts` | full; **whole bill** (`raiseFullBillCi`, then the bill is cancelled) or, on a split OBD, **one CI per ticked invoice** (`raiseInvoiceCi`, 6.3, 2026-10-19) — §7.1 |
| The picking-finding confirm | `auto_finding` | `lib/ci/auto.ts` (§9) | part, whole OBD |
| A `'ci'` SO tag (bill-only) | `auto_bill_only` | `lib/ci/bill-only.ts` `raiseBillOnlyCi`, called by `lib/billing/telephonic-apply.ts` `applySoTagHolds` (which then cancels the bill) | full, whole OBD |

The Floor screen, its button and its Cancel & CI tab belong to `CLAUDE_FLOOR.md`
(§4.1b). The whole-bill cancel belongs there too. This file owns only the
document those paths write.

### What this file owns, and what it does not

This file owns the CI **document**: its three tables, the status ladder, the
numbering, the invoice rule, the two faces, the CI half of the auto route, and
the register export.

It does **not** own the things CI borrows. Each has an owner below and is
**cross-referenced, never restated** — a rule described in two files is a rule
that will disagree with itself inside a cycle.

| CI uses | Owner | CI's position |
|---|---|---|
| Pack ordering (`sortPackLabels`) | `CLAUDE_PICKING.md §3.1` — `lib/picking/pack-sort.ts` | imported, not copied. See §13 CI-7 |
| The effective-dealer rule | `CLAUDE_PICKING.md` — `lib/picking/queue.ts` | **mirrored**, because Picking does not export it. §13 CI-6 |
| `SMU_CODE_BY_NAME`, the division name↔code map | `CLAUDE_IMPORT.md §6` — `lib/import-upsert/types.ts:243` | imported. CI **diverges** on display — §5 |
| The 74/77 SMU badge rule | `CLAUDE_PICKING.md §5.2` | CI deliberately does **not** follow it — §5 |
| `formatPack` | `CLAUDE_PLACE_ORDER.md` — `lib/place-order/pack.ts` | imported |
| The id-space landmine (`sku_master_v2.material` only) | `CLAUDE_CORE.md §13` | `lib/ci/resolve-lines.ts` carries the warning verbatim |
| What a pick finding IS, and the confirm route | `CLAUDE_PICKING.md §11` | §9 describes only the CI side |
| How `orders.invoiceNo` arrives from SAP, and when | `CLAUDE_IMPORT.md` | §5 cross-refs; CI explains none of the pipeline |
| The live-sync marker mechanism | `CLAUDE_PICKING.md §10` | §12 states only CI's **direction** |
| `UniversalHeader` and its slots | `CLAUDE_CORE.md §10` + `CLAUDE_UI.md` | §8 |
| `RoleLayoutClient` / `MobileShell` / `workflowTabs`, the empty-array trap | `CLAUDE_UI.md §59.2 / §59.4` | §7 |
| The 344px rail + `minmax(0, 1fr)` two-track grid | `CLAUDE_MRN.md`, `CLAUDE_FLOOR.md` | §8 — CI copied the geometry |
| Card anatomy, the line row, the bottom-sheet primitives | `CLAUDE_PICKING.md §5.2` | ⚠ **copied, not imported** — §14 records that they are copies and why |
| Soft-delete reads, the `$transaction` ban, `force-dynamic`, the `Date.parse` trap | `CLAUDE_CORE.md §3` | never restated here |
| Invoice rows (`order_invoices`), the split OBD, the OBD done rule, which row a whole-OBD record points at | `CLAUDE_ORDER_INVOICES.md` §3, §4.6, §4.9 | §5 and §7.1 state only what CI does with them |
| Floor's Raise CI button, its selection and the Cancel & CI tab | `CLAUDE_FLOOR.md` §4.1b | §7.1 owns the CI rules behind it |
| The Billing · Telephonic tab and the `'ci'` SO tag | `CLAUDE_BILLING.md` §5 / §5b | the bill-only CI it raises (§1 raisers table) |

**Where CI diverges from an owner's rule, the divergence is stated in this file
and the rule stays in theirs.** There is exactly one today: the division number
(§5).

---

## 2. The status ladder

```
   draft  ──submit──▶  submitted  ──close──▶  closed
     │                     │
     │                     └──▶  returned_to_floor   (allowed, written by nothing)
     │
     └── invisible everywhere. Never reaches a screen.
```

`chk_ci_returns_status` permits exactly four values (§3). Three are reachable
today.

**`draft`** — the header exists, the lines may not yet. It is created by
`POST /api/ci/draft` with a body of **only** `{ orderId, returnType }`; the
stage-1 answers are not asked for until after the lines are chosen, and a draft
carries **NULL** for all four rather than an invented default (§13 CI-2).
🔴 **Every list, board, marker and search filters `status <> 'draft'`.** A draft
is an in-flight write, not a record. If a null-numbered row is ever visible on a
screen, the FILTER is missing — the number is not.

**`submitted`** — the moment the return becomes a record. The number is
allocated here and nowhere earlier (§4), and the CI appears on billing's rail.

**`closed`** — billing has punched it into SAP. `ciDate`, `sapCiNumber` and
`ciValue` are recorded and the document is real. From here it is read-only to
the floor with no exceptions, and the auto path will not touch it (§9).

**`returned_to_floor`** — in the CHECK and in the `CiStatus` union since day one,
**written by nothing**. Allowing an unused value costs nothing; ALTERing a live
CHECK later does not. The open question it stands in for — does billing send a CI
back? — was answered the other way (owner ruling: billing does not send it back,
they tell the floor and he fixes it himself), which is why no UI writes it.

⚠ **A FIFTH value needs a SQL ALTER on `chk_ci_returns_status` FIRST**, never
just a new string in `lib/ci/types.ts`. Same trap `chk_pick_assignments_status`
documents.

---

## 3. The three tables

🔴 **This section is a POINTER, not a column dump.** Every column, its
nullability and the reasoning behind it live in the model headers in
`prisma/schema.prisma` — `ci_reason_master`, `ci_returns`, `ci_return_lines`.
Read them there. A column list copied into a doc goes stale the day someone adds
a column, which is exactly what happened to that file's own
`// The CI header. 31 columns.` comment: `source` was added 2026-09-01 and the
count stayed wrong until 2026-09-03. It was 32 then. Live it is **37**
(`information_schema.columns`, 2026-10-24): `orderInvoiceId` (v27.66) and the
four bill-to / ship-to columns (v27.70) came since.

| Table | What it is |
|---|---|
| `ci_reason_master` | The reason list. **DATA, NOT CODE** — the depot can add, relabel or retire a reason without a deploy, which is why `GET /api/ci/reasons` exists and why no component may hardcode the list. 8 live rows, 3 pinned |
| `ci_returns` | The CI header. Snapshots the bill and the dealer; carries the stage-1 answers, billing's three fields, the void columns, `source`, **`orderInvoiceId`** (below) and the **bill-to / ship-to** pair (§13 CI-5) |
| `ci_return_lines` | One returned line. Snapshots what the bill said at the moment of the return, because a re-import patches raw lines in place |

### The five CHECK constraints — invisible in Prisma, so they are recorded here

`CLAUDE_CORE.md §7.4` explains why: Prisma cannot express a CHECK, so it does not
appear in `schema.prisma` as anything but a comment. Read live from
`pg_constraint`, 2026-09-03; all five re-read 2026-09-21, and
`chk_ci_returns_source` again 2026-09-22 after it was widened (CORE §7, Schema
v27.39 and v27.40). **All five were re-read again 2026-10-24, unchanged since. All
five are on `ci_returns`:**

| Constraint | What it enforces |
|---|---|
| `chk_ci_returns_status` | `draft` / `submitted` / `closed` / `returned_to_floor` |
| `chk_ci_returns_return_type` | `full` / `part` |
| `chk_ci_returns_material_moved` | `moved` / `not_moved` |
| `chk_ci_returns_source` | `manual` / `auto_finding` / `auto_bill_only` / `floor`. The third value was added 2026-09-22 (v27.39) and the fourth the same day (v27.40). Each has a writer (§1 raisers table). Live non-draft rows on 2026-10-24: auto_finding 92 · auto_bill_only 46 · floor 46 · manual 31. `ciSourceTag` (`lib/ci/types.ts`) tags them on the rail card and detail header as **"Auto"**, **"Bill-only"** and **"Floor"**; a manual CI carries no tag. *(This row said "`auto_bill_only` … NOT BUILT: nothing writes the value yet" and listed three values until 2026-10-24.)* A FIFTH value needs a SQL ALTER on this CHECK first |
| `chk_ci_returns_complete_when_not_draft` | 🔴 **the load-bearing one** — `status = 'draft'` OR all four of `materialMoved`, `materialReceivedDate`, `reasonId`, `reasonLabel` are NOT NULL |

⚠ A NULL `materialMoved` also *satisfies* `chk_ci_returns_material_moved`:
`NULL = ANY(ARRAY[...])` is NULL, and a CHECK passes on anything that is not
FALSE. The two compose correctly and neither needed changing when the columns
went nullable.

⚠ **`ci_return_lines` and `ci_reason_master` carry ZERO CHECKs.** In particular
nothing at the database level enforces `returnedQty >= 1` — that rule lives in
application code in two places (`PUT /lines` returns a 400; `lib/ci/auto.ts`
skips the line). If a zero-tin row ever appears, the database did not let it
through by accident; a write path did.

**Indexes** (live, `pg_indexes`, re-read 2026-10-24): `ci_returns` carries its
pkey, `ciNumber` UNIQUE, and six secondaries: `invoiceNo`, `obdNumber`, `orderId`,
`status`, `materialReceivedDate`, and `orderInvoiceId` (v27.66). The `invoiceNo` +
`obdNumber` pair is §5's search ruling in schema form. `ci_return_lines` has its pkey plus `UNIQUE(ciReturnId,
lineNumber)`; there is deliberately no separate index on `ciReturnId`, which is
the leading column of that pair.

### `ci_returns.orderInvoiceId` — which invoice row came back (v27.66, 2026-10-12)

`Int?`, FK `ci_returns_orderInvoiceId_fkey` → `order_invoices` **ON DELETE
RESTRICT**, index `ci_returns_orderInvoiceId_idx`. **`orderId` stays the identity
of the bill (§5).** This column only narrows it to one invoice row. Every CI
that existed then was back-filled to the OBD's seq-1 row.

| Writer | Value |
|---|---|
| Floor per-invoice CI (`raiseInvoiceCi`) | **the ticked row** |
| Every whole-OBD raiser: phone draft, Floor whole bill, auto, bill-only | `linkRowForOrder(orderId, "ci")` (`lib/order-invoices/links.ts`): **seq 1 on an unsplit OBD, NULL on a split one** |

🔴 **NULL means "the whole OBD", not "unlinked".** A NULL CI on a split OBD covers
every invoice row (`ciCoversRow`, `CLAUDE_ORDER_INVOICES.md` §4.6 / §4.9). Never
back-fill it to seq 1.

**Live 2026-10-24:** all **232** CIs carry a row (215 non-draft + 17 drafts). None
sits on a seq ≥ 2 row, and none is on the one split OBD, so no live CI has a NULL
row and no live CI is per-invoice yet.

---

## 4. Numbering

`CI-{YEAR}-{5 digits}` — `CI-2026-00014`. Allocated by
`allocateCiNumber(submittedAt)` in `lib/ci/number.ts`, copied from
`lib/mrn/number.ts` rather than from the challan allocator (which is built inline
at six call sites and has no year reset).

- 🔴 **Allocated at SUBMIT, never when the form opens.** That is the entire
  reason `ci_returns.ciNumber` is nullable: the write order is insert header as
  draft → insert lines → allocate and flip to `submitted`, so a failure part-way
  leaves a **numberless draft** rather than a numbered CI with no lines sitting
  on billing's rail.
- **The year is IST, not UTC.** A CI submitted at 02:00 IST on 1 January is
  19:30 UTC on 31 December; reading the UTC year would file it under the previous
  year's sequence, and would do so for five and a half hours every New Year.
  **Resets to 00001 each January.**
- `MAX + 1`, never `COUNT + 1` — a count silently collides the moment the
  sequence has a gap, and **gaps are expected**: a voided CI keeps its number, an
  abandoned draft never had one. The scan orders lexicographically DESC over the
  zero-padded fixed-width suffix, which within one `CI-{year}-` prefix is
  identical to numeric DESC and rides the `ci_returns_ciNumber_key` btree.
- **Not atomic, and that is an accepted trade** (§13 CI-4).

---

## 5. The bill: search, identity, and the invoice rule

**Search** (`GET /api/ci/search`, `searchCiBills` in `lib/ci/queries.ts`)
matches on **invoice number OR OBD number**. The term is normalised by
`normaliseCiSearchTerm` (`lib/ci/search-term.ts`, pure since 2026-10-10 so Add
invoices' `lib/order-invoices/rules.ts` shares the one rule; `queries.ts`
re-exports it): trimmed, uppercased, and a bare 9 digits gets its `I` prefix.
The normalised term is echoed back so the UI can show what was actually
searched. It **always returns a list, never a single row**: 11 live invoice
numbers map to two OBDs each. With exactly one hit the UI skips straight to the
bill, which is a UI shortcut and not a query shortcut.

- **The invoice side matches ANY invoice row** (since 2026-10-13, `e11e7115`). It
  first searches `order_invoices.invoiceNo`, keeps the lowest matching seq per
  OBD, and ORs those OBDs into the order match. So a seq-2 invoice number finds
  its OBD. The 31-day `orderDateTime` fence still applies.
- ⚠ **The hit card still shows the OBD's own (seq-1) number.** The phone raises
  a whole-OBD CI. The search returns `matchedInvoiceSeq`, but no component reads
  it yet.

🔴 **`orderId` is the identity of the bill. Never `invoiceNo`.** `invoiceNo` is
not unique, and `obdNumber`, though unique, is a business key. Every route that
takes a bill takes `orders.id` — `GET /api/ci/bill/[orderId]` — and
`ci_returns.orderId` is `NOT NULL` with `onDelete: Restrict`.

**What a CI does to the order.** The CI document itself writes no `orders`
column. What changes the order is the raiser around it, or a guard that reads
it:

- **A whole-bill CI from Floor or from a bill-only tag cancels the bill.** The
  caller does that write (`raiseFullBillCi` step f; `applySoTagHolds`), not the
  CI. The phone face and the auto-CI never touch the stage.
- 🔴 **A FULL CI counts toward the OBD done rule** (`CLAUDE_ORDER_INVOICES.md` §3,
  `lib/order-invoices/dispatch.ts`). Raising a per-invoice CI can therefore move a
  split OBD to `dispatched` (`settleObdDone`). It does so only when at least one
  row really shipped. Here, "full" means submitted or closed, not a draft and not
  voided; part CIs never count. The rule is owned there; do not restate it here.
- **A live FULL CI blocks Release, unhold and cancel** (`findLiveCi`,
  `lib/ci/live-ci.ts`; scoped per row by `invoiceRowIds`, so a CI on one invoice
  never blocks releasing another).

*(Until 2026-10-24 this paragraph said "a CI never changes the order's
`workflowStage` or any other column". That has been false since the Floor CI
(2026-09-22) and the done rule (6.4, `4c97fd2f`, 2026-10-19). Do not restore it.)*

### The invoice rule

🔴 **`invoiceNo` and `invoiceDate` are read LIVE off the order at render time,
with the CI's own snapshot as the FALLBACK — never the reverse.**

5% of dispatched bills carry no invoice number when the CI is raised; SAP sends
it later (`CLAUDE_IMPORT.md` owns how and when). The supervisor is **never
blocked** by that. Because the CI holds `orderId`, the number simply **appears**
once SAP has it — with no back-fill job, which is the point (§13 CI-1).

Three read paths implement it and all three are live-first: the board
(`toBoardRow`), the detail (`getCiDetail`) and the register export
(`getCiRegisterRows`). This is the **one** place CI deliberately does not
snapshot.

**Which invoice is "the order's" (6.3, `3e319529`).** All three read through
`liveInvoiceOf(order, orderInvoice)` (`lib/ci/queries.ts`). On a CI whose row is
**seq ≥ 2**, the live number and date are **that row's**
(`order_invoices.invoiceNo` / `invoiceDate`). Otherwise they are `orders.invoiceNo`
/ `invoiceDate`, which is seq 1 (that covers seq 1 and NULL whole-OBD CIs). The
per-invoice raiser also snapshots its own row's number.

### Division — CI's one divergence from an owner's rule

The division number ("70", "74", "76", "77", "10") is shown on **both detail
screens**, on **every CI**.

`orders.smu` holds the **NAME** only ("Deco Retail"); the numeric code stops at
`import_raw_summary.smuCode`, which CI does not join and must not start joining —
the name determines the code, so it is derived in memory through
`SMU_CODE_BY_NAME` (`CLAUDE_IMPORT.md §6` owns that map). It has five
importers: `lib/picking/queue.ts`, `lib/floor/queries.ts`, `lib/ci/queries.ts:30`,
`lib/picking/colour-work-query.ts:4` and `lib/picking/tint-workload.ts:3`.

⚠ **CI shows it on every bill, including "70". `CLAUDE_PICKING.md §5.2`'s
`SmuBadge` deliberately does not** — it renders for 74/77 only, because 82% of a
live board is Deco Retail and a badge on 82% of cards is noise. That rule stays
Picking's. CI's cell is a labelled slot in a fixed row, not a badge competing for
attention on a card, and billing copies the division into SAP on every punch,
where a value that is blank four times out of five is worse than one that always
answers. **Both rules are correct; they answer different questions.**

Null renders as the em-dash the neighbouring cells already use — 132 of 12,952
bills carry no `smu`, and a name the map does not know falls through the same
way. 🔴 It never falls back to the NAME: a division cell reading "Deco Retail"
where every other CI reads "70" is worse than a blank.

---

## 6. Lines, tins and litres — derived, never typed

`lib/ci/derive.ts` is **PURE** — no Prisma, no I/O, no clock — which is what lets
three client components import it by value and still guarantee that what the
supervisor reads above Submit is what the server will store.

**He types TINS and nothing else.** Litres are calculated and shown back
read-only, so the number on the return is never one a phone invented.

```
litresPerTin      = import_raw_line_items.volumeLine ÷ unitQty     (snapshot)
returnedQtyLitres = litresPerTin × returnedQty                     (at save)
```

🔴 **LITRES COME FROM SAP, NEVER FROM THE CATALOG.** The catalog holds
`packCode` + `unit`, which look like they say the pack size outright. Measured
2026-08-31 across 36,380 active lines / 815 SKUs / 16 pack sizes: `volumeLine ÷
unitQty` matched the catalog's declared size on 36,271 — **99.70%** — and every
one of the 109 disagreements is a **catalog error** (5856409 stores packCode
"925" with unit "L", i.e. nine hundred and twenty-five litres in a tin; 5856421
rounds a real 3.7L pack to 4). SAP wins every time. Do not add a packCode
fallback "for when `volumeLine` is missing" either: it is missing on **2 of
40,675** active lines, and two blanks are cheaper than a rule that is wrong 109
times.

🔴 **The division guard is on `unitQty` ONLY, never on `volumeLine`** (§13 CI-8).

Snapshotting is the rule everywhere except the invoice pair: a re-import PATCHES
a raw line in place, and a closed CI must not silently change what it claims was
delivered. ⚠ `deliveryQty` is SAP's **delivery** quantity — **there is no
invoiced-quantity column anywhere in this database** (§13 CI-14).

**Full bill vs Part.** `full` MEANS every active line at its delivered quantity,
and the lines route COMPUTES that set server-side precisely so a stale phone
cannot file a "full" return that quietly omits a line. A full CI's lines are
therefore not editable — ticking lines on one would silently be turning it into
a different document.

---

## 7. The supervisor's phone face

`CiShell` hands `RoleLayoutClient` two module tabs, which **replace**
MobileShell's default Home/Menu/You bar (`CLAUDE_UI.md §59` owns that mechanism,
including the trap that `workflowTabs={[]}` falls through to the default bar
rather than hiding it — hiding needs `hideBar`).

**New** — `new-return.tsx`, the create flow, frames 1-5 of
`docs/mockups/ci/supervisor.html`:

```
search → results → bill (Full bill / Part) → lines → qty sheet
      → Next → details → reason → Submit → success
```

Opening a bill takes the whole viewport, and the tab bar goes with it (`hideBar`,
reported up through `onInsideBill`). The Next pill is rendered by the bill screen
inside its own fixed overlay, so the pill and the tab bar can never both be on
screen.

**Submitted** — `submitted-board.tsx`, frame 9. **Two sections in one list**,
"With billing" above "Finished". One scroll, not two tabs. Scoped to the viewer's
own CIs, and that scope lives in exactly one place —
`buildCiSupervisorWhere()` — so answering the open question the other way is a
one-line change. The outstanding band spans **all dates** (work handed to billing
yesterday is still his to see); only the finished band is fenced, to seven days.

**Editable only while `submitted`, and only by the supervisor who raised it**
(owner ruling). Once `closed` it is read-only with no exceptions — billing has
punched it into SAP by then. 🔴 The component decides nothing: `editable` is
computed by the board from the server's own `status` and `supervisorId`, and both
write routes re-test both inside a guarded write. A screen that worked it out for
itself would be a fourth opinion about who may write.

### 7.1 Raise CI from Floor — the desk raiser, whole bill or per invoice

Not a face of `/ci`: the button, its ticks and the result view are Floor's
(`CLAUDE_FLOOR.md` §4.1b, which lists the refusals word for word). The CI rules
behind it are below. `POST /api/floor/ci` is gated on `floor` canEdit, **not**
the `ci` tick. Its body is `{ orderIds, reasonId, remark?, invoiceRowIds? }`. An
OBD listed in `invoiceRowIds` gets one `raiseInvoiceCi` per row; every other OBD
gets `raiseFullBillCi`. Both write `status 'submitted'` straight onto billing's
rail, with `returnType 'full'`, `materialMoved 'not_moved'` and `source 'floor'`.

- **Whole bill** (`raiseFullBillCi`, `lib/floor/raise-ci.ts`): every active line
  at its delivered quantity (`lib/ci/full-bill.ts`), then the bill is cancelled
  (Floor's write). Duplicate guard: **any** live (non-draft, non-voided) CI of
  **any** source, plus a separate open-draft check. One exception: an existing
  `floor` CI on a bill still on the floor is read as "an earlier press made the
  CI and died before the cancel". The function then finishes that press with the
  existing number, so a retry is safe.
- **Per invoice** (`raiseInvoiceCi`, 6.3, `3e319529`, 2026-10-19; rules in the pure
  `lib/order-invoices/ci-plan.ts`):
  - Only on a split OBD.
  - One CI per ticked invoice row: `orderInvoiceId` = that row. Its lines are that
    invoice's `order_invoice_lines` (raw line + tins), never the whole bill. The
    number and date are that row's.
  - A held invoice may be returned. An invoice on a trip or already dispatched is
    refused.
  - 🔴 **Duplicate guard per (OBD, invoice row)** (`invoiceCiDuplicate`): any
    non-voided, non-draft CI that covers the row (its own, or a whole-OBD NULL
    one) → "Already has CI-…"; a covering draft → "open on /ci". A second CI
    would double the credit in SAP.
  - 🔴 **The OBD is NOT cancelled.** There is no `orders` write. The only
    exception is when the CI finishes the OBD under the done rule (§5,
    `settleObdDone`). There is one status log naming the row. The invoice leaves
    To plan / On hold for the Cancel & CI tab.
- **Add invoices is refused once ANY CI exists on the OBD**, every status, **void
  and draft included**: "Has a CI (…) — invoices can't be changed."
  (`obdStateRefusal`, `lib/order-invoices/plan.ts`; owner →
  `CLAUDE_ORDER_INVOICES.md` §5). Voiding a CI does not reopen Add invoices.
- ⚠ **KNOWN DEFECT, recorded 2026-10-24, not fixed: a whole-OBD CI is NOT refused
  on a split OBD that already has a per-invoice CI.** `raiseFullBillCi`'s guard
  finds the per-invoice CI. Its `source` is `floor`, so the guard takes the retry
  branch: it creates no second CI and cancels the WHOLE OBD under the invoice
  CI's number. **SAP is not credited twice** (no second document). But the other
  invoices go off the floor with no CI of their own. The Floor client does not
  pre-check this either.
  - The fix belongs in the guard: on a split OBD, an existing floor CI with a
    non-NULL `orderInvoiceId` is a per-invoice CI, not an unfinished press, and
    should be refused.
  - Whether the desk can actually send that request is not confirmed: it would
    need a whole-OBD Raise CI on a split OBD, i.e. every invoice ticked. ROADMAP.

---

## 8. Billing's desk face

`billing-board.tsx` is the composition root: `UniversalHeader` (never a
hand-rolled one — `CLAUDE_CORE.md §10`; `/floor` and `/freight-trips` are the named exceptions in
`CLAUDE_UI.md §6` and CI does not earn a third), over a
`344px minmax(0, 1fr)` two-track grid — the same geometry MRN and `/floor` use.

**Row 1** carries the counts in `stats` (the app's count idiom — pending and
closed), and the search. There is no page title (`b3896d30`). **Row 2 LEFT** carries the register control (§10). **Row 2 RIGHT**
carries the date stepper.

🔴 **The date stepper drives the CLOSED section ONLY. Pending is the whole
backlog and is never date-fenced.** The rule lives in `buildCiBillingWhere` — one
OR, two arms — so the board and the marker cannot disagree about it. It is
restated here because the stepper sitting in that header is exactly what makes a
reader assume it fences everything: the billing Picking tab shipped that
assumption once and rendered an **empty tab over a real backlog** of older bills.

**One rail, not two tabs.** Pending sits above Closed in a single list so that
closing a CI moves its card down the list **in front of the operator**. A tab
would make it vanish instead, and that visible movement is the point.

**The close** (`POST /api/ci/[ciId]/close`) records three fields — `ciDate`,
`sapCiNumber`, `ciValue` — and flips the status. 🔴 **`sapCiNumber` is SAP's
number, `ciNumber` is OrbitOMS's, and the billing screen labels the SAP one plain
"CI number"** — which is precisely why they look mergeable (§13 CI-13).

---

## 9. The auto-CI, from a confirmed picking finding

When a supervisor **confirms** a finding on a bill SAP has already invoiced, the
goods cannot simply be un-picked: an invoice exists, so what is not going out has
to come back on a document. `lib/ci/auto.ts` raises that document.

`CLAUDE_PICKING.md §11` owns what a finding is, who reports it and who confirms
it. This section owns only the CI side.

**Hooked on `POST /api/picking/findings/confirm` — the supervisor's sign-off —
and never on `findings/report`.** A picker's unconfirmed claim must never raise a
document. The confirmed marker is `recordedById IS NOT NULL`: the two write
routes divide cleanly, the picker's setting `reportedById` only, the supervisor's
always stamping `recordedById`. Measured live 2026-09-01: 92 of 95 findings are
recorded, 3 are picker-only, and those 3 are exactly what the filter excludes.

⚠ **The findings board is the primary job; this is the SIDE EFFECT.** It runs
after the confirm is written, it is **awaited** (a floating promise on a
serverless function can be killed the moment the response returns, which would
drop the CI silently and non-deterministically), and any failure is **logged and
swallowed** — it must never roll back the confirm, never turn a successful
confirm into an error the supervisor sees, and never leave him tapping Confirm
again on a line that is already recorded.

### The fire rule

🔴 **`orders.invoiceNo`, the DATABASE COLUMN, and nothing else.** Not billing's
"Already invoiced" badge — that means two different things (the invoice genuinely
arrived early, OR the operator forgot to mark done) and so cannot be a trigger.
Not `invoicedAt`, which is billing's mark-done timestamp rather than SAP's
invoicing moment. No invoice, no CI.

### Which lines are due

```
due  if  shortfall > 0   OR   reason is old-MFG
qty  =   qtyOrdered      for old-MFG        (the whole line is held back)
     =   shortfall       for everything else
```

Walked in **bill order** (`orderBy lineId asc`, active lines only) so
`lineNumber` lands 1..N the way `PUT /lines` assigns it. A line resolving to
fewer than 1 tin is skipped — a zero-tin row is not "nothing came back", it is a
row that should not be on the return.

🔴 **THE OLD-MFG ARM IS PROVISIONAL AND UNDER REVIEW.** Owner ruling, 2026-09-03:
raise now, review after testing. Nothing is short on a full-count old-MFG line,
but nothing is going out either — the stock is held, so it comes back; before
this rule 21 of 95 findings raised nothing at all. ⚠ **There is deliberately NO
feature flag and no switch for the review.** A special case built for a decision
nobody has made yet is a second code path to maintain forever. Do not read this
as settled, and do not build a toggle for it — when the review lands, the rule
changes in one place.

### Still WHOLE-OBD after Add invoices — an open item

🔴 **The auto-CI is per OBD, not per invoice** (6.3 decided this deliberately,
`3e319529`). It is keyed `orderId` + `source 'auto_finding'`. Its
`orderInvoiceId` is `linkRowForOrder`: seq 1 on an unsplit OBD, **NULL on a split
one** (a whole-OBD CI that covers every row, §3). The reason: a finding is on a
SAP line, and on a split OBD one line's tins can sit across several invoices. Its
fire rule still reads `orders.invoiceNo` (seq 1), and it snapshots that number.
Per-invoice auto-CI is an open item (§15, `docs/ROADMAP.md`). The bill-only CI
(`lib/ci/bill-only.ts`) is whole-OBD for the same reason it is a whole-bill
document. (`lib/ci/auto.ts`, `bill-only.ts` and `app/api/ci/draft/route.ts` still
carry a comment "NULL on a split one until Phase 6 assigns it from lines". Phase
6 kept them whole-OBD; the comment is stale.)

### One auto CI per order, and it GROWS

A supervisor confirms lines **one at a time** — the confirm route takes one
`rawLineItemId` per call. So "create once on the first confirm" would be born
with one line and lock the rest out, and a CI claiming 2 tins when 6 came back is
worse than no CI, because billing punches that into SAP.

Instead it **reconciles on every confirm**: re-read every confirmed finding,
recompute the due set, make the lines match — insert, update, delete, then
renumber (§13 CI-15). The duplicate protection is the lookup itself,
`orderId + source = 'auto_finding' + isVoided = false`, not a "skip if one
exists" guard. 🔴 `source` is what makes that safe: without it the lookup would
also match a CI the supervisor raised **by hand** for the same bill, and a
reconcile would rewrite his document.

**Fixed on creation:** `returnType: 'part'` **always** (a "full bill" claim
belongs only to the whole-bill path), `materialMoved: 'not_moved'`,
`materialReceivedDate` = today in **IST**, `status: 'submitted'`,
`source: 'auto_finding'`, and the reason looked up **by CODE**
(`PHYSICALLY_CROSS`) rather than by id — `ci_reason_master` is depot-editable, so
a baked-in id would silently file returns under whatever row later took that
number. The label is snapshotted from that row, never composed.

**Every line field is re-derived server-side through the same helpers the manual
path calls, on the same source row.** Nothing is copied off the finding that
`PUT /lines` would compute: the two paths must write **identical rows, not
lookalikes**.

**On a later confirm** the CI number is **not** re-allocated and `supervisorId`
is **not** changed — the number is on billing's rail already, and that field
records who RAISED the return, not who last touched it. If a corrected count
empties the due set, the CI is **deleted** (lines, then header) rather than left
standing empty on billing's rail claiming a return with nothing in it.

**If billing has already closed it:** 🔴 **FROZEN — never touched.** The document
is real and this module has no business editing it. This is the one case where an
auto CI can end up short of what actually came back, and it is **logged loudly**
(`console.error` naming the CI, the order, the status and the new due count)
rather than silently reconciled, because a mismatch someone can see beats one
nobody can. Reconcile by hand.

---

## 10. The register export

Billing keeps a workbook by hand — `CI DATA NEW FILE2.xlsm`, sheet
`CI DATA BELOW 10000RS`, 17 columns, one row per CI, retyped off the very screen
that already holds every value. `GET /api/ci/export?from=&to=` produces that
sheet.

- **.xlsx, not .xlsm.** We do not reproduce their VBA; billing **pastes** these
  rows into their own macro workbook.
- 🔴 **The 17 header strings are copied CHARACTER FOR CHARACTER, typos
  included** — their named table keys off them. `DELAR NAME` (sic, not DEALER)
  and `CI Order value ` (sic, **trailing space**). An editor that strips trailing
  whitespace on save breaks the paste.
- **Closed CIs only**, over `ciDate`, inclusive both ends. A CI billing has not
  punched has no SAP number and no value — two of the seventeen columns empty on
  a row whose whole purpose is to carry them.
- 🔴 **NO VALUE FILTER, despite the sheet's name.** Owner ruling: every closed CI
  in the range, whatever it is worth. Whether a second register exists for larger
  CIs is still an open question (§15); if one does, the answer is one clause in
  `getCiRegisterRows`, not a threshold guessed in advance.
- **An empty range is a 200 with a header-only workbook.** Never a 404, never an
  error — "no CIs closed that month" is an answer, and billing needs the same
  file shape back either way.
- **Dates are TEXT, `dd.mm.yyyy`**, from the **UTC parts** of a `@db.Date` (its
  UTC parts ARE its calendar parts). A real Date would let the cell re-format
  itself by the opening machine's locale.
- **A blank column is an EMPTY CELL** — no cell at all, never `""`, `-` or `N/A`.
  Billing types into them.

**Five columns are blank, and `NON TINTED` is blank by RULING, not by absence.**
I `NON TINTED`, J `REASON`, L `Mtrl in Depo Y/N`, M `MATERIAL STATUS`,
Q `remark2`. ⚠ `NON TINTED` **is** derivable — a one-line rollup over
`import_raw_line_items.isTinting` — and it stays blank anyway (owner ruling,
2026-09-03). Whoever "discovers" `isTinting` has not found a gap. The other four
have no source in this schema at all; J in particular wants SAP's own 32-item
reason list, which is a different field from `ci_reason_master` and is a ROADMAP
item, not a missing feature.

⚠ **Gated on `ci.canExport`, NOT the board's `canView`** — see §11.

Cell types: dealer code, SAP CI number and DIV are **numbers**, except that a
digit string with a **leading zero stays TEXT** (§13, the `digitsCell` note
after CI-16). `CI Qty` is
**LITRES**, not tins (§13 CI-9).

---

## 11. Permissions

Page key **`ci`**. Access is a **per-user tick**: the live `ACCESS_SOURCE` is
`user` (live 2026-09-18, Q02), so `checkAnyPermission` (`lib/permissions.ts`)
reads the logged-in user's `user_page_access` row, not the role table. Live `ci`
ticks (live 2026-09-18, Q03a): **39 rows · canView 13 · canEdit 12 · canExport 5.**

Seed says (`prisma/seed.ts:162-164` — the `role_permissions` rows role mode would
read; seed is not live):

| Role | canView | canImport | canExport | canEdit | canDelete |
|---|---|---|---|---|---|
| `billing_operator` | ✅ | — | ✅ | ✅ | ✅ |
| `operations` | ✅ | — | ✅ | ✅ | — |
| `floor_supervisor` | ✅ | — | **❌** | ✅ | — |

🔴 **The seed's `floor_supervisor` row holds canView and canEdit but NOT
canExport, and that is DESIGNED.** He raises the return; the REGISTER is billing's deliverable. It is
the same split `app/api/mrn/[mrnId]/export/route.ts` documents. A future session
tidying "why is the export route stricter than the board next door" is about to
hand billing's outward-going document to the floor.

**Which gate each route uses** is listed in §14. The shape: reads take
`canView`, writes take `canEdit`, the export takes `canExport`, and `admin`
bypasses all three.

**Four write routes carry a sharper gate on top of the permission.** The three
role lists use `hasRole`, never `requireRole` (the latter redirects to an HTML
page a `fetch()` cannot parse):

| Route | Gate |
|---|---|
| `PATCH [ciId]/details` | canEdit + `EDIT_ROLES` = `floor_supervisor`, `operations`, `admin` (`details/route.ts:69`, `:92`) + ownership inside the guarded `updateMany` — `status: 'submitted'`, `supervisorId: viewerId` (`:215-219`) — with **no admin bypass** (`:51`). Billing holds canEdit to close; the role list is what stops it rewriting a supervisor's answers |
| `POST [ciId]/submit` | canEdit + `SUBMIT_ROLES` = `floor_supervisor`, `operations`, `admin` (`submit/route.ts:61`, `:90`) + ownership, where `admin` and `operations` keep a bypass for support work (`:186-190`) |
| `POST [ciId]/close` | canEdit + `CLOSE_ROLES` = `billing_operator`, `operations`, `admin` (`close/route.ts:49`, `:77`). `floor_supervisor` holds canEdit (he needs it to raise a return) and **cannot close** — 403 "Closing a return is the billing operator's step." |
| `PUT [ciId]/lines` | canEdit + ownership, no role list (below) |

`PUT /lines` on a
**submitted** CI requires `ci.supervisorId === viewerId` with **no admin
bypass** — the owner ruling names it "only by the supervisor who raised it" and
the guard is written that way verbatim, because a submitted CI has a number, is
on billing's rail and may already have been read off a screen. On a **draft**,
and on `submit`, `admin` and `operations` keep a bypass for support work.

⚠ **The page gate and the route gates are separate on purpose.**
`app/ci/page.tsx` stops the SCREEN rendering; `app/api/ci/*` stop the DATA, which
is reachable directly by URL. Neither substitutes for the other.

---

## 12. Live sync

🔴 **BILLING POLLS. THE SUPERVISOR DOES NOT.**

CI runs the opposite way to MRN, and the asymmetry is deliberate in **both**
modules — do not "align" them. The floor supervisor **creates** the work on his
phone, so he has nothing to wait for. The billing desk is the side sitting with a
screen open waiting on someone else. So `/api/ci/marker` exists, is billing-only,
and the supervisor face has no marker at all. MRN's marker is supervisor-only for
the mirror-image reason.

The mechanism — the 15s poll, the count + `MAX(updatedAt)` probe — is
`CLAUDE_PICKING.md §10`'s and is not restated here. What is CI's own:

- The marker **imports** `buildCiBillingWhere` from `lib/ci/queries.ts` (§13
  CI-10).
- The poll **pauses** while the close form has anything typed in it or a save is
  in flight — a refetch mid-entry that reset the three fields would be
  maddening.
- 🔴 The auto path **touches the header** after reconciling lines, because the
  marker keys on `MAX(updatedAt)` and a CI whose lines changed without the header
  moving would sit stale on a desk that has no other way to learn about it.

---

## 13. Landmines

Seventeen. Each states the reasoning, not just the rule — "don't do X" gets argued
around; "don't do X because it did Y" does not.

**CI-1 · `invoiceNo` is read LIVE. There must never be a back-fill job.**
The schema says it on the column itself: *"DO NOT BUILD A BACK-FILL JOB. The CI
holds orderId, so any screen reads the invoice number through the order at render
time and it simply appears once SAP sends it… print and export must PREFER the
live order value and fall back to this, never the reverse. A patch job would
fight that and could rewrite a closed document."* Live proof that it works:
CI-2026-00006 carries a NULL snapshot and every screen shows `I536226670` off the
order.

**CI-2 · Four columns are nullable so a DRAFT can exist, and a CHECK — not NOT
NULL — is what makes that safe.** `materialMoved`, `materialReceivedDate`,
`reasonId`, `reasonLabel`. The details screen comes AFTER line selection, so
between the draft insert and the details step these genuinely have no value. The
earlier shape forced the draft route to invent defaults (`"not_moved"`, today,
reason 1) that were never true and had to be patched before submit — and
inventing a fact to satisfy a NOT NULL is how a wrong fact reaches a printed
document when the patch is later forgotten. `chk_ci_returns_complete_when_not_
draft` makes all four mandatory the moment `status` stops being `draft`.
⚠ It is the **backstop, not the error message**: `POST /submit` validates all
four itself and names the missing one, because a raw "violates check constraint"
string reaching a supervisor's phone is not something he can act on. If that
string ever surfaces in the UI, the route's guard has a hole — fix the guard, do
not weaken the CHECK.

**CI-3 · The CI-number sequence query does NOT filter `isVoided`.** A voided CI
keeps its row and the database still enforces `UNIQUE(ciNumber)` against it.
Filtering would hand the next return a number a voided row still holds, and the
INSERT would throw a P2002 on a screen where the operator did nothing wrong.
Everywhere ELSE in this module every read filters voided rows out; this one query
is the documented exception, and it is the same exception the challan sequence
makes (`CLAUDE_CORE.md §13`).

**CI-4 · Allocation is NOT atomic, deliberately — do not "fix" it with a
transaction.** `prisma.$transaction` is banned (`CLAUDE_CORE.md §3`: Vercel
serverless + the Supabase pooler time out on it). Two submits racing on the same
millisecond can read the same maximum; `UNIQUE(ciNumber)` is the real backstop
and both write paths re-allocate **once** on P2002 and retry. At a handful of
returns a day the window is theoretical.

**CI-5 · Two parties, and the screens SHOW SAP's bill-to (v27.70, 2026-10-17,
`c6d6a8c7`).**

- **Four columns, snapshotted at raise by every raiser through `ciPartyColumns`
  (`lib/ci/derive.ts`):** `billToCustomerCode` / `billToCustomerName` and
  `shipToCustomerCode` / `shipToCustomerName`, all `text` and nullable. Smart Flow
  added them live and back-filled every row. Bill-to comes from the newest
  `import_raw_summary` row per OBD (`loadBillToByObd`, `lib/reports/bill-facts.ts`).
  Ship-to comes from `orders.shipToCustomerId` / `shipToCustomerName`, which is
  **SAP's own ship-to, never the override dealer**.
- **What the screens show** (`ciPartyDisplay`):
  - The main name is bill-to, else the old `customerName`, else "(Unmatched)".
  - A grey **"Ship to · name · code"** line sits under it and is hidden when
    unknown.
  - It shows on both faces: the phone search card, bill header, success screen,
    Submitted card and detail (`spine.tsx` `SHIP_TO_LINE`), and the desk rail and
    pane.
  - The desk search also matches bill-to, ship-to and the old name.
  - The register's columns A/B take the bill-to pair (`registerDealer`), else the
    old pair. Unknown is an empty cell, never "(Unmatched)".
- **The old dealer snapshot stays, for history.** `customerId` / `customerCode` /
  `customerName` are still written by `resolveCiDealer` (CI-6), which honours the
  ship-to override.
  - Live example, verified 2026-09-03 — **CI-2026-00007, OBD 9109178276**: the
    snapshot says `National Paints`, the override dealer
    (`shipToOverrideCustomerId = 1948`). The master (id 1987) and SAP's ship-to
    say Ambika Paints.
  - Before v27.70 that snapshot WAS the displayed name. *(Until 2026-10-24 this
    entry said the displayed dealer honours the override. For display that has
    been false since v27.70.)*
  - Do not "fix" either column by reading the master.

**CI-6 · `resolveCiDealer` MIRRORS Picking's rule; it does not import it.**
`lib/picking/queue.ts` owns the effective-dealer rule but does not export it (it
resolves through a batched id→row Map for its own N+1 reasons). If Picking's rule
changes, this changes with it. They must not drift.

**CI-7 · Pack order is `sortPackLabels`, it is NOT alphabetical, and CI does not
own it.** 🔴 **The rule lives in `CLAUDE_PICKING.md §3.1`** — the tiers, why weight
ranks apart from volume, why it takes the rendered label, and the 2026-08-10
`localeCompare` bug it replaced. Read it there; do not restate it here, and do
not let a future pass re-expand this entry. CI's position is only this: it
**imports** `lib/picking/pack-sort.ts` at `components/ci/line-list.tsx` and
`lib/ci/derive.ts`, and **must never copy it** — a RULE is imported, a token is
copied with a citation (§14). CI's own two lines on top of the shared rule: the
`"No pack"` group is filtered out, the rest sorted, then appended LAST (the
caller-side pinning §3.1 describes), and `derive.ts` pins on the display label
`"No pack"` where the components pin on the `"__no_pack__"` key, because it emits
labels rather than filter keys. If pack order ever needs to change, it changes in
Picking and CI inherits it — a CI-local fix would silently split the ordering
between CI's bill screen (the filter strip) and its details step (the pack
breakdown), which today agree only because both go through the shared sorter.

**CI-8 · Guard the division on `unitQty` ONLY — NEVER on `volumeLine`.**
`volumeLine = 0` is a real, correct value: **346 active lines** are brushes,
rollers, scrapers and putty knives that genuinely have no volume, and they must
produce 0 and render "0 L". A falsy check (`if (!volumeLine) return null`) would
blank all 346, and a blank reads as *"unknown"* — a different and wronger claim
than *"none"*. `unitQty` is what cannot be divided by; live it is never null and
never zero across 40,675 active lines, so that branch is a seatbelt.

**CI-9 · `returnedQty` is TINS. The register's `CI Qty` is LITRES.** Their row 2
reads 2.4 and no tin count is 2.4. A future session "simplifying" column G to
`totalTins` would be wrong, plausible, and invisible until a credit note is
short.

**CI-10 · The marker must IMPORT the board's WHERE, never re-type it.**
`buildCiBillingWhere` and `buildCiSupervisorWhere` are exported for exactly this.
A marker watching a NARROWER set than the board silently misses updates on the
desk; wider is harmless. This is the drift the Picking §10, Floor §10 and MRN
marker landmines all warn about.

**CI-11 · The date stepper drives the CLOSED section only.** Pending is the whole
backlog. Stated in §8 and repeated here because the billing Picking tab shipped
the opposite assumption once and rendered an empty tab over a real backlog of
older bills.

**CI-12 · `components/ci/spine.tsx` is the PHONE grammar. The desk pane is not
part of it and must never be "unified" with it.**
`spine.tsx` exists because `details-step.tsx` (the create flow, typed into) and
`submitted-detail.tsx` (a submitted CI, read) show the same four facts and had
**already drifted** into two different objects — one full-width stacked bands
with tiny uppercase labels, the other the approved label-left/value-right spine —
because the tokens were typed out twice and `details-step` could not import from
`submitted-detail` without a cycle. **Four files must take their tokens from it
and never re-declare them:** `details-step.tsx`, `submitted-detail.tsx`,
`line-list.tsx`, `new-return.tsx`.
🔴 **`ci-detail-pane.tsx` is deliberately NOT one of them.** It is the DESK pane,
with its own private `Fact` at its own scale (a 10px uppercase label over a
12.5px value, in a six-column grid) against the spine's 13px label/value pair on
a 60px row. They are two different objects on two different surfaces, and a
session that "unifies the CI detail tokens" will shrink a desk pane onto phone
metrics or bloat a phone row onto desk ones. Canon says **the phone screens**.

**CI-13 · Two CI numbers, and only one of them is labelled.** `ciNumber` is
OrbitOMS's own reference, allocated at submit. `sapCiNumber` is SAP's, typed by
billing after punching — **and the billing screen labels THAT field plain "CI
number"**, which is exactly why the two look mergeable. Merging leaves every
pending CI with no way to name it for the hours or days before SAP sees it.

**CI-14 · `deliveryQty` is SAP's DELIVERY quantity. There is no invoiced-quantity
column anywhere in this database.** Do not label it "invoiced qty" on a screen or
in a later doc.

**CI-15 · The `+1000` renumber offset in the auto reconcile is load-bearing.**
`lineNumber` is `UNIQUE(ciReturnId, lineNumber)`, so rewriting 1..N in place
collides with a row that still holds the number being assigned — swap two lines
and the first update fails. Moving every surviving row out of the 1..N range
first makes the second pass collision-free. It reads like a redundant extra pass.
It is not. (Two passes, sequential — never a transaction.)
⚠ Related: the reconcile **upserts and renumbers**; it does not
delete-all-and-recreate. `PUT /lines` may clear a draft to zero lines because a
draft is invisible; doing that here would blank a **live** document, which
billing may be reading, for the width of two statements.

**CI-16 · CLOSED — `/ci` is in the sidebar.** `PAGE_NAV_MAP` carries
`{ pageKey: "ci", label: "CI", href: "/ci" }` (`lib/permissions.ts` `PAGE_NAV_MAP`, placed
after `mrn`; its comment warns that the position is behaviour, because
`MobileShell`'s phone Home is `navItems[0]?.href`), and the sidebar icon is
`ci: Undo2` (`components/shared/role-sidebar.tsx` `ICON_MAP`; line numbers dropped 2026-10-24 — they had drifted).
Was URL-only in canon until 2026-09-18; the nav entry has existed since 55c3cdc6 (2026-08-31).
⚠ **`digitsCell`'s leading-zero branch is the sixteenth-and-a-half:** a digit
string writes as a NUMBER unless it starts with `0`, where it stays TEXT.
`Number("0000000")` is `0` — a live `sapCiNumber` — and a register that silently
drops the padding on a document number going upward is worse than one column with
mixed types. The comment sits at that line; do not simplify it to `Number()`.

**CI-17 · `orderInvoiceId` NULL is a WHOLE-OBD CI. It is not a missing link
(2026-10-24).** On a split OBD, every whole-OBD raiser writes NULL
(`linkRowForOrder`), and NULL covers every invoice row in the duplicate guard, the
done rule and the live-CI guard (`ciCoversRow`). A "tidy-up" that back-fills NULL
to seq 1 would quietly shrink a whole-bill return to one invoice. The done rule
would then call the OBD dispatched with invoices still un-returned, and the
per-invoice guard would allow a second CI on the others, which is a double credit
in SAP. Owner of the rule: `CLAUDE_ORDER_INVOICES.md` §4.9 and §8.

---

## 14. Key files index

**Schema** — `prisma/schema.prisma`: `ci_reason_master`, `ci_returns` (37
columns live, 2026-10-24), `ci_return_lines`. The model headers carry the
column-level reasoning.

**`lib/ci/` — eleven files** *(seven until 2026-10-24's count; `full-bill.ts`,
`bill-only.ts` and `live-ci.ts` came 2026-09-22/24 and `search-term.ts` came
2026-10-10)*. **The client/server line matters:**

| File | Owns | Client-safe? |
|---|---|---|
| `types.ts` | Every wire shape + the status/enum guards | ✅ imported by 9 client components |
| `derive.ts` | Litres, totals, pack breakdown, dealer resolution, `parseCiDateOnly`. **PURE** — no Prisma, no I/O, no clock | ✅ imported **by value** by 3 client components. It must stay pure |
| `queries.ts` | Every read feed + the exported WHERE builders | 🔴 server only (`prisma`) |
| `auto.ts` | The findings→CI reconcile (§9) | 🔴 server only (`prisma`) |
| `number.ts` | `allocateCiNumber` (§4) | 🔴 server only (`prisma`) |
| `resolve-lines.ts` | Batch SKU→name/pack against `sku_master_v2.material` ONLY | 🔴 server only (`prisma`) |
| `search-term.ts` | `normaliseCiSearchTerm` — the one invoice / OBD search-term rule (§5); shared with `lib/order-invoices/rules.ts` | ✅ **PURE** — no Prisma |
| `full-bill.ts` | `computeFullBillLines` — "full bill" = every active line at its delivered quantity; callers: `PUT /lines`, `bill-only.ts`, Floor's `raiseFullBillCi` | 🔴 server only (`prisma`) |
| `bill-only.ts` | `raiseBillOnlyCi` — the `'ci'` SO-tag CI (§1 raisers); never throws | 🔴 server only (`prisma`) |
| `live-ci.ts` | `findLiveCi(orderId, invoiceRowIds?)` + `liveCiRefusal` — "does this bill carry a live FULL CI?" for Release / unhold / cancel / hold release (§5) | 🔴 server only (`prisma`) |
| `workbook.ts` | The register .xlsx (§10) | 🔴 server only **for a second reason**: `xlsx` is a ~900KB CommonJS bundle with side effects that webpack cannot tree-shake out of anything a client component imports. `queries.ts` takes its row type with `import type`, which `isolatedModules` erases |

**`app/api/ci/` — twelve routes. All twelve carry `export const dynamic =
'force-dynamic'`** (verified 2026-09-03):

| Route | Method | Gate |
|---|---|---|
| `board` | GET | canView — `?face=billing[&date]` or `?face=supervisor`, 400 on a contradictory param |
| `search` | GET | canView |
| `bill/[orderId]` | GET | canView |
| `reasons` | GET | canView |
| `marker` | GET | canView |
| `[ciId]` | GET | canView |
| `export` | GET | **canExport** |
| `draft` | POST | canEdit |
| `[ciId]/lines` | PUT | canEdit **+ ownership** |
| `[ciId]/submit` | POST | canEdit **+ `SUBMIT_ROLES` + ownership** (admin/operations bypass) |
| `[ciId]/details` | PATCH | canEdit **+ `EDIT_ROLES` + ownership** (no admin bypass) |
| `[ciId]/close` | POST | canEdit **+ `CLOSE_ROLES`** (billing_operator, operations, admin) |

The role lists and their line anchors are in §11.

⚠ The static siblings win over the dynamic segment: `board`, `marker`, `search`,
`bill` and `export` all resolve to their own routes and never reach `[ciId]`.

**`components/ci/` — fourteen files. Nothing is shared between the two faces
except `lib/ci/types.ts` and `lib/ci/derive.ts`:**

- **Phone (10):** `ci-shell` · `new-return` · `submitted-board` ·
  `submitted-detail` · `details-step` · `line-list` · `qty-sheet` · `sheet` ·
  `result-card` · `spine`
- **Desk (4):** `billing-board` · `ci-rail` · `ci-detail-pane` ·
  `register-export`

⚠ **The card, the line row and the bottom-sheet primitives are COPIED from
Picking, not imported — and that is the module convention, not laziness.**
Picking does not export its row or its sheet geometry, and MRN's is
module-private and typed on its own line shape. **Tokens, not rules**: a token is
copied with a citation, a RULE (`sortPackLabels`) is imported. One deliberate
divergence is recorded in `sheet.tsx`: CI's `bottomOffset` is **0** where
Picking's is `MOBILE_NAV_CLEARANCE`, because CI's sheets open from a screen where
the tab bar is already hidden.

**Entry point** — `app/ci/page.tsx` (server, `force-dynamic`, gated
`ci·canView`), branching on `primaryRole`.

**The auto hook** — `app/api/picking/findings/confirm/route.ts`.

**Raisers outside `/ci`** (§1, §7.1), with their owners in brackets:
- `app/api/floor/ci/route.ts` — `floor` canEdit, `force-dynamic` (Floor)
- `lib/floor/raise-ci.ts` — `raiseFullBillCi`, `raiseInvoiceCi`
- `lib/order-invoices/ci-plan.ts` — pure, tested by `ci-plan.test.ts`: `ciCoversRow`, `invoiceCiRefusal`, `invoiceCiDuplicate`, `invoiceCiPicks`
- `lib/order-invoices/links.ts` — `linkRowForOrder`, the row a whole-OBD CI points at
- `lib/order-invoices/dispatch.ts` — the done rule, `settleObdDone` (ORDER_INVOICES)
- `lib/billing/telephonic-apply.ts` — calls `raiseBillOnlyCi` (BILLING)

**Mockups** — `docs/mockups/ci/supervisor.html` (frames 1-9) and
`docs/mockups/ci/billing.html` (4 frames), committed 2026-09-03. Component
headers cite frame numbers into these two files.

**Design history** — `docs/prompts/archive/2026-09/web-update-2026-08-31-ci-module.md`
(v3.3). ⚠ **HISTORY, NOT CANON.** It predates three days of change and is wrong
in at least one countable way (it describes nine API routes; there are twelve).
This file is the authority.

---

## 15. Open items and live state

**Live shape, SELECT-verified 2026-09-03:**

```
by status × source            totals                     closed CIs
  closed  · auto_finding   2    all rows      31            13, ciDate 2026-08-25 → 2026-09-03
  closed  · manual        11    drafts        17
  draft   · manual        17    voided         0            reasons used: 4 of 8
  submitted · manual       1    visible       14            (Physically Cross 7, Wrong Order
                                                             by S.O. 3, Return by Dealer 3,
                                                             Order Cancel by Dealer 1)
```

Four days from first table to register export: 19 CI commits, `e8695f40`
(2026-08-31 16:42) → `3b0d04b7` (2026-09-03 22:51).

**Live shape, SELECT-verified 2026-10-24** (the block above is the 2026-09-03 snapshot, kept as history):

```
non-draft by status × source × type        totals
  closed    · auto_finding   · part  92     all rows        232
  closed    · auto_bill_only · full  46     drafts           17
  closed    · floor          · full  45     voided            0
  submitted · floor          · full   1     orderInvoiceId  232 / 232
  closed    · manual         · full   8     on a seq ≥ 2 row  0
  closed    · manual         · part  23     on a split OBD    0  (1 split OBD live)
```

**Known-and-deliberate gaps** — all tracked in `docs/ROADMAP.md`'s CI section:

- **17 drafts against 14 real CIs.** Harmless — every feed filters
  `status <> 'draft'` — but growing, and there is no sweep.
- **The void path has never run in production.** Zero voided rows. The columns,
  the UNIQUE interaction (§13 CI-3) and the allocator exception all exist; no UI
  writes them.
- **`returned_to_floor` has no writer** (§2).
- **No A4 print sheet.** MRN has one; CI does not. Route comments already
  anticipate it ("the eventual print sheet").
- **Stale code comments (claims, not facts).** `app/ci/page.tsx` ("⚠ NOT
  IN THE SIDEBAR YET … Reach this page by URL until then") and
  `lib/permissions.ts` (`ci` "DELIBERATELY NOT IN PAGE_NAV_MAP YET" — still there 2026-10-24) are
  both contradicted by `PAGE_NAV_MAP` (§13 CI-16). Neither changes
  behaviour; fix them in a code-comment pass.
- **The old-MFG arm of the auto rule is provisional** (§9).
- **A frozen auto-CI is reconciled by hand only** — the `console.error` is the
  entire alerting mechanism. If it fires, someone must read a Vercel log to know.
- **SAP's 32-item reason list** (register column J) is not implemented and is a
  different field from `ci_reason_master`.
- **Whether a second register exists for CIs above ₹10,000** is unanswered, and
  no threshold has been guessed (§10).
- **Auto-CI per invoice** (§9): the auto-CI and the bill-only CI stay whole-OBD
  (NULL row on a split OBD). Open; ROADMAP.
- **Whole-OBD Floor CI after a per-invoice CI** cancels the OBD instead of being
  refused (§7.1 known defect). Open; ROADMAP.
- **The phone search's `matchedInvoiceSeq` is unread** (§5): a hit found by a seq-2
  number shows seq 1's number on the card.
- **Stale code comments, for the code-comment pass:** "NULL on a split one until
  Phase 6 assigns it from lines" in `lib/ci/auto.ts`, `lib/ci/bill-only.ts`,
  `app/api/ci/draft/route.ts` and `lib/floor/raise-ci.ts` (§9).

---

*CLAUDE_CI.md v1.5 · Schema v27.74 · CI / Goods Return Note · updated 2026-10-24 — **canon batch B5 (Add invoices) and a reconciliation to Schema v27.74.** Evidence: code at `b1d38861` (`lib/ci/*`, `lib/floor/raise-ci.ts`, `app/api/floor/ci`, `lib/order-invoices/ci-plan.ts` / `links.ts` / `dispatch.ts` / `plan.ts`, `app/api/ci/draft`), `git show` of `3e319529` (6.3), `4c97fd2f` (6.4), `e11e7115`, `c6d6a8c7` (v27.70); `pg_constraint`, `pg_indexes`, `information_schema` and counts read live 2026-10-24. Plan: `docs/prompts/drafts/code-discovery-2026-10-24-canon-add-invoices.md`. §1: NEW "three server raisers" table (`floor`, `auto_finding`, `auto_bill_only` beside the phone's `manual`) and three ownership rows (ORDER_INVOICES, FLOOR §4.1b, BILLING). §3: `ci_returns` 37 columns; `chk_ci_returns_source` has FOUR values, each with a writer (the "`auto_bill_only` … NOT BUILT" line was false); the `orderInvoiceId` index; NEW `orderInvoiceId` subsection (writers, NULL = whole OBD, live 232/232). §5: search matches ANY invoice row; **corrected** "a CI never changes `workflowStage`" — a FULL CI counts toward the OBD done rule (cross-ref, not restated), whole-bill raisers cancel, the live-CI guard; `liveInvoiceOf` shows a seq-2+ CI's own number. NEW §7.1 Floor Raise CI — whole bill vs per invoice, the per-(OBD, invoice row) duplicate guard, no OBD cancel, Add invoices refused by any CI incl. void, and a **known defect**: a whole-OBD CI after a per-invoice CI is not refused (no second CI, but the OBD is cancelled). §9: the auto-CI stays whole-OBD — open item. §13: CI-5 rewritten for v27.70 (bill-to shown, SAP ship-to line, old snapshot kept); NEW CI-17 (NULL is whole-OBD); line anchors in CI-16 dropped. §14: eleven `lib/ci` files, the raisers outside `/ci`. §15: 2026-10-24 live shape and four open items. Schema stamp v27.24 → v27.74: reconciled against every CORE version that touches a CI table (v27.39, v27.40, v27.66, v27.70; v27.75 is `trip_activity` only). Prior, v1.4 · updated 2026-10-03 — §8: the UniversalHeader exceptions are now two (`/floor`, `/freight-trips`), wording only. Prior, v1.3 · September 2026 ·
updated 2026-09-22 — **§3 only:** `chk_ci_returns_source` widened to three
values (`auto_bill_only`, CORE Schema v27.39), read live from `pg_constraint`
2026-09-22; the code that labels it "Bill-only" is named in the row. The Schema
stamp stays v27.24 ON PURPOSE: this was one row, not a reconciliation pass over
the file (CLAUDE.md §4 item 4). Prior, v1.2 (2026-09-18) — reconciled to code at HEAD 5ab9ee40 and the 2026-09-18 live
SELECTs (canon sweep batch B1). §13 CI-16 CLOSED: `/ci` has been in
`PAGE_NAV_MAP` since `55c3cdc6` (2026-08-31) with the `Undo2` sidebar icon; the
"URL only" / "not in the sidebar" claims are gone from §13 and §15, and §15
records the two stale code comments that still say otherwise. §11 rewritten:
access is a per-user tick (live Q02/Q03a: ci 39 rows · view 13 · edit 12 ·
export 5), the role table relabelled "seed says", and the sharper gates now
listed in full — details = canEdit + `EDIT_ROLES` + ownership (no admin bypass),
submit = canEdit + `SUBMIT_ROLES` + ownership, close = canEdit + `CLOSE_ROLES`
(`floor_supervisor` cannot close). §14 route table follows. §8 Row 1 has no title
(`b3896d30`). §1/§5 `SMU_CODE_BY_NAME` points at `CLAUDE_IMPORT.md §6` and lists
its five importers. Schema stamp v27.21 → v27.24, earned by this pass. Prior,
v1.1 (2026-09-04): §13 CI-7 REDUCED to a cross-reference: the pack-ordering
rule now lives where the code does, `CLAUDE_PICKING.md §3.1` (v1.17). CI-7 had
been the only place in canon the rule was written down, which put a three-module
rule in the file of a module that borrows it. CI keeps what is CI-specific — that
it imports and must never copy, plus its own no-pack pinning. §1 borrow table
points at §3.1. No other change; nothing about CI behaviour moved. Prior, v1.0
(2026-09-03) — first canonical file for the module. Written from the code, the
live schema and read-only SELECTs; the 2026-08-31 design draft is history.*
