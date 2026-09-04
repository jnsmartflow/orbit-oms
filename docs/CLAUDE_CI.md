# CLAUDE_CI.md — CI, Goods Return Note (CI Form)
# v1.1 · Schema v27.21 · September 2026 · updated 2026-09-04
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
| `SMU_CODE_BY_NAME`, the division name↔code map | `CLAUDE_IMPORT.md` | imported. CI **diverges** on display — §5 |
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
count stayed wrong until 2026-09-03. It is 32.

| Table | What it is |
|---|---|
| `ci_reason_master` | The reason list. **DATA, NOT CODE** — the depot can add, relabel or retire a reason without a deploy, which is why `GET /api/ci/reasons` exists and why no component may hardcode the list. 8 live rows, 3 pinned |
| `ci_returns` | The CI header. Snapshots the bill and the dealer; carries the stage-1 answers, billing's three fields, the void columns and `source` |
| `ci_return_lines` | One returned line. Snapshots what the bill said at the moment of the return, because a re-import patches raw lines in place |

### The five CHECK constraints — invisible in Prisma, so they are recorded here

`CLAUDE_CORE.md §7.4` explains why: Prisma cannot express a CHECK, so it does not
appear in `schema.prisma` as anything but a comment. Read live from
`pg_constraint`, 2026-09-03 — **all five are on `ci_returns`**:

| Constraint | What it enforces |
|---|---|
| `chk_ci_returns_status` | `draft` / `submitted` / `closed` / `returned_to_floor` |
| `chk_ci_returns_return_type` | `full` / `part` |
| `chk_ci_returns_material_moved` | `moved` / `not_moved` |
| `chk_ci_returns_source` | `manual` / `auto_finding` |
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

**Indexes** (live, `pg_indexes`): `ci_returns` carries its pkey, `ciNumber`
UNIQUE, and five secondaries — `invoiceNo`, `obdNumber`, `orderId`, `status`,
`materialReceivedDate`. The `invoiceNo` + `obdNumber` pair is §5's search ruling
in schema form. `ci_return_lines` has its pkey plus `UNIQUE(ciReturnId,
lineNumber)`; there is deliberately no separate index on `ciReturnId`, which is
the leading column of that pair.

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

**Search** (`GET /api/ci/search`) matches on **invoice number OR OBD number**.
The term is normalised in `lib/ci/queries.ts` — trimmed, uppercased, and a bare
9 digits gets its `I` prefix — and the normalised term is echoed back so the UI
can show what was actually searched. It **always returns a list, never a single
row**: 11 live invoice numbers map to two OBDs each. With exactly one hit the UI
skips straight to the bill, which is a UI shortcut and not a query shortcut.

🔴 **`orderId` is the identity of the bill. Never `invoiceNo`.** `invoiceNo` is
not unique, and `obdNumber`, though unique, is a business key. Every route that
takes a bill takes `orders.id` — `GET /api/ci/bill/[orderId]` — and
`ci_returns.orderId` is `NOT NULL` with `onDelete: Restrict`.

⚠ **No behaviour hangs off that FK.** A CI never changes the order's
`workflowStage` or any other column; the link is stored, and read, and nothing
else.

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

### Division — CI's one divergence from an owner's rule

The division number ("70", "74", "76", "77", "10") is shown on **both detail
screens**, on **every CI**.

`orders.smu` holds the **NAME** only ("Deco Retail"); the numeric code stops at
`import_raw_summary.smuCode`, which CI does not join and must not start joining —
the name determines the code, so it is derived in memory through
`SMU_CODE_BY_NAME` (`CLAUDE_IMPORT.md` owns that map). CI is its third caller,
after `lib/picking/queue.ts` and `lib/floor/queries.ts`.

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

---

## 8. Billing's desk face

`billing-board.tsx` is the composition root: `UniversalHeader` (never a
hand-rolled one — `CLAUDE_CORE.md §10`; `/floor` is the one named exception in
`CLAUDE_UI.md §6` and CI does not earn a second), over a
`344px minmax(0, 1fr)` two-track grid — the same geometry MRN and `/floor` use.

**Row 1** carries the title, the counts in `stats` (the app's count idiom), and
the search. **Row 2 LEFT** carries the register control (§10). **Row 2 RIGHT**
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
digit string with a **leading zero stays TEXT** (§13 CI-16). `CI Qty` is
**LITRES**, not tins (§13 CI-9).

---

## 11. Permissions

Page key **`ci`**. Live `role_permissions`, SELECT-verified 2026-09-03, and
`prisma/seed.ts` **agrees row for row** — no drift in either direction:

| Role | canView | canImport | canExport | canEdit | canDelete |
|---|---|---|---|---|---|
| `billing_operator` | ✅ | — | ✅ | ✅ | ✅ |
| `operations` | ✅ | — | ✅ | ✅ | — |
| `floor_supervisor` | ✅ | — | **❌** | ✅ | — |

🔴 **`floor_supervisor` holds canView and canEdit but NOT canExport, and that is
DESIGNED.** He raises the return; the REGISTER is billing's deliverable. It is
the same split `app/api/mrn/[mrnId]/export/route.ts` documents. A future session
tidying "why is the export route stricter than the board next door" is about to
hand billing's outward-going document to the floor.

**Which gate each route uses** is listed in §14. The shape: reads take
`canView`, writes take `canEdit`, the export takes `canExport`, and `admin`
bypasses all three.

**Two routes carry a sharper gate on top of the permission.** `PUT /lines` on a
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

Sixteen. Each states the reasoning, not just the rule — "don't do X" gets argued
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

**CI-5 · The dealer name is a SNAPSHOT that honours the ship-to override, so it
can legitimately differ from the customer master.** Live example, verified
2026-09-03 — **CI-2026-00007, OBD 9109178276**: the CI says `National Paints`,
`delivery_point_master` (id 1987) says `Ambika Paints`, and SAP's own
`shipToCustomerName` says `AMBIKA PAINTS`. The bill carries
`shipToOverrideCustomerId = 1948` = National Paints. **The override is correct:
goods come back from where they were DELIVERED.** This is also why the register
will show a name billing's old sheet does not — expect that question, and do not
"fix" it by reading the master.

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

**CI-16 · `/ci` IS REACHABLE BY URL ONLY, AND THE REASON IS BEHAVIOURAL — NOT AN
UNFINISHED TASK.**
`ci` is in the `PageKey` union and in `ALL_PAGE_KEYS`, but deliberately **not in
`PAGE_NAV_MAP`**. 🔴 `MobileShell`'s phone Home target is **`navItems[0]?.href`**,
so a nav entry inserted at index ≤ 2 would **steal `floor_supervisor`'s Home
button from `/picking`** — the screen he lands on at login and works from all
day. Adding the row is not the fix on its own.
**A correct fix must satisfy all three:** (a) CI's entry lands at an index that
leaves `navItems[0]` as `/picking` for `floor_supervisor` specifically, after
`buildNavItems` has filtered by permission — the index in `PAGE_NAV_MAP` is not
the index in the built list; (b) it is verified on a real phone for that role,
not only for admin, whose nav is longer and orders differently; (c) the desk
roles get it too, since `billing_operator` reaches the same route. Until then the
URL is the entry point, and that is a known state rather than an oversight.
⚠ **`digitsCell`'s leading-zero branch is the sixteenth-and-a-half:** a digit
string writes as a NUMBER unless it starts with `0`, where it stays TEXT.
`Number("0000000")` is `0` — a live `sapCiNumber` — and a register that silently
drops the padding on a document number going upward is worse than one column with
mixed types. The comment sits at that line; do not simplify it to `Number()`.

---

## 14. Key files index

**Schema** — `prisma/schema.prisma`: `ci_reason_master`, `ci_returns` (32
columns), `ci_return_lines`. The model headers carry the column-level reasoning.

**`lib/ci/` — seven files. The client/server line matters:**

| File | Owns | Client-safe? |
|---|---|---|
| `types.ts` | Every wire shape + the status/enum guards | ✅ imported by 9 client components |
| `derive.ts` | Litres, totals, pack breakdown, dealer resolution, `parseCiDateOnly`. **PURE** — no Prisma, no I/O, no clock | ✅ imported **by value** by 3 client components. It must stay pure |
| `queries.ts` | Every read feed + the exported WHERE builders | 🔴 server only (`prisma`) |
| `auto.ts` | The findings→CI reconcile (§9) | 🔴 server only (`prisma`) |
| `number.ts` | `allocateCiNumber` (§4) | 🔴 server only (`prisma`) |
| `resolve-lines.ts` | Batch SKU→name/pack against `sku_master_v2.material` ONLY | 🔴 server only (`prisma`) |
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
| `[ciId]/submit` | POST | canEdit **+ ownership** |
| `[ciId]/details` | PATCH | canEdit |
| `[ciId]/close` | POST | canEdit |

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

**Mockups** — `docs/mockups/ci/supervisor.html` (frames 1-9) and
`docs/mockups/ci/billing.html` (4 frames), committed 2026-09-03. Component
headers cite frame numbers into these two files.

**Design history** — `docs/prompts/drafts/web-update-2026-08-31-ci-module.md`
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

**Known-and-deliberate gaps** — all tracked in `docs/ROADMAP.md`'s CI section:

- **17 drafts against 14 real CIs.** Harmless — every feed filters
  `status <> 'draft'` — but growing, and there is no sweep.
- **The void path has never run in production.** Zero voided rows. The columns,
  the UNIQUE interaction (§13 CI-3) and the allocator exception all exist; no UI
  writes them.
- **`returned_to_floor` has no writer** (§2).
- **No A4 print sheet.** MRN has one; CI does not. Route comments already
  anticipate it ("the eventual print sheet").
- **`/ci` is not in the sidebar** (§13 CI-16).
- **The old-MFG arm of the auto rule is provisional** (§9).
- **A frozen auto-CI is reconciled by hand only** — the `console.error` is the
  entire alerting mechanism. If it fires, someone must read a Vercel log to know.
- **SAP's 32-item reason list** (register column J) is not implemented and is a
  different field from `ci_reason_master`.
- **Whether a second register exists for CIs above ₹10,000** is unanswered, and
  no threshold has been guessed (§10).

---

*CLAUDE_CI.md v1.1 · Schema v27.21 · CI / Goods Return Note · September 2026 ·
updated 2026-09-04 — §13 CI-7 REDUCED to a cross-reference: the pack-ordering
rule now lives where the code does, `CLAUDE_PICKING.md §3.1` (v1.17). CI-7 had
been the only place in canon the rule was written down, which put a three-module
rule in the file of a module that borrows it. CI keeps what is CI-specific — that
it imports and must never copy, plus its own no-pack pinning. §1 borrow table
points at §3.1. No other change; nothing about CI behaviour moved. Prior, v1.0
(2026-09-03) — first canonical file for the module. Written from the code, the
live schema and read-only SELECTs; the 2026-08-31 design draft is history.*
