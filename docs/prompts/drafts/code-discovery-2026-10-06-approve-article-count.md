# Code discovery — Article count on Approve (2026-10-06)

Diagnosis only. No code written, nothing committed.
Canon read: CLAUDE.md (router v1.14), CLAUDE_CORE.md v130 (Schema v27.57), CLAUDE_UI.md v5.37,
CLAUDE_PICKING.md v1.19 (Schema v27.24), CLAUDE_FLOOR.md v1.9 (Schema v27.24). Where docs and code
disagree, the code wins and it is called out below.

**Feature.** On the supervisor's Approve (Done tab → Needs check → tick screen → Approve), a popup
asks for the **article count**, the number the supervisor has written on the drum or carton. Saving
it approves the bill the same way Approve does today. Floor then shows the number for checked
(`pick_checked`) bills.

---

## 1. How Approve works today

**Client:** `components/picking/picking-board-mobile.tsx:3040-3071`, `handleApprove(row)`.
- It is guarded by `approving`. It POSTs `/api/picking/approve` with the body `{ orderId: row.orderId }` (`:3045-3049`) and nothing else.
- On a 409 it shows the toast "Already changed — refreshed." and then calls `refetchQueue({ ids: [orderId] })`.
- On success it shows a toast, then calls `window.history.back()` unconditionally (`:3063`). That fires the popstate handler (`:2482-2527`), which reaches `closeDetail()`. After that it calls `refetchQueue({ ids })`.
- The CTA is at `:5092-5116`. It renders only when `detailRow.isDone`. It is disabled until `allLinesResolved`.

**Route:** `app/api/picking/approve/route.ts`. It runs these steps in order, with sequential awaits:
1. Auth, then the `picking` / `canEdit` check (`:25-29`). `checkedById` comes from the session (`:32`).
2. Parses the body as `{ orderId?: number }` (`:37`). Returns 400 if `orderId` is not an integer.
3. Reads `orders.findFirst` → `{ id, workflowStage }` (`:44`). Returns 409 unless the stage is `pick_done` (`:56`). This is the double-tap guard.
4. **Write 1:** `pick_assignments.update({ where: { orderId }, data: { checkedAt, checkedById } })` (`:66-69`).
5. **Write 2:** `orders.update({ data: { workflowStage: PICK_CHECKED } })` (`:73-76`). This is the **only `orders.update`**. If it fails, the catch rolls write 1 back to `checkedAt: null, checkedById: null` (`:79-81`) and returns 500.
6. **Write 3:** `order_status_logs.create` with fromStage `pick_done` → toStage `pick_checked` (`:88-96`).

There is **no `prisma.$transaction`**: confirmed by reading the file. There is also no push, and no `pick_findings` write.

---

## 2. Where the count should live

### (a) A new column on `pick_assignments`, next to `checkedAt`/`checkedById`

Every path that touches the row:

| Path | What happens to the row | File |
|---|---|---|
| Unassign (supervisor/Floor panel, Floor Release of a held `pick_assigned` bill) | **deleted**, but only reachable at `pick_assigned`, so a count does not exist yet | `lib/picking/unassign.ts:59` |
| Picking cancel | **deleted**. Only `PICKING_CANCELLABLE_STAGES` = pending_picking / pick_assigned / **pick_done** (`lib/workflow-stages.ts:272-276`), so a checked bill cannot be cancelled here | `app/api/picking/cancel/route.ts:229` |
| Floor cancel | **deleted** (`clearAssignment`, any stage including `pick_checked`) | `lib/floor/bill-actions.ts:274`, `:367-369` |
| Floor raise-CI | **deleted** | `lib/floor/raise-ci.ts:273` |
| Billing pick-delete | **deleted** | `lib/billing/pick-delete.ts:748` |
| Billing telephonic apply | **deleted** | `lib/billing/telephonic-apply.ts:429` |
| Direct-load (from `pick_assigned`) | **deleted** | `app/api/picking/direct-load/route.ts:128` |
| Restore (Floor) | does not touch the row. The row was already deleted by the cancel; a re-pick creates a **new** row with a null count | `bill-actions.ts` restore arm |
| Reassign | Floor allows it only when `!isDone && !isChecked` (`components/floor/detail-panel.tsx:451`), so it never happens on a counted bill |
| Dispatch (`markBillsDispatched`) | does not touch the row, so the count survives into History | `lib/floor/dispatch.ts` |
| Approve rollback | **must also null the new column** in the catch at `:79-81` | approve route |

**Lifecycle is free.** Every path that ends a pick deletes the count with it. No path can leave a
stale count on a live bill.

### (b) A new column on `orders`

- **Nothing deletes it.** Each of the six cancel and delete paths above would need an explicit `articleCount: null` added to its own `orders.update` to avoid a stale count. That is six edits, and missing one means a restored and re-picked bill carries the old number.
- **The upside:** it is the only home that works for a **Direct-Loaded** bill. Those sit at `pick_checked` with **no `pick_assignments` row** (`lib/picking/types.ts:181-188`; `direct-load/route.ts:116`). If the floor ever wants a count on Direct Loading, only (b) can hold it.

### Live-sync marker, for both options

Approve already does exactly one `orders.update` (write 2). `orders.updatedAt` is `@updatedAt`
(`prisma/schema.prisma`, `model orders`), so the marker moves.
- **Under (a)** the count rides in write 1's existing `data`.
- **Under (b)** it rides in write 2's existing `data`.

Either way there are **zero new writes**, and no second `orders.update` is needed or allowed
(PICKING §10.1 landmine).

**Change-feed path:** `pick_assignments` has statement-level `trg_live_changes_pick_assignments_upd`
with no column list (`sql/2026-09-30-live-changes-step4.sql:384-386`), so a new column needs no
trigger change.

### Docs vs code

- **CORE §7.4 is wrong about column naming.** It says `pick_assignments` "uses `@map` snake_case on every column". The code shows `clearedAt DateTime? @db.Timestamptz` with **no `@map`** (`prisma/schema.prisma:1771`), so the table is already mixed. A new column should follow the `clearedAt` precedent (camelCase, no `@map`, CORE §3).
- **The CHECK constraint is not in play.** The new column is a number, not a `status` value, so `chk_pick_assignments_status` is unaffected.

---

## 3. Server-side validation

**Yes, the route should validate the count.** The route is the authority. A client gate alone can
be bypassed by a cached PWA bundle or a direct POST.

Proposed rule:
- `articleCount` is **required**.
- It must satisfy `typeof === "number" && Number.isInteger && 1 <= n <= 999`.
- Otherwise return **400** "Article count is required (1–999)."

Why these bounds:
- **Floor of 1:** a bill always has at least one article.
- **Cap of 999:** the largest live `articleTag` measured in the Floor recut (2026-09-10) was "168 D · 35 C · 11 T", which is 214 articles. 999 is ample and still stops a fat-finger like 2000.

The check should run **before** write 1, beside the `orderId` check (`:39-42`). A DB CHECK should
mirror it: `"articleCount" IS NULL OR "articleCount" BETWEEN 1 AND 999`.

**Existing data:**
- All approved bills, every Direct-Loaded bill, and every history row will be **NULL**. Every reader must render NULL as "—" or nothing, never 0.
- **Deploy note:** a phone still running the old bundle will get a 400 on Approve until it reloads. The 400 toast is shown verbatim (`:3055`), so the supervisor sees why.

---

## 4. The popup

**Do not reuse `FindingPopup`.** `components/picking/finding-recorder.tsx` is typed on a
`PickingDetailLine` target with qty/reason/mfg state. Its header (`:36-39`) and PICKING §11.4 both
say it must **never learn** whether Approve is enabled. A fourth `mode` would change its target type,
its fields and its route. That is a fork in all but name.

**Build its own small popup instead**, e.g. `ArticleCountPopup`, and copy the §11.4 **pattern**, not
the component:
- always mounted, toggled by opacity and scale (never `{open && …}`)
- `fixed inset-0 z-[65]`
- carries `NO_BILL_SWIPE_ATTR`, so a drag does not page to the next bill
- numeric input with `inputMode="numeric"`, no prefill (same reasoning as confirm mode: a number he did not type must not save)
- Save is disabled until the value is valid

**Flow:** the Approve CTA opens the popup (with no network call). Save calls
`handleApprove(row, count)`.

### Popstate: one new branch is needed, and one ordering landmine

1. **New branch.** Add `countOpen` to `navStateRef` (`:1802-1807`, synced at `:2473-2480`). Add a close-and-re-push branch in `onPop`, the same shape as `findingOpen` (`:2493-2497`).
   - Without it, Android back while the popup is up reaches `closeDetail()`.
   - The popup's state then stays `true`, and it reappears over the next bill opened.
2. **Ordering landmine on success.** `handleApprove` calls `history.back()` unconditionally (`:3063`).
   - If `countOpen` is still `true` in `navStateRef` when the popstate fires, the new branch closes the popup and **re-pushes**, so the detail screen stays open.
   - `navStateRef` is synced in a `useEffect`, so `setCountOpen(false)` alone is not guaranteed to land before the pop.
   - **Fix:** clear the popup and set `navStateRef.current.countOpen = false` synchronously **before** `history.back()`.
   - The popup never pushes its own history entry, so the single "detail" entry and depth stay intact.
   - On a 409 or another error, keep the popup open (or close it without touching history). Do not call back.

**Pause:** the popup opens only over the detail screen, and `detailOpen` already pauses the marker
and the feed (PICKING §10.1 pause table). No `overlayBusy` change is needed.

---

## 5. Floor display

**How the data reaches the row today:**
- `getFloorBoard`'s include selects `pickAssignment: { pickerId, assignedAt, pickedAt, checkedAt, checkedBy.name, picker.name, assignedBy.name }` (`lib/floor/queries.ts:674-684`).
- The mapping sets `checkedAt` and `checkedByName` (`:1047-1048`).
- `FloorBoardRow extends PickingQueueRow` (`lib/floor/types.ts:116`), which declares `checkedAt` and `checkedByName` (`lib/picking/types.ts:180-181`).
- **So, yes:** `checkedAt` is already selected.

**The smallest change, under (a):**
1. Add `articleCount: true` to that select (`queries.ts:679`).
2. Add `articleCount: order.pickAssignment?.articleCount ?? null` to the mapping (`:1047`).
3. Declare `articleCount: number | null`.

**Where to declare the field (step 3):**
- **On `FloorBoardRow`** (FLOOR §1: "widen the Floor type, never the Picking one"), if only Floor shows it.
- **On `PickingQueueRow`**, if the Done tab will show it too. In that case `lib/picking/queue.ts:623-631` and `:961` gain it as well. TypeScript enforces both builders once the field is required.

The live-feed patch path (`lib/floor/rows.ts`) reuses the same include and mapping, so it comes for
free.

### Option A: a new column

- **For:** it is its own fact, sortable later, and nothing to misread.
- **Against:** the table was **recut on 2026-09-10 because nine or ten positions did not fit** (`floor-table.tsx:471-546`).
  - A new column means a fifth width set in **four arms**, each re-summed to 100. The colgroup, the `<th>` and the `<td>` must all change in step; this exact class of bug hit Route in `e656ad80`.
  - The column is empty for every non-checked row, which is most of the live board.

### Option B: a second line in the Article cell, checked rows only

- Line 1 stays `formatArticleTag` (SAP's plan, "18 D · 14 C").
- Line 2 is the supervisor's count, e.g. "Count 32", stacked like the Vol/KG cell.
- **For:** no width change, and the planned number sits beside the physical count, which is exactly where a planner compares them.
- **Against:** two different sources in one cell, so line 2 must be visibly labelled. It needs `rowStatus(row) === "done"` (or `articleCount != null`) to gate it; per the `floor-table.tsx:801-822` warning, do not test `isChecked`, which is true for dispatched bills.
  - Showing it on dispatched History rows too is arguably right.
- Do **not** touch `HoldTable` (FLOOR §4.10, shared with Freight Trips). The board table does not share code with it.

---

## 6. Other surfaces that might want it (listed only, not planned)

- **Billing Picking tab:** `app/api/billing/picking/list/route.ts:146`, `:299` (already selects `pickAssignment.checkedAt`); `components/billing/billing-picking-tab.tsx:830`.
- **Billing Print data:** `lib/billing/print.ts:213`, `:333`.
- **Supervisor Done tab, Checked band card:** `picking-board-mobile.tsx:1936`.
- **Picker's Done tab:** `lib/picking/picker-split.ts:128`; `components/picking/picker-my-picks-board.tsx`.
- **Floor detail panel:** `lib/floor/order-detail.ts:44` (select), `:224`; `components/floor/detail-panel.tsx`.
- **Trip desk / trip sheet** (Floor trips, `components/floor/trip-desk.tsx:552`), and anything that prints a loading list.

---

## 7. `isChecked` consumers (PICKING §7 standing grep rule)

`articleCount` is an **additive data field, not a stage or a boolean**. It changes no
`isAssigned`/`isDone`/`isChecked` value, so no consumer below changes behaviour. They are listed
because the rule binds.

**Picking:**
- `lib/picking/queue.ts:958`, `:1020`
- `lib/picking/live-merge.ts:70`. `sameRow` (`:96`) is a generic JSON comparison, so a new field is compared automatically and a changed count correctly shows "This bill changed elsewhere".
- `lib/picking/picker-split.ts:126`, `:128`
- `lib/picking/types.ts:170`
- `lib/workflow-stages.ts:307-309`
- `components/picking/picking-board-mobile.tsx:1917`, `:1936`, `:4997`, `:5020`, `:5076`. The `:4723-4846` hits are a local line-tick `isChecked`, unrelated.
- `components/picking/picking-mobile-shell.tsx:938`

**Floor:**
- `lib/floor/queries.ts:1040`, `:1193`
- `lib/floor/filter.ts:87-88`
- `lib/floor/selection.ts:43-44`
- `lib/floor/order-detail.ts:220`
- `lib/floor/types.ts:685`
- `components/floor/status-pill.tsx:140-141`
- `components/floor/detail-panel.tsx:91`, `:134`, `:144`, `:451`
- `components/floor/floor-table.tsx:801-822`, a comment that warns against `isChecked`
- `components/floor/trip-desk.tsx:552`
- `components/floor/trip-redelivery-info.tsx:40`

**Others:**
- `lib/billing/print.ts:300`
- `components/tint/manager/board-hold-tab.tsx:47`
- The MRN hits (`app/api/mrn/**`, `lib/mrn/**`, `components/mrn/**`) are MRN's own line `isChecked`, unrelated.

---

## Read-only SQL (single paste)

```sql
-- READ-ONLY. pick_assignments columns, its CHECK constraints, pick_checked counts.
SELECT 1 AS sec, ordinal_position AS ord, 'column'::text AS kind,
       column_name::text AS name,
       (data_type || ' / ' || udt_name)::text AS detail,
       ('nullable=' || is_nullable || ' default=' || coalesce(column_default, '∅'))::text AS extra
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'pick_assignments'
UNION ALL
SELECT 2, 0, 'check'::text, c.conname::text, c.contype::text, pg_get_constraintdef(c.oid)::text
FROM pg_constraint c
WHERE c.conrelid = 'public.pick_assignments'::regclass AND c.contype = 'c'
UNION ALL
SELECT 3, 1, 'count'::text, 'pick_checked_open_total'::text, count(*)::text, 'isRemoved=false'::text
FROM orders WHERE "workflowStage" = 'pick_checked' AND "isRemoved" = false
UNION ALL
SELECT 3, 2, 'count'::text, 'pick_checked_approved_today_ist'::text, count(*)::text, 'via pick_assignments.checked_at'::text
FROM orders o JOIN pick_assignments pa ON pa.order_id = o.id
WHERE o."workflowStage" = 'pick_checked' AND o."isRemoved" = false
  AND (pa.checked_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date
UNION ALL
SELECT 3, 3, 'count'::text, 'pick_checked_direct_loaded_today_ist'::text, count(*)::text, 'no pick_assignments row'::text
FROM orders
WHERE "workflowStage" = 'pick_checked' AND "isRemoved" = false
  AND ("directLoadedAt" AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date
ORDER BY sec, ord, name;
```

---

## Recommendation

**Store it as `"articleCount" integer NULL` on `pick_assignments`.**
- Use camelCase with no `@map`, following the `clearedAt` precedent rather than CORE §7.4's outdated "every column is snake_case".
- Add `CHECK ("articleCount" IS NULL OR "articleCount" BETWEEN 1 AND 999)`.

**Write it inside Approve's existing first `pick_assignments.update`.** Null it in the existing
rollback. Make it required and range-checked in the route. That adds no write and no second
`orders.update`, and every cancel or delete path discards it with the row, so there is nothing to
clean up.

**On Floor, show it as a labelled second line in the Article cell for finished rows only.** That
puts it under SAP's planned tag, with no change to the four-arm width matrix that was recut on
2026-09-10. Carry it through `getFloorBoard`'s existing `pickAssignment` select and declare it on
`FloorBoardRow`, unless the Done tab will show it too.

**One open product question:** Direct-Loaded bills have no assignment row, so this design gives
them no count. If the floor needs one there, that decision moves storage to `orders`.

**The popup** is its own small always-mounted sheet, not `FindingPopup`. It needs a `countOpen`
popstate branch, and it must clear `navStateRef` synchronously before Approve's `history.back()`.
