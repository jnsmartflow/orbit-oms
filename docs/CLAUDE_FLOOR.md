# CLAUDE_FLOOR.md — Floor Control
# v1.0 · Schema v27.12 · July 2026
# Lives in: orbit-oms/docs/
# Load with: CLAUDE.md (repo root) + docs/CLAUDE_CORE.md + docs/CLAUDE_UI.md

Covers `/floor` — the desk operator's unified board: decide which bills go to the floor, and watch what happens to them there.

---

## 1. What Floor Control is [LIVE]

One desk screen that consolidates the **Support board** and the **Picking desktop board** into a single surface for one person — the operator who releases bills to the floor and watches them get assigned, picked and checked.

**Route:** `/floor` (`app/(floor)/floor/page.tsx`). Hand-rolled shell, NOT `UniversalHeader` (§10).

**Access:** pageKey `"floor"` in `lib/permissions.ts` (in the `PageKey` union, `ALL_PAGE_KEYS`, and `PAGE_NAV_MAP` → `/floor`). v1 grant = **admin + operations only**, `canView`+`canEdit`, present in BOTH `prisma/seed.ts` and live `role_permissions` (SQL, 2026-07-23). `dispatch planner` / `telecaller` (named in the design) are **[DEFERRED]** — `dispatch planner` has no matching slug, `telecaller` does not exist.

### Ownership boundary — READ BEFORE EDITING ANYTHING FLOOR

Floor Control **reuses Support and Picking as a CALLER**. It did NOT fork or modify them — no Support/Picking component or API file was changed. The one shared edit was `lib/hooks/use-picking-marker` gaining **optional** params (`url`, `onProbe`); all three Picking call sites pass neither and are byte-identical.

| This file OWNS | This file does NOT own — cross-reference only, never restate |
|---|---|
| the left/right split (§2) | assign / unassign + the sort spine → **`CLAUDE_PICKING.md §3/§4`** |
| the 4 read feeds (§3) | ship-to override + `dispatch-slot-picker` → **`CLAUDE_SUPPORT.md §4.18/§4.10`** |
| floor routes: hold / cancel / release / change-slot (§4) | the dispatch engine (`evaluateDispatchSlot`) → **`CLAUDE_CORE.md §7.4`** |
| the detail panel (§4.6) | |
| the held-since read-side rule (§4.5) | |
| floor live-sync + `/api/floor/marker` (§5) | |
| the hand-rolled header divergence (§10) | |

If you find yourself explaining borrowed behaviour here, replace it with a pointer.

### Both old surfaces are STILL LIVE

`/support` (`app/(support)/support/page.tsx`) and `/picking` (`app/picking/page.tsx`) are **both live and reachable today** — `middleware.ts` `PHASE1_BLOCKED` is `[]`, nothing is blocked. Picking's **mobile** supervisor + picker boards also stay. Retiring the DESKTOP tabs is **intended but NOT actioned and has no plan yet** — see §9.

---

## 2. The screen [LIVE]

One rule the operator learns: **left = not on the floor, right = on the floor.**

- **Left rail (344px) — "Needs your decision".** Cards, one per bill. Holds ONLY bills the dispatch engine could not auto-slot (having no slot is *why* they are here). A bill the engine successfully slotted never appears on the rail — it is already on the right, carrying its stored `dispatchTargetDate`/`dispatchWindowId`. Oldest-first, always; never filtered by search/slot/route/date — only the header delivery-type scope narrows it (search only HIGHLIGHTS a matching rail card, never hides it). Each card: `[ pick slot ] [ Hold ] [ ✕ ]` (no Release button, no suggestion — §8). Tint bills show a live tint strip and a slot picker disabled until all shades are done.
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
| Floor board | `getFloorBoard({mode,date,scope})` | `GET /api/floor/board` | **Live:** `floorLiveBaseWhere` (below). **History:** released bills dated D (`dispatchTargetDate=D`, active stages) — read-only. |
| Hold | `getFloorHold(scope)` | `GET /api/floor/hold` | `dispatchStatus="hold"`, all dates (pure open state), recent-held-first. |
| Cancelled | `getFloorCancelled(scope)` | `GET /api/floor/cancelled` | `workflowStage="cancelled"`, **today only** (IST, by the cancel log's `createdAt`). |

Also `getFloorPickers()` (active picker roster + on-hand load, for the assign bar). `GET /api/floor/board` returns `{ rail, floor, pickers }`; each route gates on `checkAnyPermission(roles,"floor","canView")`.

**`floorLiveBaseWhere(todayRange)` — the live predicate, SHARED by the board and the marker** (so they cannot drift, §5). Two arms:
1. everything still OPEN — `workflowStage ∈ PICKING_OPEN_STAGES` (pending_picking / pick_assigned / pick_done), **any** dispatch date. Floor's carry-over arm (design §4.2).
2. everything the floor **CHECKED TODAY** — `workflowStage=pick_checked` AND `pick_assignments.checkedAt ∈ getISTDayRange()` (today, IST), whatever day it was due.

Plain English: everything still open whatever day it was due, plus everything the floor finished today whatever day it was due.

⚠ **Floor's carry-over is its OWN scope — NOT `lib/picking/queue.ts`'s WHERE.** Picking's carry-over deliberately excludes `pick_done`/`pick_checked` (a documented "workaround, not a fix"). Floor's arm 1 keeps anything not-yet-checked. Do not "align" the two.

Per row: `zone` (`due` | `upcoming`, from `dispatchTargetDate` vs today) and `ageDays`. Rows are spine-sorted by **`lib/picking/sort.ts`** (reused, never copied — the spine is owned by `CLAUDE_PICKING.md §3`).

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

**Releasable stages — `FLOOR_RELEASABLE_STAGES = ["pending_support","pending_picking"]`** (`lib/floor/release-stages.ts`). Deliberately **NOT** Support's `supportMayEdit()` — borrowing it would couple Floor's release gate to Support's permission model. `pending_support` = a rail bill; `pending_picking` = a bill held after auto-dispatch (hold flips status only, never stage). Same 422/partial contract as §4.1.

### 4.3 Assign / unassign

**Reused from Picking, unchanged** — Floor calls `POST /api/picking/assign` and `/api/picking/unassign` as a caller. Reassign = unassign (only if already assigned) then assign. → behaviour owned by **`CLAUDE_PICKING.md §4`**.

### 4.4 Ship-to change (detail panel)

**Reused from Support as a CALLER** — search `GET /api/support/ship-to-search`, write `PATCH /api/support/orders/[id]` with `{ shipToOverrideCustomerId }`. ⚠ That Support route uses `prisma.$transaction`; Floor is only a caller, no `$transaction` in any Floor file. → owned by **`CLAUDE_SUPPORT.md §4.18`**.

### 4.5 Held-since — READ-SIDE rule [LIVE]

`orders.heldAt` stores the bill's **arrival** date (`obdEmailDate`), NOT the moment it was held — matching Support (`CLAUDE_SUPPORT.md §4.9`), which anchors its amber hold footprint to arrival. **The write was NOT changed** (flipping it to `now` would move Support's footprint). The Hold tab needs the opposite, so "held since" is derived on the READ side in `getFloorHold()`:
- Take the hold **event's** wall-clock `order_status_logs.createdAt`, identified by the log **NOTE** via the shared constant `HOLD_LOG_NOTES` (`lib/floor/hold-log.ts`) — never a sentinel `toStage` (which would pollute the stage ladder). Matches the Floor note AND Support's two hold notes (`"Placed on hold by support"`, `"Placed on hold by support (bulk)"`), so a Support-held bill groups correctly.
- Fallback ladder: hold log → `orders.heldAt` (rendered with a leading `~` + "approximate" tooltip; enrichment holds write no log) → unknown (banded separately under "Held date unknown"). Nothing can silently read as "held today".

### 4.6 Detail panel [LIVE]

`GET /api/floor/order/[orderId]` (floor `canView`) returns one payload: header + Details + Items + Activity. Items resolve via `sku_master_v2` on `material === skuCodeRaw` (CORE §13 — never a sku id), raw-text fallback preserved, gift lines out of scope. Activity = `order_status_logs` + ONE synthetic "auto-slot" line derived from `dispatchSlotSource`/`dispatchSlotRuleId` and labelled "enrichment" (the engine writes no log — do not add one; §5). 472px slide-in; primary action + Change ship-to + Update slot + ⋯ ; Prev/Next walks the source list.

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
- **(c) A carried-over bill vanished the instant it was checked.** *Root cause:* the live "checked" arm fenced on `dispatchTargetDate = today`, so a bill due earlier failed both arms the moment it reached `pick_checked`. *Fix:* the checked arm now fences on `pick_assignments.checkedAt` within today's IST range (§3) — a bill can never disappear at completion.

---

## 7. Live-data cleanup [LIVE] — completed one-off, do NOT repeat

**2026-07-23.** The rail opened with **261** undecided bills; only 23 were from the last two days, 151 over a week old. Confirmed the goods had physically shipped weeks earlier and the system was simply never updated. **238 bills** (older than 2 days) were closed to `workflowStage='dispatched'`, each with an `order_status_logs` row *"Bulk backfill: goods dispatched, never recorded in system"*. Rail 261 → 23; Support's pending backlog cleared by the same 238. Two of the 238 were `tinting_in_progress` with open splits — splits deliberately left alone.

This is a **completed one-off**, not a runbook. (It is also the source of the `dispatched`-stage rows to reconcile in `CLAUDE_PICKING.md`.)

---

## 8. Deferred / not built [DEFERRED]

- **v2 slot suggestion (Step 10).** `lib/floor/suggest.ts` is intact but gated behind `RAIL_SUGGESTIONS_ENABLED = false` in `lib/floor/queries.ts` — flip that one constant to re-enable. Every rail card renders `[ pick slot ] [ Hold ] [ ✕ ]`; the operator always picks the slot. Two things must change first: (1) the staleness check must compare the **full moment (date + time)** vs now, not minutes-since-midnight (the bug that caused removal — §10); (2) the suggestion must carry date AND time. Deferred until v1 has been used.
- **§7-gap follow-ups:** `Waiting` pills show no elapsed time (needs `releasedAt` on the floor payload); the ship-to original→redirect name pair is missing on the floor table (rail already has it); assigned rows sink to the bottom (decide whether `byAssigned` is right for this screen); rail button reads lowercase "pick slot" vs mockup "Set slot"; assign bar reads "Change slot" beside a "pick slot" button; no picker search (matches customer/route/OBD only); detail-panel header pill shows no elapsed time (not a live surface).
- **Out of scope for v1 (deliberate):** gift lines (no identifier exists anywhere in the codebase — no heuristic invented); free-text ship-to (needs a schema decision); a per-row Slot column on the All view (the band header carries it); the stats line / "pickers free" tile / floor-idle alarm (removed per design §7.13).

---

## 9. Retirement of the old tabs [NEXT]

Retiring `/support` and the Picking **desktop** board is **INTENDED but unplanned** — nothing is switched off, no trigger is set. Draft §8 #6 requires a **retirement DEPENDENCY LIST first**: exactly what Floor leans on before anything is turned off — the Picking assign/unassign endpoints, the sort spine, the Support dispatch-slot-picker, `formatArticleTag`, and the `use-picking-marker` hook — so the retirement is deliberate, not a surprise breakage. → **ROADMAP** (dependency list + a concrete trigger).

---

## 10. Landmines [LANDMINE]

- **`RAIL_SUGGESTIONS_ENABLED = false`** (`lib/floor/queries.ts`) — the slot suggestion is gated OFF; `lib/floor/suggest.ts` (which calls the live `evaluateDispatchSlot`) is intact behind it. Flipping the constant re-enables it — but the staleness bug in §8 must be fixed first, or "Release to Wed 16:00" reappears on a Thursday.
- **`heldAt` is the ARRIVAL date, not the hold time** — the write is intentional and shared with Support (§4.5). Do NOT "fix" it to wall-clock; the Hold tab already handles it on the read side. Reading `heldAt` as "held since" shows a 3-week-old bill held 5 min ago as "21 days".
- **The board and the marker MUST stay on the one shared predicate** `floorLiveBaseWhere` (§3/§5). Re-declaring the WHERE in either place reintroduces the marker/queue drift the Picking §10 landmine warns about.
- **Never add a second `orders.update` (or a log write to the dispatch engine)** in any floor path — the marker keys on `MAX(orders.updatedAt)`; a second write fires a false "changed" on every board.
- **Delivery-type scope is applied CLIENT-SIDE in the feeds** — the DB queries return all types. A future "just filter in SQL" change would desync the marker (which watches all types) from the board.
- **`dispatched`-stage rows exist** — SELECT 2026-07-24: 1,051 at `workflowStage='dispatched'` (662 `dispatchSlotSource='auto'`), 195 at `pick_checked`; `dispatched` stops 21 Jul while `pick_checked` keeps growing. The §7 backfill (238 rows) was a one-time manual sweep, not a code path. The surviving gap — **no automatic drain `pick_checked` → `dispatched`** — is owned by `CLAUDE_PICKING.md §9`.
- **Parked data issues (not Floor bugs):** `Deco` (9 rows) — un-mapped raw XLS SMU value that should be `Deco Retail`, so those bills silently never auto-slot; **103 Deco Retail bills reached `pending_support` with `dispatchStatus` NULL** (engine fires only on `='dispatch'` — something upstream isn't setting it; worth a diagnosis session); four identical `Shree Rang Sarita` bills (22 Jul 18:31, 140 L, different OBDs — dup import unconfirmed); a `SAT FIN 93 BASE 3.7L` line carries pack chip `4L` so litres compute 16 vs 14.8 (a catalog value, Chandresh's cleanup list); three test bills marked urgent 23 Jul (clear unless genuine).

---

## 11. Key files index

| File | Role |
|---|---|
| `app/(floor)/floor/page.tsx`, `layout.tsx` | Route shell |
| `components/floor/floor-page.tsx` | Composition root — state, search/filter, live-sync mounts, detail wiring |
| `components/floor/floor-rail.tsx`, `rail-card.tsx`, `tint-strip.tsx`, `rail-empty.tsx` | Left rail |
| `components/floor/floor-board.tsx`, `floor-tabs.tsx`, `slot-band.tsx`, `route-row.tsx`, `floor-table.tsx`, `status-pill.tsx`, `progress-bar.tsx`, `carryover-banner.tsx`, `upcoming-strip.tsx` | Floor pane |
| `components/floor/assign-bar.tsx` | Bulk assignment bar (calls Picking assign/unassign) |
| `components/floor/hold-tab.tsx`, `hold-bar.tsx`, `cancelled-tab.tsx`, `pdf-preview.tsx` | Hold + Cancelled tabs, Hold-report PDF |
| `components/floor/detail-panel.tsx`, `detail-items.tsx`, `detail-details.tsx`, `detail-activity.tsx` | Detail panel |
| `components/floor/search-box.tsx`, `filter-sheet.tsx`, `connection-strip.tsx`, `floor-skeleton.tsx` | Search/filter, connection strip, skeleton |
| `lib/floor/queries.ts` | The 4 feeds + `floorLiveBaseWhere` / `getFloorLiveMarkerWhere` + `RAIL_SUGGESTIONS_ENABLED` |
| `lib/floor/types.ts`, `selection.ts`, `search.ts`, `filter.ts`, `hold-log.ts`, `hold-pdf.ts`, `release-stages.ts`, `suggest.ts` | Types, selection, search/filter, hold notes + PDF, releasable stages, slot suggestion (gated) |
| `lib/floor/use-floor-rail-poll.ts` | Rail 30s poll |
| `app/api/floor/board/route.ts` | Rail + floor board + pickers |
| `app/api/floor/hold/route.ts`, `cancelled/route.ts` | Hold / Cancelled feeds |
| `app/api/floor/release/route.ts`, `actions/route.ts` | Release / state actions (422-on-total-failure) |
| `app/api/floor/order/[orderId]/route.ts` | Detail payload |
| `app/api/floor/marker/route.ts` | Live-sync marker (floor-exact set) |
| `lib/dispatch/dispatch-engine.ts` | Auto-slot engine (reused; **owned by CORE §7.4**) |

---

*CLAUDE_FLOOR.md v1.0 · Schema v27.12 · OrbitOMS*
