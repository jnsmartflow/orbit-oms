> SUPERSEDED IN PART, 2026-07-27. This was a PRE-MOVE
> snapshot and is written in the present tense; the
> move has since happened (commits bc42a948 →
> 62a2928c). Its central warning — that
> app/(support)/support/layout.tsx gated the
> Customers / SKUs / Routes / Vehicles pages on
> support_queue, so revoking that permission would
> darken four unrelated pages — is RESOLVED, not
> pending: those four pages were archived with the
> board in f1166f94 and the support-role href
> overrides it cites at lib/permissions.ts:55-59 were
> removed in the same commit. The role now falls
> through to the live /admin/* equivalents. Its own
> §9 self-correction (the tint slot pre-set was not a
> gap) stands. Everything else stands as written.

# Support cut-loose — pre-move safety check
# 2026-07-27 · read-only

Every claim below was read in the code. Nothing was moved, created, edited or deleted;
no SQL was run; no commit was made.

---

## 1. Verdict

**Safe to move as planned — 3 surprises, none blocking.**
The slot picker and `formatArticleTag` are genuinely self-contained: they can move with import-path
edits only. The biggest surprise is **not** in the four moves — it is that `app/(support)/support/layout.tsx:25-28`
gates the Customers / SKUs / Routes / Vehicles pages on the **`support_queue`** permission. Revoke
that permission when the board retires and those four unrelated pages go dark too.
Second surprise: Floor's ship-to save can only **set** a redirect, never clear one — so the new route
needs less than Support's does. Third: my earlier report was **wrong** to call the tint slot pre-set
a gap — Floor already covers it (§9).

---

## 2. Slot picker — move assessment

File: `components/support/dispatch-slot-picker.tsx` (365 lines, read in full).

**Every import it makes** (`:3-5`):

| Import | Resolves to | Inside `components/support/**`? |
|---|---|---|
| `React, { useState, useRef, useEffect, useCallback, useMemo }` | `react` (npm package) | outside |
| `{ createPortal }` | `react-dom` (npm package) | outside |
| `{ getTodayIST }` | `lib/dates.ts:10` | outside |

**That is the complete list — three imports, none of them from Support.**

**API calls it makes itself:** none. There is no `fetch` anywhere in the file. It receives its
window list as a prop (`windows: DispatchWindow[]`, `:24`) and reports the operator's pick back
through `onChange` (`:23`). ["Prop" = a value handed in by whichever screen renders it.]

**Everything it exports, and who imports each name:**

| Exported name | `:line` | Support files importing it | Floor files importing it |
|---|---|---|---|
| `DispatchWindow` (a type) | `:9` | `support-page-content.tsx:12`, `support-orders-table.tsx:13`, `support-hold-table.tsx:11` | `rail-card.tsx:22`, `hold-bar.tsx:16`, `detail-panel.tsx:22`, `assign-bar.tsx:22`, `floor-rail.tsx:12`, `hold-tab.tsx:27`, `floor-page.tsx:31` |
| `DispatchSlotValue` (a type) | `:15` | `support-orders-table.tsx:13`, `support-hold-table.tsx:11` | `hold-bar.tsx:16`, `detail-panel.tsx:22` |
| `DispatchSlotPicker` (the component) | `:66` | `support-orders-table.tsx:12`, `support-hold-table.tsx:10` | `rail-card.tsx:22`, `hold-bar.tsx:16`, `detail-panel.tsx:22`, `assign-bar.tsx:22` |

**Does it import anything from `components/support/shared/table-cells.tsx`?** **No.** The two files
never reference each other.

### Answer

**YES — it can move to `components/floor/` with only the import path changed at the 7 Floor call
sites.** Nothing else has to move with it. It depends on `lib/dates.ts` (which stays put) and on
React itself. It is a pure display control: no database, no network, no Support knowledge.

Two small notes for whoever does the move:
- It carries a behaviour-neutral marker `data-slot-popover="open"` (`:236`) that Floor's Escape-key
  handler looks for (`components/floor/floor-page.tsx:442`). Keep the attribute.
- The three Support files that import it (`support-orders-table.tsx`, `support-hold-table.tsx`,
  `support-page-content.tsx`) are **all** being archived with the board, so they need no fix-up —
  they leave together.

---

## 3. `formatArticleTag` — move assessment

File: `components/support/shared/table-cells.tsx` (154 lines, read in full).

**Every symbol it exports, and who imports it:**

| Exported name | `:line` | Support files | Floor files | Other modules |
|---|---|---|---|---|
| `SUPPORT_GRID_COLUMNS` | `:14` | `support-orders-table.tsx:24` | — | — |
| `SUPPORT_HOLD_GRID_COLUMNS` | `:21` | `support-hold-table.tsx:14` | — | — |
| `ARTICLE_WORD_ABBR` | `:29` | *(none — used only inside this file, at `:39`)* | — | — |
| `formatArticleTag` | `:31` | `support-orders-table.tsx:24`, `support-hold-table.tsx:15` | **`floor-table.tsx:22`** | — |
| `GroupBy` (type) | `:49` | `support-orders-table.tsx:25`, `support-hold-table.tsx:21` | — | — |
| `OrderGroup` (type) | `:51` | `support-orders-table.tsx:25`, `support-hold-table.tsx:21` | — | — |
| `getSmuGroup` | `:56` | *(none — used only inside this file, at `:65`)* | — | — |
| `groupOrders` | `:60` | `support-orders-table.tsx:24`, `support-hold-table.tsx:19` | — | — |
| `getPriLabel` | `:74` | `support-orders-table.tsx:24`, `support-hold-table.tsx:16`, `support-page-content.tsx:9` | — | — |
| `VolCell` | `:84` | `support-orders-table.tsx:24`, `support-hold-table.tsx:17` | — | — |
| `CustomerCell` | `:108` | `support-orders-table.tsx:24`, `support-hold-table.tsx:18` | — | — |

**The full body of `formatArticleTag` (`:29-43`), verbatim:**

```ts
export const ARTICLE_WORD_ABBR: Record<string, string> = { Drum: "D", Carton: "C", Tin: "T", Bag: "B" };

export function formatArticleTag(raw: string): string {
  const groups = raw.split(",").map((g) => g.trim()).filter((g) => g.length > 0);
  if (groups.length === 0) return raw;
  const parts: string[] = [];
  for (const g of groups) {
    const m = g.match(/^(\d+)\s+(\S.*)$/);
    if (!m) return raw;
    const [, num, word] = m;
    const short = ARTICLE_WORD_ABBR[word];
    parts.push(short ? `${num} ${short}` : `${num} ${word}`);
  }
  return parts.join(" · ");
}
```

**What it needs to work:** exactly one thing — the constant `ARTICLE_WORD_ABBR` (`:29`), which sits
immediately above it in the same file. No React, no types from elsewhere, no other function, no
import of any kind. It is plain string handling. [It turns `"16 Drum, 14 Carton"` into `"16 D · 14 C"`.]

### Answers

**Can it be lifted into a new `lib/floor/format.ts` as a self-contained function — YES or NO?**
**YES.** Copy the function **and** the `ARTICLE_WORD_ABBR` constant above it — 15 lines total, zero
imports. Note that the file it currently lives in is a `"use client"` file (`:1`); the new
`lib/floor/format.ts` needs **no** such directive, because the function touches no browser API.

**Does any module OTHER than Support and Floor import anything from this file?**
**No.** Only three Support files and one Floor file (`components/floor/floor-table.tsx:22`) import
from it. Two other files mention it in a **code comment** only, with no import:
`components/picking/picking-board-mobile.tsx:361` and `components/support/support-hold-table.tsx:24`.
Once `formatArticleTag` moves to `lib/floor/format.ts`, this file becomes 100% Support-internal and
can be archived wholesale with the board.

---

## 4. Ship-to save — minimum write list for the new route

File read in full: `app/api/support/orders/[id]/route.ts` (256 lines).

### Every branch of the handler

**`GET` (`:13-119`)** — returns one order with customer, splits, tint assignments, the last 10 audit
log rows, and its line items resolved against the SKU catalog. Its own source comment (`:89-90`) says
"This endpoint has no known UI caller today" — I confirmed that: nothing in the repo fetches it.
**Not needed by Floor** (Floor has its own detail route, `app/api/floor/order/[orderId]/route.ts`).

**`PATCH` (`:131-256`)** — one handler, four independent optional fields. Each has its own
"only if it actually changed" guard, so sending a field that already holds that value writes nothing:

| Field | Triggered by | `:line` |
|---|---|---|
| `dispatchStatus` | any caller sending it | `:178-187` |
| `shipToOverrideCustomerId` | **the only one Floor uses** | `:189-199` |
| `priorityLevel` | accepted, but no caller anywhere in the repo | `:201-210` |
| `dispatchSlot` | accepted, but no caller anywhere in the repo | `:212-221` |

If nothing changed, it returns early at `:223-225` **without writing at all**.

### The ship-to branch only — every write and side effect

1. `orders.shipToOverrideCustomerId` = the new id, or `null` to clear (`:190`).
2. `orders.shipToOverride` = `true` when an id is set, `false` when cleared (`:191`) — the old
   yes/no flag, kept in step with the id so the two can never disagree.
3. **One** row inserted into `order_status_logs` (`:192-198` build it, `:231` writes it):
   `fromStage` = the previous id as text or `null`, `toStage` = the new id as text or the word
   `"cleared"`, `changedById` = the signed-in user, `note` = whatever `note` was sent (Floor sends
   none, so `null`).
4. **No** `dispatch_change_queue` row. That side effect (`:235-246`) fires **only** when
   `dispatchStatus === "hold"` is sent — Floor never sends it.
5. **No** email, no notification, no second order write.

### What is inside the `prisma.$transaction`, and is the order load-bearing?

`:228-253` wraps three things: (a) the audit log inserts, (b) the conditional
`dispatch_change_queue` insert, (c) the single `orders.update`. **The order is not load-bearing** for
the ship-to case: the log row does not read anything the update writes, and there is exactly one
`orders.update`. A sequential-await rewrite is a straight swap. [`$transaction` = all-or-nothing
batch; the house rule `CLAUDE_CORE.md §3` forbids it because it times out on this hosting setup.]

### What the route returns on success

`:255` → `NextResponse.json({ order: updatedOrder })` — the whole updated order row. On the
"nothing changed" path, `:224` → `NextResponse.json({ order })`. Status 200 in both cases.

### What Floor actually sends and reads

**Send** — `components/floor/floor-page.tsx:372`:
```
PATCH /api/support/orders/{orderId}      body: { shipToOverrideCustomerId: customerId }
```
`postJson` (`floor-page.tsx:63-75`) sets `Content-Type: application/json` and nothing else.

**Read** — `reportWrite` (`floor-page.tsx:82-94`) looks at only three things: the HTTP status
(`res.ok`), a top-level `error` string, and a `failed[]` array. It **ignores** the returned `order`
object entirely. So the new route can return anything 2xx that has no `error` and no non-empty
`failed[]`.

**Does Floor send any field other than ship-to?** **No.** That one call sends exactly one key.
And the type it is wired through (`components/floor/detail-panel.tsx:104`) declares
`onChangeShipTo: (orderId: number, customerId: number)` — **`number`, not `number | null`**. The
picker only ever calls it with a real id (`detail-panel.tsx:621`). **Floor cannot clear a ship-to
redirect today; it can only set one.**

### Minimum write list for the new thin Floor route

To be behaviour-identical for Floor's use, the new route must:

1. **Gate on `checkAnyPermission(roles, "floor", "canEdit")`** — matching every other Floor write
   route (`app/api/floor/actions/route.ts:50-52`), returning 401 without a session and 403 without
   the permission.
2. **Load the order first** and read its current `shipToOverrideCustomerId`.
3. **Skip everything if the value is unchanged** — return 200 and write nothing. This is not
   cosmetic: Floor's live-refresh watches `MAX(orders.updatedAt)`, so a pointless write makes every
   open board think something changed (`CLAUDE_FLOOR.md §5`, `§10`).
4. **Exactly ONE `orders.update`**, setting **two** columns: `shipToOverrideCustomerId` and the
   legacy `shipToOverride` boolean (`true` when an id is given).
5. **Exactly ONE `order_status_logs` insert**, same shape as today: `fromStage` = old id as text or
   `null`, `toStage` = new id as text, `changedById` = the signed-in user id.
6. **Sequential awaits, no `prisma.$transaction`.**
7. **Return 200 with a JSON body containing neither `error` nor a non-empty `failed[]`.**
   Return a non-2xx with `{ error: "…" }` on failure so `reportWrite` surfaces it.
8. **Do NOT carry over:** the `dispatch_change_queue` insert, the `priorityLevel` branch, the
   `dispatchSlot` branch, the `dispatchStatus` branch, or the `GET` handler.
9. Decide explicitly whether to accept `null` (clear the redirect). Floor's current UI never sends
   it; accepting it costs nothing and leaves room for a future ✕ button.

One validation gap worth carrying over knowingly: the current route does **not** check that the
customer id exists — it relies on the database's own foreign key to reject a bad one (`:189-199`,
no lookup). A bad id therefore surfaces as a 500, not a clean 400.

---

## 5. Ship-to search — what to copy

File: `app/api/support/ship-to-search/route.ts` (31 lines, read in full).

- **Auth gate** (`:10`): `requireRole(session, [ROLES.SUPPORT, ROLES.ADMIN, ROLES.OPERATIONS])` —
  a plain role list. The Floor copy should instead use
  `checkAnyPermission(roles, "floor", "canView")`, matching `app/api/floor/board/route.ts:22`.
- **Short-circuit** (`:13-16`): fewer than 2 characters typed → returns an empty list `[]` without
  touching the database.
- **Query** (`:18-26`): `delivery_point_master` where the customer name **contains** the search text,
  case-insensitive, and `isActive: true`; sorted by name A→Z.
- **Take limit** (`:24`): **8** rows.
- **Response shape** (`:28-30`): a bare JSON **array**, not an object —
  `[{ id, customerName, area }]`, where `area` is the area's name or `null`.
- **Caller's expectation matches exactly** — `components/floor/detail-panel.tsx:582-583` reads the
  response as an array of `{ id, customerName, area }` (`detail-panel.tsx:94-98`), and does its own
  250 ms typing delay and 2-character minimum client-side (`:571-580`).

It is a 31-line read-only endpoint with no Support-specific logic. Copy it verbatim, change the
auth gate, and add `export const dynamic = "force-dynamic"` (already present at `:6`).

---

## 6. Support folder tree — what is board-only vs shared

**BOARD-ONLY** = goes away with the board. **SHARED** = something else needs it.
**UNRELATED** = has nothing to do with the board.

### `app/(support)/**`

| File | Verdict |
|---|---|
| `app/(support)/layout.tsx` | **SHARED** — a 4-line pass-through that just renders its children (`:3`). Adds nothing; wraps everything below. |
| `app/(support)/support/layout.tsx` | **SHARED — and the trap.** Builds the sidebar and gates access on `checkAnyPermission(roles, "support_queue", "canView")`, else redirect to `/unauthorized` (`:25-28`). **All five pages below sit under it**, including the four unrelated ones. |
| `app/(support)/support/page.tsx` | **BOARD-ONLY** — 5 lines, renders `SupportPageContent` (`:1`). |
| `app/(support)/support/customers/page.tsx` | **UNRELATED** — Customer master. Imports `@/components/admin/customers-table` (`:5`); own permission check on `customers` (`:13-14`). |
| `app/(support)/support/skus/page.tsx` | **UNRELATED** — SKU list. Imports `@/components/admin/skus-table` (`:5`); own check on `skus` (`:18`). |
| `app/(support)/support/routes/page.tsx` | **UNRELATED** — Routes. Imports `@/components/admin/routes-table` (`:5`); own check on `routes_areas` (`:12`). |
| `app/(support)/support/vehicles/page.tsx` | **UNRELATED** — Vehicles. Imports `@/components/admin/vehicles-table` (`:5`); own check on `vehicles` (`:12`). |

### `app/(operations)/operations/support/**`

| File | Verdict |
|---|---|
| `app/(operations)/operations/support/page.tsx` | **BOARD-ONLY** — 9 lines; own role check for `operations`/`admin` (`:8`), then renders `SupportPageContent` (`:3`). It is the **landing page for the Operations login** (`lib/rbac.ts:29`) and the target of `app/(operations)/operations/page.tsx:4`. Both must be repointed. |

That folder contains exactly one file — no layout of its own.

### `app/(admin)/admin/support/**`

| File | Verdict |
|---|---|
| `app/(admin)/admin/support/page.tsx` | **BOARD-ONLY** — 5 lines, renders `SupportPageContent` (`:1`). No permission check of its own. Linked from `components/admin/admin-sidebar.tsx:74`, which must be removed at the same time. |

### `components/support/**`

| File | Verdict |
|---|---|
| `dispatch-slot-picker.tsx` | **SHARED → moves to Floor** (§2). |
| `shared/table-cells.tsx` | **SHARED in one function only** → `formatArticleTag` moves (§3); the rest is board-only and goes with the board. |
| `support-page-content.tsx` | **BOARD-ONLY** — the board's top level; imported by all three page files above. |
| `support-orders-table.tsx` | **BOARD-ONLY** — the main table (1,387 lines). |
| `support-hold-table.tsx` | **BOARD-ONLY** — the Hold tab. |
| `ship-to-override-cell.tsx` | **BOARD-ONLY** — the inline ship-to editor; imported only by the two tables (`support-orders-table.tsx:20`, `support-hold-table.tsx:9`). Floor has its own editor inside its detail panel. |
| `cancel-order-dialog.tsx` | **BOARD-ONLY** — imported by the two tables (`support-orders-table.tsx:18`, `support-hold-table.tsx:8`). |
| `ship-to-override-modal.tsx` | **BOARD-ONLY, already dead** — imported at `support-orders-table.tsx:19` and rendered at `:805-814`, but no button ever opens it and its save handler does nothing (`:811-813`). Already recorded as dead in `CLAUDE_CORE.md §13`. |

### Do the Customers / SKUs / Routes / Vehicles pages import anything from `components/support/**`?

**No.** All four import only from `@/components/admin/*`, `@/lib/auth`, `@/lib/permissions` and
`@/lib/prisma` (each file's first five lines). They share **no code** with the board.

### Would they still work if the board page and its components were archived?

**Yes — provided two things:**
1. `app/(support)/support/layout.tsx` **stays** (it supplies their sidebar and page shell), and
2. the **`support_queue` permission stays granted** to whoever uses those pages. That layout's gate
   (`:25-28`) is on `support_queue`, not on `customers`/`skus`/`routes_areas`/`vehicles`. Revoke
   `support_queue` as part of the retirement and all four pages start redirecting to `/unauthorized`,
   even for a user who still holds the customers permission. The four sidebar links that point at
   them are defined at `lib/permissions.ts:55-59`.

### Orphaned Support files with zero importers

**None of the eight component files is import-orphaned** — every one is reachable from
`support-page-content.tsx`. The orphans are all **API routes**, safe to archive with zero risk
because nothing anywhere calls them:

| Route | Evidence |
|---|---|
| `app/api/support/splits/[id]/route.ts` | zero callers repo-wide (searched for `api/support/splits`) |
| `app/api/support/orders/[id]/assign-slot/route.ts` | the only handler that would call it fires off `localEdits.slot` (`support-orders-table.tsx:422-426`), and nothing ever sets that key |
| `GET` half of `app/api/support/orders/[id]/route.ts` | the route's own comment says so (`:89-90`); confirmed no caller |

---

## 7. Anything that becomes unreachable

Read-only reasoning, no SQL. Four items, listed factually.

1. **Un-doing a release** — moving a bill back from `pending_picking` to `pending_support`.
   Only `POST /api/support/orders/[id]/undo-dispatch` does this (`route.ts:75-91`), driven by the
   button at `support-orders-table.tsx:1262-1276`. Floor's action list has no equivalent
   (`app/api/floor/actions/route.ts:21-22`). **That route becomes unreachable.**

2. **Legacy `closed`-stage bills become invisible everywhere.** Nothing writes `closed` any more
   (`lib/workflow-stages.ts:61`), but old rows carry it. Floor's rail only takes stages below rank 60
   (`lib/floor/queries.ts:51-53`, and `closed` is rank 60 at `workflow-stages.ts:45`), and Floor's
   board deliberately excludes `closed` (`workflow-stages.ts:154-159`). Support's board is the only
   screen that shows them, and `undo-dispatch` is the only action on them — so that route becomes
   unreachable for this population too.

3. **Un-cancelling a bill cancelled before today.** The database write exists on both sides —
   Support's `undo-cancel` (`route.ts:63-79`) and Floor's `restore`
   (`app/api/floor/actions/route.ts:138-144`) — but Floor's Cancelled tab shows **today's**
   cancellations only (`lib/floor/queries.ts:577`), so an older one can never be selected.
   `POST /api/support/orders/[id]/undo-cancel` becomes unreachable.

4. **Releasing a bill that was put on hold before tinting started.** Support can do it
   (its release route allows stage `pending_tint_assignment`, via `supportMayEdit` at
   `workflow-stages.ts:40`); Floor's release refuses anything outside `pending_support` /
   `pending_picking` (`lib/floor/release-stages.ts`, enforced at `app/api/floor/release/route.ts:96-99`).
   The bill would still appear on Floor's Hold tab (that feed has no stage filter,
   `lib/floor/queries.ts:458`) but the Release button would fail with "Not releasable at stage
   pending_tint_assignment". No route becomes unreachable — the bill becomes stuck on the Hold tab
   until tinting finishes.

**Not a loss:** bills at stage `dispatched` (rank 100) are shown read-only on Support with no action
attached (`support-orders-table.tsx:1118-1122`), so nothing is lost by them disappearing.

---

## 8. Exact file list for Step 1

| # | File | From | To | Call sites to update |
|---|---|---|---|---|
| 1 | Slot picker component | `components/support/dispatch-slot-picker.tsx` | `components/floor/dispatch-slot-picker.tsx` | 7 Floor files — `rail-card.tsx:22`, `hold-bar.tsx:16`, `detail-panel.tsx:22`, `assign-bar.tsx:22`, `floor-rail.tsx:12`, `hold-tab.tsx:27`, `floor-page.tsx:31`. (The 3 Support importers leave with the board: `support-orders-table.tsx:12-13`, `support-hold-table.tsx:10-11`, `support-page-content.tsx:12`.) |
| 2 | `formatArticleTag` + its `ARTICLE_WORD_ABBR` constant | `components/support/shared/table-cells.tsx:29-43` | new `lib/floor/format.ts` | 1 Floor file — `components/floor/floor-table.tsx:22`. (Support's 2 importers leave with the board: `support-orders-table.tsx:24`, `support-hold-table.tsx:15`.) |
| 3 | Ship-to search endpoint | `app/api/support/ship-to-search/route.ts` | `app/api/floor/ship-to-search/route.ts` | 1 Floor file — `components/floor/detail-panel.tsx:582` (change the URL). Swap the auth gate to `checkAnyPermission(roles, "floor", "canView")`. |
| 4 | Ship-to save (new thin route, §4 write list) | logic from `app/api/support/orders/[id]/route.ts:189-199, 228-253` | new `app/api/floor/ship-to/route.ts` (POST) | 1 Floor file — `components/floor/floor-page.tsx:372`: change `PATCH /api/support/orders/{id}` to `POST /api/floor/ship-to`, move the order id into the body, and drop the `"PATCH"` third argument to `postJson`. |

After all four, a repo-wide search for `components/support` and `api/support` outside
`components/support/**` and `app/api/support/**` should return **only code comments**
(`lib/workflow-stages.ts:139`, `lib/hide/visibility.ts:22`, `lib/floor/hold-log.ts:31-35`,
`components/picking/picking-queue.tsx:636`, `components/picking/picking-board-mobile.tsx:361`,
`app/api/picking/assign/route.ts:147`, `app/api/picking/unassign/route.ts:52`,
`app/api/picking/queue/route.ts:25`) plus the three Support page files themselves.

---

## 9. Surprises / open questions

**S1 — The permission trap (biggest).** `app/(support)/support/layout.tsx:25-28` gates on
`support_queue`. Four **unrelated** pages — Customers, SKUs, Routes, Vehicles — sit under it and
would go dark if that permission is revoked as part of the retirement. Their sidebar links
(`lib/permissions.ts:55-59`) point straight into that folder. Question: keep `support_queue` granted
purely to keep those four alive, or move them out of the folder later?

**S2 — Floor can only SET a ship-to redirect, never clear one.** `components/floor/detail-panel.tsx:104`
types the handler as `customerId: number`, and the picker only ever passes a real id (`:621`).
Support's inline cell has a ✕ that clears it (`components/support/ship-to-override-cell.tsx`).
So the new route needs less than Support's, but the *operator* loses the ability to undo a wrong
redirect. Question: add clearing to the new route now, or accept it?

**S3 — Correction to the earlier report.** My 2026-07-27 gap report called "pre-set a dispatch slot
on a bill still being tinted" a **GAP** (row 16). **That was wrong.** Floor's detail panel shows an
editable slot chip on every source except cancelled (`components/floor/detail-panel.tsx:348-364`),
and its `change-slot` action has **no stage restriction** (`app/api/floor/actions/route.ts:110-112`).
It writes the same three columns Support's `preset-slot` route writes — `dispatchTargetDate`,
`dispatchWindowId`, `dispatchSlotSource: "manual"` — and the tint-completion auto-flip reads only
those columns, not who wrote them (`app/api/tint/operator/done/route.ts:179`,
`app/api/tint/operator/split/done/route.ts:188`). **Floor already covers this; it is not a gap.**
The only difference is the rail's own inline picker stays disabled mid-tint (`rail-card.tsx:63, 134`),
so the operator must open the bill to do it.

**S4 — The `operations` login still points at Support.** `lib/rbac.ts:29` and
`app/(operations)/operations/page.tsx:4` both send that user to `/operations/support`. Not part of
the four moves, but it must land in the same change or Operations logs into a dead page.

**S5 — A secondary-role edge case in the current gate.** Support's PATCH route exempts admin and
operations from the `support_queue` check using the user's **primary** role only
(`app/api/support/orders/[id]/route.ts:137`), while the role check just above it accepts **any** of
the user's roles (`lib/rbac.ts:52-56`). A user whose primary role is something else but who holds
`operations` as a second role would pass the first check and fail the second. Moving to a
`floor`-permission gate on the new route removes the inconsistency — worth doing deliberately, not
by accident.

**S6 — Three API routes are already dead and can be archived with zero analysis:**
`app/api/support/splits/[id]/route.ts`, `app/api/support/orders/[id]/assign-slot/route.ts`, and the
`GET` half of `app/api/support/orders/[id]/route.ts`. Nothing calls any of them.
