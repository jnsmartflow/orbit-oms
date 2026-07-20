# Picking board redesign — discovery (2026-07-20)

## A. DATE FILTER

**A1.** `orders.dispatchTargetDate` — `lib/picking/queue.ts:145` (`dispatchTargetDate: dateOnly`, inside the `findMany` WHERE). It is an **equality** match on a single day, not a range.

**A2.** Default is **today in IST**, never unbounded. `resolveTargetDate(undefined)` → `getISTTodayDate()` at `lib/picking/queue.ts:47-49` / `:17-25`. The route turns an empty/whitespace `?date=` into `undefined` (`app/api/picking/queue/route.ts:28`), which falls through to the same today path.

**A3.** It **is** the support-set dispatch date. `dispatchTargetDate` was added in schema v27.7 as "chosen dispatch day (date-only; window carries the time)" — `docs/CLAUDE_CORE.md §7.3`. Not `obdDate`, not `createdAt`, not a slot field. The query also pins `dispatchStatus: "dispatch"` (`queue.ts:144`), so only Support-released bills are in scope at all.

## B. DISPATCH DATE

**B4.** `orders.dispatchTargetDate  DateTime? @db.Date` — `prisma/schema.prisma:648`. Postgres type `date` (no time-of-day), **nullable**.

**B5.** Yes — nothing constrains it to today or the past. It is a plain nullable `date` with no CHECK constraint and no application-side clamp anywhere in the picking path. **Caveat, stated honestly:** no schema comment or code comment positively *documents* future-dating as intended behaviour — the evidence is permissive-by-absence (type allows it, `queue.ts` filters by exact equality so a future date simply never surfaces today), plus the Support module owning the write. Worth one live `SELECT DISTINCT dispatchTargetDate` before the build to confirm future rows actually exist in production.

**B6.** Separate columns, adjacent in schema:
- DATE → `dispatchTargetDate DateTime? @db.Date` (`schema.prisma:648`)
- WINDOW/slot → `dispatchWindowId Int?` FK → `dispatch_slot_master` (`schema.prisma:649-650`), which carries `windowTime` ("10:30"/"12:30") + `sortOrder` (`CLAUDE_CORE.md §7.4`). `dispatchWindow` is the Prisma relation, not an extra column.

**B7.** It is a **date** (`@db.Date`), surfaced by Prisma as a JS `Date` anchored at **UTC midnight**. So the zone split is `dispatchTargetDate: { lte: todayUtcMidnight }` vs `{ gt: todayUtcMidnight }`, where `todayUtcMidnight` must be built with the existing `Date.UTC(y, m-1, d)`-after-IST-shift helper (`queue.ts:17-25`) — never `new Date(dateStr)` (explicitly warned against at `queue.ts:29-44`), never a string comparison.

## C. TAB BUCKETING

**C8.** Not by `workflowStage` in the component — by the three strict-per-stage booleans computed once in `lib/picking/queue.ts:218-220` (`isAssigned === PICK_ASSIGNED`, `isDone === PICK_DONE`, `isChecked === PICK_CHECKED`). The component filters those:

| Tab | Row set | Test | Render gate |
|---|---|---|---|
| Assign | `waitingRows` | `!r.isAssigned && !r.isDone && !r.isChecked` — `picking-board-mobile.tsx:586-589` | `:1374` |
| Check → Still picking | `assignedRows` → `filteredStillPicking` | `r.isAssigned` — `:590-593`, filtered `:693-700` | `:1465` |
| Check → Needs check | `doneRows` → `filteredNeedsCheck` | `r.isDone` — `:599-602`, filtered `:702-709` | `:1465` |
| Done (key `"checked"`) | `checkedRows` → `filteredChecked` | `r.isChecked` — `:604-607`, filtered `:718-730` | `:1526` |

**C9.** A `pick_done` row renders in the **Check tab's "Needs check" band**: `doneRows = data.rows.filter(r => r.isDone)` (`picking-board-mobile.tsx:599-602`) → `filteredNeedsCheck` (`:702-709`) → rendered inside the `activeTab === "check"` block (`:1465`). That is the single condition to move.

**C10.** Computed **server-side** in `app/picking/page.tsx:109-110`: `pending = myRows.filter(r => !r.isDone && !r.isChecked)`, `done = myRows.filter(r => r.isDone || r.isChecked)`, both scoped by `pickerId` FK (`:101`). **Yes, date-scoped** — `getPickingQueue()` is called with no argument (`:100`), so the picker board is hard-wired to today only, with no date param anywhere in that path.

## D. BADGE COUNTS

**D11.** Two independent count layers:

*Server* (`lib/picking/queue.ts:235-249`):
```ts
count: sortedRows.filter(r => r.windowId === w.id && !r.isAssigned).length   // :239
const assignedCount = sortedRows.filter(r => r.isAssigned).length            // :242
totalCount: sortedRows.length - assignedCount                                // :249
```
*Mobile bottom-bar tabs* (`components/picking/picking-mobile-shell.tsx:152-159`):
```ts
waitingCount  = rows.filter(r => !r.isAssigned && !r.isDone && !r.isChecked).length
assignedCount = rows.filter(r => r.isAssigned).length
doneCount     = rows.filter(r => r.isDone).length
checkedCount  = rows.filter(r => r.isChecked).length
tabs: Assign=waitingCount · Check=assignedCount+doneCount · Done=checkedCount
```

**D12.** **§7 confirmed against live code.** Neither server formula excludes `isDone` or `isChecked` — `queue.ts:239` guards only `!r.isAssigned`, and `:249` subtracts only `assignedCount`. Important scoping correction: this over-count reaches **desktop only** (`picking-queue.tsx:608` window segments, `:613` "All" segment, `:715` "OBDs" stat). The **mobile bottom-bar counts are already correctly cut** (shell `:152-155`) and do not consume `windows[]`/`totalCount` at all.

## E. BLAST RADIUS

**E13.** Four live consumers (plus one dormant reference):

| Consumer | How it gets rows | (a) Widening date scope | (b) Moving `pick_done` → Done tab |
|---|---|---|---|
| `app/api/picking/queue/route.ts:31` | calls `getPickingQueue(dateParam)` | **Affected** — the only place a widened contract can be expressed; `dateParam` semantics change | Not affected |
| `components/picking/picking-queue.tsx:496` (desktop) | `fetch(/api/picking/queue?date=${selectedDate})`, date stepper at `:464` | **Affected — highest risk.** Desktop's whole model is one-day-at-a-time; its window segments (`:608`) and `totalCount` (`:613`, `:715`) assume a single-date slice | Low — desktop already excludes `isDone`/`isChecked` from `unassignedRows` (`:298`), `availableRoutes` (`:638`), `selectableIdsInTab` (`:651`); a `pick_done` row has no desktop home today |
| `components/picking/picking-mobile-shell.tsx:104` (supervisor) | same endpoint, `selectedDate` frozen at `getTodayIST()` (`:95`) | **Affected — primary target.** Owns the fetch + the tab counts | **Affected** — `workflowTabs` at `:158` must stop folding `doneCount` into Check |
| `components/picking/picking-board-mobile.tsx` (via `usePickingBoard()` `:415`) | context, no own fetch | **Affected** — needs the locked-zone split of `waitingRows` (`:586`) | **Affected** — `doneRows`/`filteredNeedsCheck` move out of the `activeTab === "check"` block (`:1465`) into the new tab; `DetailListKey` (`:54`) and `activeDetailList` (`:821-828`) must follow, or swipe-paging pages the wrong list |
| `app/picking/page.tsx:100` (picker face) | direct server `getPickingQueue()`, no date arg | **Affected if the default changes** — currently relies on "no arg = today" | **Affected in spirit** — picker `done` deliberately includes `isDone \|\| isChecked` (`:110`); it must NOT inherit the supervisor's new tab cut |
| `lib/picking/validate-assign.ts:8` | dormant, comment-only | No | No |

**E14. Confirmed — no new `pick_assignments.status` value is needed.** The redesign is pure re-bucketing: the zone split is a comparison on an existing column (`dispatchTargetDate`), and the Done tab shows the already-live `pick_done` stage (`lib/workflow-stages.ts`, rank 80). Nothing in the design writes a new status string, so `chk_pick_assignments_status` (`'assigned'`/`'picked'` only) is untouched. **Nothing found to the contrary.** Standing caution from `CLAUDE_PICKING.md §7`: if a future iteration wants to persist "locked/unlocked" on the assignment row, that becomes a SQL ALTER first — model it as timestamp columns instead, the way `checkedAt`/`checkedById` were.

---

### Biggest risk for the build

1. **The date filter is a shared equality clause, not a per-board setting** (`queue.ts:145`) — widening it in place silently breaks desktop's date stepper and its per-window/"All" counts, which are built on a single-date slice. The widening must be an explicit new parameter/mode, not an edit to the existing WHERE.
2. **`dispatchTargetDate` is NULLABLE, and today's equality filter silently drops every NULL row.** The moment it becomes a range comparison, NULLs must be given an explicit home (locked zone? excluded?) or they will either vanish differently or flood in unannounced.
3. **The badge re-cut collides with the known §7 over-count.** `windows[].count` and `totalCount` (`queue.ts:239`, `:249`) still ignore `isDone`/`isChecked`; re-cutting badges while that stands means shipping two different "how many are queued" answers on desktop and mobile. Fix both in the same pass, as §7 already prescribes.
