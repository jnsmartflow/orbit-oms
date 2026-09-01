# CLAUDE_MRN.md — MRN, Material Receipt Note
# v1.0 · Schema v27.20 · September 2026 · updated 2026-09-01
# Lives in: orbit-oms/docs/
# Load with: CLAUDE.md (repo root) + docs/CLAUDE_CORE.md + docs/CLAUDE_UI.md

Goods coming IN. A truck arrives from a JSW Dulux depot, billing raises an MRN
from the STI sheet, the floor supervisor counts what physically came off it on
his phone, and billing files the result as the document the depot answers to.
CI (`/ci`) is its mirror image — stock going BACK to a customer.

> **This file was written 2026-09-01 and is the module's first canonical record.**
> Everything before it lived in commit messages, code comments and two draft
> design records. Where those drafts and the code disagree, **the code won** —
> `web-update-2026-08-20-mrn-module-design.md` predates two days of change and
> is a historical record, not a spec.

---

## 1. What it is, and the two faces

One route, `/mrn`, rendering two entirely different screens.

| Face | Who | What |
|---|---|---|
| **Billing desk** | `billing_operator`, `operations`, `admin` | A date-fenced rail of the day's trucks + a working pane: header facts, delivery tabs, the line table, the reports |
| **Supervisor phone** | `floor_supervisor` | Three tabs — To check · Checking · Done — and the line sheet he counts on |

🔴 **THE BRANCH IS ON `primaryRole`, NEVER ON VIEWPORT.** `app/mrn/page.tsx:69`:
`showSupervisorFace = primaryRole === "floor_supervisor"`. There is no `md:`
switch anywhere in this module and none may be added — `/picking` removed its
width switch in July 2026 and MRN never had one. A billing operator on a phone
gets the desk face; a supervisor on a desktop gets the phone face. That is
correct: the face follows the JOB, not the glass.

There is **no `app/mrn/layout.tsx`** and there cannot be one. `RoleLayoutClient`
needs `workflowTabs` / `activeTabKey` / `onTabChange` / `hideBar`, all four owned
by client state inside `MrnShell`; a server layout cannot supply them and would
lock the supervisor to the default Home/Menu/You bar. `/floor` gets away with a
layout only because it is desktop-only and supplies none of the four.

**MRN is standalone.** It touches nothing in the orders/OBD pipeline — no
`orders` row, no `order_status_logs`, no challan. It has no audit table and
needs none: `createdBy`, `unloadingStartBy`, `unloadingEndBy`, `closedBy` and
`removedBy` on the row itself ARE the record.

---

## 2. The status ladder

```
open ──START──► checking ──END──► done ──OTR PUNCH──► closed
 │   (supervisor)         (supervisor)      (billing)
 └─ billing owns the row: header PATCH, lines PUT and delete
    all 409 the moment status ≠ 'open'
```

Live CHECK, verified 2026-09-01:
`chk_mrn_status CHECK (status = ANY (ARRAY['open','checking','done','closed']))`

| Step | Route | Guard | Records |
|---|---|---|---|
| create | `POST /api/mrn/create` | `mrn` canEdit | `createdById` |
| **START** | `POST /api/mrn/[mrnId]/start` | canEdit · 409 unless `open` · 409 if zero lines | `unloadingStartAt/ById` |
| **END** | `POST /api/mrn/[mrnId]/end` | canEdit · 409 unless `checking` · **409 unless every line is checked, counted server-side** | `unloadingEndAt/ById` |
| **CLOSE** | `POST /api/mrn/[mrnId]/close` | **explicit role check** · 409 unless `done` · 400 on blank OTR | `otrNo`, `closedAt`, `closedById` |
| delete | `POST /api/mrn/[mrnId]/delete` | **canDelete** · 409 unless `open` | soft: `isRemoved`, `removedAt/ById` |

🔴 **THE LADDER IS ONE-WAY. THERE IS NO REOPEN AND NO UN-START.** No route
writes the status backwards; `header` PATCH rejects a `status` key outright. A
mistyped OTR is permanent, which is why the close modal says so *before* the
click. Adding a reopen is a real decision about takeover semantics — do not add
one as a side effect of something else.

🔴 **START IS THE SINGLE LOCK.** Nothing extra is written to enforce it: `header`,
`lines` and `delete` each already 409 on `status !== 'open'`, so moving to
`checking` locks all three in one stroke. Design §5 removed a "Send to
supervisor" button precisely so that START is the only lock. **Any new billing
write route must carry the same `status === 'open'` guard** or it will quietly
stay editable while the supervisor is counting.

### 2.1 `closed` is new, and the historical MRNs stay `done`

`closed` was added 2026-09-01 (v27.19). **`done` did not change meaning** — it
still means "the supervisor has finished checking"; `closed` means "billing has
recorded the OTR number and the document is finished".

The MRNs that predate the change were **deliberately not migrated**. They
genuinely never had an OTR number, and marking them closed would be a lie
written into the database. As of 2026-09-01 every live MRN is `done` and none
has ever been closed — see §12.

⚠ `asMrnStatus()` (`lib/mrn/types.ts`) **THROWS** on an unrecognised status and
is called for every board row and every detail read. Widening the DB CHECK
without widening `MrnStatus` takes the rail, the pane and both phone faces down
at once. **Order is always: SQL, then the union, then the gates.**

---

## 3. The OTR close

`POST /api/mrn/[mrnId]/close` — **a new route, not a relaxation of the header
lock**, and that distinction is the design. Widening `header` PATCH to admit a
late `otrNo` would have reopened `truckReportingDate`, `receivedFrom` and
`stiRefNo` on a finished document at the same time.

🔴 **`billing_operator` + `admin` ONLY, BY AN EXPLICIT ROLE CHECK — NOT `canEdit`.**

```ts
const CLOSE_ROLES: string[] = [ROLES.BILLING_OPERATOR, ROLES.ADMIN];
if (!hasRole(session, CLOSE_ROLES)) return 403;
```

The live grants give `mrn` canEdit to **three** roles (§9). `floor_supervisor`
needs it to START and END an unloading, so a canEdit gate would put a Close
button on his phone where he has no OTR number to type into it. `operations` is
excluded for the same reason, on the owner's instruction.

⚠ **NARROWER THAN CI'S EQUIVALENT.** `app/api/ci/[ciId]/close`'s `CLOSE_ROLES`
includes `OPERATIONS`; MRN's does not. Two modules, two deliberate calls — do
not "align" them.

⚠ `hasRole`, not `requireRole` — the latter redirects to an HTML page a `fetch()`
cannot parse.

**The write is a guarded `updateMany`, not a read-then-update:**

```ts
await prisma.mrn.updateMany({
  where: { id: mrnId, status: "done", isRemoved: false },
  data: { otrNo, status: "closed", closedAt: new Date(), closedById },
});
// count === 0  →  409 "closed by someone else a moment ago"
```

Between the status read and the write there is a window, and two tabs or a
double-click both walk through it — the second would overwrite the first
operator's OTR on a document already filed. The status in the `where` makes the
test and the write one statement. Same guard and reasoning as CI's close route.

**Why the OTR field was never used before this.** Every MRN raised before
2026-09-01 carries `otrNo` NULL, while `stiRefNo` and `deliveryNo` were routinely
filled. The reason is structural: the real OTR arrives *after* unloading, which
is exactly when the header locks. The field was offered at create and at
header-edit — both windows close before the number exists.

---

## 4. Photos

### 4.1 Storage

**Bucket `mrn-photos`, PRIVATE, created by hand in the Supabase dashboard.**
SQL cannot create a bucket and no migration pretends to.

🔴 **ITS OWN BUCKET, NOT A PREFIX INSIDE `attendance-photos`.**
`app/api/cron/attendance-purge/route.ts` scans `attendance_records` and calls
`.remove()`; MRN photos under a prefix there would be un-purged today and
delete-able by tomorrow's well-meaning edit to that cron. An MRN is a
supplier-facing document; a selfie is not.

Path scheme `mrn/{mrnId}/{kind}/{uuid}.jpg`. **`mrn_photos.storagePath` stores the
PATH, never a URL** — a stored URL expires and becomes a broken image with no way
back to the object. Signed URLs (300s) are minted per view.

Env is `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`, already configured. There is
deliberately **no** `NEXT_PUBLIC_SUPABASE_*` anon key: `lib/supabase.ts` is
server-only and must never be imported from a client component.

### 4.2 The table

`mrn_photos` — 10 columns. `mrnId` NOT NULL (CASCADE), `lineId` NULL (CASCADE,
see §10), `kind`, `storagePath` (UNIQUE), `bytes` NOT NULL, `widthPx`/`heightPx`
NULLABLE, `capturedById` NOT NULL (RESTRICT), `createdAt`.

Live CHECKs:
- `chk_mrn_photo_kind` — `kind IN ('lr','leaky','damage','other')`
- `chk_mrn_photo_lr_truck_level` — `kind <> 'lr' OR "lineId" IS NULL`

🔴 **`leaky` AND `damage` ARE LEGAL BUT UNUSED BY THE UI, AND THE CHECK MUST NOT
BE NARROWED.** The phone's kind picker was removed 2026-09-01 (it gated the
shutter behind a question the photograph answers); every line photo now stores
`'other'`. A future session will run a DISTINCT over `kind`, find two values and
be tempted to ALTER the CHECK down. Do not — the vocabulary is the design's, not
the current UI's, and re-widening later is a migration where leaving it costs
nothing.

🔴 **`kind` IS NOT NULL AND THAT IS LOAD-BEARING.** A CHECK passes when its
expression is NULL, so a nullable `kind` would make BOTH checks silently accept
a NULL-kind row.

**`bytes` NOT NULL, dimensions NULLABLE** — `bytes` is what size accounting
reads; the dimensions are a thumbnail hint a future non-camera upload path would
have to decode the image to learn.

### 4.3 Capture (the phone)

- **Up to `MAX_PHOTOS_PER_GROUP` = 5 per group.** A group is one `lineId`, or the
  MRN's `'lr'` rows. Defined once in `lib/mrn/photo.ts` and read by both the UI
  and the route — **no literal 5 exists anywhere.**
- 🔴 **The cap is enforced SERVER-SIDE.** The route counts the group immediately
  before writing and 409s. A UI-only cap is not a cap: a stale sheet, a double
  tap, or a second phone on the same truck all walk past it.
- 🔴 **Upload only while `status === 'checking'`.** See §10 — this gate is the
  only thing protecting photos from the paste route's cascade.
- **LR photos** are captured at END unloading, are **OPTIONAL**, and `/end` gets
  **no new guard** for them. Skip is as prominent as the camera. If a photo IS
  taken it uploads *before* `/end`, and a failed upload aborts that END — an MRN
  must never reach `done` believing it holds an LR it does not.
- **Skip and failure read differently on purpose.** Skip is silent and END
  proceeds; a failure keeps the sheet open and says *"…Nothing was finished; the
  truck is still open."*
- **No offline queue, and none can be built.** `public/sw.js` has no fetch
  handler by hard rule, so a photo that did not upload is still only on the
  phone and the UI says exactly that.
- Upload state is **per photo**. A photo that landed stays landed and is never
  re-sent — the route has no idempotency key, so a re-post would duplicate the
  page under a second UUID.

### 4.4 Write order — the compensating delete

`prisma.$transaction` is banned (CORE §3) and could not help anyway: Supabase
Storage is not in the database.

1. upload the object
2. insert the row
3. 🔴 **if 2 throws, DELETE THE OBJECT** before returning the error

Without step 3 the object is unreachable for ever — no row references it, and
there is deliberately no purge cron. **DELETE reverses the order**: row first,
then object. An orphaned object is a cost; an orphaned row is a broken image on
a supplier-facing screen.

**Delete permission splits on status:** during `checking` the capturer may
delete his own (the retake path); once `done`/`closed` it is `canDelete` only.

### 4.5 Billing's view

A **Photos button in the pane's action row**, with a count badge on its top-right
corner — `#f5f3ff` / `#5b21b6`, the notes/remark shade owned by
`components/floor/tint-strip.tsx:30` and documented in `CLAUDE_UI.md §28`. Never
a Tailwind `purple-*`.

🔴 **The control renders NOTHING at zero photos** — no greyed button, no "0". The
thumbnail band that preceded it was removed 2026-09-01: the header must not grow
a second row of pictures.

**The viewer** is `fixed inset-0` over everything (LineDrawer's pattern), with a
big ✕, Esc, arrows, "3 of 7", and Copy / Download / Open / Delete.

- **Copy writes `image/png`, never the fetched JPEG.** Chromium's clipboard
  write list is text/plain, text/html and image/png — `image/jpeg` throws. The
  JPEG is re-encoded through a canvas, and the blob is passed to `ClipboardItem`
  **as a Promise** so Chrome's transient user activation survives the fetch and
  encode (Safari requires that form).
- **Download goes through a blob URL**, because `download` is ignored
  cross-origin and the signed URL is on supabase.co.
- **Plain `<img>` throughout, never `next/image`.** `next.config.mjs` has no
  `images` key, deliberately — do not add `remotePatterns`.

**Loading:** one list call per MRN, no signed URLs. URLs are minted only when the
viewer shows a photo (plus a quiet prefetch of the next). Cached per tab in
`lib/mrn/signed-url.ts`, re-minted a minute before the 300s expiry.

---

## 5. Delivery numbers

🔴 **ON THE LINES SINCE 2026-09-01 (v27.20). ONE STI CAN CARRY SEVERAL.**

`mrn_lines.deliveryNo` — `text NOT NULL`, currently with a temporary
`DEFAULT ''` (see §12). `''` is a real value meaning *no delivery number*, not a
NULL: the column is NOT NULL precisely so the unique index works, because
Postgres treats NULLs as DISTINCT from each other and a nullable column would
silently permit duplicate line numbers on exactly those rows.

**The unique index moved:** `(mrnId, lineNo)` → **`(mrnId, deliveryNo, lineNo)`**
(`mrn_lines_mrnId_deliveryNo_lineNo_key`), plus `mrn_lines_mrnId_deliveryNo_idx`
for the tab grouping.

### 5.1 One paste per delivery

`PUT /api/mrn/[mrnId]/lines` takes `{ deliveryNo, block }` or
`{ deliveryNo, lines }`. `deliveryNo` is **required**, trimmed, 400 on blank.

```ts
await prisma.mrn_lines.deleteMany({ where: { mrnId, deliveryNo } });
```

🔴 **THE SCOPE IN THAT `where` IS THE WHOLE POINT.** It was `{ mrnId }`, so a
second paste for a second delivery deleted the first outright — silently, with
the operator watching half the truck vanish.

⚠ **The row-delete in `lines-table.tsx` is the second, quieter caller** of the
same route and had to be scoped in the same commit. It sends "the lines that
remain"; unscoped, it would have re-created other deliveries' lines under this
delivery's number, with the right row count and the wrong grouping.
**`tsc` cannot see a missing JSON field** — nothing would have reported it.

### 5.2 Each delivery numbers from 1

`lineNo` is the nth line **of its delivery**, not a position on the truck. Two
lines on one MRN can share it. That matches the paper STI sheet the operator
reads from, which is the whole reason for the ruling.

Consequences, all handled:
- **Ordering** is `deliveryNo` ASC then `lineNo` ASC everywhere.
- **The phone shows a RUNNING POSITION**, `detail.lines.indexOf(line) + 1`,
  1..n across the whole MRN — "line 7 of 13". It is display-only: never send it,
  never store it, never pass it where a `lineNo` is expected.
- **Billing gets TABS**, one per distinct delivery number (§8).

### 5.3 `mrn.deliveryNo` is frozen legacy

The header column is **kept and never dropped** — it holds real history for the
MRNs raised before the split, and the step-2 backfill copied each value down
onto its own lines. But it has **no writer**: `create` and `header` PATCH both
stopped writing it on 2026-09-01.

⚠ **Anything still READING `mrn.deliveryNo` is reading a frozen field** that is
NULL on every MRN raised since. The one that mattered was
`reportHeaderFields()` — it feeds both the XLS and the A4 sheet, so a stale read
would have printed a blank delivery number on the document billing hands to a
supplier. `lib/mrn/delivery.ts` is the single owner of "what delivery numbers
does this MRN have", off the lines.

`mrn.otrNo` is the mirror case: kept, and written by exactly one route (§3).

---

## 6. Derived values — never stored

🔴 **Short, Excess, Batch No and Mfg Date have NO COLUMNS and none may be added**
(design §11 OQ-2). If a card, a table, an XLS writer and a print sheet each
recomputed them, the four could disagree about one truck.

`lib/mrn/derive.ts` is the single owner. It is PURE — the phone validates a line
with the same function the write route validates it with, so the two can never
disagree about whether a line is confirmable.

| Value | Rule |
|---|---|
| `shortQty` | `max(0, qtySti − physicalQty)`, **0 on an unchecked line** |
| `excessQty` | `max(0, physicalQty − qtySti)`, 0 on unchecked |
| `hasIssue` | checked AND (short OR excess OR any **non-SND** condition count) |

⚠ **SND is excluded from `hasIssue` on purpose.** It is the SOUND count — on a
clean line `sndQty === physicalQty`, so folding it in would flag every healthy
line. It is still a real column with a real total; `reportTotals()` sums it while
`MrnIssueSummary` deliberately has no `totalSnd` field, because folding a
sound-count into a type named *issue* would make that name a lie.

### 6.1 Batch No and Mfg Date — two filler days, both deliberate

```
formatBatchNo("TPW", 8, 2026)  →  "T20260801"     prefix + YYYY + MM + 01
formatMfgDate(8, 2026)         →  "15.08.2026"    15 + . + MM + . + YYYY
```

Both are rendered from the **same two integers** on `mrn_line_batches`
(`mfgMonth`, `mfgYear`). **No day is stored anywhere** and none is wanted.

🔴 **THE DAY IS 01 IN ONE AND 15 IN THE OTHER, AND THAT IS OWNER-SPECIFIED, NOT
DRIFT.** A future session will see two hardcoded days in one file and unify
them. Do not:

- **`formatBatchNo` → 01.** It is an IDENTIFIER handed to a supplier. The first
  of the month is the conventional stand-in for "this month's batch", and the
  string has to be stable and comparable, not plausible.
- **`formatMfgDate` → 15.** It is a DISPLAYED DATE a reader parses as a date.
  Mid-month is never wrong by more than a fortnight, whereas the 1st reads as a
  precise claim about the first day that nobody made.

⚠ Batch No was `prefix + MM + YYYY` ("T082026") until 2026-08-31. Anything still
writing that in a comment or fixture is stale.

⚠ `mrn_line_batches.batchNo` **IS NOT** the Batch No string. That column is an
INT ordinal (1, 2, …) backing `UNIQUE(lineId, batchNo)` and driving the report's
6a/6b labels. The two are unrelated.

### 6.2 Cartons

`cartonQty` **is** stored, and is DERIVED AT PASTE from the catalog — never
typed. `pack === "4L" && piecesPerCarton > 0 → floor(qtySti / piecesPerCarton)`,
else null. **4L only**, owner's ruling: larger packs arrive loose. It is a
SNAPSHOT so a truck received in August does not restate itself when the catalog
changes in November.

---

## 7. Lines, batches and the paste

**`lib/mrn/paste.ts`** parses the STI block: `Sr no · SKU · Qty`, tab or comma
separated, header row skipped, Sr no optional. **Nothing throws** — every problem
comes back as a per-row error so the preview can say "34 matched, 2 could not be
read".

**The client parses for the PREVIEW; the server parses for the SAVE**, both
calling the same pure function. The modal sends the RAW BLOCK, so a browser that
somehow parsed differently still cannot write a different answer.

⚠ **An unmatched SKU is NORMAL and never blocks.** Roughly 27% of distinct active
SAP codes resolve in neither catalog table (CORE §7.1.c). Those lines are saved
with the bare code, fully checkable, rendering "Not in catalog · UNKNOWN SKU".
A row that could not be PARSED is different and does block the whole paste.

⚠ **`lib/mrn/resolve-lines.ts` matches on `sku_master_v2.material` and NOTHING
ELSE** — never a row id. `sku_master` and `sku_master_v2` assign completely
different ids to the same material code (CORE §13, the id-space landmine), so
following an id would render a confidently WRONG product name on a live
goods-receipt sheet. A blank reads as "unknown" and stops the operator; a wrong
name reads as fact and gets signed.

**Batches** (`mrn_line_batches`): usually one per line; a line occasionally
splits across manufacturing months. `validateBatches()` enforces
`SUM(batch.qty) === physicalQty` — the DB cannot, since no CHECK spans a parent
and its children. **`physicalQty === 0` is valid and takes ZERO batch rows.**

🔴 **`bestBeforeMonth`/`Year` ARE RETIRED** (2026-08-22, v27.17). Not collected,
not displayed, NULL on every row since. Two earlier designs are recorded in
`prisma/schema.prisma` so neither is revived: it was TYPED per batch, and before
that DERIVED as manufacturing + 24 months. **Do not add a 24-month helper in any
direction.**

---

## 8. The three outputs

They differ on purpose, and the difference is not drift.

| | XLS export | A4 sheet | Desktop table |
|---|---|---|---|
| Columns | **19** | **17** (widths sum to exactly 100) | **2 sets, chosen by status** |
| Mfg | Month + Year + Date of Manufacturing + Batch No — **all four** | Mfg Date + Batch No only | Batch No alone |
| Split line | 6a/6b sub-rows | 6a/6b sub-rows | ONE row + a `+N` badge; batches in the drawer |
| Scope | the whole TRUCK | the whole TRUCK | the SELECTED delivery |

**Why:** a spreadsheet is sorted and filtered, and two integers do that where
two strings do not. A4 landscape has no width to say the same thing three times.
The screen has a drawer to put the split in.

`lib/mrn/report.ts` owns the shape shared by all three — `buildRenderRows()` is
the single sub-row rule, and getting it wrong in one place silently doubles a
total. **`Qty STI` and the eight condition columns ride the FIRST sub-row only**;
only Physical, Mfg and the two derived strings vary down a split line.

⚠ **`lib/mrn/workbook.ts` is SPLIT FROM report.ts and must stay split.**
`report.ts` is imported by a CLIENT component, and `xlsx` is a ~900KB CommonJS
bundle webpack cannot tree-shake out — merging them would ship the whole
spreadsheet library to every billing operator's browser, silently.

⚠ **The column order came from the workbook's `PRINT` sheet, ROW 17** — every
prose source in this repo says row 16 and they are all off by one (the used
range starts at A4). Verified by reading the cells. Do not "correct" 17 back.

### 8.1 The desktop table

**TWO** column sets across the four statuses, chosen by an **exhaustive
`switch` with a `never` default**:

- `BILLING_COLUMNS` (5) — `open` + `checking`: # · SKU · Description · Pack · Qty STI
- `DONE_COLUMNS` (8) — `done` + `closed`: + Physical · Batch No · chevron

⚠ Two sets, four statuses, three render arms (`OpenTable` is editable,
`CheckingTable` is the same columns greyed and locked, `DoneTable` is the wide
one). Do not conflate the three counts.

The eight condition columns and Ctn left the screen entirely on 2026-08-26 —
they live in the line drawer and in both reports. Nothing was dropped from the
DATA; sixteen numbers on a row competed with the two that matter.

🔴 **THE `never` DEFAULT IS THE GUARD, NOT DECORATION.** This was an if/else
chain ending in `return <OpenTable>` as a catch-all, and the moment a fourth
status existed `closed` fell through to the **editable** table — offering a
delete button on a signed document. A fifth status must be a compile error here.

**Delivery tabs** sit ABOVE that machinery and replace the "Line items" heading.
They scope the **detail**, not the arms: `scopeToDelivery()` hands the switch a
narrower `MrnDetail`, so every count, total and filter downstream becomes
per-delivery with no change at any call site.

⚠ **The TOTAL row follows the TAB but not the All/Issues filter.** A delivery is
the SUBJECT (billing is reading one paper sheet); All/Issues is a VIEW of it, and
a total that moved when you hid clean rows would be a different number wearing
the same label.

⚠ **A single-delivery MRN still shows its tab** — the delivery number replaces
the heading, so every MRN reads the same way.

---

## 9. Permissions

**No page key of its own beyond `mrn`.** Live grants, SELECT-verified 2026-09-01
(seed is not live — always check):

| Role | canView | canEdit | canExport | canDelete |
|---|---|---|---|---|
| `billing_operator` | ✓ | ✓ | ✓ | ✓ |
| `floor_supervisor` | ✓ | ✓ | ✗ | ✗ |
| `operations` | ✓ | ✓ | ✓ | ✗ |

`admin` holds no `role_permissions` rows and is short-circuited to all-true.

| Action | Requires |
|---|---|
| Create, paste, start, end, confirm a line, capture a photo | `canEdit` |
| View, open a photo | `canView` |
| Print / Download XLS | `canExport` — billing's alone (§11 OQ-11) |
| Delete the MRN; delete a photo after `done` | `canDelete` |
| **Punch the OTR and close** | 🔴 **`billing_operator` or `admin`, explicit role check — NOT `canEdit`** |

⚠ **HIDDEN vs DISABLED** (UI §10) is load-bearing in this module. HIDDEN = "not
yours", a ROLE thing. DISABLED = "not yet", a STATE thing. `operations` holds
canEdit but canDelete FALSE, and once saw a Delete button that returned
"Forbidden" — the route was right, offering the button was the bug.

---

## 10. Landmines

- 🔴 **IDENTIFIER CASE-FOLDING IN DDL.** Postgres folds every UNQUOTED identifier
  to lower case. On 2026-09-01 four constraint names in
  `sql-2026-08-31-mrn-photos-otr.sql` were written unquoted, came out
  lower-cased, and had to be renamed by hand.
  **An unquoted-but-NAMED constraint is strictly worse than an unnamed one:**
  Postgres auto-generates a name from the stored COLUMN name, so an unnamed FK
  comes out correctly cased. `mrn."closedById"`'s inline FK — never named —
  landed as `mrn_closedById_fkey`, correct, while the three that WERE named
  folded. **Quote it, or omit it. Never name it unquoted.**

- 🔴 **`mrn_photos.lineId` IS ON DELETE CASCADE, AND ONLY THE OPEN-ONLY PASTE
  GATE PROTECTS THE PHOTOS.** `lines` PUT does `deleteMany` + `createMany`, which
  would take every attached photo with it. It cannot today: that route 409s
  unless `open`, photos exist only from `checking`, and the ladder is one-way.
  **If a reopen, un-start or admin override is ever added, that deleteMany
  becomes a silent photo shredder** — change the FK to SET NULL in the same
  commit.

- 🔴 **`captureFromVideo()` TAKES 0–100, NOT 0–1.** `lib/attendance/photo.ts`
  divides by 100, so passing `JPEG_QUALITY` (0.8) encodes at quality **0.008** —
  a near-black image that compresses tiny, uploads cleanly, passes every server
  check and is caught only by a human looking at it. Pass
  `JPEG_QUALITY_PERCENT` (80). **No test can fail on this.**

- 🔴 **THE `download` ATTRIBUTE IS IGNORED CROSS-ORIGIN.** Signed URLs live on
  supabase.co, so `<a download="name" href={signedUrl}>` navigates to the image
  and throws the filename away. Fetch the blob and use a `blob:` URL.
  `detail-pane.tsx`'s XLS link works only because that route is same-origin.

- 🔴 **THE CLIPBOARD TAKES PNG, NOT JPEG.** `image/jpeg` throws "not supported on
  write" in Chromium. Re-encode through a canvas, and pass the blob to
  `ClipboardItem` **as a Promise** or the user-activation window expires mid-fetch
  on a slow connection.

- 🔴 **THREE COPIES OF THE BOARD TAB PILL, AND `CLAUDE_UI.md` DOCUMENTS NONE OF
  THEM.** `components/floor/floor-page.tsx` `tabPill` → `components/billing/billing-tab-bar.tsx`
  `pill` → `components/mrn/lines-table.tsx` `DeliveryTabs`. Each names the
  others; the obligation is on STYLE. **MRN's has no count chip and that is not
  drift** — Floor and Billing count work outstanding (a decision), MRN names
  which paper sheet is on screen (not one). CLAUDE_UI's only "tab strip" entry
  is the place-order variant strip, a different thing.

- 🔴 **`tsc` CANNOT SEE A MISSING JSON FIELD.** When the paste route was scoped to
  one delivery, the compiler caught the `createMany` omission — but both callers
  were still sending the wrong body and it went green. A scoped route with an
  unscoped caller is a data-loss bug no type check will report.

- ⚠ **THE ALLOCATORS DELIBERATELY COUNT SOFT-REMOVED ROWS.** `lib/mrn/number.ts`
  does NOT filter `isRemoved` — a deleted MRN keeps its row and the UNIQUE
  indexes still hold against it. Filtering would hand the next truck a number a
  deleted row owns and throw P2002 on a screen where the operator did nothing
  wrong. Everywhere ELSE in this module every read filters `isRemoved: false`.
  Same class as the challan sequence rule (CORE §13).

- ⚠ **THE MARKER MUST USE THE EXPORTED WHERE BUILDERS.** `/api/mrn/marker` calls
  the same `buildMrnSupervisorWhere()` the board does. A marker watching a
  NARROWER set than the board silently misses updates on the floor (the Picking
  §10 / Floor §10 landmine). Never re-type the predicate.

- ⚠ **ONE window-level Escape owner.** `modal-shell.tsx` binds Escape whenever an
  MRN modal is mounted. `line-drawer.tsx` declined to add a second; the photo
  viewer DOES own one, guarded branch by branch, and its delete confirm is
  deliberately **not** a ModalShell so it registers nothing. Two listeners fire
  in registration order and one surface closes under the other
  (CLAUDE_FLOOR.md §4.6).

- ⚠ **NEVER `router.refresh()` ON THE PHONE FACE.** A history pop discards a
  pending refresh (CORE §3). Every refresh in `MrnShell` is a client fetch +
  setState. Picking's picker face shipped this bug twice.

- ⚠ **`@page mrn-sheet` LIVES TOP-LEVEL IN `globals.css`**, never nested inside
  `@media print`, and the print isolation uses `visibility`, never
  `display: none` (CORE §3, UI §32).

---

## 11. Key files index

| File | Role |
|---|---|
| `app/mrn/page.tsx` | `/mrn` entry. Role branch (`primaryRole === "floor_supervisor"`), permission resolve, `canClose` |
| `app/mrn/[mrnId]/sheet/page.tsx` | A4 print route. 409-equivalent unless `done`/`closed` |
| `components/mrn/mrn-shell.tsx` | Both shells in one file; `MrnPerms`; the marker poll; the one refetch path |
| `components/mrn/billing-board.tsx` | Desk face: rail + pane + every modal |
| `components/mrn/detail-pane.tsx` | Header block (title · action row · facts), Photos button, the lines table |
| `components/mrn/lines-table.tsx` | Three column sets, the exhaustive status switch, delivery tabs, TOTAL row |
| `components/mrn/line-drawer.tsx` | Billing's per-line panel — condition counts, batches |
| `components/mrn/supervisor-board.tsx` | Phone face: three tabs, START/END, the line band |
| `components/mrn/line-list.tsx` / `line-sheet.tsx` | The supervisor's list and the sheet he counts on |
| `components/mrn/photo-capture.tsx` | Camera, review, staging strip, per-photo upload |
| `components/mrn/photos-button.tsx` / `photo-lightbox.tsx` | Billing's entry point and full-screen viewer |
| `components/mrn/print-sheet.tsx` | The A4 document (17 columns, widths sum to 100) |
| `lib/mrn/types.ts` | Wire shapes; `MrnStatus`; `asMrnStatus()` which THROWS |
| `lib/mrn/derive.ts` | Short/Excess/hasIssue, `formatBatchNo`, `formatMfgDate`, both validators |
| `lib/mrn/delivery.ts` | The one owner of "what delivery numbers does this MRN have" |
| `lib/mrn/photo.ts` | Bucket, size budget, kinds, path builder, `MAX_PHOTOS_PER_GROUP` |
| `lib/mrn/signed-url.ts` | Client-side signed-URL cache; re-mint before expiry |
| `lib/mrn/queries.ts` | Every read feed + the exported WHERE builders. SELECT only |
| `lib/mrn/report.ts` | Shared report shape: `buildRenderRows`, `reportTotals`, header fields, filename |
| `lib/mrn/workbook.ts` | The XLS writer. **Server-only — kept split from report.ts** |
| `lib/mrn/number.ts` | `mrnNumber` + `srNo` allocation. Counts soft-removed rows |
| `lib/mrn/paste.ts` / `resolve-lines.ts` | STI parsing; catalog resolve on `material` |
| `app/api/mrn/[mrnId]/close/route.ts` | The OTR punch. Explicit role check, guarded updateMany |
| `app/api/mrn/[mrnId]/lines/route.ts` | The paste. **Scoped delete — read §5 before touching** |
| `app/api/mrn/[mrnId]/photo/route.ts` | Upload + the server-side cap + the compensating delete |
| `app/api/mrn/photo/[photoId]/route.ts` | Signed URL (GET) and delete (DELETE) |
| `lib/supabase.ts` | `getSupabaseAdmin()` — **server-only, service-role key** |
| `prisma/schema.prisma` | `mrn` / `mrn_lines` / `mrn_line_batches` / `mrn_photos` headers carry the column-level rules |
| `docs/prompts/drafts/sql-2026-08-31-mrn-photos-otr.sql` | Photos + `closed` DDL, as run |
| `docs/prompts/drafts/sql-2026-09-01-mrn-delivery-split.sql` | Delivery split DDL. **Part 4 still commented — see §12** |

---

## 12. Open items and live state

**Live state, SELECT-verified 2026-09-01:** 11 MRNs, all `done`, 369 lines, 370
batches, **0 photos, 0 closed, every MRN single-delivery.** The test rows that
exercised the multi-delivery, photo and close paths were deleted during
development.

⚠ **So none of the 2026-09-01 work has live data behind it yet.** The code is
deployed and typechecks; the paths have been exercised by hand and then cleaned
up. Treat any claim about how they behave at scale as untested.

| Item | State |
|---|---|
| **`mrn_lines.deliveryNo` still has `DEFAULT ''`** | 🔴 **The one piece of unfinished work.** Part 4 of `sql-2026-09-01-mrn-delivery-split.sql` is commented out and drops it. Run that single ALTER **alone** — re-running the file would flatten real per-line delivery numbers back to the legacy header value. Until it runs, the route's 400 is the only guard against a caller filing lines under `''` |
| **LR photo is optional, with no override** | Owner ruling, reversed from "mandatory" the same day. `/end` has no LR guard and must not grow one. The billing photo button makes an absent LR visible — that IS the enforcement |
| **No retention cron, by decision** | Reversed from "90 days". Build no `mrn-photo-purge`, and do NOT widen `attendance-purge` to see this bucket. Storage grows without bound; revisit when it is large enough to notice |
| **The tab pill exists in three copies** | Extracting a shared component is a three-caller refactor (Floor, Billing v2, MRN) and has not been done. `CLAUDE_UI.md` documents none of them |
| **"N SKUs not in catalog" roll-up removed** | 2026-09-01, with the summary line. The PER-ROW "Not in catalog · UNKNOWN SKU" tag is untouched and names which code is missing |
| **Unattributed write paths** | `header` PATCH and `lines` PUT record no actor (CORE §13, census D). ⚠ The photo DELETE also records nobody — it hard-deletes the row — and postdates that census |
| **QTD's meaning is unknown** | Carried through schema, UI and report because the source workbook has it (design §4). Do not repurpose it |
| **The condition columns are barely used** | Across the MRNs recorded before 2026-09-01, the six condition counts were filled on a handful of lines and `Short`/`Excess` were zero on every line ever recorded. Worth knowing before reading anything into a quiet photo panel |

---

*MRN v1.0 · Schema v27.20 · OrbitOMS · updated 2026-09-01 — first canonical record; supersedes the 2026-08-20 design draft wherever the code disagrees*
