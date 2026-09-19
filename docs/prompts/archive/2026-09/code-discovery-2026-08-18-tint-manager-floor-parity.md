# Code discovery — Tint Manager vs Floor Control parity
# 2026-08-18 · READ-ONLY diagnosis · no files edited
# Method: code read at the call site; where doc and code disagree, CODE WINS and the disagreement is noted.

**Files read.** Docs: `CLAUDE.md`, `docs/CLAUDE_CORE.md` §3, `docs/CLAUDE_UI.md` §6/§10/§27 (+ §33/§37/§39 for TM specifics),
`docs/CLAUDE_TINT.md` §1–§3, `docs/CLAUDE_FLOOR.md` (whole). Code: all 10 Tint Manager files and all 18 Floor files listed
in the prompt, plus `components/universal-header.tsx`, `components/shared/order-detail-panel.tsx`,
`lib/hooks/use-picking-marker.ts`, `lib/floor/use-floor-rail-poll.ts`.

**Version note (doc drift, not fixed here):** `CLAUDE_CORE.md` §7 header reads **schema v27.15**; `CLAUDE_TINT.md` and
`CLAUDE_FLOOR.md` both stamp **v27.13**. Per the router §4.4 that mismatch is a stop-and-ask; recorded here, no action taken.

---

## 1. Header

**Tint Manager today.** `<UniversalHeader />`, one call, `tint-manager-content.tsx:1965`. Wiring passed:

| Prop | Value |
|---|---|
| `title` | `"Tint Manager"` |
| `stats` | pending / assigned / in progress / done (4 counters) |
| `segments` + `activeSegment` + `onSegmentChange` | the operator workload pills — `"Unassigned"` first, then one per operator, alphabetical by first name |
| `filterGroups` | 3 groups: Delivery Type (Local/UPC/IGT/Cross), Priority (Urgent/Normal), Type (Split/Whole) |
| `activeFilters` / `onFilterChange` | `headerFilters` state, mirrored into 3 legacy filter states by an effect |
| `showDatePicker` | `false` |
| `searchValue` / `onSearchChange` | client-side search over OBD / customer / SO name / SKU code |
| `showImport` | role-gated (admin, dispatcher, support, billing_operator, tint_manager) |
| `rightExtra` | missing-customer badge + Reports link + "Add to Tint" + card/table view toggle |
| `shortcuts` | ↑↓ navigate · ↵ details · M add-to-tint |

**Floor today.** No `UniversalHeader` anywhere in the floor tree — verified by import sweep. `floor-page.tsx:775–805`
hand-rolls two rows: Row 1 `h-11`, title `"Floor Control"` + IST `dateStr · timeStr` right-aligned; Row 2 `h-[46px]`
`bg-[#fcfcfd]`, scope chips left (All/Local/Upcountry/IGT, a bespoke `bg-gray-100 p-[2px]` group where the ACTIVE chip is
`bg-white font-semibold text-gray-900 shadow-sm` — **white, not teal**), `SearchBox` + `FilterSheet` right. UI §6 names this
as the ONE approved exception ("Do not 'fix' `/floor` back to `<UniversalHeader />`").

**What Tint Manager would LOSE if it hand-rolled.** Everything below is behaviour that lives inside `universal-header.tsx`
and has no counterpart in the floor shell:

- **Segmented control** (`bg-gray-100 rounded-[7px] p-[3px]`, active = `bg-teal-600 text-white`, click-active-deselects,
  4-slot max). Floor's chip group is a different component with different states and **no count badges** — TM's pills carry
  per-operator counts, floor's chips carry none.
- **The `1`–`9` keyboard shortcut** that jumps to segment N (`universal-header.tsx:280–287`). Floor has no equivalent — so a
  hand-rolled TM header would silently drop operator-pill keyboarding.
- **`/`-to-focus-search and Escape-to-clear-search**, plus the ordered Escape chain search → shortcuts → filter
  (`universal-header.tsx:261–271`). Floor owns its own single window-level Esc chain in `floor-page.tsx` and FLOOR §4.6
  forbids a second listener under `components/floor/` — meaning a hand-rolled TM would have to build and own that chain itself,
  and TM already registers a bare `M` keydown listener (`tint-manager-content.tsx:2046`) that would need folding into it.
- **The multi-group filter dropdown** (`HeaderFilter`): inactive `border-gray-200 text-gray-500` → active `border-gray-900`
  + a count badge summing across ALL groups, with "Clear all" appearing only above zero. TM uses 3 groups today. Floor's
  `FilterSheet` (108 lines) is a floor-specific component with a `showStatus` toggle keyed to the open tab — not a drop-in.
- **The IST clock, the shortcuts popover, the Import button + `ImportModal` instance.** TM passes `showImport` role-gated;
  a hand-roll re-implements the modal mount and the role plumbing.
- **`rightExtra` / `leftExtra` slots** — TM puts four separate controls in `rightExtra`. Floor's Row 2 has no slot concept.

**What it would GAIN.** Only two things Floor's shell has and TM's does not: a live IST date/time readout, and freedom to
shape Row 2 differently (Floor spends it on scope chips; TM spends it on segments + filter). Neither is blocked by
`UniversalHeader` — the clock is already on by default and TM already renders it.

**Gap.** Tint Manager is a compliant `UniversalHeader` consumer (one of the 8 in UI §6's roster). Hand-rolling would break the
CORE §3 rule "`<UniversalHeader />` is mandatory for all boards. No custom headers", would require a SECOND named exception in
UI §6, and would cost segments + `1`–`9` + the Escape chain + the multi-group filter + Import — all of which TM actively uses.

---

## 2. Layout — does Pending/Assigned/In-Progress/Completed map onto rail + pane?

**Tint Manager today.** Two view modes, persisted in `sessionStorage` under `tm_view_mode`:

- **Card view** — `grid grid-cols-4 gap-2`, four equal columns from `COLUMNS` (`pending_tint_assignment` /
  `tint_assigned` / `tinting_in_progress` / `completed`), each `bg-gray-50` with a white header bar carrying a coloured dot,
  label, a neutral `bg-gray-100` count pill and a litres figure. **Paginated at 5 cards per column** (`CARDS_PER_PAGE = 5`,
  per-column page state in `pages`). Each column mixes THREE item shapes: whole orders, split cards, and — in Completed only
  — `completedAssignments` re-shaped into `TintOrder` objects at render time (`tint-manager-content.tsx:2707–2790`).
- **Table view** — `TintTableView`, four stacked sections (same four stages) each its own `<table>` with
  `tableLayout: "fixed"` + a shared `<colgroup>` 4/13/10/18/7/9/6/15/10/8%. Fully compliant with UI §27/§33.

**Floor today.** `grid` with `gridTemplateColumns: "344px 1fr"`. Left = `FloorRail`, header "Needs your decision" + count +
"oldest first", body independently scrolling, **never paginated, never filtered by search/slot/route** (search only
highlights). Right = tabs (Floor / On hold / Cancelled) + board + a `472px` slide-out detail panel overlaying the whole thing.

⚠ **Code beats doc here.** FLOOR §2 says the Floor tab offers "Flat/By-route". The code offers **four** view pivots —
`flat` / `route` / `picker` / `group` (`floor-page.tsx:847–875`) — with `picker-card.tsx` (209 lines) and `group-row.tsx`
(285 lines) both live, and `mode` **defaults to `"picker"`**. §11 documents `picker-card` but nothing documents `group-row`.

**My read, plainly: the rail/pane split is a BAD FIT for Tint Manager, and it is a bad fit for a structural reason, not a
cosmetic one.**

Floor's rail exists because its left and right hold **two different populations answering two different questions**:
"undecided, needs a human" vs "released, being worked". The rail is a *decision queue* — every card there is waiting on the
operator's judgement, and a card leaves the rail permanently once decided. That is why it is oldest-first, unpaginated and
un-filterable: it is a pile that must be emptied.

Tint Manager's four columns are not two populations — they are **one population at four points on one ladder**. Every OBD
enters at Pending and walks Pending → Assigned → In Progress → Completed. Only the FIRST column is a decision queue in
Floor's sense (Chandresh must pick an operator). Assigned / In Progress / Completed are **monitoring** states: he is watching
the tint operators work, not deciding anything. Mapping that onto rail + pane would mean:

- Rail = Pending (genuinely rail-shaped: undecided, oldest-first — the code already sorts Pending by arrival time only,
  `tint-manager-content.tsx:2662–2668`, while the other columns sort by `sequenceOrder`).
- Pane = Assigned + In Progress + Completed, which then needs its own three-way split *inside* the pane — i.e. the tabs
  Floor already has, which is the same 4-column shape with an extra level of nesting bolted on.

The net effect is one column promoted to a permanent 344px sidebar and three columns demoted into tabs behind each other.
That **loses the one thing the Kanban actually buys**: all four stages visible side by side at once, which is how a workload
board reads at a glance. Floor can afford tabs because On-hold and Cancelled are exceptions you visit; TM's Assigned and In
Progress are the main event and are watched continuously.

Where the shapes DO align is narrower and worth stating: **Pending alone is rail-shaped**. It is the only column with a
"needs a decision" character, the only one sorted purely by age, and the only one where the 5-card pagination actively hurts
(a 30-deep pending pile shows 5 and hides 25 behind arrows — Floor's rail would show all 30 in one scroll).

---

## 3. Action-surface rules (UI §10)

The five rules, checked against TM code:

### 3a. "One teal per surface, on the state's REAL job"

**Floor.** Detail panel: exactly one teal per state — Waiting/Assigned/Done → **Ship-to** teal, Release/Restore neutral;
Held/Rail → **Release** teal (`detail-panel.tsx:408–461`); Cancelled → **Restore** teal. Assign bar: Assign is the bar's only
teal (`assign-bar.tsx:157`). Slot picker popover: **no teal at all**, deliberately — commit-on-tap needs no confirm.

**Tint Manager — FOLLOWS, partially, and only by accident of having almost no teal.** 19 teal occurrences in
`tint-manager-content.tsx`, but they break down as:
- **Teal-as-identity, not teal-as-CTA (11 of them):** operator avatar circles (`bg-teal-600` at lines 1124, 1140, 1312, 1469,
  2968, 3059), the IGT delivery-type dot (961, 1777), the Pending column dot `bg-teal-500` (504), the "current" split chip
  (1433). These are decoration/identity, not actions — they do not compete for the one-teal budget in the §10 sense, but they
  DO mean the eye finds teal everywhere on the card and so teal has lost its "this is the job" signal on this screen.
- **Teal-as-state (2):** the `+` status button flips `bg-teal-600 text-white` while its popover is open (705, 1655).
- **Teal-as-CTA (1):** the StatusPopover's Save button (485) — `bg-teal-600` when there are changes, `bg-gray-100
  text-gray-400 cursor-not-allowed` when not. **This one is fully §10-compliant**, including the grey-not-faded disabled state.

**Where TM does NOT follow.** The two primary jobs on the screen carry **no teal at all**:
- The **Assign** / **Create Split** button at the bottom of a Pending card is `bg-white border-gray-200 text-gray-700`
  (lines 1104–1119) — a neutral secondary. Assigning an operator IS the Pending state's real job; §10 says that button
  should be the state's one teal.
- The **Assign Operator** modal confirm is `bg-gray-700` (line 3117) and the **Confirm Re-assign** confirm is `bg-gray-700`
  (line 3012). UI §13 specifies `bg-gray-900` for modal confirms — so these are neither teal nor the documented grey. **Doc/code
  disagreement: code says `gray-700`, UI §13 says `gray-900`.**
- Assigned / In Progress / Completed cards have **no action row at all** — just an operator strip. In Progress and
  pending_support even render a literal `"No actions available"` line in the kebab (line 855). So three of four states have
  zero teal, which §10 calls out as wrong in the same breath as two ("never zero, never two").

### 3b. "Disabled buttons are grey, never faded primary"

**Floor.** Every disabled path uses the exact token: `disabled:border-gray-200 disabled:bg-gray-100 disabled:text-gray-400`
— assign bar (167), detail-panel Release (420) and Restore (437). Border present in both states, so nothing shifts.

**Tint Manager — VIOLATES in most places.**
- ✅ StatusPopover Save: `bg-gray-100 text-gray-400 cursor-not-allowed` — correct.
- ✅ `RemoveObdModal` confirm: `bg-gray-300 text-white cursor-not-allowed` — grey, not faded (though not the §10 token).
- ❌ Assign modal confirm: `disabled:opacity-50 disabled:cursor-not-allowed` on a `bg-gray-700` base (line 3117) — **faded
  primary, exactly what §10 forbids.**
- ❌ Split Re-assign confirm: same `disabled:opacity-50` (line 3012).
- ❌ `RemoveObdModal` Cancel (271), its radio/textarea disabled states (211/238 `disabled:opacity-60`), and its history
  chevron (167 `disabled:opacity-40`) — all opacity-based.

### 3c. "An editable value gets a pencil, not a label"

**Floor.** The slot on the detail-panel identity line is a **clickable chip carrying a `PencilIcon()`**
(`detail-panel.tsx:84`, rendered at 346–363), dashed "No slot" when unset, hidden on cancelled.

**Tint Manager — DOES NOT FOLLOW. No pencil affordance exists anywhere on the screen.** Two editable values are rendered as
plain non-obvious surfaces:
- **Priority and Dispatch status** are editable (`PATCH /api/tint/manager/orders/[id]/status`) but the card shows them as
  read-only pills — "🚨 Urgent" / "● Normal" (lines 921–935) and `<DispatchStatusBadge>`. The edit path is a **separate `+`
  icon button** in the icon row that opens `StatusPopover`. Nothing on the pill says it is editable; nothing on the `+` says
  what it edits except a `title` attribute.
- **Sequence order** is editable (Move Up / Move Down) but lives only inside the kebab menu — no visible handle on the row.

### 3d. "Facts live in the header, jobs live in the action row"

**Floor.** Enforced literally: FLOOR §4.6 — "slot lives on the IDENTITY line as a clickable pencil chip; the action row holds
only jobs."

**Tint Manager — MIXED.**
- ✅ The card's identity block is clean facts: customer name, OBD, area, `orderDateTime`, age badge, Manual tag, then a
  4-cell info grid (SMU / Sales Officer / Articles / Volume).
- ❌ **The icon row mixes a fact-editor into the action strip**: Eye (view detail — a job), `+` (edit priority/dispatch — a
  fact edit dressed as an action), `⋯` (jobs). The `+` is a fact belonging on the identity line per §3c/§3d, sitting in the
  action row.
- ❌ **The action row is where dispatch FACTS render on a Completed card** — "✓ Tinting Done › 🚚 Dispatch / Hold / Waiting /
  Pending Support" (lines 1160–1188) occupies the bottom action slot with pure status, no job.
- ⚠ **A header-facts accuracy gap:** the UniversalHeader `stats` "done" counter is `completedSplits.length + orders where
  workflowStage === "pending_support"` (line 2196) and **excludes `completedAssignments`**, while the Completed COLUMN pill
  counts orders + assignments + splits (2790–2793). Same for the operator pills: the "Unassigned" segment count reads
  unfiltered `orders` with predicate `stage === pending || remainingQty > 0` (2455), while the Pending COLUMN reads
  `filteredOrders` with the narrower `stage === pending || ((assigned|in_progress) && remainingQty > 0)` (2661). **The header
  number and the column number can legitimately disagree on the same screen.** Factual finding; not a redesign item.

### 3e. "Selection summaries name what was selected"

**Floor.** `assign-bar.tsx:65–72` — 1 row → `{customer} · {vol} L`; 2+ → `{total} L · {n} routes`; `· {n} already assigned`
appended when relevant. All derived from `selectedRows`, no extra fetch.

**Tint Manager — N/A. There is no selection.** See §4.

---

## 4. Selection + bulk actions

**Floor today.** A complete selection layer:
- `lib/floor/selection.ts` (73 lines) — `FloorSelection = Set<number>` keyed on `orderId`, so it **survives a re-sort by
  construction**. `isSelectable` = `!isDone && !isChecked` (Waiting + With-picker only — "past that the material is off the
  shelf"). `toggleOne` / `isAllSelected` / `toggleAll` are **per-GROUP** (one header checkbox per slot band / route group),
  and `toggleAll` on a PARTIAL selection **selects all, it does not clear** — verified in code at `selection.ts:43–51`,
  matching FLOOR §4.6. Separate `isAllIdsSelected` / `toggleAllIds` for Hold/Cancelled where every row is selectable.
- `components/floor/assign-bar.tsx` (168 lines) — a 60px sticky bar, four controls:
  `[N selected][✕] · summary … [Change slot] │ [picker ▾][Assign]`. Renders `null` at zero selection. Assign label flips to
  `Reassign all {n}` when every ticked row already has a picker. Optional `lockedPicker` drops the dropdown when arriving
  from a picker card.
- Selection is **cleared on every tab / scope / view / date / context change** (`floor-page.tsx:214–223`) and **pauses both
  live-sync mechanisms** so the ground never moves under a hand; a selected row changed by someone else is reconciled
  (tick cleared + toast) without moving the board.
- Deliberately REMOVED from the bar and documented as such so they are not rediscovered as bugs: bulk mark-urgent, bulk hold,
  bulk unassign.

**Tint Manager today — NOTHING. Zero equivalent.** Verified: `grep -rn 'type="checkbox"' components/tint/` returns exactly one
hit, in `manual-tint-entry-modal.tsx` (a line-picker inside a modal, unrelated). No selection Set, no multi-select state, no
bulk bar, no per-row checkbox in either the Kanban cards or the fixed table. Every mutation on this screen is **strictly
one-record-at-a-time**, and every one of them re-fetches the entire board afterwards (`void fetchOrders()`):

| Action | Path | Shape today |
|---|---|---|
| Assign operator | `POST /api/tint/manager/assign` | modal, `{ orderId, assignedToId, note? }` — **one orderId, scalar** |
| Re-assign operator | same route | same modal, `isReassign` only changes the label |
| Re-assign split | `POST /api/tint/manager/splits/reassign` | modal, `{ splitId, assignedToId }` — one splitId |
| Cancel assignment | `POST /api/tint/manager/cancel-assignment` | kebab item, `{ orderId }` |
| Reorder (Move Up/Down) | `PATCH /api/tint/manager/reorder` | kebab item, `{ type, id, direction }` — **one step, one row** |
| Set priority / dispatch | `PATCH /api/tint/manager/orders/[id]/status` | `+` popover, per-record |
| Remove OBD | `POST /api/tint/manager/orders/[id]/remove` | modal, id in the URL path — **structurally single-record** |
| Hide OBD | `POST /api/admin/hide/orders/[id]/hide` | modal, id in the URL path |

**Where a selection model WOULD have leverage (factual, not a recommendation):**

- **Operator re-assign — the strongest case.** TINT §4 states the whole Skip flow returns a job "back to TM pool as a fresh
  pending assignment", and TINT §5 caps an operator at 1 in-progress + 3 paused. When an operator goes down (the
  `MACHINE_BREAKDOWN` / `TINTER_FINISHED` skip reasons exist precisely for this), Chandresh's only route today is: open the
  Assign modal, pick operator, confirm, watch a full board refetch, repeat — N times for N jobs. Floor's exact bar shape
  (`[picker ▾][Assign]` → `Reassign all {n}`) maps onto this one-for-one. **Note the server contract**: `assign/route.ts`
  takes a scalar `orderId` and there is no batch route; Floor's batch routes return **422 when nothing was written** and a
  partial success stays **200 with `failed[]`** — TM's single-record routes have no such contract.
- **Reorder — the case is real but the API blocks it.** `reorder/route.ts` is a per-step **swap**: it resolves the target
  order's operator, filters the list to that operator, and swaps with the neighbour. Moving a job from position 9 to position
  1 is 8 round trips, each followed by a full `fetchOrders()`. A selection model does not by itself fix this — the swap-only
  API does. Floor has no counterpart to compare against (Floor's `FLOOR_SPINE` is a fixed sort with **no** manual reorder,
  and `byAssigned` is deliberately excluded so rows hold their place).
- **Remove OBD — weak case.** UI §39 / the route gate it to `workflowStage === 'pending_tint_assignment'` only, it demands a
  mandatory per-record free-text remark, and it voids a linked delivery challan. A bulk form of an action that requires a
  written per-record justification and cascades a challan void is a poor fit. Floor reached the same conclusion from the other
  direction: FLOOR §4.6 records that **bulk hold was deliberately removed** from the assign bar because it is "a single-bill
  decision".

**Gap.** Tint Manager has no selection primitive, no bulk surface, and no batch API. Floor has all three plus the two safety
rules that make them survivable (selection pauses live-sync; selection is keyed on id so it survives a re-sort). TM currently
needs neither safety rule because it has neither selection nor live-sync.

---

## 5. Detail panel

⚠ **The prompt's premise is wrong on the code. Tint Manager DOES have a slide-out detail panel — two of them.**

**What Tint Manager actually has:**

1. **`OrderDetailPanel`** (`components/shared/order-detail-panel.tsx`, 513 lines) — imported at
   `tint-manager-content.tsx:26`, mounted once at 3201, driven by `detailOrderId`, opened by the **Eye icon** in every Kanban
   card's icon row and from the table. It is a `fixed right-0 top-0 h-full w-[600px] z-40` slide-out with a `bg-black/20`
   backdrop, a 4-line header (OBD mono + ✕ / customer + SH-id / deliveryType · route · area / SMU · materialType), a
   scrolling body with sections **Reference** (Bill-to, Ship-to, OBD date, SO no, invoice), line items, removed-line count,
   splits, `CascadeBadge`, and an expandable **`OrderAuditHistory`** — i.e. an activity log.
2. **`SplitDetailSheet`** (in-file, `tint-manager-content.tsx:1238`) — a `w-[420px]` right-anchored portal sheet with its own
   backdrop, showing ASSIGNED OPERATOR (+ a Re-assign button on Assigned), SKU LINES, STATUS, and ALL SPLITS FOR THIS OBD,
   with a Cancel Split / Close footer. Fetched from `GET /api/tint/manager/orders/[id]/splits`.

**Floor's panel** (`detail-panel.tsx`, 634 lines) — `w-[472px]`, `GET /api/floor/order/[orderId]`, and structurally different
in four specific ways:

| | Floor | Tint Manager |
|---|---|---|
| Width | 472px | 600px (`OrderDetailPanel`) / 420px (`SplitDetailSheet`) |
| Zones | **four, three of them FIXED**: 3-line header · action row · tabs \| scrolling body \| pinned Prev/Next | header · scrolling body. **No action row, no tabs, no Prev/Next** |
| Body | **tabbed** — `items` \| `details` \| `activity`, tab state resets to `items` on open, counts in the labels | one continuous scroll; audit history is an expand/collapse block at the bottom |
| Actions | context-primary action **changes with the source** (Ship-to / Release / Restore, exactly one teal), plus Change ship-to + Update slot + ⋯, all writing through `reportWrite()` so failures surface | **read-only.** `OrderDetailPanel` renders no write action at all. `SplitDetailSheet` has exactly two (Re-assign, Cancel Split), both in the footer |
| Walking the list | **Prev/Next pinned at the bottom, walks the source list** — open one, review the queue without closing | none. Close and re-open per record |
| Live-sync interaction | panel open **pauses** both poll mechanisms | n/a — no polling exists |

**The real gaps, stated precisely (not "TM has no panel"):**

1. **No Prev/Next.** Reviewing 10 pending OBDs is 10 open/close cycles.
2. **No action row.** Every write on this screen happens on the card/row (kebab, `+` popover, bottom button) or in a separate
   modal — the panel is a dead end you must close to act from. Floor's panel is where the decision is made.
3. **No tabbing.** Reference + items + removed lines + splits + audit are one long scroll in a 600px column.
4. **Two panels, not one.** An order opens `OrderDetailPanel` (600px, read-only, audit log); a split opens `SplitDetailSheet`
   (420px, 2 actions, no audit log). Different widths, different chrome, different capabilities, same gesture class.
5. **`SplitDetailSheet` refetches per open** with no cache and no pause interaction.

**Not asserting this should be copied.** Floor's panel earns Prev/Next because its rail is a queue you walk once and empty.
TM's Kanban is a board you scan; the per-record depth Chandresh needs (splits, pause/skip history) is already surfaced
inline on the card by design — the amber summary blocks and the history modals exist so he does NOT have to open a panel.

---

## 6. Live sync

**Floor today — two different mechanisms, no shared abstraction, deliberately:**
- **Floor board → 15s marker probe.** `usePickingMarker` (`floor-page.tsx:709`) with `url: "/api/floor/marker"`,
  `PICKING_MARKER_POLL_MS = 15_000`. The marker returns a cheap `{count, latest}` over `getFloorLiveMarkerWhere()` =
  `floorLiveBaseWhere(getISTDayRange())` AND hide — **the same predicate the board renders**, so marker and board cannot
  drift. A full refetch happens **only when that pair moves**.
- **Rail → 30s full refetch.** `useFloorRailPoll` (`FLOOR_RAIL_POLL_MS = 30_000`), the Mail Orders pattern — a new import
  appears on its own.
- **Both pause** while: not live (History mode), the detail panel is open, or (rail) a selection is up. `useFloorRailPoll`
  additionally skips while `document.visibilityState === "hidden"` and fires one immediate tick on becoming visible.
- **`onProbe` drives the connection strip off the SAME poll** — one probe, not two — showing a grey "not connected — showing
  last update HH:MM" strip, never a modal.
- **Read-only throughout**: the marker adds no `orders.update`, which matters because the marker keys on
  `MAX(orders.updatedAt)` and a second write would fire a false "changed" on every board.

**Tint Manager today — NO live sync of any kind.** Verified by grep across `tint-manager-content.tsx`,
`tint-table-view.tsx` and `app/api/tint/manager/orders/route.ts`: **zero** `setInterval` for data, no marker hook, no poll
hook, no `revalidate`, no websocket. The only `setInterval` in the whole TM tree is
`tint-table-view.tsx:336` — `setInterval(() => setNow(new Date()), 60_000)` — a **clock tick for the elapsed-time badge,
not a data fetch**. It re-renders the badge from data already in memory.

Data reaches Tint Manager exactly three ways:
1. **Mount** — `init()` runs `Promise.all([fetch('/api/tint/manager/orders'), fetch('/api/tint/manager/operators')])` once,
   plus `fetchMissingCustomers()`.
2. **After the user's own write** — every mutation handler ends in `void fetchOrders()`. There are **20+ such call sites**;
   each is a full re-fetch of orders + activeSplits + completedSplits + completedAssignments (the `/orders` route is 712
   lines and returns the entire board).
3. **A manual page reload.**

**Gap, stated plainly.** Tint operators pause, resume, skip and complete jobs on `/tint/operator` continuously. **None of
that reaches an open Tint Manager screen.** A job that an operator marked done, paused, or skipped ten minutes ago still
renders in its old column with its old badges until Chandresh happens to perform a write of his own or reloads. TINT §1
does not mention refresh behaviour at all — it is simply absent from the module, not a documented decision. There is also no
connection indicator, so a dead network is indistinguishable from a quiet floor.

Note for any later fix: there is **no `/api/tint/manager/marker` route** — Floor and Picking each have one; Tint Manager has
none. And TM's refetch is the whole board (four collections), where Floor's marker fetches `{count, latest}` first and only
pays for the board when something moved.

---

## 7. What must NEVER change, regardless of visual redesign

These are DATA and BEHAVIOUR. A mockup pass chasing Floor's look must not touch any of them. Each is stated with where it is
enforced, so a later change can be checked against the enforcement point rather than the description.

### 7.1 Sequence order — one source, per-operator, swap-only (TINT §1.8)
- The operator reads **`sequenceOrder`**, NEVER `operatorSequence`. Do not introduce a second ordering field or sort the
  Assigned column by anything the operator does not read.
- **Reorder is per-operator.** `reorder/route.ts` resolves the target order's operator via `tint_assignments` (status ≠ done),
  filters `orders` to `workflowStage: "tint_assigned"` + that operator's non-done assignments, and swaps with the immediate
  neighbour. Moving a job must never cross operators.
- **New assignments get `sequenceOrder = MAX + 1`** (FIFO).
- The Assigned column's client sort is `sequenceOrder ASC → priorityLevel ASC → date ASC` (`tint-manager-content.tsx:2672–2679`,
  and the same triple for `activeSplits` at 2694–2701). ⚠ **Do NOT adopt Floor's `FLOOR_SPINE`** — Floor deliberately drops
  `byAssigned` so rows hold position, and sorts window → deliveryType → keyCustomer → priority → fifo → obdNumber. That is a
  different rule set for a different screen; applying it here would silently reorder the operators' work queues.
- **Pending sorts differently and must stay differently**: arrival time only, `orderDateTime ?? buildTs(obdEmailDate, obdEmailTime)`
  (2662–2668). No `sequenceOrder` in Pending — those rows have none yet.

### 7.2 Pause / Resume (TINT §5)
- **Whole-OBD only** — splits rejected with 400.
- **Caps: 1 in-progress + max 3 paused per operator; max 3 pauses per job.** Enforced server-side AND client-side.
- **Resume blocked** if the operator has another job in progress — double-checked server-side.
- **TM cannot reassign a paused job** (the operator owns it until resume or done). Any redesign that adds bulk re-assign must
  exclude paused jobs, or it breaks this.
- **`startedAt` is reset to `now` on resume** — elapsed time must be computed through `computeElapsedMs()`
  (`lib/tint/elapsed-time.ts`), never from `startedAt` alone. `accumulatedMinutes` carries the prior runs.
- Paused jobs persist overnight; no expiry.
- TM-side surfaces that must survive: the stage-agnostic amber `⏸ Paused (N/3)` pill, the amber left border
  `border-l-[3px] border-l-amber-500`, the "Last paused / Reason / Progress N of N tins" summary block, and the
  **5 entry points into `PauseHistoryModal`** (Kanban pill · "View full pause history" link · Kanban kebab · Table badge ·
  Table kebab) — all wired to ONE hoisted `pauseHistoryFor` state.

### 7.3 Skip (TINT §4)
- **Only the top/first job** in an operator's queue may be skipped.
- Skipped → back to the TM pool as a **fresh pending assignment**: operator FK cleared, `sequenceOrder = null`.
- 4 reasons; `TINTER_FINISHED` additionally requires a manual tinter-type pick + a non-empty out-of-stock colour multi-select.
- Remark always optional. **No daily skip limit.** **TM may reassign to the SAME operator who skipped** — do not add a guard
  that "helpfully" blocks this.
- TM card shows **full** skip history (not last-only), via the same 5-entry-point pattern into `SkipHistoryModal`.
- Skip + pause **coexist** on one card: amber left border, both pills in one inline row, two stacked summary blocks, two
  kebab items. A redesign that collapses the status-pill row must keep both visible.

### 7.4 Mark Done / partial qty (TINT §6)
- `POST /api/tint/operator/done` takes `{ progress: [{ skuId, doneQty }] }`, validates `0 ≤ doneQty ≤ unitQty` per SKU and
  full coverage, folds the final run delta into `accumulatedMinutes`, and writes the `currentProgress` snapshot.
- Two-stage confirm: `[Cancel] [Confirm Done]` → amber "Short by N tins" banner → `[Back] [Yes, mark done]`.
- **Splits keep the legacy path** (`/api/tint/operator/split/done`); partial-qty validation is whole-OBD only.
- **Parent auto-advance:** after a split completes, if all **non-cancelled** splits are `tinting_done` and the parent is still
  `tinting_in_progress`, advance the parent to `pending_support` + write an `order_status_logs` row. **Cancelled splits are
  excluded — non-negotiable for correctness.**
- **Completion branches on a pre-set dispatch slot:** with `dispatchWindowId != null && dispatchTargetDate != null`,
  completion writes `SUPPORT_DONE_OUTPUT` (= `pending_picking`) + `dispatchStatus: "dispatch"`; otherwise `pending_support`.
  ⚠ TINT §2 flags a **stale code comment** at `split/done/route.ts:169` still saying "closed+dispatch" — it is wrong; nothing
  writes `closed` any more. Do not quote it, do not restore it.

### 7.5 Sampling reuse — search-first flow (TINT §3.12)
**This is Tint OPERATOR-side (`/tint/operator`), not Tint Manager.** A TM redesign should not reach it at all — flagged here
because the prompt named it and because a "tint module" redesign could over-reach:
- Per-entry view mode `browse | confirm | newshade` (collapse-on-pick). Repeat site → full uncapped this-site list,
  recent-first, exact match pinned. New site → no list, new-shade form + retained cross-site search.
- **Pick = reuse, no allocation** — attaches the EXISTING `samplingNo`.
- **The pack dropdown is a FILTER, not an auto-scaler.** Rows show raw stored values. **Scaling happens ON USE only**, and
  **only for TINTER** — the gate is per-row `row.tinterType === 'TINTER'`. **ACOTONE is never scaled.**
- A scaled use creates a NEW pack variant under the SAME sampling number; existing variants stay immutable.
- The "Same shade found" modal: Cancel/Esc/backdrop aborts with NO new number; only Use / Create new mint or save.
- ⚠ Explicitly superseded, must not be reintroduced: the old flat list that auto-scaled every row with ✓/×N markers + the
  `scalingEnabled` prop.
- Also operator-side and locked: the **Acotone column order** `WH1, NO1, NO2, YE1, YE2, XY1, RE1, RE2, XR1, MA1, OR1, GR1,
  BU1, BU2` — `ACOTONE_SHADES` and `ACOTONE_COLS` must stay code-for-code aligned or saved values load into the wrong cells.

### 7.6 Customer-missing badge + the assign interceptor (TINT §1.3 / §1.9)
- `GET /api/tint/manager/missing-customers` filters on `customerMissing: true` AND
  `smu ∈ {"Retail Offtake", "Decorative Projects"}` AND `workflowStage NOT IN ("cancelled", ...SUPPORT_DONE_STAGE_NAMES)`
  AND `isRemoved: false`, AND-merged with `getHideExclusion()`. Covers **both tint and non-tint** orders. Do not narrow to
  tint-only while chasing a "tint screen shows only tint" tidy-up.
- ⚠ **Code beats doc.** TINT §1.3 says "Click opens `CustomerMissingSheet`". The code shows a **two-step**: the amber
  `N missing` badge opens a 300px dropdown LIST of the missing OBDs (`tint-manager-content.tsx:2553–2597`), and clicking a row
  in that list opens `CustomerMissingSheet`. The direct-to-sheet path exists separately, from the per-card ⚠ `AlertCircle`.
- **The Assign interceptor is business logic, not chrome** (`openAssignModal`, 2303–2325): a `customerMissing` order **cannot
  be assigned**. Clicking Assign stores `pendingAssignOrderId`, opens `CustomerMissingSheet` with the amber warning
  "Resolve customer details first before assigning.", and a `useEffect` watching `orders` **re-fires `openAssignModal`
  automatically** once the flag flips false. `sheetResolvedRef` disambiguates resolve-success from cancel. Any redesign of the
  Assign button must preserve this chain — dropping it lets un-resolved customers be assigned.

### 7.7 Operator workload pills (TINT §1.2)
- `"Unassigned · N"` first, then **one pill per operator from `/api/tint/manager/operators`**, alphabetical by first name.
- Each operator's count = **assigned + in-progress combined**, summed across BOTH whole orders and `activeSplits`
  (2465–2476). Not just orders.
- **Tap filters all 4 columns; tap again deselects.** The deselect-on-re-tap is `UniversalHeader`'s segmented-control
  behaviour — a hand-rolled header must re-implement it (§1).
- The filter is applied in **three** places that must stay in step: `filteredOrders` (2136–2140), `filteredActiveSplits`
  (2158–2159), `filteredCompletedSplits` (2175–2176), plus the Completed column's `completedAssignments` branch (2716–2720).
  `"unassigned"` excludes splits entirely (a split is always assigned).

### 7.8 Cross-cutting engineering invariants (CORE §3) that any redesign inherits
- **No `prisma.$transaction`** — `assign/route.ts` carries an explicit comment that its `$transaction` was removed for
  Vercel/pooler timeouts, and accepts partial state on mid-sequence failure. Sequential awaits only.
- Every API route keeps `export const dynamic = 'force-dynamic'`.
- **Soft-delete reads:** every `orders` query keeps `isRemoved: false`; `getHideExclusion()` stays AND-merged.
- **Never `Date.parse()` an offset-less ISO string** — and note that TM currently has `formatTime()` and `buildTs()` reading
  the HOST timezone (`d.getHours()`, `ts.setHours()`), while `formatOrderDateTime()` and `getAgeBadge()` correctly force
  `Asia/Kolkata`. Existing behaviour; a redesign must not spread the host-local pattern further.
- **`tsc --noEmit` passes before commit; never delete files.**

---

## Summary of doc↔code disagreements found (CODE wins; recorded, not fixed)

| # | Doc says | Code says | Where |
|---|---|---|---|
| 1 | `CLAUDE_TINT.md` / `CLAUDE_FLOOR.md` stamp schema **v27.13** | `CLAUDE_CORE.md` §7 header reads **v27.15** | file headers |
| 2 | FLOOR §2: Floor tab offers "Flat/By-route" | **four** pivots — Flat / By route / By picker / By group; `mode` defaults to `"picker"` | `floor-page.tsx:847–875` |
| 3 | FLOOR §11 lists `picker-card.tsx` but has no entry for group mode | `group-row.tsx` (285 lines) is live and reachable from the pivot | `components/floor/group-row.tsx` |
| 4 | TINT §1.3: missing-customer badge "Click opens `CustomerMissingSheet`" | badge opens a 300px **list dropdown**; the sheet opens from a row in it | `tint-manager-content.tsx:2553–2597` |
| 5 | UI §10 / §39: "Remove OBD destructive confirm: `bg-red-600`" | `RemoveObdModal` confirm is **`bg-gray-900`**, with an in-file comment citing UI §13 | `RemoveObdModal.tsx:275–284` |
| 6 | UI §13: "Confirm button: `bg-gray-900`" | Assign modal and Split Re-assign confirms are **`bg-gray-700`** | `tint-manager-content.tsx:3012, 3117` |
| 7 | The prompt's premise: "Tint Manager has no [detail panel] equivalent" | TM has **two** slide-outs — `OrderDetailPanel` (600px, shared) and `SplitDetailSheet` (420px, in-file) | `tint-manager-content.tsx:26, 1238, 3201` |
| 8 | TINT §1.2: Unassigned pill = "count of orders in Pending column" | pill predicate and column predicate differ, and the pill reads UNfiltered orders — the two numbers can disagree | 2455 vs 2661 |

---

*Read-only discovery · 2026-08-18 · no files edited · no recommendations offered*
