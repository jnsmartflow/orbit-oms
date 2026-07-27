> SUPERSEDED IN PART, 2026-07-27. §4 states Floor
> calls /api/support/ship-to-search and PATCH
> /api/support/orders/[id]. Fixed in commit 316eec6b
> — Floor now has its own routes. §2 row 16 calls the
> tint slot pre-set a GAP; that was wrong, Floor
> covers it via the detail panel. Everything else
> stands as written.

# Support vs Floor — retirement gap discovery
# 2026-07-27 · read-only · code-verified

Every row below was opened in the code. Docs were used only as a map, never as
evidence. Nothing was edited, moved or deleted; no SQL was run.

---

## 1. Verdict in plain English

**Not yet — but the build-breaking risk is small and known.**
Floor imports **two files** from Support (the slot picker, and one text helper) and calls
**two Support API routes** at runtime (ship-to search + the ship-to save). Delete the Support
folders as they stand and `/floor` stops compiling.
Beyond that, Floor cannot do **10 things Support can** — the biggest being: no way to undo a
release, no way to book a dispatch slot on a bill still being tinted, no cancel reason, no
CSV export, and the **`operations` login still lands on `/operations/support`** (`lib/rbac.ts:29`)
— retire Support today and that user logs into a dead page.

---

## 2. Capability parity table

"OBD" = one bill/order. "Route" = an API endpoint the screen calls. "Stage" = `orders.workflowStage`,
the text field that records where a bill is in the pipeline.

| # | Support capability | Support file:line | API route | Floor equivalent (file:line) | Verdict | What the operator loses |
|---|---|---|---|---|---|---|
| 1 | Main list, fenced to bills that ARRIVED today (+ per-arrival-slot) | `components/support/support-page-content.tsx:152-182`; `app/api/support/orders/route.ts:89-97` | `GET /api/support/orders` | Rail `lib/floor/queries.ts:200-294` + board `lib/floor/queries.ts:332-451`; `app/api/floor/board/route.ts:17-39` | PARTIAL | No single "everything that came in today" list. Floor splits bills into *undecided* (left rail, no date limit) and *released* (right board). A bill that arrived today and was already dispatched by the system shows on the board, not in an arrival list. |
| 2 | Arrival-slot tabs — Morning / Afternoon / Evening / Night | `components/support/support-page-content.tsx:462-468, 495-509`; counts `app/api/support/slots/route.ts:150-196` | `GET /api/support/slots` | Floor's tabs are **dispatch windows** (10:30/12:30/16:00/18:00) — `components/floor/floor-tabs.tsx`, fed by `lib/floor/queries.ts:371-375` | **GAP** | Cannot ask "what arrived in the morning slot?". Floor only groups by when a bill will *go out*, never by when it *came in*. |
| 3 | Header tiles: pending · dispatched · tinting per slot, "% done", total OBDs | `components/support/support-page-content.tsx:372-376, 486-494`; `app/api/support/slots/route.ts:133-196` | `GET /api/support/slots` | Tab counts only — `components/floor/floor-page.tsx:530-532`; status pills `components/floor/status-pill.tsx` | **GAP** | No day-progress number. Floor shows how many bills are in each tab, not "we are 72% done today". |
| 4 | History — any past day, fully actionable, showing arrivals + holds + dispatches | `components/support/support-page-content.tsx:452-460`; `app/api/support/orders/route.ts:98-128` (3-arm date query) | `GET /api/support/orders?date=` | `components/floor/floor-board.tsx` date bar; `lib/floor/queries.ts:346-356` — **released bills dated D only**, read-only | PARTIAL | On a past day Floor shows only what was *promised for dispatch* that day. It cannot show what arrived that day, what was held that day, or what was cancelled that day — and past days cannot be edited. |
| 5 | "N pending from earlier" carry-over badge + flat list | `components/support/support-page-content.tsx:534-557`; `app/api/support/slots/route.ts:204-219`; `app/api/support/orders/route.ts:132-140` | `GET /api/support/orders?section=earlier` | Not needed — Floor's rail has **no date fence at all** (`lib/floor/queries.ts:205-218`), so yesterday's undecided bills simply stay on it; carry-over banner `components/floor/carryover-banner.tsx` | COVERED | — (Floor is structurally better here.) |
| 6 | Dispatch-slot picker (date rail + 4 window pills) | `components/support/dispatch-slot-picker.tsx` (whole file) | `GET /api/support/dispatch-windows` | **The same file, imported** — `components/floor/rail-card.tsx:22`, `hold-bar.tsx:16`, `detail-panel.tsx:22`, `assign-bar.tsx:22` | COVERED **by borrowing** | Nothing today — but this is dependency #1 (see §4). Floor gets its window list from its own board payload (`components/floor/floor-page.tsx:514-518`), not from Support's route. |
| 7 | Status → **Dispatch** (pick a slot, bill goes to the picking queue) | `components/support/support-orders-table.tsx:1173-1211, 1296-1316` | `POST /api/support/orders/[id]/dispatch` | Rail slot pick → `components/floor/rail-card.tsx:128-135` → `components/floor/floor-page.tsx:187-194` → `app/api/floor/release/route.ts:105-114` | COVERED | — (Both write the same columns: date, window, `dispatchStatus='dispatch'`, stage `pending_picking`.) |
| 8 | Status → **Hold** | `app/api/support/orders/[id]/hold/route.ts:64-67` | `POST …/hold` | `app/api/floor/actions/route.ts:113-124` ("hold"), triggered `components/floor/rail-card.tsx:138-145` | COVERED | — |
| 9 | Status → **Cancel, with a required reason** (6 preset reasons + note) | `components/support/cancel-order-dialog.tsx:14-21, 49-57`; `app/api/support/orders/[id]/cancel/route.ts:27-35` | `POST …/cancel` | `app/api/floor/actions/route.ts:125-132` — accepts a `reason` but **the Floor UI never sends one** (`components/floor/floor-page.tsx:203-210`); log note defaults to "Cancelled from floor" | PARTIAL | Cancellations stop recording **why**. Nobody can later ask "how many were cancelled for credit hold?" |
| 10 | Bulk bar — select many bills, dispatch them all with one slot | `components/support/support-orders-table.tsx:418-444, 657-788`; `app/api/support/bulk/route.ts:73-111` | `POST /api/support/bulk` | Floor's bulk bar does **change-slot + assign to picker only** — `components/floor/assign-bar.tsx`, `floor-page.tsx:229-249`. The rail has no checkboxes; selection exists only for bills already on the floor (`lib/floor/selection.ts`) | **GAP** | Cannot clear a pile of undecided bills in one go. On a 40-bill morning that is 40 individual slot picks instead of one. |
| 11 | Bulk **hold** | `app/api/support/bulk/route.ts:112-146` | `POST /api/support/bulk` | Deliberately retired — `components/floor/floor-page.tsx:226-228` (comment); hold is per-bill only | **GAP** | Cannot hold a batch (e.g. a whole route stuck behind one credit issue) in one action. |
| 12 | Hold tab (own table, own columns, "hold since") | `components/support/support-hold-table.tsx` | `GET /api/support/orders?section=hold` | `components/floor/hold-tab.tsx`; feed `lib/floor/queries.ts:455-534` | COVERED | — (Floor is better: it reads the real hold *moment* from the audit log, `queries.ts:472-500`, and adds a printable Hold report, `hold-tab.tsx:191-199`.) |
| 13 | Release from hold — single + bulk | `components/support/support-hold-table.tsx:136-161`; `app/api/support/orders/[id]/release/route.ts:84-93` | `POST …/release` | `components/floor/hold-bar.tsx`; `components/floor/floor-page.tsx:258-266` → `app/api/floor/release/route.ts` | COVERED | — |
| 14 | **Undo dispatch** — pull a released bill back to "undecided" | `components/support/support-orders-table.tsx:1262-1276`; `app/api/support/orders/[id]/undo-dispatch/route.ts:75-91` | `POST …/undo-dispatch` | **Nothing.** Floor's action list is release / hold / cancel / restore / change-slot / mark-urgent (`app/api/floor/actions/route.ts:21-22`) | **GAP** | A bill released by mistake cannot be taken back. The only workaround is Cancel then Restore — two actions, and the audit trail then reads as a cancellation that never happened. |
| 15 | **Undo cancel** | `components/support/support-orders-table.tsx:1277-1291`; `app/api/support/orders/[id]/undo-cancel/route.ts:63-79` | `POST …/undo-cancel` | Same DB write exists as "restore" — `app/api/floor/actions/route.ts:138-144` — but is only reachable from the Cancelled tab, which is **today only** (`lib/floor/queries.ts:577`) | PARTIAL | Yesterday's cancelled bill is invisible on Floor, so it can never be un-cancelled there. |
| 16 | **Pre-set a dispatch slot on a bill still being tinted** | `components/support/support-orders-table.tsx:1219-1238`; `app/api/support/orders/[id]/preset-slot/route.ts:49-66` | `POST …/preset-slot` | Floor's rail picker is **disabled** until the bill is out of tinting — `components/floor/rail-card.tsx:63, 134`; same rule in the panel `components/floor/detail-panel.tsx:318, 417` | **GAP** | Cannot book "this tint bill goes on the 16:00 van" while the paint is still being mixed. Today that pre-set makes the bill auto-dispatch the moment tinting finishes (`app/api/tint/operator/done/route.ts`); on Floor it must be handled manually after mixing. |
| 17 | Priority / mark-urgent (P1 / P2 / P3 / FIFO) | Menu writes local state only — `components/support/support-orders-table.tsx:1350-1367`; the submit path handles slot + bulk status and **never sends priority** — `:418-444` | `PATCH /api/support/orders/[id]` accepts `priorityLevel` (`route.ts:201-210`) — **no caller anywhere** | Floor's ⚡ actually saves — `components/floor/floor-page.tsx:213-220` → `app/api/floor/actions/route.ts:106-109` | COVERED (Floor is the working one) | Nothing. **Support's priority control has never saved anything** — see §7 Doc drift. |
| 18 | Ship-to override (redirect a bill to a different delivery point) | `components/support/ship-to-override-cell.tsx:65`; `components/support/support-orders-table.tsx:1067-1075`; `PATCH app/api/support/orders/[id]/route.ts:189-199` | `GET /api/support/ship-to-search` + `PATCH /api/support/orders/[id]` | Floor **calls the same two Support routes** — `components/floor/detail-panel.tsx:582` (search) and `components/floor/floor-page.tsx:372` (save) | COVERED **by borrowing** | Dependency #2 (§4). Ergonomic difference: on Support it is an inline cell on every row; on Floor it lives inside the detail panel only. |
| 19 | Arrival-slot reassignment ("move this bill to the Evening slot") | Route exists, handler exists (`support-page-content.tsx:330-341`) but **no UI control calls it** — `setEdit(…, "slot", …)` has zero callers and `PILL_SLOT_CLS` (`support-orders-table.tsx:176`) is never used | `POST /api/support/orders/[id]/assign-slot` | none | n/a — dead on both sides | Nothing. Already unreachable on Support. |
| 20 | Split (part-order) edit | none — zero callers in the repo | `PATCH /api/support/splits/[id]` | none | n/a — dead route | Nothing. |
| 21 | Group by SMU / Route | `components/support/support-orders-table.tsx:509-518`; `components/support/shared/table-cells.tsx:60-71` | client-side | Floor groups by **slot band** and **By-route** only — `components/floor/floor-board.tsx`, `components/floor/route-row.tsx` | PARTIAL | Cannot group the board by SMU (business unit, e.g. "Retail Offtake"). Route grouping survives. |
| 22 | Filters: View / SMU / Delivery type / Priority | `components/support/support-page-content.tsx:510-520, 390-406` | client-side | Status + Flags only — `lib/floor/filter.ts:20-33`; delivery type is the header scope chips (`floor-page.tsx:566-579`) | PARTIAL | **No SMU filter on Floor.** Priority is reduced to a single "Urgent" flag (no P2/P3 split). |
| 23 | Search | 6 fields incl. the customer master code — `components/support/support-page-content.tsx:431-450` | client-side | 3 fields: OBD, dealer name, route — `lib/floor/search.ts:48-54` | PARTIAL | Pasting a customer **code** copied out of SAP finds nothing on Floor. (Floor gains multi-OBD paste search, `search.ts:22-31`.) |
| 24 | **Export CSV of exactly what is on screen** | `components/support/support-orders-table.tsx:456-471` | client-side | Only the Hold report PDF — `components/floor/hold-tab.tsx:191-199`, `components/floor/pdf-preview.tsx` | **GAP** | No spreadsheet export of the day's board. |
| 25 | "⚠ Missing" customer badge → resolve-customer sheet | `components/support/support-orders-table.tsx:798-804`; badge `components/support/shared/table-cells.tsx:136-144` | shared resolver | none in `components/floor/**` | **GAP** | When a bill arrives with a delivery point not in the master, Floor shows "(Unmatched)" (`lib/floor/queries.ts:256`) but offers no way to fix it. Support (and Tint Manager) do. |
| 26 | Tint bills visible while mixing, with locked status | `components/support/support-orders-table.tsx:1123-1129` | — | Rail tint strip — `components/floor/tint-strip.tsx`, `lib/floor/queries.ts:296-309` | COVERED | — (Floor shows shades-done progress, which Support does not.) |
| 27 | Row detail panel | shared `components/shared/order-detail-panel.tsx:142` → `/api/orders/[id]/detail` | `GET /api/orders/[id]/detail` | Floor's own — `components/floor/detail-panel.tsx:168` → `app/api/floor/order/[orderId]/route.ts` | COVERED | — |
| 28 | Envelope icon (bill came from a matched email), material-type sub-line | `components/support/support-orders-table.tsx:1043-1047`; `shared/table-cells.tsx:84-103` | — | not rendered on Floor (`components/floor/floor-table.tsx:12` column list) | **GAP** (cosmetic) | Two small display signals disappear. Low impact. |

---

## 3. GAPS — must close before retirement

Ordered by how much it would hurt.

**G1 · No undo of a release.** (row 14)
*What:* once a bill is sent to the floor there is no button to pull it back to "undecided".
*Who/how often:* the desk operator; mis-clicks on a busy morning are routine.
*Suggested fix:* add an "undo release" action to Floor's existing actions route — the write already
exists on Support's side and does not need inventing.

**G2 · Cannot pre-book a slot on a bill still being tinted.** (row 16)
*What:* Support lets the operator choose the dispatch slot while paint is mixing; the bill then
auto-dispatches the moment tinting finishes. Floor's picker is greyed out until mixing ends.
*Who/how often:* every tint bill that needs to catch a specific van — daily.
*Suggested fix:* let Floor's rail picker write the pre-set (Support's route already does exactly
this, and both the tint completion routes already honour it).

**G3 · No bulk release / bulk hold from the undecided pile.** (rows 10, 11)
*What:* Floor's bulk bar only re-slots and assigns bills already on the floor.
*Who/how often:* the desk operator, every morning clear-down.
*Suggested fix:* add checkboxes to the rail and reuse Floor's existing release route, which already
accepts a list of bills.

**G4 · Cancel records no reason.** (row 9)
*Who/how often:* every cancellation.
*Suggested fix:* show the same six-reason dialog before Floor's cancel and pass the text through —
Floor's route already accepts a `reason` field and just never receives one.

**G5 · Cancelled list is today-only, so yesterday's cancel cannot be undone.** (row 15)
*Suggested fix:* a date control on the Cancelled tab, or fold cancelled bills into Floor's history.

**G6 · No CSV export.** (row 24) — Chandresh / the owner pulls these for reconciliation.

**G7 · No missing-customer resolver.** (row 25) — bills with an unmatched delivery point can be
seen but not fixed from Floor.

**G8 · Arrival-slot view and the day-progress tiles are gone.** (rows 2, 3) — decide whether the
depot actually still uses "what arrived in the Morning slot"; if not, this is a deliberate drop,
not a gap.

**G9 · Bills in a contradictory state become invisible.** (no Support row — found while reading)
A bill sitting at stage `pending_support` **with** `dispatchStatus='dispatch'` matches neither
Floor feed: the rail requires `dispatchStatus` to be empty (`lib/floor/queries.ts:208`) and the
board requires the bill to be past that stage (`lib/floor/queries.ts:139`). Support shows it today.
This is not hypothetical — `CLAUDE_FLOOR.md §10` already records 103 bills with the mirror-image
problem. **Run a count before retirement.**

---

## 4. Dependency list — what Floor and others borrow from Support

**Code imports (these break the build if the Support folder goes away):**

| Importing file:line | Imported from | Still needed after retirement? |
|---|---|---|
| `components/floor/rail-card.tsx:22` | `components/support/dispatch-slot-picker` → `DispatchSlotPicker`, `DispatchWindow` | **YES** — must move, not delete |
| `components/floor/hold-bar.tsx:16` | same file → `DispatchSlotPicker`, `DispatchWindow`, `DispatchSlotValue` | **YES** |
| `components/floor/detail-panel.tsx:22` | same file → all three | **YES** |
| `components/floor/assign-bar.tsx:22` | same file → `DispatchSlotPicker`, `DispatchWindow` | **YES** |
| `components/floor/floor-rail.tsx:12` | same file → `DispatchWindow` (type only) | **YES** |
| `components/floor/hold-tab.tsx:27` | same file → `DispatchWindow` (type only) | **YES** |
| `components/floor/floor-page.tsx:31` | same file → `DispatchWindow` (type only) | **YES** |
| `components/floor/floor-table.tsx:22` | `components/support/shared/table-cells` → `formatArticleTag` | **YES** |
| `app/(support)/support/page.tsx:1` | `components/support/support-page-content` | no — this IS the Support page |
| `app/(operations)/operations/support/page.tsx:3` | same | no — second mount of the Support page |
| `app/(admin)/admin/support/page.tsx:1` | same | no — third mount of the Support page |

**Runtime API calls from outside Support (these break silently, at click time):**

| Caller file:line | Route called | Still needed after retirement? |
|---|---|---|
| `components/floor/detail-panel.tsx:582` | `GET /api/support/ship-to-search` | **YES** — the ship-to search box |
| `components/floor/floor-page.tsx:372` | `PATCH /api/support/orders/[id]` | **YES** — saves the ship-to change |

**Comment-only mentions (harmless, no code dependency):** `components/picking/picking-queue.tsx:636`,
`components/picking/picking-board-mobile.tsx:361`, `app/api/picking/assign/route.ts:147`,
`app/api/picking/unassign/route.ts:52`, `app/api/picking/queue/route.ts:25`,
`lib/workflow-stages.ts:139`, `lib/hide/visibility.ts:22`, `lib/floor/hold-log.ts:31-35`.

**The four explicit questions, answered:**

1. **Does Floor import the dispatch-slot-picker from `components/support/`?**
   **Yes — in seven files.** The real component in four (`rail-card.tsx:22`, `hold-bar.tsx:16`,
   `detail-panel.tsx:22`, `assign-bar.tsx:22`); the `DispatchWindow` type only in three
   (`floor-rail.tsx:12`, `hold-tab.tsx:27`, `floor-page.tsx:31`).
2. **Does Floor import `formatArticleTag` or anything else from `components/support/shared/table-cells.tsx`?**
   **Yes — exactly one thing, in one place:** `formatArticleTag` at `components/floor/floor-table.tsx:22`.
   Nothing else from that file is used outside Support.
3. **Does anything outside Support call `/api/support/*` at runtime?**
   **Yes — Floor, two routes:** `GET /api/support/ship-to-search` (`components/floor/detail-panel.tsx:582`)
   and `PATCH /api/support/orders/[id]` (`components/floor/floor-page.tsx:372`). No other module calls
   any `/api/support/*` route.
4. **Do Picking, Mail Orders, Import or Trip Report reference Support in code or types?**
   **No.** Every hit in those modules is a code **comment** pointing at a Support file as a precedent
   (list above). No import, no type, no fetch. The traffic runs the other way: Floor calls
   `/api/picking/assign` and `/api/picking/unassign` (`components/floor/floor-page.tsx:244-246, 387-389`)
   and imports Picking's sort rules (`lib/floor/queries.ts:20`).

---

## 5. Routing / permissions / nav references

- **`middleware.ts:20`** — `const PHASE1_BLOCKED: string[] = [];` — **empty**. Nothing is blocked;
  `/support`, `/operations/support`, `/admin/support`, `/picking` and `/floor` are all reachable
  today. Blocking a route means adding its path to this array (`middleware.ts:56-61`), and note the
  guard exempts `admin` — an admin would still get through.
- **`lib/permissions.ts`** — the Support page key is **`support_queue`**:
  in the `PageKey` union at `:132`, in `ALL_PAGE_KEYS` at `:186`, and in `PAGE_NAV_MAP` at `:26`
  (`Support Queue → /support`). A **second, separate** key `operations_support` maps to
  `/operations/support` at `:18`. Floor's key is `"floor"` (`:122`, `:183`, `:24`).
- **`prisma/seed.ts`** — only **one** Support grant is seeded:
  `:78` `support` role → `support_queue`, view + edit. There is **no seeded row** for
  `operations_support`, so Operations' access to `/operations/support` exists only as a live DB row
  (it would vanish on a reseed). Floor is seeded at `:119-120` (admin + operations, view + edit).
- **Route shells and their guards:**
  `app/(support)/support/layout.tsx:25-28` — needs `support_queue` view, else `/unauthorized`.
  `app/(operations)/operations/support/page.tsx:8` — hard-coded role check (`operations` or `admin`).
  `app/(admin)/admin/support/page.tsx` — **no guard of its own**; relies on the admin layout.
  `app/(floor)/floor/layout.tsx:25-28` — needs `floor` view.
- **Hard-coded links / redirects to Support (all would break):**
  - `lib/rbac.ts:29` — `operations: "/operations/support"` — **the Operations login landing page.**
  - `app/(operations)/operations/page.tsx:4` — `redirect("/operations/support")`.
  - `lib/permissions.ts:18` — the sidebar "Support" item (`/operations/support`).
  - `lib/permissions.ts:26` — the sidebar "Support Queue" item (`/support`).
  - `components/admin/admin-sidebar.tsx:74` — admin sidebar "Support Queue" → `/admin/support`.
  - `lib/permissions.ts:55-59` — the `support` role's href overrides for Customers / SKUs / Routes /
    Vehicles point at `/support/customers` etc. **These are different pages that live inside the same
    `app/(support)/` folder** — deleting the folder wholesale would take them out too.

---

## 6. Workflow stage + data references

**Stages Support writes:**

| Stage written | Where |
|---|---|
| `pending_picking` (via `SUPPORT_DONE_OUTPUT`) | `app/api/support/orders/[id]/dispatch/route.ts:87`, `…/release/route.ts:87`, `app/api/support/bulk/route.ts:95` |
| `cancelled` | `app/api/support/orders/[id]/cancel/route.ts:77` |
| `pending_support` (undo paths) | `…/undo-dispatch/route.ts:78`, `…/undo-cancel/route.ts:66` |
| *(no stage change — status only)* `dispatchStatus='hold'` + `heldAt` | `…/hold/route.ts:66`, `bulk/route.ts:134` |

**Stages Support reads:** `pending_support`, `tinting_done`, `pending_tint_assignment`,
`tint_assigned`, `tinting_in_progress`, `cancelled`, plus the derived lists
`SUPPORT_DONE_STAGE_NAMES` / `SUPPORT_PICKING_QUEUE_STAGE_NAMES` (`app/api/support/orders/route.ts:7, 95-140`).

**Are these Support-owned? No — every one of them is shared.** Plainly: these stage names are the
whole app's vocabulary, not Support's private labels.

- `pending_support` is **written** by Import (`lib/import-upsert.ts`), by both tint-completion routes
  (`app/api/tint/operator/done/route.ts`, `…/split/done/route.ts`), by Tint Manager's manual-entry
  revert, **and by Floor's own restore action** (`app/api/floor/actions/route.ts:142-143`). It is
  **read** by Floor's rail predicate (`lib/floor/queries.ts:51-53`) and its release gate
  (`lib/floor/release-stages.ts`), and by Tint Manager throughout.
- `pending_picking` is the shared handover value defined once in `lib/workflow-stages.ts:61` and used
  by Support, Floor and Picking alike.
- `cancelled` is written by Support and by Floor (`app/api/floor/actions/route.ts:130`).

**Tables used only by Support:** one — **`dispatch_change_queue`**. Its only writer in the entire
repo is `app/api/support/orders/[id]/route.ts:236`, and **nothing reads it anywhere**. Retiring
Support makes it a permanently frozen table. (Do not drop it in the same session — that is a
separate decision.)

**Support-only columns on `orders`:** none. Every column Support touches (`heldAt`,
`dispatchTargetDate`, `dispatchWindowId`, `dispatchStatus`, `dispatchSlotSource`,
`shipToOverrideCustomerId`, `priorityLevel`, `workflowStage`) is written by Floor, the dispatch
engine, or Import as well. `arrivalSlotId` is written by Import and read by Support only — but it is
Import's column, not Support's.

No renames proposed. No SQL run.

---

## 7. DOC DRIFT FOUND

1. **Support's Priority control has never saved anything.**
   *Doc says:* `CLAUDE_SUPPORT.md §6` — "CORRECTED 2026-07-09 — Priority IS a Support concern…
   Priority stays on the board"; §4.19 lists PRIORITY as a live column.
   *Code does:* the menu writes to local component state (`components/support/support-orders-table.tsx:1355-1366`)
   and the only submit path handles arrival-slot changes and the bulk status — there is no branch
   that sends `priorityLevel` anywhere (`:418-444`). The `PATCH` route accepts the field
   (`app/api/support/orders/[id]/route.ts:201-210`) but has **no caller in the repo**. The pill
   changes on screen and reverts on the next refresh.

2. **`CLAUDE_SUPPORT.md §10` lists an arrival-slot field as "may be unused from UI" — it is
   definitely unused.** `POST /api/support/orders/[id]/assign-slot` has a wired handler
   (`support-page-content.tsx:330-341`) that only fires from `localEdits.slot`
   (`support-orders-table.tsx:422-426`), and nothing ever sets `localEdits.slot`. The styling constant
   for the missing dropdown is still on disk and unreferenced (`support-orders-table.tsx:176`).

3. **`PATCH /api/support/splits/[id]` is fully dead, not just landmined.**
   *Doc says:* `CLAUDE_SUPPORT.md §8` lists it as a `$transaction` landmine to refactor.
   *Code does:* a repo-wide search finds **zero callers** of `/api/support/splits`.

4. **`CLAUDE_FLOOR.md §9` names five things Floor leans on; the real list is different.**
   It names the Picking assign/unassign endpoints, `lib/picking/sort.ts`, the dispatch-slot-picker,
   `formatArticleTag`, and `use-picking-marker`. **It omits the two Support API routes Floor calls at
   runtime** — `GET /api/support/ship-to-search` and `PATCH /api/support/orders/[id]`
   (`components/floor/detail-panel.tsx:582`, `components/floor/floor-page.tsx:372`) — even though
   `CLAUDE_FLOOR.md §4.4` documents the behaviour elsewhere.

5. **`CLAUDE_SUPPORT.md §1` says `/support` "needs `support_queue` DB permission row" and that
   Operations lacks it — the third mount is undocumented.** There are **three** routes rendering the
   same component, not two: `/support`, `/operations/support`, and **`/admin/support`**
   (`app/(admin)/admin/support/page.tsx:1`, linked from `components/admin/admin-sidebar.tsx:74`). The
   admin one has no permission check of its own.

6. **`CLAUDE_SUPPORT.md §4.12` says "Bulk cancel [DEFERRED] — bulk/route.ts accepts dispatch | hold
   only" — correct, and worth carrying forward:** Floor also has no bulk cancel
   (`app/api/floor/actions/route.ts` is batch-capable but the UI sends one id at a time).

---

## 8. Open questions for Smart Flow

1. **Where should the shared slot picker live?** It is now used by both screens. Moving it to
   `components/shared/` before retirement makes the cut-over a delete, not a rescue. (Same question
   for `formatArticleTag` — one tiny function.)
2. **Where should the ship-to search + save routes live?** Floor calls them; they sit under
   `/api/support/`. Options: move them to `/api/floor/`, or leave `/api/support/` alive as a
   back-end while the *screen* retires. Note the save route still uses `prisma.$transaction`
   (`app/api/support/orders/[id]/route.ts:228`), a known landmine — moving it is a chance to fix it.
3. **Does the depot still use arrival slots (Morning/Afternoon/Evening/Night) to organise work?**
   If yes, Floor needs an arrival view. If no, rows 2 and 3 are a deliberate simplification and can
   be closed as "not a gap".
4. **Is "% done today" a number anyone actually reads?** It only exists on Support.
5. **Who uses the CSV export, and for what?** That determines whether Floor needs a full export or a
   narrower one.
6. **Is the undo-release gap acceptable for a trial period**, or must it ship before retirement?
7. **What happens to the Operations login?** `lib/rbac.ts:29` sends `operations` to
   `/operations/support`. It must be repointed (to `/floor`) in the same change that retires Support,
   or that user logs into nothing.
8. **`app/(support)/` also contains the Customers / SKUs / Routes / Vehicles pages** for the `support`
   role. Retiring the Support *board* must not take those with it — confirm they stay.
9. **Run one count before deciding:** how many bills are currently at `pending_support` with
   `dispatchStatus = 'dispatch'`? Those are visible on Support and on neither Floor feed (G9).
