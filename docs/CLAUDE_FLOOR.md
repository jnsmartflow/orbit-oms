# CLAUDE_FLOOR.md — Floor Control
# v1.4 · Schema v27.13 · August 2026 · updated 2026-08-04
# Lives in: orbit-oms/docs/
# Load with: CLAUDE.md (repo root) + docs/CLAUDE_CORE.md + docs/CLAUDE_UI.md

Covers `/floor` — the desk operator's unified board: decide which bills go to the floor, and watch what happens to them there.

---

## 1. What Floor Control is [LIVE]

One desk screen for one person — the operator who releases bills to the floor and watches them get assigned, picked and checked. It was built to consolidate the **Support board** and the **Picking desktop board**; both have since been retired (2026-07-27 and 2026-07-28, §9 / §9b), so Floor is not "the merged view" any more — it is the only desk view.

**Route:** `/floor` (`app/(floor)/floor/page.tsx`). Hand-rolled shell, NOT `UniversalHeader` (§10).

**Access:** pageKey `"floor"` in `lib/permissions.ts` (in the `PageKey` union, `ALL_PAGE_KEYS`, and `PAGE_NAV_MAP` → `/floor`). v1 grant = **admin + operations only**, `canView`+`canEdit`, present in BOTH `prisma/seed.ts` and live `role_permissions` (SQL 2026-07-23, **re-confirmed live 2026-07-28** — still exactly those two roles). ⚠ **`floor_supervisor` and `picker` hold `picking` but NOT `floor`** (same 2026-07-28 SELECT) — so `/floor` is not a fallback for them; a redirect there would be a permission denial. That is why the Picking desktop retirement kept `/picking` live rather than redirecting (§9b). Grant table: `CLAUDE_CORE.md §5`. `dispatch planner` / `telecaller` (named in the design) are **[DEFERRED]** — `dispatch planner` has no matching slug, `telecaller` does not exist.

### Ownership boundary — READ BEFORE EDITING ANYTHING FLOOR

Floor Control **reuses Picking as a CALLER**. It did NOT fork or modify it — no Picking component or API file was changed. The one shared edit was `lib/hooks/use-picking-marker` gaining **optional** params (`url`, `onProbe`); all three Picking call sites pass neither and are byte-identical. Support was also a lender until its retirement; everything Floor borrowed from it now lives under `lib/floor/` or `app/api/floor/` and is **owned by this file** (§9).

| This file OWNS | This file does NOT own — cross-reference only, never restate |
|---|---|
| the left/right split (§2) · Floor's `FLOOR_SPINE` sort LIST (`lib/floor/sort.ts`, §3) | assign / unassign + the sort rule OBJECTS + `sortPickingQueue` → **`CLAUDE_PICKING.md §3/§4`** |
| the 4 read feeds (§3) | the dispatch engine (`evaluateDispatchSlot`) → **`CLAUDE_CORE.md §7.4`** |
| floor routes: hold / cancel / release / change-slot (§4) | |
| ship-to search + save (§4.4) · the dispatch-slot picker (`components/floor/dispatch-slot-picker.tsx`) · `formatArticleTag` (`lib/floor/format.ts`) | |
| the action surfaces — assign bar / panel header / picker behaviour / selection+Esc (§4.6) | |
| the detail panel (§4.7) | |
| the held-since read-side rule (§4.5) | |
| floor live-sync + `/api/floor/marker` (§5) | |
| the hand-rolled header divergence (§10) | |

If you find yourself explaining borrowed behaviour here, replace it with a pointer.

### What is still live alongside Floor

`/picking` (`app/picking/page.tsx`) is **live and reachable** — `middleware.ts` `PHASE1_BLOCKED` is `[]`. Its supervisor + picker card boards were never in scope for retirement and stay; they now render at EVERY width. **The Picking DESKTOP board is RETIRED** — 2026-07-28, `archive/2026-07-picking-desktop/` (§9). **`/support` is gone** — retired 2026-07-27, §9.

---

## 2. The screen [LIVE]

One rule the operator learns: **left = not on the floor, right = on the floor.**

- **Left rail (344px) — "Needs your decision".** Cards, one per bill. Holds ONLY bills the dispatch engine could not auto-slot (having no slot is *why* they are here). A bill the engine successfully slotted never appears on the rail — it is already on the right, carrying its stored `dispatchTargetDate`/`dispatchWindowId`. Oldest-first, always; never filtered by search/slot/route/date — only the header delivery-type scope narrows it (search only HIGHLIGHTS a matching rail card, never hides it). Each card: **with an engine suggestion** (live since 2026-08-03 — §8), a teal split-confirm button `[ ✓ Today 18:00 ▾ ]` + `Hold` + `✕`; **without one**, the original `[ pick slot ] [ Hold ] [ ✕ ]` plus a quiet grey "Why no slot?" link. Tint bills show a live tint strip and a slot picker disabled until all shades are done; a FINISHED full tint OBD gets a completion-anchored suggestion (§8).
- **Right pane** — three top tabs: **Floor** / **On hold** / **Cancelled**, plus the slide-out **detail panel**.
  - **Floor:** delivery-type scope chips (All/Local/Upcountry/IGT) · slot tabs `10:30 · 12:30 · 16:00 · 18:00 · All` · slot bands (All view) or Flat/By-route (a slot tab) · a fixed-layout table · four status pills (Waiting / With picker / Needs check / Done). Live vs History (History is read-only, dated).
  - **On hold / Cancelled:** tables (§4).
- **Header:** hand-rolled title + IST date/time; scope chips; one search box + one filter (§ CLAUDE_UI §5.2/§5.3-style, floor-only). No `UniversalHeader` (§10).

---

## 3. Data feeds [LIVE]

Four SELECT-only feeds, sequential awaits, never `prisma.$transaction` (CORE §3). All in `lib/floor/queries.ts`. Delivery-type scope is applied **client-side** in each feed loop (`inScope`), so the DB queries fetch all types. `getHideExclusion()` (CORE §7.10) is AND-merged into every feed.

| Feed | Function | Route | Scope / anchor |
|---|---|---|---|
| Rail | `getFloorRail(scope)` | `GET /api/floor/board` | Pure open state — `workflowStage` rank < 60 AND `dispatchStatus IS NULL` AND `isRemoved=false`. No date anchor (yesterday's undecided bills stay). Oldest-first. |
| Floor board | `getFloorBoard({mode,date,scope})` | `GET /api/floor/board` | **Live:** `floorLiveBaseWhere` (below). **History:** TWO arms under one `OR`, active stages, read-only — (a) bills **promised** for D (`dispatchTargetDate=D`) **OR** (b) bills **checked** on D (`pick_checked` AND `pick_assignments.checkedAt ∈ getISTDayRange(D)`). See below. |
| Hold | `getFloorHold(scope)` | `GET /api/floor/hold` | `dispatchStatus="hold"`, all dates (pure open state), recent-held-first. |
| Cancelled | `getFloorCancelled(scope)` | `GET /api/floor/cancelled` | `workflowStage="cancelled"`, **today only** (IST, by the cancel log's `createdAt`). |

Also `getFloorPickers()` (active picker roster + on-hand load, for the assign bar). `GET /api/floor/board` returns `{ rail, floor, pickers }`; each route gates on `checkAnyPermission(roles,"floor","canView")`.

**`floorLiveBaseWhere(todayRange)` — the live predicate, SHARED by the board and the marker** (so they cannot drift, §5). Two arms:
1. everything still OPEN — `workflowStage ∈ PICKING_OPEN_STAGES` (pending_picking / pick_assigned / pick_done), **any** dispatch date. Floor's carry-over arm (design §4.2).
2. everything the floor **CHECKED TODAY** — `workflowStage=pick_checked` AND `pick_assignments.checkedAt ∈ getISTDayRange()` (today, IST), whatever day it was due.

Plain English: everything still open whatever day it was due, plus everything the floor finished today whatever day it was due.

**The HISTORY predicate (`mode="history"`) — two arms under one `OR`, added 2026-08-25.** Outer AND terms (`dispatchStatus="dispatch"`, `isRemoved=false`, `workflowStage ∈ PICKING_ACTIVE_STAGES`) are unchanged; only the date anchor grew:
1. **promised for D** — `dispatchTargetDate = D`. The original and only arm until 2026-08-25.
2. **checked on D** — `workflowStage=pick_checked` AND `pick_assignments.checkedAt ∈ getISTDayRange(D)` (IST), whatever day it was promised. Same helper and same half-open shape as the live arm above, with the viewed day instead of today.

Plain English: what was owed that day, plus what was finished that day. A bill matching both appears **once**; a bill finished early appears under **two** days (its promise day and its check day) — both statements are true, and that is the owner decision, not a predicate accident. ⚠ This is the **same promise-vs-completion anchor class** as §6c / the 2026-08-02 picking `checkedAt` fix: a completion belongs to the day it happened. Arm 2 exists because without it a bill promised for D+1 but checked on D was on **no reachable screen at all** — live had dropped it, D's history never had it, and D+1's history is unreachable behind the stepper clamp (§10). The marker does **not** consume this predicate (§5 — it is live-only).

⚠ **Floor's carry-over is its OWN scope — NOT `lib/picking/queue.ts`'s WHERE.** Picking's carry-over deliberately excludes `pick_done`/`pick_checked` (a documented "workaround, not a fix"). Floor's arm 1 keeps anything not-yet-checked. Do not "align" the two.

Per row: `zone` (`due` | `upcoming`, from `dispatchTargetDate` vs today) and `ageDays`. Rows are sorted with Floor's OWN **`FLOOR_SPINE`** (`lib/floor/sort.ts`) = the picking spine **minus `byAssigned`**, so Assigned/Done rows HOLD their position instead of sinking on assign and rising on done (a convention Floor shared with the Picking desktop board, retired 2026-07-28 — §9b; Floor is now its only implementation). ⚠ **Ownership boundary:** the rule OBJECTS (`byWindow`/`byDeliveryType`/`byKeyCustomer`/`byPriority`/`byFifo`) and `sortPickingQueue()` are IMPORTED from `lib/picking/sort.ts` (never copied — that file stays owned by `CLAUDE_PICKING.md §3`); only the Floor rule LIST is Floor's own. `FLOOR_SPINE` is applied in the TWO places that sort and must stay identical or the board flickers on refetch — the server sort (`getFloorBoard`, `lib/floor/queries.ts`) and the client re-sort helper (`components/floor/floor-board.tsx`), both importing the one constant. Shipped commit `661e4e61`.

---

## 4. Floor actions [LIVE]

Every write path: sequential awaits, **exactly ONE `orders.update` per bill**, **exactly ONE `order_status_logs` row per bill per action** (CORE §3 / the live-sync marker keys on `MAX(orders.updatedAt)` — a second write fires a false "changed" on every board). No Floor file contains `prisma.$transaction`.

### 4.1 `POST /api/floor/actions` — mark-urgent · change-slot · hold · cancel · restore

Batch `{ action, orderIds[], … }`. Per bill:
- **mark-urgent** — set/toggle `priorityLevel` (1 ↔ 3).
- **change-slot** — write `dispatchTargetDate`+`dispatchWindowId`+`dispatchSlotSource="manual"`, no stage change (a pre-set; also re-slots a floor bill).
- **hold** — `dispatchStatus="hold"`, `heldAt = obdEmailDate ?? now` (arrival anchor, §4.5). Log note = `FLOOR_HOLD_NOTE`.
- **cancel** — `workflowStage="cancelled"`, `dispatchStatus=null`.
- **restore** — cancelled → `workflowStage="pending_support"`, `dispatchStatus=null` → back onto the left rail.

Returns **422 when nothing was written** (every requested bill failed); a partial success stays 200 but always carries `failed[]`.

### 4.2 `POST /api/floor/release` — rail Release AND Hold-tab bulk release

Body `{ releases: [{ orderId, dispatchTargetDate, dispatchWindowId }] }`. Writes the slot, `dispatchStatus="dispatch"`, `workflowStage=SUPPORT_DONE_OUTPUT` (pending_picking), `dispatchSlotSource="manual"`. Log `fromStage` = the bill's **real** prior stage.

**Releasable stages — `FLOOR_RELEASABLE_STAGES = ["pending_support","pending_picking"]`** (`lib/floor/release-stages.ts`). Floor's own explicit list, deliberately **NOT** `supportMayEdit()` (`lib/workflow-stages.ts`) — that predicate encoded Support's permission model, and Floor's release gate answers a different question. It is now dead code with zero callers, kept pending a ROADMAP cleanup; do not wire it back in here. `pending_support` = a rail bill (the stage name is historical — nothing named Support writes it any more); `pending_picking` = a bill held after auto-dispatch (hold flips status only, never stage). Same 422/partial contract as §4.1.

### 4.3 Assign / unassign

**Reused from Picking, unchanged** — Floor calls `POST /api/picking/assign` and `/api/picking/unassign` as a caller. Reassign = unassign (only if already assigned) then assign. → behaviour owned by **`CLAUDE_PICKING.md §4`**.

### 4.4 Ship-to change (detail panel) [LIVE] — Floor's OWN routes

Search `GET /api/floor/ship-to-search?q=` (min 2 chars, `take: 8`, gated on floor `canView`); write `POST /api/floor/ship-to` with `{ orderId, customerId }` — `customerId: null` clears the redirect. Both are Floor's own as of commit `316eec6b`; nothing here calls a Support route.

The **save is a rewrite, not a copy**. Support's PATCH handled four unrelated fields at once and rode a `prisma.$transaction` (CORE §3). Floor's does one job, verifies the target customer exists, keeps the legacy `shipToOverride` boolean in sync, and **skips the write entirely when nothing changed** — sequential awaits, no `$transaction` in any Floor file.

⚠ The **clear (✕)** affordance is not built on the panel yet — the route already accepts `customerId: null`. UI-only gap → ROADMAP.

### 4.5 Held-since — READ-SIDE rule [LIVE]

`orders.heldAt` stores the bill's **arrival** date (`obdEmailDate`), NOT the moment it was held — a convention inherited from Support, which anchored its amber hold footprint to arrival. **The write was deliberately NOT changed** when Support retired: thousands of historical rows carry arrival dates, and flipping the write to `now` would make old and new rows mean different things in the same column. The Hold tab needs the opposite, so "held since" is derived on the READ side in `getFloorHold()`:
- Take the hold **event's** wall-clock `order_status_logs.createdAt`, identified by the log **NOTE** via the shared constant `HOLD_LOG_NOTES` (`lib/floor/hold-log.ts`) — never a sentinel `toStage` (which would pollute the stage ladder). Matches the Floor note AND the two historical Support notes (`"Placed on hold by support"`, `"Placed on hold by support (bulk)"`). ⚠ **Keep both Support strings** — Support no longer writes them, but bills it held are still on hold today and would otherwise fall to the `~approximate` fallback.
- Fallback ladder: hold log → `orders.heldAt` (rendered with a leading `~` + "approximate" tooltip; enrichment holds write no log) → unknown (banded separately under "Held date unknown"). Nothing can silently read as "held today".

### 4.6 Action surfaces — assign bar · panel header · slot picker · selection/Esc [LIVE since 2026-07-27]

The 2026-07-26 redesign (draft `web-update-2026-07-26-floor-action-surfaces.md`; committed with the
Support-retirement step 1). The five general DESIGN rules it minted are owned by
**`CLAUDE_UI.md §10`**; this section owns the floor-specific SPECS. *(The draft's §8 routing table
sent four items to `CLAUDE_SUPPORT.md §4.10/§4.18` — that file is retired; the picker and the
ship-to routes are Floor's own since `316eec6b`, so those items land HERE.)*

- **Assign bar** (`assign-bar.tsx`) — four controls:
  `[ N selected ][✕] summary … [Change slot] │ [picker ▾][Assign]`. Summary: 1 row →
  `{customer} · {vol} L`; 2+ → `{total} L · {n} routes`; `· {n} already assigned` appended when
  applicable. Assign label flips to `Reassign all {n}` when every ticked row has a picker; Assign is
  the bar's only teal, grey when disabled. Renders nothing when nothing is selected.
  **Deliberately REMOVED capabilities** (do not rediscover as bugs): bulk mark-urgent (per-row ⚡
  covers it) · bulk hold (per-bill ⋯ menu) · bulk unassign (weakest removal — fell out of the
  four-control layout, accepted; the lost case is "pull N bills back with nobody to hand them to").
  Handlers were deleted from `floor-page.tsx` with explanatory comments left in place.
- **Detail-panel header** — slot lives on the IDENTITY line as a clickable pencil chip
  (`DD-MM · HH:MM`, dashed "No slot" when unset, hidden on cancelled); the action row holds only
  jobs. **Exactly one teal per state, on the state's real job:** Waiting/Assigned/Done → Ship-to;
  Held/Rail → Release; Cancelled → Restore. The ⋯ menu contents are unchanged from the redesign.
- **Slot picker behaviour** (`dispatch-slot-picker.tsx` — Floor-owned): commit-on-tap, **no confirm
  button** (a confirm would tax the most frequent action) → hence NO teal anywhere in the popover;
  near-black selection on a neutral strip; month tag only on tiles crossing a month. **Honest
  highlight:** opens on the bill's OWN day if visible, else highlights NOTHING (never claims today).
  **Consequence: tapping only a time keeps the bill on its own day** — it no longer silently drags
  the date to today. Auto-flip positioning: preferred direction if it fits, flips, else caps+scrolls;
  repositions on scroll/resize; already portalled. Plus the §8 `suggested`/`hideTrigger` props.
- **Selection + Esc — THE spec (flagged in every pass since 2026-08-04 step 2; lands here):**
  `lib/floor/selection.ts` `toggleAll()` on a PARTIAL selection **selects all, it does not clear**,
  and it is per-GROUP (one per slot band / route group) — so a cross-group or search-auto-ticked
  selection cannot be cleared by any header checkbox. That is WHY the bar's ✕ global-clear exists —
  any proposal to remove it must solve this first. **`floor-page.tsx` is the SINGLE window-level Esc
  owner** for the floor tree. Guard order, exactly one branch per keypress: slot popover open
  (`[data-slot-popover="open"]` — the marker the picker carries for exactly this) → nothing · focus
  in input/textarea/select/contentEditable → nothing · panel open → close panel · rows selected →
  clear selection · else nothing. **Never add a second Esc keydown listener under
  `components/floor/`** — two window-level listeners race in registration order, which is the bug
  this replaced. The panel closes via ✕/backdrop as well; the picker itself dismisses on
  click-outside, not Esc.

### 4.7 Detail panel [LIVE]

`GET /api/floor/order/[orderId]` (floor `canView`) returns one payload: header + Details + Items + Activity. Items resolve via `sku_master_v2` on `material === skuCodeRaw` (CORE §13 — never a sku id), raw-text fallback preserved, gift lines out of scope. Activity = `order_status_logs` + ONE synthetic "auto-slot" line derived from `dispatchSlotSource`/`dispatchSlotRuleId` and labelled "enrichment" (the engine writes no log — do not add one; §5). 472px slide-in; primary action + Change ship-to + Update slot + ⋯ ; Prev/Next walks the source list.

**Sources** (`FloorDetailSource`, `lib/floor/types.ts`): `rail` · `floor` · `hold` · `cancelled` · **`history` — READ-ONLY, the only one that is** (2026-08-25). A history-sourced panel reaches **zero write endpoints**: the whole action row is suppressed (it hosts Release, Restore, Ship-to, Assign/Reassign and the ⋯ Hold/Cancel/Unassign menu, and the only `setEditingShipTo(true)` trigger, so the ship-to editor is unreachable too), and the header slot chip — which writes `change-slot` — is gated off. Everything else excludes `history` **by default**, because each gate is written `source === "floor" | "rail" | "hold" | "cancelled"` and a new member matches none of them; that default-closed property is why this is a member of the existing union and not a separate `readOnly` prop. The one derived boolean is `readOnly` in `detail-panel.tsx`, mirroring `interactive` in `floor-table.tsx` — do not add a third read-only concept. Opened by a ⋯ on history rows (⋯ only — the live arm's ⚡ is `mark-urgent`, a write). `headerStatus` has an explicit `history` case placed **above** the `d.dispatchStatus === "hold"` term, so a bill held later cannot rewrite a past day's record. Prev/Next walks the history payload (`filteredFloor` IS the history rows in history mode) and cannot reach a live row.

---

## 5. Live sync [LIVE]

**Two DIFFERENT mechanisms, no shared abstraction** (design §13):
- **Rail** → Mail Orders pattern: a **30s full refetch** (`lib/floor/use-floor-rail-poll.ts`). A new import appears on its own.
- **Floor** → Picking pattern: a **15s marker probe** (`lib/hooks/use-picking-marker`, reused with its optional `url` param → `/api/floor/marker`). Refetch only when the cheap `{count, latest}` moved.

`GET /api/floor/marker` aggregates `{count, latest}` over `getFloorLiveMarkerWhere()` = `floorLiveBaseWhere(getISTDayRange())` AND hide — the **same predicate the board renders** (§3), so marker and board cannot drift. It is the floor's OWN exact set, not picking's superset. The marker hook's `onProbe` drives the connection strip off the **same poll** — one probe, not two.

The marker's `{count, latest}` semantics + the `orders_updatedAt_idx` behaviour are **owned by `CLAUDE_PICKING.md §10`** — not restated here. Difference from Picking: Floor watches its own set via the `url` param; the connection strip (`components/floor/connection-strip.tsx`) shows a grey "not connected — showing last update HH:MM" (a strip, never a modal; live mode only).

**Pause rules** (both mechanisms): the detail panel is open, a selection is up, History mode, or the tab is hidden. A **selected** row changed by someone else is **reconciled** — its tick is cleared and a toast shown — **without moving the visible board** (rule: never move the ground under a hand). READ-ONLY throughout: the marker adds no write.

---

## 6. Bugs fixed this build [LIVE]

Each with the one-line root cause so the class is recognisable again.

- **(a) Auto-slot scheduled Saturday-evening bills into Sunday** (depot closed). *Root cause:* `evaluateDispatchSlot()` rolled a late bill to the next **calendar** day. *Fix:* `nextWorkingDateOnlyUTC()` in `lib/dispatch/dispatch-engine.ts` skips Sunday only (Saturday is a working day; holidays not modelled). This was a **live enrichment bug independent of Floor Control**. Engine owned by CORE §7.4.
- **(b) Releasing a held bill was a silent no-op** (UI said OK, wrote nothing). *Root cause:* the release route required `workflowStage === "pending_support"`, but a floor-held bill sits at `pending_picking`; it was pushed to `failed[]`, the route returned **200**, and the client discarded the response. *Fix:* `FLOOR_RELEASABLE_STAGES` (§4.2) admits `pending_picking`; routes return 422 when nothing was written; the client now reads the response and `reportWrite()` surfaces every non-2xx / hard error / non-empty `failed[]` (the rail release path had the same swallow).
- **(c) A carried-over bill vanished the instant it was checked.** *Root cause:* the live "checked" arm fenced on `dispatchTargetDate = today`, so a bill due earlier failed both arms the moment it reached `pick_checked`. *Fix:* the checked arm now fences on `pick_assignments.checkedAt` within today's IST range (§3) — a bill can never disappear at completion. **This "done = check date" convention now has three implementations:** Floor (here, the original), the Billing Picking tab (`CLAUDE_MAIL_ORDERS.md §23.4`), and the Picking supervisor board (`e37cbe74`, 2026-08-02 — documented in the PICKING pass, pending).

---

## 7. Live-data cleanup [LIVE] — completed one-off, do NOT repeat

**2026-07-23.** The rail opened with **261** undecided bills; only 23 were from the last two days, 151 over a week old. Confirmed the goods had physically shipped weeks earlier and the system was simply never updated. **238 bills** (older than 2 days) were closed to `workflowStage='dispatched'`, each with an `order_status_logs` row *"Bulk backfill: goods dispatched, never recorded in system"*. Rail 261 → 23; Support's pending backlog cleared by the same 238. Two of the 238 were `tinting_in_progress` with open splits — splits deliberately left alone.

This is a **completed one-off**, not a runbook. (It is also the source of the `dispatched`-stage rows to reconcile in `CLAUDE_PICKING.md`.)

---

## 8. Rail slot suggestion [LIVE — shipped 2026-08-03; hand-verification PENDING]

**Status:** `RAIL_SUGGESTIONS_ENABLED = true` (`lib/floor/queries.ts:70`) since the 2026-08-03 session
(commits `30226144` → `dee603dc` + `ab70c826`; draft record
`docs/prompts/drafts/code-update-2026-08-03-floor-slot-suggestion.md`). Both prior blockers were
fixed at source: the staleness check is now one closed-batch MOMENT test (below), and the suggestion
carries date AND time. ⚠ **Smart Flow's five manual hand-checks (rail→auto-slot round trip, human
slot survives repair, re-slot log lines, no marker flash, morning-rail eyeball) are still pending** —
treat behaviour as shipped-but-not-hand-verified until they run.

**What it is:** `lib/floor/suggest.ts` — a render-time NUDGE on each rail card, computed in
`getFloorRail` per card. It reuses the LIVE `evaluateDispatchSlot` (engine owned by **CORE §7.4** —
never re-implemented, so the hint and the auto-enrich path cannot disagree) with two gates
deliberately neutralised via literals: `smu: "Deco Retail"` and `dispatchStatus: "dispatch"` — the
engine's gates answer "may I slot this WITHOUT a human?", the rail hint answers "if I release this
now, which slot?", which the operator asks of every SMU. `input.smu` stays on `SuggestInput` for
future "why this slot" copy — input, not a gate.

- **Clock discipline:** arrival clocks go through `resolveArrivalClocks()`
  (`lib/dispatch/punch-clock.ts` — single owner, **CLAUDE_IMPORT.md §12.1b**; the import auto-slot
  call site uses the SAME function). This matters MOST here: the rail renders every bill, and 1,854
  of 9,521 orders carry a date-only `orderDateTime` (audit 2026-08-03) — without the guard, each was
  eligible for a confident teal one-click button built on a fake 05:30.
- **Tint, full OBD only:** a finished full tint OBD anchors on `tint_assignments.completedAt`,
  which **REPLACES both arrival clocks** (passed as the single clock; punchDateTime null — the
  engine's single-clock path). Feeding completion ALONGSIDE the punch would invoke the dual-clock
  merge and could hand back the punch on a cross-day bill. Replace, never add. Splits → no
  suggestion (v1 scope). Mid-tint → no suggestion (arrival clock would offer 12:30 to a bill still
  on the mixer).
- **60-minute grace (`SUGGESTION_GRACE_MINUTES`):** a batch stays OPEN for one hour past its window
  time; past that → no suggestion, operator decides — **deliberately NO roll-forward** to a later
  window. Why 60: (a) import lag (~15-20 min measured) means near-cutoff bills arrive pre-expired —
  without grace they could never show a suggestion; (b) **safety proof: the smallest inter-window
  gap is 10:30→12:30 = 120 min, so 60 can never overlap the next window. Do not raise past 120.**
- **The closed-batch test** is epoch arithmetic on absolute instants (window minutes − IST offset +
  grace, on `r.targetDate`'s UTC-midnight epoch) — it replaced the two old arms (past-date string
  compare + minutes-since-IST-midnight), whose within-a-day blindness was the original 23-Jul
  "Release to Wed 16:00 on a Thursday" bug. Never reintroduce a per-day arm, and never
  `Date.parse` an offset-less string here (CORE §3).
- **UI (`rail-card.tsx`, commit `dd871c41`):** teal split button — body tap = release with that slot
  via the existing `POST /api/floor/release` (writes `dispatchSlotSource='manual'`); `▾` opens the
  existing picker pre-highlighted on the suggested day+window. Without a suggestion: unchanged
  controls + grey "Why no slot?" reveal (neutral copy, **no red/amber** — a missing suggestion is a
  "you decide", not an error). Teal is the only filled element on the row; green stays "Done".
- **Design principle — a nudge, never a lock.** Nothing is written until the operator clicks. A
  completed tint bill is deliberately NOT given a window at completion: `hasPresetSlot` in both tint
  "done" routes would flip it to `dispatchStatus='dispatch'` and it would **leave the rail
  entirely**, robbing the operator of the confirm step.
- **Picker props (additive, `dispatch-slot-picker.tsx`):** `suggested` (highlight only — `value`
  always wins; a committed slot is never visually overridden by a proposal) + `hideTrigger`. Every
  other call site omits both and is byte-identical.

## 8b. Deferred / not built [DEFERRED]

- **`byAssigned` on Floor — RESOLVED + SHIPPED (commit `661e4e61`, this session).** Formerly an open question ("decide whether `byAssigned` is right for this screen"). Decided: it is deliberately **excluded** from Floor's sort — Floor sorts with `FLOOR_SPINE` (the picking spine **minus `byAssigned`**, `lib/floor/sort.ts`), so Assigned/Done rows hold their place instead of sinking/rising on each status change, and the `#` column now numbers **every** row, not just Waiting. Full detail: §3.
- **§7-gap follow-ups:** `Waiting` pills show no elapsed time (needs `releasedAt` on the floor payload); the ship-to original→redirect name pair is missing on the floor table (rail already has it); rail button reads lowercase "pick slot" vs mockup "Set slot"; assign bar reads "Change slot" beside a "pick slot" button; no picker search (matches customer/route/OBD only); detail-panel header pill shows no elapsed time (not a live surface).
- **Out of scope for v1 (deliberate):** gift lines (no identifier exists anywhere in the codebase — no heuristic invented); free-text ship-to (needs a schema decision); a per-row Slot column on the All view (the band header carries it); the stats line / "pickers free" tile / floor-idle alarm (removed per design §7.13).

---

## 9. Support retirement — DONE 2026-07-27 [LIVE]

`/support` is **retired**. Screens, API routes and its spec live at `archive/2026-07-support/` — nothing there is compiled, deployed or reachable. Commits `bc42a948` → `62a2928c` (8 steps: extract shared code → Floor's own ship-to routes → nav → screens → API routes + page keys → orphaned links → docs). Full story, including what stayed in the database and why: `archive/2026-07-support/README.md`.

**What Floor absorbed** — all now owned by this file, not borrowed:

| Was | Now |
|---|---|
| `components/support/dispatch-slot-picker.tsx` | `components/floor/dispatch-slot-picker.tsx` |
| `formatArticleTag` (Support's shared table cells) | `lib/floor/format.ts` |
| `GET /api/support/ship-to-search` · `PATCH /api/support/orders/[id]` | `GET /api/floor/ship-to-search` · `POST /api/floor/ship-to` (§4.4 — rewritten, not copied) |

## 9b. Picking DESKTOP retirement — DONE 2026-07-28 [LIVE]

The Picking **desktop** board is retired. `components/picking/picking-queue.tsx` lives at
`archive/2026-07-picking-desktop/`; commits `90c9a865` → `561368da`. Full story in that folder's
README. **`/picking` itself STAYS LIVE** — same route, same permissions, same login landing for
`floor_supervisor` and `picker`; it renders the card board at every width now, branching by role.
Picking is hidden from the DESKTOP sidebar only; the phone Menu sheet keeps its entry.

**Shape worth noting: this was NOT a route retirement.** One branch was removed from inside a live
route — no page key removed, no permission row cleared, no orphaned DB rows to clean.

**What Floor borrowed from Picking — the dependency list this section used to carry as a blocker.
Nothing had to move: all three survived and Floor still imports them.**

| Dependency | What happened |
|---|---|
| `POST /api/picking/assign` · `/unassign` | **Untouched, still called by Floor** (§4.3) and by the surviving supervisor board |
| The sort rule objects + `sortPickingQueue()` (`lib/picking/sort.ts`) | **Untouched.** Still imported by `lib/floor/sort.ts` → `FLOOR_SPINE`, `lib/floor/queries.ts` and `components/floor/floor-board.tsx` |
| `lib/hooks/use-picking-marker.ts` | **Untouched behaviourally.** Four call sites became three; Floor's (`floor-page.tsx`, via the `url` param) is one of them. Only the dead `"rolling"` value left its `MarkerScope` union |

⚠ Two things DID go, and neither was Floor's: the `rolling` queue scope and the four payload
counters (`windows[]`/`totalCount`/`unmatchedCount`/`assignedCount` + `isStillWaiting`). Floor never
read either — it has its own predicate (`floorLiveBaseWhere`, §3) and counts off its own rows.

---

## 10. Landmines [LANDMINE]

- **`RAIL_SUGGESTIONS_ENABLED = true` since 2026-08-03** (`lib/floor/queries.ts`) — the suggestion layer is LIVE (§8). The staleness protection is the single closed-batch MOMENT test in `suggest.ts`; **never reintroduce a per-day arm** (minutes-since-midnight was the original bug), and the 60-min grace must never exceed 120 (§8's proof).
- **Slot tabs group by `windowTime` ALONE, ignoring `dispatchTargetDate`** (the `tabRows` filter in `floor-board.tsx` — verified 2026-08-04). Bills due on different DATES stack under one tab, separated only by the age chip — a real "wrong slot?" illusion generator, distinct from the fixed clock bug.
- **The floor row displays `orderDateTime` while the slot was decided by `obdEmailDate`** (via `pickEffectiveClock`) — the operator sees two numbers that cannot be reconciled from anything on screen. Display gap, not a data bug.
- **`change-slot` never clears `dispatchSlotRuleId`** (`app/api/floor/actions/route.ts` — write verified 2026-08-04: sets date+window+`source:'manual'` only). 6 live rows (2026-08-03 count) carry an engine rule id beside a human-picked window — harmless today, misleading in any future audit. One-line fix, owner decision (ROADMAP).
- **Picker `suggested` prop is highlight-ONLY** — `value ?? suggested` precedence in `dispatch-slot-picker.tsx`; wiring `suggested` into the trigger's committed/filled look would make a proposal read as a decision.
- **The import-side twins of the clock bug live in IMPORT, not here:** `obdEmailDate` fake-midnight population + the `arrivalSlotId` Morning defect + `import_raw_summary.obdEmailTime` not-source-of-truth → `CLAUDE_IMPORT.md §12.1b`/`§12`/landmines. Cross-ref only.
- **`heldAt` is the ARRIVAL date, not the hold time** — the write is intentional and inherited from Support (§4.5); thousands of historical rows depend on it. Do NOT "fix" it to wall-clock; the Hold tab already handles it on the read side. Reading `heldAt` as "held since" shows a 3-week-old bill held 5 min ago as "21 days".
- **The board and the marker MUST stay on the one shared predicate** `floorLiveBaseWhere` (§3/§5). Re-declaring the WHERE in either place reintroduces the marker/queue drift the Picking §10 landmine warns about.
- **Never add a second `orders.update` (or a log write to the dispatch engine)** in any floor path — the marker keys on `MAX(orders.updatedAt)`; a second write fires a false "changed" on every board.
- **Delivery-type scope is applied CLIENT-SIDE in the feeds** — the DB queries return all types. A future "just filter in SQL" change would desync the marker (which watches all types) from the board.
- **`dispatched`-stage rows exist** — SELECT 2026-07-24: 1,051 at `workflowStage='dispatched'` (662 `dispatchSlotSource='auto'`), 195 at `pick_checked`; `dispatched` stops 21 Jul while `pick_checked` keeps growing. The §7 backfill (238 rows) was a one-time manual sweep, not a code path. The surviving gap — **no automatic drain `pick_checked` → `dispatched`** — is owned by `CLAUDE_PICKING.md §7` (it moved out of that file's §9 on 2026-07-28 when §9 collapsed; the gap is unrelated to the desktop board and is still open).
- **Parked data issues (not Floor bugs):** `Deco` (9 rows) — un-mapped raw XLS SMU value that should be `Deco Retail`, so those bills silently never auto-slot; **103 Deco Retail bills reached `pending_support` with `dispatchStatus` NULL** (engine fires only on `='dispatch'` — something upstream isn't setting it; worth a diagnosis session); four identical `Shree Rang Sarita` bills (22 Jul 18:31, 140 L, different OBDs — dup import unconfirmed); a `SAT FIN 93 BASE 3.7L` line carries pack chip `4L` so litres compute 16 vs 14.8 (a catalog value, Chandresh's cleanup list); three test bills marked urgent 23 Jul (clear unless genuine).

---

## 11. Key files index

| File | Role |
|---|---|
| `app/(floor)/floor/page.tsx`, `layout.tsx` | Route shell |
| `components/floor/floor-page.tsx` | Composition root — state, search/filter, live-sync mounts, detail wiring |
| `components/floor/floor-rail.tsx`, `rail-card.tsx`, `tint-strip.tsx`, `rail-empty.tsx` | Left rail |
| `components/floor/floor-board.tsx`, `floor-tabs.tsx`, `slot-band.tsx`, `route-row.tsx`, `floor-table.tsx`, `status-pill.tsx`, `progress-bar.tsx`, `carryover-banner.tsx`, `upcoming-strip.tsx` | Floor pane |
| `components/floor/picker-card.tsx` | **By picker** — the third view pivot beside Flat / By route (2026-08-11), and **the view `/floor` LANDS on** (`mode` defaults to `"picker"`): the operator's first question is "who is free", not "what is in the 10:30 window". One card per active picker, seeded from the roster so a picker with nothing on him still shows "Free". Its article figure is a TYPED breakdown ("18 D · 14 C") via `formatArticleBreakdown()` (`lib/floor/format.ts`) — which is why `parseArticleTag`/`aggregateArticleTags`/`TYPE_ORDER` were moved out of `lib/article-tag.ts` into the dependency-free **`lib/article-tag-parse.ts`** (that module imports prisma, and `lib/prisma.ts` constructs a client at module scope, so a `"use client"` file could not reach them without pulling PrismaClient into the browser bundle); `lib/article-tag.ts` re-exports them, so its four existing callers are untouched and the RULE still lives there. ⚠ A short-lived `FloorBoardRow.totalArticle` (added and removed the same day) was superseded by that breakdown — see `lib/floor/types.ts`. ⚠ **This view reads `dueRows`, NOT `tabRows` — it ignores the slot tab ON PURPOSE**, because a picker's load spans every window and scoping his card to the open tab would understate what is on him; the branch sits ABOVE `floor-board.tsx`'s `slotTab === "all"` check to keep that true. Busy tiers read `pick_assignments.assignedAt` (30m amber / 60m red), never `ageDays` — that is day-granular and anchored on `dispatchTargetDate`, i.e. how overdue the BILL is, not how long the PERSON has held it. Cards are fixed alphabetical, not worst-first (same reason `FLOOR_SPINE` drops `byAssigned`, §3). |
| `components/floor/assign-context-banner.tsx` | The "Assigning to {name}" band shown while a picker card is open (2026-08-11) — pending-vs-current toggle + cancel. Floor's OWN component: `components/mail-orders/instructions-strip.tsx` was evaluated and rejected (its per-row caption is derived from the prop name and cannot be suppressed, and it belongs to Mail Orders / the Billing v2 face). It reuses `tint-strip.tsx`'s violet tokens rather than new ones, so the shade still has one owner. |
| `components/floor/assign-bar.tsx` | Bulk assignment bar (calls Picking assign/unassign). Optional `lockedPicker` skips the "which picker" dropdown when the operator arrived from a picker card. |
| `components/floor/hold-tab.tsx`, `hold-bar.tsx`, `cancelled-tab.tsx`, `pdf-preview.tsx` | Hold + Cancelled tabs, Hold-report PDF |
| `components/floor/detail-panel.tsx`, `detail-items.tsx`, `detail-details.tsx`, `detail-activity.tsx` | Detail panel |
| `components/floor/search-box.tsx`, `filter-sheet.tsx`, `connection-strip.tsx`, `floor-skeleton.tsx` | Search/filter, connection strip, skeleton |
| `lib/floor/queries.ts` | The 4 feeds + `floorLiveBaseWhere` / `getFloorLiveMarkerWhere` + `RAIL_SUGGESTIONS_ENABLED` |
| `lib/floor/types.ts`, `selection.ts`, `search.ts`, `filter.ts`, `hold-log.ts`, `hold-pdf.ts`, `release-stages.ts`, `suggest.ts` | Types, selection, search/filter, hold notes + PDF, releasable stages, **slot suggestion (LIVE — §8)** |
| `lib/dispatch/punch-clock.ts` | `hasClockTime` + `resolveArrivalClocks` — which clocks the engine may see (owned by `CLAUDE_IMPORT.md §12.1b`; suggest.ts is its second consumer) |
| `lib/floor/use-floor-rail-poll.ts` | Rail 30s poll |
| `app/api/floor/board/route.ts` | Rail + floor board + pickers |
| `app/api/floor/hold/route.ts`, `cancelled/route.ts` | Hold / Cancelled feeds |
| `app/api/floor/release/route.ts`, `actions/route.ts` | Release / state actions (422-on-total-failure) |
| `app/api/floor/order/[orderId]/route.ts` | Detail payload |
| `app/api/floor/marker/route.ts` | Live-sync marker (floor-exact set) |
| `lib/dispatch/dispatch-engine.ts` | Auto-slot engine (reused; **owned by CORE §7.4**) |

---

## Change log — v1.4 (2026-08-04 reconciliation pass, method v1.1)

Evidence: 12 commits git-verified, suggest.ts/queries.ts/rail-card/picker/actions-route/floor-board read at the call sites, the 08-03 draft's dated counts cited as-dated. Claim IDs from the session report.

- FLR-1 (§8, §10, §2, §11): the rail slot suggestion is LIVE (`RAIL_SUGGESTIONS_ENABLED = true`, 2026-08-03) — §8 rewritten from "DEFERRED" to the full layer spec (neutralised gates, punch-clock discipline, tint completion anchor, 60-min grace + ≤120 proof, closed-batch moment test, nudge-never-lock + the `hasPresetSlot` trap, picker props); hand-verification marked PENDING. Old deferred entry → §8b.
- FLR-2 (§4.6 NEW): the 2026-07-26 action-surfaces specs land — assign bar (incl. deliberately-removed bulk actions), panel-header teal-per-state, picker commit-on-tap/honest-highlight/auto-flip, and the toggle-all/single-Esc-owner spec (open since the 08-04 step-2 flag). The draft's four CLAUDE_SUPPORT-routed items re-routed here (picker + ship-to are Floor-owned since `316eec6b`).
- FLR-3 (§10): three 08-03 floor landmines added (windowTime-only tabs, orderDateTime-vs-obdEmailDate display, change-slot keeps `dispatchSlotRuleId`) — each verified at its call site; import-side twins cross-referenced, not restated.
- FLR-4 (§6c): the "done = check date" convention cross-referenced to MAIL_ORDERS §23.4 + the pending PICKING doc.
- FLR-5 (header/footer): the footer date-drift open item fixed — version + date now at both ends.
- Support mentions (11): all verified legitimate (ownership/origin pointers) — none removed; §9's absorbed-assets table already says Floor owns them now.

- Schema stamp -> v27.13 (final-pass 12b, 2026-08-05).

---

*CLAUDE_FLOOR.md v1.4 · Schema v27.13 · OrbitOMS · updated 2026-08-04*
