# Picking — Desktop Redesign · Session Wrap-Up (2026-07-22)

**Session type:** design + build (web planning → Claude Code execution)
**Module:** Picking (desktop `/picking` only)
**Outcome:** desktop picking board fully redesigned and shipped to production. Mobile board untouched throughout.

**Related files**
- Design decisions (locked): `docs/prompts/drafts/web-design-2026-07-21-picking-desktop-redesign.md`
- Approved mockup: `docs/mockups/picking/desktop-picking-v9.html`

---

## 1. What shipped

Six build steps, all live on `main`, all tsc-clean, each committed and pushed separately.

| # | Step | Commit | Files |
|---|---|---|---|
| 1 | Discovery (read-only) | — | none |
| 2 | Table restructure | `2df2dc62` | `picking-queue.tsx` |
| 3 | Filter bar | `56b9f658` | `picking-queue.tsx` |
| 4 | List/By-Route toggle + slot bands | `fd324213`, `b34ad763` | `picking-queue.tsx` |
| 5 | Rolling scope + count fix | `0922beba` | `queue.ts`, `queue/route.ts`, `picking-queue.tsx` |
| 5b | Carry-over rule fix (bug) | `16c34bba` | `queue.ts` |
| 6 | Age tags + locked Upcoming | `0d44ab00` | `picking-queue.tsx` |

### Step 2 — Table restructure
- 8 columns, widths `[4,3,19,27,14,7,9,17]`: ☐ · # · OBD · Dealer · Route · LT · Flags · Status.
- OBD with created date-time stacked below; Dealer with `→ ship-to` line; Route as **plain text** (no dot — no route→colour data exists); LT right-aligned.
- Dropped: Area, Article, KG, Picker column.
- Flags became **icons**: ★ `isKeyCustomer` (amber `#f59e0b`), ⚡ `priorityLevel === 1` (red `#ef4444`). P1/KEY text badges removed.
- **Status pill** (rightmost), derived in order: `isChecked`→Ready (green) / `isDone`→Picked (amber) / `isAssigned`→Assigned (grey-700) / else Waiting (grey-500). Never teal.
- **All four states render inline** — the "▸ N assigned" collapse drawer removed. Picked/Ready rows were already in the payload but previously rendered nowhere; they now appear.
- **Stable global #**: parent computes `sortPickingQueue(rows, [byWindow, byDeliveryType, byKeyCustomer, byPriority, byFifo])` — the spine **minus `byAssigned`** — plus a `sequenceByOrderId` map. Rows keep their number as status changes and across tabs. `sort.ts` untouched.
- **Temporary inline Undo** on assigned rows (hover-revealed, calls existing `handleUnassign`) — stopgap until the detail panel exists.

### Step 3 — Filter bar
- Filter panel wired via **UniversalHeader props** (`filterGroups` / `activeFilters` / `onFilterChange`) — the panel is built into UniversalHeader; there is no standalone FilterButton component to import. Three groups: **Route** (runtime distinct), **Status** (Waiting/Assigned/Picked/Ready), **Delivery type**.
- **Search added** (`searchValue`/`onSearchChange`) — desktop had none. Client-side on `dealerName` OR `obdNumber`, case-insensitive.
- Applied-filter pills row replaced the old toolbar. `RouteFilterControl`, `routeFilter` state and `availableRoutes` removed.
- **Filters persist across slot-tab switches** (global lens, matching Mail Orders/Support) — deliberate, confirmed.

### Step 4 — List ⇄ By Route + slot bands
- Segmented view toggle via UniversalHeader `rightExtra`. Default **List**. Not teal.
- **By Route**: groups `visibleRows` by route, alphabetical, trailing "No route" group. Header = route name · `{N} orders` · `{sum} L`. **No progress bar, no "Ready to load"** — loading depends on vehicle/space, which the system doesn't know.
- **Slot bands** under the "All" tab only (`windowTime · N · litres`), trailing "No slot" band. None under a single slot tab. Not collapsible.
- All four nesting combos handled; rows keep their global # inside groups (never renumbered).

### Step 5 + 5b — Rolling day-board scope + count fix *(shared file)*
- New **`rolling`** scope in `lib/picking/queue.ts`. `openPending` left **byte-identical** (mobile + picker face depend on it).
- `zone`/`ageDays` re-anchored on the **requested date D**, not literal today.
- **Count-landmine fixed**: `isStillWaiting(r) = !isAssigned && !isDone && !isChecked && zone !== "upcoming"`, applied to **both** `windows[].count` and `totalCount`. Slot badges and the OBD total now mean "still needs a picker."
- **Step 5b — bug fix.** First implementation had no lower bound, so *every historical* `pick_done`/`pick_checked` order poured onto today's board (live: header said 4 OBDs, table showed dozens of old Ready rows from 17/18/20 Jul). Final WHERE:
  - `= D` → all four active stages
  - `< D` → **only** `pending_picking` + `pick_assigned` (unfinished carry-over; old Picked/Ready excluded)
  - `> D` → active stages, for the upcoming zone
  - `null` date → "due" as before

### Step 6 — Age tags + locked Upcoming
- **Age tags** next to the OBD for `ageDays >= 1`: `1d` amber, `{n}d` red (2+). Uses `row.ageDays` from the payload — **not** recomputed from creation date (the Tint helper's day math is wrong for picking; only its pill styling was copied).
- **🔒 Upcoming section** at the bottom of both views, collapsed by default: `🔒 Upcoming · {N} — locked until dispatch day`. Rows are muted, lock glyph instead of checkbox, `—` for #, and a `for {Day} {DD} {Mon} · {time}` chip in the Status cell. Excluded from `displayRows`, the global #, Select-All and all 3 guards. Slot tabs do not filter it. Renders nothing when empty.

---

## 2. Invariants held throughout
- **Workflow unchanged.** Only UI + one scoped data change. Assign → pick → check ladder, stage constants, and the assign/unassign/pickers APIs were never altered.
- **Only Waiting rows are selectable/assignable.** The three guards (`unassignedRows`, `availableRoutes`, `selectableIdsInTab`) kept filtering `!isAssigned && !isDone && !isChecked` at every step.
- **`lib/picking/sort.ts` never edited** — desktop re-sorts client-side using the individually-exported rules.
- **Mobile never touched.** Only `picking-queue.tsx` changed in steps 2/3/4/6; step 5 touched `queue.ts` but left the `openPending` arm identical.

---

## 3. Open items

### 3.1 ⚠️ Missing `dispatched` stage — ROOT CAUSE, needs a proper session
Orders never leave the picking board because **no dispatched stage exists to drain `pick_checked`**. This directly caused the step-5 bug. Step 5b works around it by excluding old finished rows from carry-over, but the underlying gap remains: `pick_checked` accumulates forever with nothing to move it on. Worth a dedicated design session — this is a workflow gap, not a UI one.

### 3.2 Row-click detail panel — designed, deferred
Picker name, assign/pick/check timestamps, who-checked, line items, and the **permanent Undo** all belong here. Deferred by agreement during design. **Note:** the inline Undo shipped in step 2 is a *stopgap* and should be removed when this panel lands.

### 3.3 `#` column clipping — minor polish
On some rows the # cell truncates (observed as "3…"). Cosmetic width/overflow issue in `picking-queue.tsx`. Not worth its own step; fold into any future polish pass.

### 3.4 Route dot colour — not implemented
The mockup showed coloured route dots; no route→colour data exists in the payload (`RouteDot` on mobile keys on `deliveryType`, not route). Shipped as plain text. If colour is wanted later, either add a colour to route master or key off `deliveryType`.

### 3.5 Rolling scope lookback bound — watch
The rolling ACTIVE set has no lower date cutoff. Fine now (picking is new/test-mode, and 5b limits carry-over to unfinished work), but if `pending_picking`/`pick_assigned` ever accumulate stale rows, a lookback bound may be needed. Tied to 3.1.

---

## 4. Notes for the next session
- The v9 mockup is the design of record; where mockup and shipped code differ, the differences are documented above (route dot, no progress bars).
- Test mode is still on — assignments are tagged `"test"` and reversible. Picker/floor_supervisor SQL role grants remain deliberately deferred; testing continues under admin/operations logins.
- Repo state verified clean after a mid-session PC shutdown: `0d44ab00` on both local and `origin/main`, working tree clean for source files, `tsc --noEmit` exit 0.

---
*Session 2026-07-22. Design locked 2026-07-21. Consolidate into `CLAUDE_PICKING.md` (and `CLAUDE_UI.md` for the desktop table/filter patterns) at the next consolidation cycle; archive this draft afterwards.*
