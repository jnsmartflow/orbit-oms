# Picking — Desktop Redesign · Design Decisions (LOCKED 2026-07-21)

**Purpose:** hand-off record for the build chat. Every decision below is settled — do **not** re-litigate. Read this + the mockup before writing any code.

**Mockup (final, interactive):** `docs/mockups/picking/` — the v9 interactive mock (List/By-Route toggle, no progress bars, locked Upcoming). Save it into the repo mockups folder at build step 1.

---

## 0. Scope & ground rules
- **Desktop `/picking` only** — `components/picking/picking-queue.tsx` (the `hidden md:block` face).
- **Mobile board is already redesigned and shipped — DO NOT touch** `picking-board-mobile.tsx` / `picker-my-picks-board.tsx`.
- **UI-only redesign. Workflow is NOT changing.** Assign → pick → done → check → the stage ladder, the assign/unassign/done/approve APIs — all stay exactly as they are. We are repainting the room, not moving the plumbing.
- Follow **CORE §3** engineering rules throughout (no `$transaction`, no `db push`, `force-dynamic`, camelCase, tsc clean before commit, commit to `main`, stage files by name, stop dev server before git, push after commit).

## 1. Status model (4 states)
Confirmed against `lib/workflow-stages.ts` — the ladder has **4 real states**, not 5:

| UI label | Stage | Pill colour |
|---|---|---|
| Waiting  | `pending_picking` | neutral grey |
| Assigned | `pick_assigned`   | grey |
| Picked   | `pick_done`       | amber |
| Ready    | `pick_checked`    | green |

- **"Assigned" = "Picking."** Assignment *is* the start; there is no separate "started picking" timestamp. No 5th state.
- Colours are palette-honest (CLAUDE_UI §3): green=done, amber=timing/attention, grey=neutral. Teal is spent on the active slot tab (one-teal rule) — status pills never use teal.

## 2. Table columns (final)
`☐ · # · OBD · Dealer · Route · LT · Flags · Status`
- **OBD**: number (mono) + created **date-time stacked below** it (house standard).
- **Dealer**: name + `→ ship-to` suffix when `isShipToOverride`.
- **Route**: route dot + name.
- **LT**: litres, right-aligned, tabular.
- **Flags**: **mobile icons** — ★ `isKeyCustomer` (amber), ⚡ `priorityLevel === 1` (red). **No** "P1"/"KEY" text badges.
- **Status**: single pill, **right-most column** (status reads as the row's verdict, left-to-right).
- **Dropped from today's table:** Area (Route covers it), Article, KG, and the Picker column (picker moves to the row-click detail — see §9).

## 3. All four states shown inline (no drawer)
- Replace today's "N assigned" collapse drawer. **Every state renders inline** with its pill so the whole floor reads at a glance.
- Assign/undo behaviour unchanged — assigned rows just stop being hidden.

## 4. No row-jumping on status change
- Rows do **not** re-sort when a status changes. The list order is fixed; only the pill changes (read like a printed checklist).
- Desktop display order = the pick spine **minus the `byAssigned` sink**, so an order keeps its place when it moves Waiting→Assigned→…
- **Do NOT change `lib/picking/sort.ts`** (shared with mobile). Desktop applies its own display sort client-side.

## 5. `#` = global pick-sequence, preserved across views
- The `#` is the order's position in the day's pick run.
- In **By Route** grouping, rows are **not** renumbered — they keep their List `#` (e.g. #2 & #4 under Adajan). One number, same meaning in both views.

## 6. Rolling day-board scope
- **Today's board = today's dispatch orders + overdue (still-unpicked) orders from earlier days.** Future orders are **not** in the active list.
- "Today" means **dispatch day, not creation day** (scope on `dispatchTargetDate`).
- Overdue carry-overs get an **age tag**: `1d` amber, `2d+` red — reuse the existing Tint-board age-badge pattern (CLAUDE_UI §? age badge).
- Date stepper is now a **look-back-at-a-past-day** tool only; users live on Today.

## 7. Upcoming (future orders)
- Shown as a **clean collapsible section at the bottom**, collapsed by default (`🔒 Upcoming · N`).
- Rows locked: **no checkbox, not assignable**, with a soft `for Wed 22 Jul · HH:MM` date chip. Mirrors the mobile Assign board's Upcoming section.
- **Slot tabs never filter the Upcoming section** (slot = today's execution; upcoming = future planning).

## 8. Filters — unified (match other boards)
- **Slot tabs** stay in the UniversalHeader (teal active) — **header structure unchanged**.
- **Filter button + panel** (like Mail Orders / Support / Tint): holds **Route, Status, Delivery-type**, with an active-count badge, "Clear all", and applied-filter pills. Replaces the loose route dropdown + status chips.
- **Search added** (dealer / OBD) — desktop has none today; wire the UniversalHeader search prop.
- **View toggle: List ⇄ By Route** — same idea as Mail Orders' Table/Review toggle. **Default = List.** By Route is the dispatch planner's lens.

## 9. By Route view
- Groups orders by route (within the slot). Route header shows **route · order count · litres ONLY**.
- **No route progress bar. No "Ready to load."** Whether a route can load depends on the vehicle/space/dispatcher judgement — the picking system doesn't know that, so it must not claim it.

## 10. Slot bands (under "All")
- Under the **All** tab, thin slot band headers (`◷ 10:30 · count · litres`) group the list by dispatch window — this already matches the sort order.
- Bands **disappear** when a single slot tab is selected (redundant there).

## 11. Explicitly removed / rejected
- ❌ Header "% ready for dispatch" bar — removed.
- ❌ Per-route progress bar / roll-up — removed.
- ❌ Auto "Ready to load" status — rejected (vehicle-dependent, human decides).
- ❌ Header status count stats (12 waiting / 7 ready…) — removed.

## 12. Assign rules (unchanged)
- **Only `Waiting` rows are selectable/assignable.** Assigned / Picked / Ready are out of reach — no checkbox, excluded from Select-All.
- Single = tick one; Bulk = tick many → picker → `POST /api/picking/assign`. Undo via `POST /api/picking/unassign` (moves to row-click detail).

## 13. Row-click detail (later)
- Picker name, assign/pick/check times, who-checked, line items, Undo all live in a **click-to-open detail panel** — **designed in a later session**, not this build.

## ⚠️ Shared-file cautions (verify mobile after any of these)
Desktop and mobile read the same data layer. Keep desktop-visual changes inside `picking-queue.tsx`. When a shared file must change, do it deliberately and re-check the mobile board:
- `lib/picking/queue.ts` — scope (§6/§7) and the **count landmine** (`windows[].count`/`totalCount` over-count because they don't exclude `isDone`/`isChecked`; fix both formulas together with `&& !r.isDone && !r.isChecked`; desktop-visible number change; won't affect mobile counts, which are computed independently).
- `lib/picking/sort.ts` — **do not change** (desktop re-sorts client-side).
- `lib/picking/types.ts`, `lib/workflow-stages.ts`, `/api/picking/assign|unassign`, `/api/warehouse/pickers` — shared contracts; don't alter shapes.
- Keep the **three desktop guards** (`unassignedRows`, `availableRoutes`, `selectableIdsInTab`) filtering `!isAssigned && !isDone && !isChecked` so a done/checked bill never leaks into the waiting list, route options, or Select-All.

---
*Design locked 2026-07-21. Build sequence: discovery → table → filters → grouping → scope → upcoming.*
