# code-update-2026-08-31-floor-invoice-column

**Classification:** `code-update-*` — SHIPPED. Merge as current reality.
**Commit:** `697b193b` on `main`, pushed to origin 2026-08-31. Verified by `git diff --cached --stat` before commit and `git log` after.
**Target canonical file:** `CLAUDE_FLOOR.md` (owner of the floor table). Two small corrections also land in `CLAUDE_CORE.md` and the repo-root router.

---

## 1. What shipped

The `/floor` table gained an **INVOICE column** — SAP's `orders.invoiceNo` on line 1, `orders.invoiceDate` underneath, shaped like the OBD cell.

**Position: immediately after OBD, before Ship to.** Owner call made on the live screen (2026-08-31) after seeing a first cut that placed it before Status. Reason recorded in code: the OBD number and the invoice number are the two reference numbers the operator scans together — reading one off the board to find the other is the whole job.

**Blank when blank.** No em dash, no placeholder, no spinner — deliberately unlike Route / Picker / Article above it, which print `—` for a value that *should* be there. A missing invoice is not a gap in the data: SAP stamps invoices in its own sub-hourly batches, so a bill still being picked simply has none yet. A dash would be a different and wrong claim, and would mark nearly every row of a busy morning's board.

The two lines guard **independently** (`row.invoiceNo &&` and `row.invoiceDate &&`, not one combined test) because `?action=patch-headers` fills the two with separate fill-if-null tests, so one can in principle arrive without the other.

### Files changed (5)

| File | Change |
|---|---|
| `lib/floor/types.ts` | `FloorBoardRow` gains `invoiceNo: string \| null` + `invoiceDate: string \| null` (ISO) |
| `lib/floor/queries.ts` | `getFloorBoard()` row builder maps both; `FLOOR_BOARD_INCLUDE` untouched |
| `lib/floor/format.ts` | NEW `formatDateIST(iso)` — en-GB, `Asia/Kolkata`, `""` on null |
| `components/floor/floor-table.tsx` | The column: one condition, four width arrays, header cell, body cell |
| `components/floor/detail-details.tsx` | Private `fmtDate` deleted, imports the shared `formatDateIST`. Behaviour identical |

**Zero cost at the database.** `getFloorBoard` uses `include`, not `select`, so both scalars were already on the fetched row and were simply being discarded. No extra query, no extra await, no write, no predicate term, no marker change, no schema edit.

---

## 2. The one condition + the four width arrays

`showInvoice` is derived **once** inside `FloorTable` and read by the colgroup, the header cell and the body cell. Three separate `!showSlot` tests would be three things that can drift, and the widths map **positionally** — a header that grew a column the colgroup did not would silently shunt every column right (the bug class `floor-table.tsx:184-186` already records).

```
const showInvoice = !showSlot;
```

| Arm | Columns | Widths | Sum |
|---|---|---|---|
| `interactive && showInvoice` | ☐ · # · OBD · **INV** · Ship · Route · Vol · Article · Picker · Status | `[4,4,13,10,20,9,6,10,8,16]` | 100 |
| `interactive && showSlot` | ☐ · # · OBD · Ship · Route · Slot · Vol · Article · Status | `[4,4,14,20,10,9,7,12,20]` *(unchanged)* | 100 |
| `read-only && showInvoice` | OBD · **INV** · Ship · Route · Vol · Article · Picker · Status | `[14,10,24,11,6,11,8,16]` | 100 |
| `read-only && showSlot` | OBD · Ship · Route · Slot · Vol · Article · Status | `[16,24,12,9,7,13,19]` *(unchanged)* | 100 |

Donors: OBD 14→13, Route 10→9, Vol 7→6, Article 12→10, Picker 9→8, **Status 20→16**. **Ship to was not shrunk in any arm** (held at 20 / 24) — it carries the longest strings on the board.

⚠ It falls out that Invoice is present exactly when Picker is. **That is a consequence, not the rule.** If a future column ever splits the two, give Invoice its own flag rather than reusing `!showSlot` again.

### Owner decision — no Invoice column on the By-group (showSlot) arms

Those views are waiting-only, and a waiting bill has no invoice by construction. Live check the same day: **0 of the 4 still-open rows** carried an invoice, against **65 of the 70** at `pick_checked`. A permanently blank 10% on the view with the least room to spare was not worth positional consistency.

---

## 3. Live data behind the design (measured 2026-08-31, re-SELECT before reusing)

Run against the board's own predicate — the script imported `getFloorLiveMarkerWhere()` rather than re-typing the WHERE, so it could not drift from what `/floor` renders.

| Metric | Value |
|---|---|
| Rows on the live floor board | 74 |
| …with `invoiceNo` | 65 |
| …with `invoiceDate` | 65 |
| At `pick_checked` | 70 (65 invoiced) |
| At `pending_picking` / `pick_assigned` | 3 / 1 — **0 invoiced** |
| Whole table: rows with `invoiceNo` | 6,962 of 12,529 |
| `invoiceNo` length | **exactly 10, every single row** — `I` + 9 digits. Not "up to 10" |
| `invoiceDate` non-midnight values | **0** — every value is `00:00:00` UTC, so IST renders the same calendar day |

**The operational read, worth stating plainly in canon:** the column is empty for the work in progress and full for the work already finished. It is a look-up aid for done bills, not a live-status column — do not position it as "watch the invoice arrive".

---

## 4. `formatDateIST` — one formatter, two surfaces

The date-only IST formatter lived as a private `fmtDate` inside `detail-details.tsx`. It moved **verbatim** (same options, same `""` on null) to `lib/floor/format.ts` so the table cell and the detail panel's "Invoice date" can never render the same value two different ways.

`lib/floor/format.ts` was the right home — its own header says "no React, no browser API, no DB… deliberately NOT a `use client` file", and `floor-table.tsx` already imported `formatArticleTag` from it.

⚠ **ISO strings only.** Every date on the `/floor` payloads is serialised with `.toISOString()`, so the offset is always present and `new Date(iso)` is safe. Never hand it an offset-less string — those are read in the *host's* timezone (CORE §3), which on a depot phone in IST is 5.5 hours from the server's answer.

---

## 5. Live sync — confirmed unchanged, checked at the write path not assumed

1. `GET /api/floor/marker` aggregates `{ _count, _max: { updatedAt } }` over `getFloorLiveMarkerWhere()`. It watches row membership and `MAX(orders.updatedAt)` — nothing field-specific. A new payload field cannot affect it.
2. The SAP invoice stamp is `?action=patch-headers` in `app/api/import/obd/route.ts` — fill-if-null, folded into the file's **single existing** `orders.update`.
3. `orders.updatedAt` is `@updatedAt`, backed by `orders_updatedAt_idx`. So the stamp bumps `updatedAt`, `MAX(updatedAt)` moves, and the 15s probe refetches on its own.

Two caveats, neither needing a change:

- **A bill that has already left the live set does not come back.** `floorLiveBaseWhere`'s second arm admits `pick_checked` only while `checkedAt` is inside today's IST range. A bill checked yesterday and invoiced today is not on the live board — its invoice appears only in History and the detail panel. So "the invoice fills in while you watch" is true **only for bills checked today.**
- Live sync pauses when the detail panel is open, a selection is up, in History, or the tab is hidden (FLOOR §5) — the invoice can land a poll or two late. Cosmetic.

🔴 **Do not add any write to make this feel more immediate.** A second `orders.update` in any floor path fires a false "changed" on every board (FLOOR §10 / CORE §3).

---

## 6. New landmines for `CLAUDE_FLOOR.md §10`

- **`showInvoice = !showSlot` is a coincidence of the current column set**, not a rule. Splitting Picker and Invoice needs its own flag.
- **The Invoice `<td>` is NOT the first cell**, even on a read-only table — the OBD cell still is. The duplicate-SO left bar (`barStyle`) rides "whichever cell is FIRST" and must stay on OBD. This became a live trap the moment Invoice landed adjacent to the bar-carrying cell.
- **Status is now the tightest cell on the row at 16%** — the pill plus the two 23px hover buttons is roughly 162px of content against roughly 166px available. Passed the depot-monitor eyeball on 2026-08-31; if a future column takes anything more from Status, that hand-check must be repeated.
- **`invoiceDate` is `timestamptz` live but carries no `@db.Timestamptz(6)` in `schema.prisma`** — pre-existing drift (the column predates that discipline; `pickEarlyReleasedAt` and `invoicedAt` both carry it). Reads fine today. Deliberately NOT repaired as a side effect of a display change; schema edits go through the Supabase SQL Editor.
- **`orders.invoiceNo` / `invoiceDate` are SAP facts. `orders.invoicedAt` is Billing's own "I marked this done" decision.** Different things, adjacent names.

---

## 7. Doc corrections found this session — fix while merging

1. 🔴 **`CLAUDE_FLOOR.md` header stamps Schema v27.13 while `CLAUDE_CORE.md` is at v27.18** — five stamps behind. Nothing in this task touched the columns minted in v27.14–v27.18, so it was safe to proceed, but the stamp must be reconciled in whichever session next edits FLOOR. **Check the footer too** — a version footer can drift out of step with its own header.
2. 🔴 **The fixed-table standard is `CLAUDE_UI.md` §27, not §40.** `CLAUDE_CORE.md §3` and the repo-root router BOTH cite §40, and both are wrong — §40 in UI v5.18 is "OT prompt screens". A wrong claim usually sits in more than one file: grep every canonical file for `§40` before calling this fixed.
3. **The prompt rule "`git diff HEAD --stat` must be empty before pushing" cannot be satisfied in this repo.** Nine tracked files have been dirty since before this session (`.claude/settings.local.json`, two `app/api/sampling-library/*`, `components/tint/operator/flat-suggestion-list.tsx`, `docs/CLAUDE_IMPORT V1.md`, three `docs/plans/*.xlsx`, `docs/runbooks/reconciliation-method.md`). The rule's intent — *the tree that tsc and the build validated is exactly what got committed* — is met by scoping the check: **`git diff HEAD --stat -- <the files just committed>`**. Update the rule's wording wherever it is recorded.

---

## 8. Canonical file edits this draft implies

| File | Section | Edit |
|---|---|---|
| `CLAUDE_FLOOR.md` | header + footer | bump schema stamp to CORE's current; both ends |
| `CLAUDE_FLOOR.md` | §2 (the screen) | the floor table's column list gains INVOICE after OBD |
| `CLAUDE_FLOOR.md` | §3 (feeds) | note `invoiceNo`/`invoiceDate` ride `FLOOR_BOARD_INCLUDE` free; the 2026-08-31 counts |
| `CLAUDE_FLOOR.md` | §10 (landmines) | the five entries in §6 above |
| `CLAUDE_FLOOR.md` | §11 (key files) | `lib/floor/format.ts` row gains `formatDateIST` |
| `CLAUDE_CORE.md` | §3 | `CLAUDE_UI.md §40` → `§27`; scope the `git diff HEAD` rule |
| `CLAUDE.md` (router) | — | same `§40` → `§27` correction |

---

## 9. Deferred — NOT built, tracked for ROADMAP

- **Hold and Cancelled tabs do not have the column.** They render their own tables (`hold-tab.tsx:62`, `cancelled-tab.tsx:93`) with their own width arrays over their own row types (`FloorHoldRow` / `FloorCancelledRow`). Their feeds also use `include`, so the data is equally free — but the types and widths are separate work. Owner has not asked for it.
- **The two read-only scratch scripts** `scripts/_chk-invoice-floor-20260831.ts` and `scripts/_chk-invoice-coltype-20260831.ts` are left untracked on the depot PC. Underscore-prefixed, so outside the `tsc` gate. Kept per the no-deletions rule.

---

*Draft written 2026-08-31 · records commit `697b193b` · target: `CLAUDE_FLOOR.md`*
