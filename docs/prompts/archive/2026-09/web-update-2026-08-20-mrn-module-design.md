# web-update-2026-08-20-mrn-module-design.md
# MRN (Material Receipt Note) — module design record
# Draft v1.1 · 20 August 2026 · Schema v27.16
# v1.1 supersedes v1.0 on FOUR points — see §11. v1.0's "Schema v27.14" was
# wrong: it was computed against CORE v92; the live CORE is v94 at v27.15,
# so MRN mints v27.16.
# Type: web-update (DECISION record — design locked, build not started)
# Lives in: orbit-oms/docs/prompts/drafts/

> **Classification (per project rule 6):** this is a `web-update-*` draft — a
> DECISION, not a shipped-reality report. Everything in §7 (schema) and §3
> (permissions) is **already applied to live production**; everything else is
> **designed and approved, not yet built**. Check implementation status before
> merging any of it into a canonical file.
>
> When MRN reaches production it earns its own canonical `docs/CLAUDE_MRN.md`
> plus a router row in `CLAUDE.md` — both are Claude Code jobs, not web jobs.

---

## 1. What MRN is

**Inbound** goods receipt. Every other module in OrbitOMS moves stock *out* of
the depot; MRN is the only one that records stock coming *in*.

A truck reports at the Surat depot carrying material against an STI / PO. The
billing operator raises an MRN and pastes the STI line items. The floor
supervisor meets the truck, records what physically came off it, and closes the
MRN. Billing then downloads the finished report.

**What it replaces.** Today: billing prints the XLS template, hands the paper to
the supervisor, the supervisor writes manufacturing month/year and damage counts
on it by hand, walks it back to billing, and billing re-types the whole thing
into Excel. The source template is `MRN TEMP SEET TPW 17.08.2026.xls` — a 4-sheet
workbook (PASTE / PRINT / HELPER-1 / MASTER). MRN removes the print, the
handwriting and the re-typing.

### Ownership boundary (§7 of the project rules — state it before building)

MRN is **standalone**. It has its own three tables and touches **nothing** in the
OBD / orders pipeline. It writes no `orders` row, no `order_status_logs` row, and
never calls a picking, floor or import route.

| MRN owns | MRN borrows, never re-describes |
|---|---|
| `mrn`, `mrn_lines`, `mrn_line_batches` | SKU resolution by `material` → `CLAUDE_CORE.md §13` / §7.1.c |
| `/mrn` route + its role branch | the mobile shell + bottom-tab slot → `CLAUDE_UI.md §59` |
| the paste parser + MRN number allocation | `ModuleMobileHeader` → `CLAUDE_UI.md §59.7` |
| the XLS + A4 report | the fixed-table standard → `CLAUDE_UI.md §27` |
| pageKey `mrn` | the hand-rolled-desk-header precedent → `CLAUDE_FLOOR.md` |

The only shared surface it reads is **`sku_master_v2`**, and only to display a
product name and pack next to a pasted SAP code.

---

## 2. Roles and access

| Role | Sees | Can |
|---|---|---|
| `billing_operator` | desktop board at `/mrn` | create, edit header, paste/edit lines, delete a not-yet-started MRN, download the report |
| `floor_supervisor` | phone card board at `/mrn` | open, Start unloading, record each line, End unloading |
| `admin` | desktop board | everything, via the usual bypass |

**One route, two faces, branching by ROLE — not by screen width.** This is
deliberately the `/picking` pattern (`app/picking/page.tsx`), not a second route.

**Decided:** the truck-side check is done by the **existing `floor_supervisor`
role**. No new role was created. The people already logging in for `/picking` get
MRN as a second board.

**Open:** whether `floor_supervisor`'s login landing moves from `/picking` to
`/mrn`, stays, or becomes conditional. Not decided — flagged for the build
session. Note the standing rule from the retirement playbook: *move the people
out before you demolish the building* — any landing change is its own commit.

---

## 3. Screens

Approved mockups, reviewed before any React (project rule — mockup first):

```
docs/mockups/mrn/01-billing-desktop.html
docs/mockups/mrn/02-supervisor-mobile.html
```

**The mockups are the visual spec.** Where this document and a mockup disagree,
the mockup wins on layout and the document wins on rules.

### 3.1 Billing — desktop `/mrn`

Floor-Control shape: **hand-rolled two-part header** (title + IST clock + date
stepper + search), **344px left rail**, right working pane. Not
`<UniversalHeader />` — same reasoning as `/floor`'s named exception in
`CLAUDE_UI.md §6`; treat this as a **second** named exception and record it there,
do not read it as the rule loosening.

| ID | Screen |
|---|---|
| B1 | Board, MRN open — header card + line table |
| B2 | Board, nothing selected — empty state |
| B3 | Board, supervisor is checking it — locked, greyed, no partial data |
| B4 | Board, checked — issues banner, totals row, report buttons |
| P1 | New MRN |
| P2 | Paste lines, step 1 (the paste box) |
| P3 | Paste lines, step 2 (match preview) |
| P4 | Edit header |
| P5 | Delete MRN |
| P6 | Download report (XLS / PDF) |
| P7 | A4 print sheet |

**Left rail rules (v2 — simplified on owner instruction):**
- **No Open / Done / All tabs.** One flat list.
- **One day at a time**, driven by a header date stepper `‹ Today · 20 Aug ›`.
  This exists *because* Sr no is per-day; the two are one decision.
- **Sr no** on every card — 1, 2, 3… in truck arrival order for that day.
- **Exactly one status pill: `Checking`.** Nothing is shown on the others. A
  finished MRN carries its completion time as plain grey caption text plus a
  neutral chip (`All clear` / `4 issues`) — those are facts, not status badges.

### 3.2 Supervisor — phone `/mrn`

Picking shape: teal `ModuleMobileHeader`, three bottom tabs through the shared
`WorkflowTabBar` slot, 390px reference viewport, card type scale `CLAUDE_UI.md §60`.

| ID | Screen |
|---|---|
| S1 / S2 / S3 | Board tabs — **To check** / **Checking** / **Done** |
| S4 | MRN open, before start — truck facts + Start unloading |
| S5 | Line list, mid check — progress strip, tick circles |
| S6 | All lines ticked — End unloading turns green |
| S7 | Line sheet, normal |
| S7b | Line sheet, two manufacturing batches |
| S8 | Line sheet, issue open — the count boxes |
| S9 | Start unloading confirm |
| S10 | End unloading confirm |
| S11 | After finish — toast, card moves to Done |
| S12 | Empty state |

**Done tab shows today only and carries NO count badge** — a finished pile is a
receipt, not work still owed. Same rule as `CLAUDE_PICKING.md §5.2`.

---

## 4. Fields — and whose job each one is

### Header

| Field | Filled by | Notes |
|---|---|---|
| MRN number | auto | `MRN-{YEAR}-{5-digit}` |
| Sr no | auto | position within `mrnDate` |
| Truck reporting date | Billing | |
| Received from | Billing | **TPW or CDC** — a two-value choice, DB CHECK |
| Receiving warehouse | auto | always `Surat` |
| STI / PO ref no. | Billing | |
| Delivery no | Billing | |
| OTR no | Billing | optional |
| Unloading start | Supervisor | button tap, permanent |
| Unloading end | Supervisor | button tap, permanent |

### Line

| Column | Filled by |
|---|---|
| Sr no | auto, from the paste |
| Product SKU | Billing — **pasted** |
| Qty as per STI | Billing — **pasted** |
| Carton qty | Billing — typed (it comes off the STI) |
| Qty as per physical | Supervisor |
| Manufacturing month + year | Supervisor (1..N batches) |
| Best before month + year | derived, stored |
| SND · Lky · Damage · Empty · QTD · REJ | Supervisor, only when something is wrong |
| Short · Excess | **derived, never typed** |

### Dropped from the source workbook — with the reason

- **Transportation mode**, **Total nags as per LR**, **Packing material vendor** —
  owner removed them; not used.
- **Non-SND location** — this was never a field. In the workbook it is the
  right-hand-corner **legend** listing Dam / Empty / Leaky / Short / Excess, which
  are already the line columns. It was a duplicate of the line work.
- **Total nags physically received** — a duplicate of the line work in the other
  direction. The supervisor confirms qty per line; a separately typed grand total
  can only ever agree or be a bug.

### Still unknown

- **QTD** — the column is carried through the schema, the UI and the report, but
  nobody in this session could say what it stands for. Do not repurpose it.

---

## 5. Workflow

```
billing creates header + pastes lines
        │   (no button — the MRN is on the phone the moment both exist)
        ▼
supervisor taps START UNLOADING   ──► MRN locks to billing
        │
        │  per line: confirm qty (pre-filled) + mfg month/year
        │            + counts only when something is wrong
        ▼
supervisor taps END UNLOADING     ──► everything lands in billing at once
        │
        ▼
billing downloads XLS / prints PDF
```

**`status`: `open` → `checking` → `done`.** A plain TEXT column with a DB CHECK,
never a Postgres enum — adding a fourth state later is a constants edit, not a
migration. Same reasoning as `orders.workflowStage`.

### Two removed CTAs, and why

- **"Send to supervisor" — removed.** Owner instruction: once the header and the
  lines exist there is nothing left to decide, so a button asking permission to
  do the obvious is friction. The MRN appears on every supervisor's phone under
  **To check** automatically.
- **"Recall to draft" — removed with it.** With no send step there is nothing to
  recall. Billing can keep editing freely; **Start unloading is what locks it.**

### No live sync into billing — explicit owner decision

While the supervisor is checking, billing sees **no progress bar, no line count,
no partial values**. The lines render exactly as billing left them, greyed,
behind an amber "Locked — the supervisor is checking this truck" banner.
Everything arrives **in one write** when he taps End unloading.

⚠ This is a **deliberate divergence** from `/picking` and `/floor`, which both
poll a 15s marker. Do not "align" MRN to them as a consistency fix. If a future
session wants live progress here it is a new decision, not a bug report.

---

## 6. Rules that make the phone side fast

1. **Physical qty opens pre-filled to the STI qty.** The common case is that the
   stock is there — he taps Confirm and moves on, typing nothing.
2. **He only types when something is wrong.** Changing the number is what raises
   the issue.
3. **Short and Excess are calculated**, never typed. `qtySti − physicalQty`.
   Negative → Short, positive → Excess. Storing them would let two places
   disagree.
4. **SND + Leaky + Damage + Empty must sum to the physical qty** before the line
   can be confirmed. That is the check which stops the counts and the quantity
   drifting apart.
5. **Manufacturing month and year always have to be entered** — nothing can
   default them.
6. **Best before is TYPED by the supervisor**, per batch — a month picker and a
   year picker sitting under the manufacturing pair. ⚠ **CHANGED 20 Aug (§11,
   OQ-9).** v1.0 of this draft had it calculated as manufacturing + 24 months
   and rendered read-only. That was wrong: **shelf life varies by product**, so
   there is nothing to calculate from. The `bestBeforeMonth` / `bestBeforeYear`
   columns stay NOT NULL and stored; only the source of the value changed —
   from a derivation to an input. Do not reintroduce a 24-month default.
7. **Ticking every line is what unlocks End unloading.** Same shape as Approve on
   the picking supervisor board.

### Multiple manufacturing batches on one line

Rare but real: 46 tins received, 30 made in Jun-26 and 16 in Jul-26.

- The **default is always one batch** — a single month/year picker, unchanged.
- "Add another manufacturing batch" turns it into a list of `qty + month + year`
  rows.
- **The batch quantities must add up to the physical qty** before Confirm works.
- On the line list a split line reads `06/26 · 9 + 07/26 · 6`.
- **On the report a split line becomes sub-rows `6a` / `6b`** — chosen over
  packing both dates into one cell, because a cell holding two values cannot be
  sorted or summed and the source workbook's columns assume one value each.
- **`Qty as per STI` sits on the first sub-row only.** Repeating it would
  double-count the column and break the totals row.

---

## 7. Schema — v27.15 → **v27.16** · APPLIED TO LIVE 2026-08-20

Three new standalone tables. Created by hand in the Supabase SQL Editor per
CORE §3 (`db push` and `db pull` are both forbidden / broken here).
**`prisma/schema.prisma` still needs the matching hand-edit + `npx prisma generate`
— that had not been done when this draft was written.**

```
mrn                          21 columns · one row per truck
├── id                       SERIAL PK
├── mrnNumber                TEXT  UNIQUE  mrn_mrnNumber_key
├── mrnDate                  DATE          the day srNo counts against
├── srNo                     INTEGER       truck 1,2,3… of that day
├── truckReportingDate       DATE
├── receivedFrom             TEXT   CHECK chk_mrn_received_from IN ('TPW','CDC')
├── receivingWarehouse       TEXT   DEFAULT 'Surat'
├── stiRefNo / deliveryNo / otrNo   TEXT?
├── status                   TEXT   DEFAULT 'open'
│                                   CHECK chk_mrn_status IN ('open','checking','done')
├── unloadingStartAt         TIMESTAMPTZ(6)?
├── unloadingStartById       INT? FK → users ON DELETE SET NULL
├── unloadingEndAt           TIMESTAMPTZ(6)?
├── unloadingEndById         INT? FK → users ON DELETE SET NULL
├── isRemoved                BOOLEAN DEFAULT false
├── removedAt                TIMESTAMPTZ(6)?
├── removedById              INT? FK → users ON DELETE SET NULL
├── createdById              INT  FK → users ON DELETE RESTRICT
├── createdAt                TIMESTAMPTZ(6) DEFAULT now()
└── updatedAt                TIMESTAMPTZ(6) DEFAULT now()

UNIQUE (mrnDate, srNo)   mrn_mrnDate_srNo_key
INDEX  (status)          mrn_status_idx
INDEX  (mrnDate DESC)    mrn_mrnDate_idx

mrn_lines                    18 columns · one row per SKU
├── id                       SERIAL PK
├── mrnId                    INT FK → mrn ON DELETE CASCADE
├── lineNo                   INTEGER
├── skuCode                  TEXT            the raw pasted SAP code
├── qtySti                   INTEGER
├── cartonQty                INTEGER?
├── physicalQty              INTEGER?        null until checked
├── isChecked                BOOLEAN DEFAULT false
├── checkedAt                TIMESTAMPTZ(6)?
├── checkedById              INT? FK → users ON DELETE SET NULL
├── sndQty / leakyQty / damageQty / emptyQty / qtdQty / rejQty   INTEGER?
├── createdAt                TIMESTAMPTZ(6) DEFAULT now()
└── updatedAt                TIMESTAMPTZ(6) DEFAULT now()

UNIQUE (mrnId, lineNo)   mrn_lines_mrnId_lineNo_key
INDEX  (skuCode)         mrn_lines_skuCode_idx

mrn_line_batches             9 columns · one row per mfg batch
├── id                       SERIAL PK
├── lineId                   INT FK → mrn_lines ON DELETE CASCADE
├── batchNo                  INTEGER          1 = "6a", 2 = "6b"
├── qty                      INTEGER   CHECK chk_mrn_batch_qty (qty > 0)
├── mfgMonth                 INTEGER   CHECK chk_mrn_batch_mfg_month 1..12
├── mfgYear                  INTEGER
├── bestBeforeMonth          INTEGER   CHECK chk_mrn_batch_bb_month 1..12
├── bestBeforeYear           INTEGER
└── createdAt                TIMESTAMPTZ(6) DEFAULT now()

UNIQUE (lineId, batchNo)  mrn_line_batches_lineId_batchNo_key
```

Verified live 2026-08-20 by `information_schema` SELECT: **3 tables · 21 / 18 / 9
columns**.

### Schema decisions worth not re-litigating

- **The mfg month never sits on the line, even in the single-batch case.** One
  batch row is still a batch row. One owner per behaviour — a split line and a
  plain line take the identical code path.
- **No product name, description or pack is stored on `mrn_lines`.** `skuCode`
  only, resolved live against `sku_master_v2.material`. A stored copy goes stale,
  and resolving by a catalog **row id** is the id-space landmine in CORE §13 —
  zero id overlap between the two catalog tables, so a naive FK renders
  confidently-wrong product names.
- **Short / Excess are not columns** (§6.3).
- **Best before IS stored** (§6.6).
- **Delete is soft** — `isRemoved`, matching `orders.isRemoved` and
  `delivery_challans.isVoided`. The MRN number is never reused.
- ⚠ **`updatedAt` on `mrn` and `mrn_lines` is a plain `DEFAULT now()`** with no
  DB trigger. Prisma's `@updatedAt` must carry it, or every UPDATE that omits it
  leaves a stale timestamp — the same trap as
  `push_subscriptions.updatedAt` (CORE §13).
- ⚠ **`mrn` has FOUR FKs to `users`** and `mrn_lines` has one. All five need
  explicitly **named** `@relation`s on both sides, or Prisma throws an ambiguity
  **error** — not a warning. (CORE §7.3 dual-relation trap, at double the usual
  scale.)
- **MRN number allocation must count soft-removed rows**, or a deleted MRN's
  number gets reissued. Same rule as challan sequence allocation (CORE §13),
  which is the one challan read that deliberately does not filter `isVoided`.

### Permissions — APPLIED TO LIVE 2026-08-20

New pageKey **`mrn`**. Live `role_permissions` rows, SELECT-verified:

| roleSlug | canView | canEdit | canExport | canDelete | canImport |
|---|---|---|---|---|---|
| `billing_operator` | true | true | true | true | false |
| `floor_supervisor` | true | true | **false** | **false** | false |

`admin` needs no row (bypass). ⚠ **These rows are in LIVE only — they are NOT in
`prisma/seed.ts` yet.** A wipe-and-reseed would silently revoke both. Adding them
to the seed is a build step, not optional. (CORE §3: *seed is not live*, and this
exact gap has bitten three times.)

The supervisor cannot export or delete deliberately: the report is billing's
deliverable, and deletion is billing's call.

---

## 8. Report output

Two formats, same data:

- **XLS (.xlsx)** — column order matching the existing `PRINT` sheet, so anyone
  used to the paper reads it without relearning. Built with the `xlsx` npm
  package already in the stack (CORE §2). Do not introduce a new library.
- **A4 landscape PDF** — the print sheet, black and white, three signature lines
  (Checked by / Billing / Warehouse in-charge), OrbitOMS footer with IST print
  time.

Print CSS rules are not negotiable and are owned elsewhere: `@page` must be
**top-level in `globals.css`**, never nested inside `@media print`, and print
isolation uses `visibility: hidden`, never `display: none` (CORE §3,
`CLAUDE_UI.md §32`).

Report contents: the full header block, every line (split lines as `6a`/`6b`),
and a TOTAL row across Qty STI / Physical / SND / Lky / Dmg / Emp / Sht / Exc.

---

## 9. Open items — carry these into the build session

1. **QTD** — meaning unknown (§4). Column exists, is displayed, is exported.
   Nobody should guess at its semantics.
2. **24-month best-before** — an assumption, unconfirmed against a product spec.
   If shelf life varies by product the derivation has to move or become an input.
3. **`floor_supervisor` login landing** — `/picking`, `/mrn`, or conditional.
   Undecided (§2).
4. **Seed rows for pageKey `mrn`** — live-only today; must be added to
   `prisma/seed.ts`.
5. **`schema.prisma` hand-edit + `npx prisma generate`** — not yet done.
6. **Unknown SKUs.** A pasted code absent from `sku_master_v2` shows as
   "Not in catalog" with a bare code and no pack. This is correct behaviour, not
   a bug — ~27% of distinct active SAP import codes resolve in neither catalog
   table (CORE §7.1.c). A blank pack is a mis-pick *preventer*. The missing master
   data is the real issue and is a separate catalog-cleanup backlog item.
7. **No device verification is possible from Claude Code** — it has no login
   credentials, so anything behind auth returns 307 → `/login`. The phone flow,
   the role branch and the report download must all be hand-tested by Smart Flow.

---

## 11. Decisions taken on the build report — 20 Aug 2026

Claude Code's read-and-plan pass verified the live schema (3 tables · 21/18/9
columns · every constraint and index · both grants — **zero differences** from
§7) and raised eleven open questions. All eleven are now answered. Where an
answer contradicts §1-§10 above, **this section wins**.

**Four of these correct errors in v1.0 of this draft**, marked ⚠.

| # | Question | Answer |
|---|---|---|
| **OQ-1** | Desktop header: `<UniversalHeader />` or a second hand-rolled exception? | ⚠ **`<UniversalHeader />`.** The mockup's "Floor-Control layout: hand-rolled header" subtitle was written in error. `/floor` stays the ONE named exception in `CLAUDE_UI.md §6`. Title + stats + clock + search in Row 1, **date stepper in Row 2** — two rows where the mockup draws one, costing 40px. Do NOT add a Row-1 stepper prop to the shared component in this build; that is a change to every board and belongs in its own session. |
| **OQ-2** | Short / Excess derived or stored? | **Derived, never stored.** `Sht = max(0, qtySti − physicalQty)`, `Exc = max(0, physicalQty − qtySti)`. Computed at render and at export. No column, ever. |
| **OQ-3** | Which condition columns on which surface? | ⚠ **All eight, on every surface** — SND · Lky · Dmg · Emp · QTD · REJ · Sht · Exc. That is exactly row 16 of the source workbook's `PRINT` sheet. The mockups showing six or seven were compressed for drawing width; **the mockup is not authority on the column set**. QTD's meaning is still unknown (§9.1) — carry it, never repurpose it. |
| **OQ-4** | A line received at zero. | **Allow it.** Confirm succeeds, **zero batch rows** are written, Mfg and BB render `—` on screen and blank in the export. `Short` derives to the full `qtySti`. Do not block confirming at 0 — a truck genuinely bringing none of a line is a real receipt, and the whole point of the module is recording what actually arrived. |
| **OQ-5** | "reported" means two different columns. | ⚠ **`truckReportingDate` everywhere it is labelled "reported".** The desktop rail card's `reported 11:04` was wrong — a creation wall-clock. Creation time appears only in the detail pane subtitle, worded "created by {name} {HH:MM}". **Age tags key off `truckReportingDate`** (how long has this truck gone unchecked). `mrnDate` is a **separate** thing: the IST date the MRN was raised. It drives the rail's date stepper and partners `srNo` in the unique key, and **both are immutable after create** — editing `truckReportingDate` later never renumbers anything. In normal operation the two dates are the same day; where they differ, that difference is real information, not a bug. |
| **OQ-6** | Supervisor tab scoping. | **As assumed.** *To check* = all dates, `status='open'`. *Checking* = all dates, `status='checking'`, **every supervisor's**, not scoped to the viewer (mockup S2 deliberately shows one worked by "Ramesh K." beside one marked "you"). *Done* = `status='done'` fenced on **`unloadingEndAt` within today IST** — never `mrnDate`. That is the same "done = the date the work finished" convention already implemented three times (Floor §6c, the Billing Picking tab, the Picking supervisor board). |
| **OQ-7** | Two supervisors both tap Start. | **Start returns 409 unless `status='open'`.** No takeover in v1. There is one `unloadingStartById` and one start timestamp; a silent overwrite would destroy the only record of who opened the truck. |
| **OQ-8** | Delete guard. | **409 unless `status='open'`.** A soft-removed MRN disappears from **both** faces — `isRemoved=false` on every read, with the single deliberate exception of `srNo` and `mrnNumber` allocation, which **must** count removed rows (§7, the challan-sequence trap). |
| **OQ-9** | Best before: always +24 months? | ⚠ **No — it varies by product, so the supervisor types it.** Two more pickers per batch, under the mfg pair. Columns stay NOT NULL and stored. **§6.6 is rewritten**; mockups S7 and S7b updated 20 Aug. Do not reintroduce a 24-month default, not even as a pre-fill. |
| **OQ-10** | The "14 packs" chip on the mobile card. | ⚠ **Dropped.** It had no defined source and told the supervisor nothing he acts on. The card keeps `1,982 nos` = `SUM(qtySti)`. Mockup updated. |
| **OQ-11** | `operations` has no `mrn` grant. | **Grant it — `canView` + `canEdit`, export and delete false.** `operations` holds both `picking` and `floor` and is the account used for mobile testing, so without it MRN cannot be exercised the way every other board is. Same shape as `floor_supervisor`: it can open and record, but the report stays billing's. Applied to live and added to `prisma/seed.ts` in the same step — **all three rows go in the seed together**. |

### Carried forward unchanged

- **`chk_mrn_received_from`** pins `receivedFrom` to `'TPW' | 'CDC'` and
  **`chk_mrn_status`** pins `status` to `'open' | 'checking' | 'done'`. Both are
  invisible to Prisma. A third source depot or a fourth status is **a SQL ALTER
  first**, never a new literal in a route or a new option in the segmented
  control. Same class as `chk_pick_assignments_status`. This belongs in
  `docs/CLAUDE_MRN.md`'s landmine section on day one.
- **`srNo` allocation must count `isRemoved` rows.** Also day-one landmine
  material.
- **`mrn_lines.mrn` is a field whose name equals its own model's name.** Legal
  Prisma. If `generate` objects, rename the **field** to `header`, never the
  model.

---

## 10. Source material

- **`docs/mockups/mrn/MRN-TEMP-SHEET-TPW-2026-08-17.xls`** — the workbook this
  module replaces. Kept in the repo, not deleted. Sheets:
  - `PASTE` — 3 columns (Sr / SKU / Qty as per STI). The shape the paste parser
    must accept.
  - `PRINT` — the real MRN layout. **Row 16 is the authoritative column order
    for the XLS export and the A4 sheet.** Step 10 must OPEN this sheet and copy
    the order from it, not trust any prose description of it — including §4 and
    §8 of this document.
  - `HELPER-1` — a VLOOKUP mirror of PRINT. No build relevance.
  - `MASTER` — a 2,277-row SKU list. **Superseded by `sku_master_v2`. Do not
    import it, do not read it at runtime, do not reconcile against it.** It is a
    frozen copy of a catalog that has moved on.
- `docs/mockups/mrn/01-billing-desktop.html`
- `docs/mockups/mrn/02-supervisor-mobile.html`

---

*web-update-2026-08-20-mrn-module-design · Schema v27.14 · OrbitOMS · 20 August 2026*
