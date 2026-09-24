# CLAUDE_FLOOR.md — Floor Control
# v1.8 · Schema v27.24 · September 2026 · updated 2026-09-24
# Lives in: orbit-oms/docs/
# Load with: CLAUDE.md (repo root) + docs/CLAUDE_CORE.md + docs/CLAUDE_UI.md (+ docs/CLAUDE_FLOOR_TRIPS.md for anything trip-shaped)

Covers `/floor` — the desk operator's trip desk: plan which bills go on which truck, and watch what happens to them on the floor.

---

## 1. What Floor Control is [LIVE]

One desk screen for one person — the planner who puts bills on trucks and watches them get assigned, picked and checked. It was built to consolidate the **Support board** and the **Picking desktop board**; both have since been retired (2026-07-27 and 2026-07-28, §9 / §9b), so Floor is not "the merged view" any more — it is the only desk view. Since 2026-09-10 (`bbb9628c`) the Floor tab is the **trip desk**: trips on the left, bills on the right (§2).

**Route:** `/floor` (`app/(floor)/floor/page.tsx`). Hand-rolled shell, NOT `UniversalHeader` (§10).

**Access — name the union each time.** Two different things carry the word "floor":
- **PageKey `floor`** (`lib/permissions.ts:209`, in `ALL_PAGE_KEYS` and `PAGE_NAV_MAP` → `/floor`). Every floor route gates on it through `checkAnyPermission(roles, "floor", …)`.
- **Role slug `floor_access`** (`role_master` id 017, live 2026-09-18 Q07a) — a role, not a page key. 4 holders via `user_roles` (live 2026-09-18 Q07b: Ajay Vansiya #29, Dhanraj Shah #30, Prakash #32, Priya Chaudhari #31).

**How access is decided today: per-user ticks.** Live `ACCESS_SOURCE = user` (live 2026-09-18 Q02). In user mode `checkAnyPermission` returns the user's own `user_page_access` row for the page (`userPagePerms`, `lib/permissions.ts:801-806`); role rows are not consulted, except that the `admin` role slug and the superuser flag short-circuit to true (`:795`, `:799`). Live `floor` ticks: rows=39 · canView=6 · canEdit=6 · canExport=1 (live 2026-09-18 Q03a); **0** users hold floor canView without canEdit (Q07c). So holding the `floor_access` role slug is not what grants the page in user mode — the ticks are. **Seed says** `admin` + `operations` only, `canView`+`canEdit` (`prisma/seed.ts:117-118`); that is the role-mode seed, not the live grant. ⚠ **`floor_supervisor` and `picker`** are the `/picking` roles; `/floor` is not a fallback for them, which is why the Picking desktop retirement kept `/picking` live rather than redirecting (§9b). Access model: `CLAUDE_CORE.md §5`.

### Ownership boundary — READ BEFORE EDITING ANYTHING FLOOR

Floor Control **reuses Picking as a CALLER**. It did NOT fork or modify it — no Picking component or API file was changed. The one shared edit was `lib/hooks/use-picking-marker` gaining **optional** params (`url`, `onProbe`); all three Picking call sites pass neither and are byte-identical. Support was also a lender until its retirement; everything Floor borrowed from it now lives under `lib/floor/` or `app/api/floor/` and is **owned by this file** (§9).

| This file OWNS | This file does NOT own — cross-reference only, never restate |
|---|---|
| the screen shell: the four top tabs, `TripDesk`'s three states and layout, the bill table (§2, §4.9) · Floor's `FLOOR_SPINE` sort LIST (`lib/floor/sort.ts`, §3) | assign / unassign + the sort rule OBJECTS + `sortPickingQueue` → **`CLAUDE_PICKING.md §3/§4`** |
| the read feeds and the board predicate `floorBoardWhere` + its four arms (§3) | the dispatch engine (`evaluateDispatchSlot`) → **`CLAUDE_CORE.md §7.4`** |
| floor routes: hold / cancel / restore / release / change-slot / mark-urgent (§4) | **trips**: tables, `lib/trips/*`, `/api/floor/trips/*`, numbering, drops, which trips a desk shows, Show to floor / the pick gate, Send to billing, the "no trip action changes a bill" rule → **`CLAUDE_FLOOR_TRIPS.md`** |
| ship-to search + save (§4.4) · the dispatch-slot picker (`components/floor/dispatch-slot-picker.tsx`) · `formatArticleTag` + `resolveFloorDisplayDate` (`lib/floor/format.ts`) | how a new bill reaches the floor without a release step → **`applyNoMailOrderFallback`** (`app/api/import/obd/route.ts`, `CLAUDE_IMPORT.md`) |
| the action surfaces — bottom bar / panel header / slot picker / selection+Esc (§4.6) | the Billing Print tab that Send to billing feeds → **`CLAUDE_BILLING.md §7`** |
| the detail panel, incl. the tint lock (§4.7) and tint on the floor (§4.8) | |
| the held-since read-side rule (§4.5) | |
| floor live-sync + `/api/floor/marker` (§5) | |
| the hand-rolled header divergence (§10) | |

If you find yourself explaining borrowed behaviour here, replace it with a pointer.

### What is still live alongside Floor

`/picking` (`app/picking/page.tsx`) is **live and reachable** — `middleware.ts` `PHASE1_BLOCKED` is `[]`. Its supervisor + picker card boards were never in scope for retirement and stay; they now render at EVERY width. **The Picking DESKTOP board is RETIRED** — 2026-07-28, `archive/2026-07-picking-desktop/` (§9). **`/support` is gone** — retired 2026-07-27, §9.

---

## 2. The screen [LIVE]

`components/floor/floor-page.tsx` is the composition root; the Floor tab renders `<TripDesk>` (`components/floor/trip-desk.tsx`, since `bbb9628c`, 2026-09-10).

- **Four top tabs** — `type TopTab = "floor" | "tinting" | "hold" | "cancelled"` (`floor-page.tsx:114`): **Floor** / **Tinting** / **On hold** / **Cancelled**, plus the slide-out **detail panel**. The tab row sits inside the table column (`143706be`). Tinting is a client-side VIEW of board rows, not a feed (`floor-page.tsx:108-113`, §4.8).
- **Left: the trip rail** (`components/floor/trip-rail.tsx`). A "To plan" entry (the not-on-a-trip pool, the default) plus one card per trip, one flat list, newest-created first (`trip-rail.tsx:10-19`). What a trip card says and which trips are listed → `CLAUDE_FLOOR_TRIPS.md §6/§8`.
- **Right: the bills, in one of three states** (`trip-desk.tsx:14-20`):
  - **pool** — header + `Flat | By route` pivot + the table (the not-on-a-trip bills). **By route is the pool's default** (2026-09-19); on a tab with route clubs (Local, and Upcountry once its seed is run) it draws the route cards below (§2.1).
  - **trip** — the selected trip's header + its bills grouped under STOPS, one `FloorTable` per stop.
  - **add** — "+ Add bills" inside a trip: the trip unchanged, then a band, then the pool below it.
  Rows sort with `FLOOR_SPINE`; bills with no slot are ordinary rows marked `no slot` (§3, §4.9).
- **Bottom bar** (`components/floor/floor-bottom-bar.tsx`) — pool selected → `+ New trip` (an existing trip is picked by clicking it on the rail); trip selected → `Remove from trip`; plus the ✕ global clear (`floor-bottom-bar.tsx:12-20`). What those do to a trip → `CLAUDE_FLOOR_TRIPS.md §4/§7`.
- **Live vs History** — History is read-only and dated (§3, §4.7).
- **Header:** hand-rolled title + IST date/time; delivery-type scope chips (All/Local/Upcountry/IGT); one search box + one filter (`CLAUDE_UI.md §6` filter-dropdown style, floor-only); the pick-gate switch (`pick-gate-toggle.tsx` → `CLAUDE_FLOOR_TRIPS.md §11`). No `UniversalHeader` (§10).

### 2.1 By route — the route cards [LIVE 2026-09-19 · single-open chips 2026-09-24]

`components/floor/route-cards.tsx`, built and placed by `trip-desk.tsx`. Display only — nothing here writes, and no card or chip changes a bill's status or hold.

- **Where it shows.** The pool's By route view on a tab that HAS route clubs (`tabHasClubs`) — **Local**, and **Upcountry** once `sql/2026-09-24-route-clubs-upcountry.sql` is run. All / IGT keep the older route rows (`ByRoute` → `route-row.tsx`) and their Upcoming block. **By route is the pool's default** (`poolPivot`, `trip-desk.tsx`); Flat is one click away. **The Tinting tab has its own view state** (`tintPivot`, default Flat) and keeps the route rows. **A search shows the pool Flat** — By route is disabled with the reason in its tooltip, and clearing the search restores the choice.
- **Clubs.** Routes that share a truck on a light day, one card per club. Read from `route_clubs` / `route_club_members` (CORE §7.17) by `getRouteClubs()` (`lib/floor/route-clubs.ts`), carried on `GET /api/floor/board` as the sibling key `routeClubs`. Local: 1 Adajan + Olpad · 2 Ghod Dod + Udhana · 3 Varachha + Kamrej. Upcountry (seed written 2026-09-24): 1 Navsari · 2 Chikhli + Vansda · 3 Vapi · 4 Bardoli · 5 Bharuch + Kamrej. First member = main. **Adding a club or a member is a SQL insert only** — no code, no deploy; it shows on the next board load.
- **Other routes.** Every route of the tab that is in **no club**, plus the route-less bills, share **ONE "Other routes" card** — one line each, lines **by kilos due, highest first** (name breaks ties), **"No route" always the last line**. On Upcountry that includes IGT / CROSS (18: Godhra) and Transport (22: Vallabhipur, Khalal) as lines of their own. It is **display-only**: nothing is written to the club tables for it; `buildRouteCards` builds it from the rows every render (`otherCard`, key `other`), and it is always the last card.
- **Which cards are drawn** (`shownCards`, 2026-09-24). **Only cards with bills — due or upcoming.** A club, or Other routes, with no bill at all is not drawn: no dimmed card, no placeholder. Inside a card, **a route with no bills at all has no line** (the old "Olpad · No bills" line is gone); a one-route club is one line. "Every bill is on a trip" shows only when the pool is truly empty, upcoming included.
- **The grid (closed state).** One grid of equal cards that flow in order: **4 per row at ≥1470px, 3 at 1100–1469px, 2 below** (`useCardColumns`, `matchMedia` change events — not a key listener). Order: **clubs by `sortOrder`, then Other routes, always last.** ⚠ 1470, not 1400: four columns at 1440px cut "Kamrej" to "Ka…" (the line needs 225px; measured in Chrome with the app's font).
- **Same size.** Every card is the same width and the **same height across the whole board**: the head (name, big kilos, "N stops · L") plus as many equal line slots as the drawn card with the most route lines. Spare slots are invisible spacers between the head and the card's own lines. Text never wraps; at worst a route name ellipsises.
- **The numbers.** Kilos = `querySnapshot.totalWeight` (the trip weight's source), whole kg, with a "+" when a bill has no weight. **Stops = distinct `stopKey`** (`computeDropKey`, `lib/trips/drop-key.ts`). Card, line and chip numbers count only bills **due today or overdue** (the row's own `zone`). A card with **only upcoming bills** shows **"Upcoming only"** (small, grey) in place of the kilos and "N stops due later" under it; a line with only upcoming bills reads "Upcoming only".
- **The bar** (4px, colour is the status, no words): green = done + dispatched · yellow = picked, not checked · blue = with picker · grey = waiting + tint done · pink = tinting. **No amber**: held bills are never in the pool.
- **Open state — ONE card at a time** (2026-09-24). Clicking a card collapses the grid into a **wrapping row of chips**, one per drawn card in card order: a 190px box, 12/20px padding, 14px radius, 1px border, two lines — name (15px semibold), then "744 kg · 5 stops" (13px grey; "Upcoming only" when nothing is due). The open chip is **brand-filled with white text and a ✕**. "Esc to go back to cards" sits in small grey at the row's right end. **Another chip switches straight to it; the open chip, its ✕, or Esc goes back to the grid.** **One drawn card still gets the chip row** — one filled chip with its ✕ and the Esc hint — so Local and Upcountry look identical (2026-09-24; the short-lived "← Back to cards" layout is gone).
- **Who owns "open".** `openRouteCard` lives in **`floor-page.tsx`**, because it owns the floor's one window-level Esc listener (§4.6). Esc order gains one rung: … ··· More menus → **open route card → back to the cards** → clear selection → end the add band. **TripDesk clears `openRouteCard`** whenever that card is not on screen (another tab or view, a trip on the rail, a search, or its last bill gone onto a trip), so Esc never spends a press on an unseen card and By route always comes back on the grid.
- **Ticks and the chips.** ⚠ **Was:** every card holding a ticked bill stayed open beside the one last clicked (commit 4b, 2026-09-19), so no tick sat inside a closed card. **Now** only one card is open: ticks in other clubs survive a chip switch and going back to the grid, out of sight — the bottom bar still counts them, and the first Esc returns to the cards without clearing them. Do not reinstate multi-open beside the chips.
- **The table.** Full width under the chip row: one section per route with bills, main first — a heading (name · stops · kg, due bills only; "Upcoming only" when nothing is due), then that route's own `FloorTable` with **Area in the Route column** (§4.9). Today's and overdue bills first, then **upcoming bills by due date** — no "Upcoming" divider.
- **The reach (Kamrej).** A club route with **no area on the club's own tab** draws its bills from the one other tab its areas are on, and its line carries that tab's name in grey ("Upcountry"). `reachFrom` is worked out from `area_master` by `getRouteClubs`; today only Kamrej in the Local club qualifies (all 10 of its areas are Upcountry). In the Upcountry club it is a plain member. A club route with ANY area on the tab shows that tab's bills only.
- **Placeholder routes.** Route 20 "No Route" folds into the **No route** line of Other routes together with bills whose area has no route. Route 25 "TEST R" is hidden (inactive, no areas).
- **Tab rules.** A trip shows on the rail only under its own stored delivery type (`tripInScope`, `lib/floor/scope.ts`); All shows every trip; an opened trip still shows every bill on it whatever tab is selected. **A planned bill leaves the pool on every tab at once**: the pool test is `tripDropId === null` (`isPoolRow`), the tab only filters one unscoped payload in the browser, and every trip write reloads the whole board.

### 2.2 Load plan — suggested truckloads (Upcountry) [LIVE 2026-09-19]

`components/floor/load-plan.tsx` (the view) on `lib/trips/load-plan.ts` (the engine, PURE — no DB, no clock; tests `lib/trips/load-plan.test.ts`, `npm run test:load-plan`). **A suggestion screen: it never creates anything by itself**, and no trip action changes a bill's status or hold.

- **Where.** The Upcountry pool switch is **Flat · By route · Load plan**, and **Load plan is Upcountry's default** (`LOAD_PLAN_SCOPES`, `trip-desk.tsx`). **Each tab remembers its own view** (`poolViews`); By route stays the default on Local, and All / IGT are unchanged. A search shows Flat (By route and Load plan disabled, with the reason).
- **What it plans.** The tab's **due** pool — today's and overdue bills on no trip, the set the route cards count (held bills are never on the board; tint-room bills are the Tinting tab's). Upcoming bills are not planned; the summary adds "· N upcoming not planned". It **regroups on every render**, so a planned, released or re-weighed bill moves the cards on the next board load.
- **The rules — in config, not code.** `load_plan_config` (CORE §7.18), one row per delivery type, **route IDs never names**; read by `getLoadPlanPayload()` (`lib/floor/load-plan-config.ts`) and carried on `GET /api/floor/board` as `loadPlan` with every route's name. Upcountry: Small ≤ 2,000 kg, Big ≤ 3,000 kg; main routes **Navsari, Vapi, Bharuch**; partners **Chikhli → Vapi or Navsari, whichever has more free space (a tie → list order, Vapi first)** · **Vansda → Navsari, then Vapi** · **Bardoli → Navsari** · **Kamrej → Bharuch**. A missing table or row, or malformed jsonb, reads **"Load plan not set up"** — the reader never throws, so the floor loads whatever state the table is in.
- **The algorithm** (`planLoads`):
  1. Pack by **stop** (`stopKey`), never by bill — a stop's bills are never split. Largest stops first.
  2. A single stop over 3,000 kg is its own **Bulk** truck — no size, no fill bar, "Over 3,000 kg — hire as needed", not counted as small or big ("· 1 bulk").
  3. Every route, partners included: while it has more than 3,000 kg left, fill one **full Big** truck first-fit by stop. What remains is its **leftover** (so a main route with any bills always has one).
  4. A main route's leftover is its **open truck — the only truck a partner may join**; a full truck never takes a partner.
  5. Each partner, in config order: its whole leftover joins an allowed open truck if the total stays ≤ 3,000 (`most_space` or `in_order`); otherwise it gets its own truck.
  6. Any other Upcountry route (Adajan, Varachha, Udhana, Transport, …) and route-less bills: their own truck(s), never mixed.
  7. Size from the final load: ≤ 2,000 Small, else Big. One plain-English reason per truck ("Vansda and Bardoli fit on the Navsari truck." · "No room on the Vapi truck, so Chikhli goes on its own." · "Full load of Navsari."). Cards by kg, highest first; the same pool always gives the same cards in the same order. An unknown weight packs as 0 and shows the floor's "+".
- **The view.** Summary "9,600 kg pending · 4 trucks suggested · 3 big, 1 small". Cards on the route cards' equal-size grid (4/3/2 at 1470/1100px): routes joined " + ", big kg, grey "Big truck · 12 stops", a 4px fill bar at the bottom — **green at ≥ 50% of that truck's size, amber below**. A card whose bills changed after a regroup **flashes a violet border** (never on the first plan). **One panel**, full width under its card's row; clicking again closes it; it closes by itself if its truck is gone after a regroup. Panel header: routes, "2,635 of 3,000 kg · Big truck · 12 stops · 13 bills", the reason, **Make trip**. Below: the truck's bills grouped by route (heading: name · stops · kg) in the floor's own `FloorTable` with **Area** (`showArea`) and **no tick boxes** — the card is the unit, so no tick can sit inside a closed panel. ⚡ and ⋯ still work.
- **Make trip** = the existing **New trip** flow (`createTripWithSelection`) given the card's bill ids — the same two API calls, **no new write path**. The card's bills replace any ticks; the delivery type comes from those bills (`chooseTripTypeName`); afterwards it **stays on the load plan**: ticks cleared, the board reloads so the plan regroups, and a toast "Trip U-… made · Open" (Open selects the trip on the rail as a rail click does). Hidden in History.
- **Kamrej** is in Local's "Varachha + Kamrej" card (§2.1, the reach) AND in Upcountry's load plan — expected; planning it from either removes it from both.

**Retired from this screen** (one line each; do not rediscover):
- The decision rail (left column of undecided bills, per-card Release / Hold / ✕, slot suggestion) — stopped rendering 2026-09-10 (`bbb9628c`), archived 2026-09-13 (`79bcc412`) → `archive/2026-09-floor-rail/README.md`.
- Slot tabs (`10:30 · 12:30 · 16:00 · 18:00 · All`), slot bands and the By group view — stopped rendering 2026-09-10 (`bbb9628c`); `floor-board.tsx` deleted in `cdbf95b1`, `slot-band.tsx` / `floor-tabs.tsx` / `group-row.tsx` in `f41b52c9`.
- By picker (`picker-card.tsx`) — deleted in `f41b52c9`.
- The assign bar — replaced by the bottom bar in `bbb9628c`; `assign-bar.tsx` stays on disk with zero importers (§10b).
- The upcoming strip (`upcoming-strip.tsx`) and `carryover-banner.tsx` — deleted in `f41b52c9`. Future-dated rows now sit below an upcoming divider row inside the table (`floor-table.tsx`).

---

## 3. Data feeds [LIVE]

SELECT-only feeds, sequential awaits, never `prisma.$transaction` (CORE §3). All in `lib/floor/queries.ts`. The client fetches board, hold and cancelled once **unscoped** and filters scope client-side (`lib/floor/scope.ts`, `9c3b3cf5`); the server still honours `?scope=` via `inScope`. `getHideExclusion()` (CORE §7.10) is AND-merged into every feed.

| Feed | Function | Route | Scope / anchor |
|---|---|---|---|
| Floor board | `getFloorBoard({mode,date,scope})` | `GET /api/floor/board` | **Live:** `floorBoardWhere` (below). **History:** a two-member `OR` (below). |
| Hold | `getFloorHold(scope)` | `GET /api/floor/hold` | `dispatchStatus="hold"`, all dates (pure open state), recent-held-first. |
| Cancelled | `getFloorCancelled(scope)` | `GET /api/floor/cancelled` | `workflowStage="cancelled"`, **today only** (IST, by the cancel log's `createdAt`). |

`GET /api/floor/board` returns `{ scope, floor, pickers, routeClubs, loadPlan }` (`app/api/floor/board/route.ts`); `pickers` = `getFloorPickers()` (active roster + on-hand load), read by the detail panel's Assign/Reassign; `routeClubs` = `getRouteClubs()` (2026-09-19, §2.1 — config, every delivery type, one small read); `loadPlan` = `getLoadPlanPayload()` (2026-09-19, §2.2 — the load-plan rules by delivery type plus every route's name; never throws). Each board row also carries `routeId` (the id of the route `route` names, `area.primaryRoute`) and `stopKey` (`computeDropKey`) for the route cards. Board, hold, cancelled, marker, order detail, ship-to search and tint-operators gate on `checkAnyPermission(roles,"floor","canView")`; actions, release, ship-to save and pick-gate on `canEdit`. `load()` also fetches `GET /api/floor/trips?date=` in the same batch (`floor-page.tsx:348-351`) — trip routes → `CLAUDE_FLOOR_TRIPS.md §10`.

**`floorBoardWhere(todayRange, todayDateOnly)` — the live predicate, SHARED by the board and the marker** (`lib/floor/queries.ts:475-490`; board `:829`, marker `getFloorLiveMarkerWhere` `:508`), so they cannot drift (§5). A union of **four named arms**, each a complete set of terms, never a term removed from another:
1. **`floorLiveBaseWhere(todayRange)`** (`:421`) — `dispatchStatus="dispatch"`, and either still OPEN (`workflowStage ∈ PICKING_OPEN_STAGES` — pending_picking / pick_assigned / pick_done, **any** dispatch date; Floor's carry-over arm, design §4.2) or **CHECKED TODAY** (`workflowStage=pick_checked` AND `pick_assignments.checkedAt ∈ getISTDayRange()`, today IST, whatever day it was due).
2. **`floorUnslottedWhere()`** (`:160`) — rank < 60 AND `dispatchStatus IS NULL`, not removed: bills with no dispatch decision. The retired rail's own predicate; its feed went, this arm did not (`archive/2026-09-floor-rail/README.md`).
3. **`floorCarriedPoolWhere()`** (`:198`) — `pick_checked`, `dispatchStatus="dispatch"`, `tripDropId IS NULL`: checked and on no truck, **whatever day it was checked** (`36a39ba7`).
4. **`floorTripBillsWhere(todayDateOnly)`** (`:315`) — `dispatchStatus="dispatch"` and on a trip the desk is about (`liveTripsOnDeskWhere`, `lib/trips/live-trips.ts` → `CLAUDE_FLOOR_TRIPS.md §8`). Its `tripDropId: { not: null }` term is redundant by meaning and load-bearing by query plan (`:226-240`) — do not delete it.

Plain English: everything still open whatever day it was due, everything the floor finished today, everything nobody has decided on, everything checked but not yet on a truck, and everything on a live trip.

**Why arm 2 has bills in it now.** Since 2026-09-11 every new non-tint bill with no mail order is released by the import itself — `applyNoMailOrderFallback` (`app/api/import/obd/route.ts:554`, `b3dfe5b8`; owner `CLAUDE_IMPORT.md`) writes `dispatchStatus="dispatch"` + `pending_picking` in one update, so those bills land in arm 1, not arm 2. The fallback skips `orderType='tint'` (`:571`), so tint bills in the tint room ride arm 2 (they are the Tinting tab's rows, §4.8). A Restore writes `pending_support` + null status, so a restored bill also lands in arm 2 as a `no slot` row (§4.1). **The SMU gate:** the fallback calls `evaluateDispatchSlot`, which declines any bill whose `smu` is not `Deco Retail` (`route.ts:520-528`); those bills are still released but carry no slot — arm 1 rows showing `no slot`. The comment there records about 12.5 such bills a day over the 30 days to 2026-09-10, and calls it a business rule.

**The HISTORY predicate (`mode="history"`)** (`queries.ts:727-804`) — two members under one `OR`:
- **The day's record.** Outer AND terms `dispatchStatus="dispatch"`, `isRemoved=false`, `workflowStage ∈ FLOOR_HISTORY_STAGES` (`= [...PICKING_ACTIVE_STAGES, DISPATCHED]`, `:101`, `551069aa`), with two date anchors:
  1. **promised for D** — `dispatchTargetDate = D`.
  2. **checked on D** — `workflowStage ∈ [pick_checked, dispatched]` AND `pick_assignments.checkedAt ∈ getISTDayRange(D)` (`:796`), whatever day it was promised. Same helper and same half-open shape as the live arm, with the viewed day instead of today.
- **The day's trips' bills** — `floorHistoryTripBillsWhere(D)` (`:307`, `:803`, `175c83fd`): every bill on a non-cancelled trip dated D, no stage and no status pin, so a History stop finds all its bills.

Plain English: what was owed that day, plus what was finished that day, plus what rode that day's trucks. A bill matching more than one appears **once**; a bill finished early appears under **two** days (its promise day and its check day) — both statements are true, and that is the owner decision, not a predicate accident. ⚠ This is the **same promise-vs-completion anchor class** as §6c / the 2026-08-02 picking `checkedAt` fix: a completion belongs to the day it happened. The checked-on-D anchor exists because without it a bill promised for D+1 but checked on D was on **no reachable screen at all** — live had dropped it, D's history never had it, and D+1's history is unreachable behind the stepper clamp (`floor-page.tsx:1283-1284`). The marker does **not** consume this predicate (§5 — it is live-only).

⚠ **Floor's carry-over is its OWN scope — NOT `lib/picking/queue.ts`'s WHERE.** Picking's carry-over deliberately excludes `pick_done`/`pick_checked` (a documented "workaround, not a fix"). Floor's arm 1 keeps anything not-yet-checked. Do not "align" the two.

Per row: `zone` (`due` | `upcoming`, from `dispatchTargetDate` vs today) and `ageDays`. Rows are sorted with Floor's OWN **`FLOOR_SPINE`** (`lib/floor/sort.ts`) = the picking spine **minus `byAssigned`**, so Assigned/Done rows HOLD their position instead of sinking on assign and rising on done (a convention Floor shared with the Picking desktop board, retired 2026-07-28 — §9b; Floor is now its only implementation). ⚠ **Ownership boundary:** the rule OBJECTS (`byWindow`/`byDeliveryType`/`byKeyCustomer`/`byPriority`/`byFifo`) and `sortPickingQueue()` are IMPORTED from `lib/picking/sort.ts` (never copied — that file stays owned by `CLAUDE_PICKING.md §3`); only the Floor rule LIST is Floor's own. `FLOOR_SPINE` is applied in the TWO places that sort and must stay identical or the board flickers on refetch — the server sort (`getFloorBoard`, `lib/floor/queries.ts:1108`) and the client sort (`components/floor/trip-desk.tsx:104`), both importing the one constant. Shipped commit `661e4e61`.

---

## 4. Floor actions [LIVE]

Every write path: sequential awaits, **exactly ONE `orders.update` per bill**, **exactly ONE `order_status_logs` row per bill per action** (CORE §3 / the live-sync marker keys on `MAX(orders.updatedAt)` — a second write fires a false "changed" on every board). No Floor file contains `prisma.$transaction`.

### 4.1 `POST /api/floor/actions` — mark-urgent · change-slot · hold · cancel · restore

Batch `{ action, orderIds[], … }`. `ACTIONS` is exactly these five (`app/api/floor/actions/route.ts:21-22`). Per bill:
- **mark-urgent** — set/toggle `priorityLevel` (1 ↔ 3).
- **change-slot** — write `dispatchTargetDate`+`dispatchWindowId`+`dispatchSlotSource="manual"`, no stage change and no status change (a pre-set; also re-slots a floor bill).
- **hold** — `dispatchStatus="hold"`, `heldAt = obdEmailDate ?? now` (arrival anchor, §4.5). Log note = `FLOOR_HOLD_NOTE`.
- **cancel** — `workflowStage="cancelled"`, `dispatchStatus=null`. Not stage-gated. **Also deletes the bill's `pick_assignments` row** after the stage write (`deleteMany`, `route.ts:157`, `:185`; `00d7da22`) — a surviving row made a restored bill permanently un-assignable. That is a write to a second table, not a second `orders.update`, so the one-update / one-log contract holds.
- **restore** — cancelled → `workflowStage="pending_support"`, `dispatchStatus=null` (`route.ts:167-168`). The bill comes back as a `no slot` row on the board through arm 2 (`floorUnslottedWhere`, §3).

Returns **422 when nothing was written** (every requested bill failed); a partial success stays 200 but always carries `failed[]`.

### 4.2 `POST /api/floor/release` — Hold-tab bulk release AND the panel's Release

Body `{ releases: [{ orderId, dispatchTargetDate, dispatchWindowId }] }`. The write lives in `releaseBillsToFloor()` (`lib/floor/release.ts`), called once per bill by the route (`app/api/floor/release/route.ts:104`): the slot, `dispatchStatus="dispatch"`, `workflowStage=SUPPORT_DONE_OUTPUT` (pending_picking), `dispatchSlotSource="manual"`, in one update. Log `fromStage` = the bill's **real** prior stage. A bill still in the tint room (`pending_tint_assignment` / `tint_assigned` / `tinting_in_progress`) is skipped as `waitingForTint` (`release.ts:75-79`, `:125`), which the route folds back into `failed[]`. Client callers: the Hold tab's bulk bar (`floor-page.tsx:1010`) and the detail panel's Release, which renders for `source === "hold"` only (`detail-panel.tsx:583`, §4.7). No trip route calls it (`CLAUDE_FLOOR_TRIPS.md §13`).

**Releasable stages — `FLOOR_RELEASABLE_STAGES = ["pending_support","pending_picking"]`** (`lib/floor/release-stages.ts`). Floor's own explicit list, deliberately **NOT** `supportMayEdit()` (`lib/workflow-stages.ts`) — that predicate encoded Support's permission model, and Floor's release gate answers a different question. It is now dead code with zero callers, kept pending a ROADMAP cleanup; do not wire it back in here. `pending_support` = a bill with no dispatch decision (the stage name is historical — nothing named Support writes it any more); `pending_picking` = a bill held after auto-dispatch (hold flips status only, never stage). Same 422/partial contract as §4.1.

### 4.3 Assign / unassign

**Reused from Picking, unchanged** — the detail panel's Assign/Reassign and ⋯ Unassign call `POST /api/picking/assign` and `/api/picking/unassign` as a caller (`floor-page.tsx:1241-1267`). Reassign = unassign (only if already assigned) then assign. Nothing on the desk assigns in bulk any more (`floor-page.tsx:995-1000`); that is the supervisor's job on `/picking`. → behaviour owned by **`CLAUDE_PICKING.md §4`**.

### 4.4 Ship-to change (detail panel) [LIVE] — Floor's OWN routes

Search `GET /api/floor/ship-to-search?q=` (min 2 chars, `take: 8`, gated on floor `canView`); write `POST /api/floor/ship-to` with `{ orderId, customerId }` — `customerId: null` clears the redirect. Both are Floor's own as of commit `316eec6b`; nothing here calls a Support route.

The **save is a rewrite, not a copy**. Support's PATCH handled four unrelated fields at once and rode a `prisma.$transaction` (CORE §3). Floor's does one job, verifies the target customer exists, keeps the legacy `shipToOverride` boolean in sync, and **skips the write entirely when nothing changed** — sequential awaits, no `$transaction` in any Floor file.

⚠ The **clear (✕)** affordance is not built on the panel yet — the route already accepts `customerId: null`. UI-only gap → ROADMAP.

### 4.5 Held-since — READ-SIDE rule [LIVE]

`orders.heldAt` stores the bill's **arrival** date (`obdEmailDate`), NOT the moment it was held — a convention inherited from Support, which anchored its amber hold footprint to arrival. **The write was deliberately NOT changed** when Support retired: thousands of historical rows carry arrival dates, and flipping the write to `now` would make old and new rows mean different things in the same column. The Hold tab needs the opposite, so "held since" is derived on the READ side in `getFloorHold()`:
- Take the hold **event's** wall-clock `order_status_logs.createdAt`, identified by the log **NOTE** via the shared constant `HOLD_LOG_NOTES` (`lib/floor/hold-log.ts`) — never a sentinel `toStage` (which would pollute the stage ladder). Matches the Floor note AND the two historical Support notes (`"Placed on hold by support"`, `"Placed on hold by support (bulk)"`). ⚠ **Keep both Support strings** — Support no longer writes them, but bills it held are still on hold today and would otherwise fall to the `~approximate` fallback.
- Fallback ladder: hold log → `orders.heldAt` (rendered with a leading `~` + "approximate" tooltip; enrichment holds write no log) → unknown (banded separately under "Held date unknown"). Nothing can silently read as "held today".

### 4.6 Action surfaces — bottom bar · panel header · slot picker · selection/Esc [LIVE]

The 2026-07-26 redesign (draft `web-update-2026-07-26-floor-action-surfaces.md`) minted five general DESIGN rules, owned by **`CLAUDE_UI.md §10`**; this section owns the floor-specific SPECS.

- **Bottom bar** (`floor-bottom-bar.tsx`) — replaced the assign bar and `trip-selection-bar.tsx` on 2026-09-10 (`bbb9628c`). Pool selection → `+ New trip`; trip selection → `Remove from trip`; ✕ clears everything. No confirm on either action (both reversible in one press, neither touches `workflowStage`; `floor-bottom-bar.tsx:22-25`). Change slot and bulk Assign are not on it: the slot is changed per bill in the panel header, and assigning is `/picking`'s job.
- **Detail-panel header** — slot lives on the IDENTITY line as a clickable pencil chip
  (`DD-MM · HH:MM`, dashed "No slot" when unset, hidden on cancelled); the action row holds only
  jobs. **Exactly one filled brand (`brand-600`) button per state, on the state's real job:** Floor → Ship-to;
  Held → Release; Cancelled → Restore (`detail-panel.tsx:580-632`). The ⋯ menu contents are unchanged from the redesign.
- **Slot picker behaviour** (`dispatch-slot-picker.tsx` — Floor-owned): commit-on-tap, **no confirm
  button** (a confirm would tax the most frequent action) → hence no filled brand button anywhere in the popover;
  near-black selection on a neutral strip; month tag only on tiles crossing a month. **Honest
  highlight:** opens on the bill's OWN day if visible, else highlights NOTHING (never claims today).
  **Consequence: tapping only a time keeps the bill on its own day** — it no longer silently drags
  the date to today. Auto-flip positioning: preferred direction if it fits, flips, else caps+scrolls;
  repositions on scroll/resize; already portalled. It also serves the Hold bar and the billing ribbon. The `suggested`/`hideTrigger` props stay (§8); no live caller passes them.
- **Selection + Esc — THE spec:**
  `lib/floor/selection.ts` `toggleAll()` on a PARTIAL selection **selects all, it does not clear**,
  and it is per-GROUP (one per route group / stop) — so a cross-group or search-auto-ticked
  selection cannot be cleared by any header checkbox. That is WHY the bar's ✕ global-clear exists —
  any proposal to remove it must solve this first. **`floor-page.tsx` is the SINGLE window-level Esc
  owner** for the floor tree (`floor-page.tsx:1293-1314`). Guard order, exactly one branch per keypress: slot popover open
  (`[data-slot-popover="open"]` — the marker the picker carries for exactly this) → nothing · focus
  in input/textarea/select/contentEditable → nothing · panel open → close panel · rows selected →
  clear selection · else nothing. **Never add a second Esc keydown listener under
  `components/floor/`** — two window-level listeners race in registration order, which is the bug
  this replaced. The panel closes via ✕/backdrop as well; the picker itself dismisses on
  click-outside, not Esc.

### 4.7 Detail panel [LIVE]

`GET /api/floor/order/[orderId]` (floor `canView`) returns one payload: header + Details + Items + Activity, plus tint-room facts for a tint bill (operator, assignment status, assigned/started/completed times, shades done/total — `app/api/floor/order/[orderId]/route.ts:160-198`, `6b315729`). Items resolve via `sku_master_v2` on `material === skuCodeRaw` (CORE §13 — never a sku id), raw-text fallback preserved, gift lines out of scope. Activity = `order_status_logs` + ONE synthetic "auto-slot" line derived from `dispatchSlotSource`/`dispatchSlotRuleId` and labelled "enrichment" (the engine writes no log — do not add one; §5). 472px slide-in; primary action + Change ship-to + Update slot + ⋯ ; Prev/Next walks the source list. The panel's date is `obdEmailDate ?? orderDateTime` (`route.ts:205`).

**Sources** (`FloorDetailSource`, `lib/floor/types.ts:422`): `floor` · `hold` · `cancelled` · **`history` — READ-ONLY, the only one that is** (2026-08-25). Openers pass only these four (`floor-page.tsx:2015`, `:2024`, `:2050`); the union's `rail` member is vestigial (§10b). A history-sourced panel reaches **zero write endpoints**: the whole action row is suppressed (it hosts Release, Restore, Ship-to, Assign/Reassign and the ⋯ Hold/Cancel/Unassign menu, and the only `setEditingShipTo(true)` trigger, so the ship-to editor is unreachable too), and the header slot chip — which writes `change-slot` — is gated off. Everything else excludes `history` **by default**, because each gate is written `source === "floor" | "rail" | "hold" | "cancelled"` and a new member matches none of them; that default-closed property is why this is a member of the existing union and not a separate `readOnly` prop. The one derived boolean is `readOnly` in `detail-panel.tsx`, mirroring `interactive` in `floor-table.tsx` — do not add a third read-only concept. Opened by a ⋯ on history rows (⋯ only — the live arm's ⚡ is `mark-urgent`, a write). `headerStatus` has an explicit `history` case placed **above** the `d.dispatchStatus === "hold"` term, so a bill held later cannot rewrite a past day's record. Prev/Next walks the history payload (`filteredFloor` IS the history rows in history mode) and cannot reach a live row.

**Tint lock** (`56db79b8`, `4af18cc8`, 2026-09-08). Rule: a tint bill whose tinting is NOT FINISHED (`pending_tint_assignment` / `tint_assigned` / `tinting_in_progress`) cannot be held or cancelled from Floor — the ⋯ Hold and Cancel render greyed with a reason ("… cancel from Tint Manager") (`detail-panel.tsx:413-434`). ⚠ **The lock is coded against `source === "rail"`** (`:414`), and no opener passes `"rail"` since the rail retired — so today it never fires, and a tint-room bill opened from the board (`source "floor"`) shows Hold and Cancel enabled. `POST /api/floor/actions` has no tint guard of its own. Recorded in §10b.

### 4.8 Tint on the floor [LIVE]

- **Pills** (`components/floor/status-pill.tsx`, `79bcc412`, `6b315729`): a tint bill's phase comes from `tintPhaseOf` (`lib/floor/queries.ts:132`) → pink Waiting / With operator / Tinting / Tint done (`status-pill.tsx:139-142`, `:225-260`). Built from `orders.workflowStage` alone; the board query does not read `tint_assignments`.
- **Tinting tab** (`143706be`) — tint bills not yet being mixed, split from the Floor tab by one predicate, `isTintRoomRow` (`status-pill.tsx:101`), so the two tabs are exact complements and the badges cannot disagree (`floor-page.tsx:1700-1710`). On this tab the Invoice column becomes **Operator** (`floor-table.tsx:556`).
- **`GET /api/floor/tint-operators`** (floor `canView`) — who holds each `tint_assigned` bill (`tint_assignments`, `splitId: null`, latest row wins). Fetched only while the Tinting tab is open and on refresh (`floor-page.tsx:1735-1751`), never by the board or the poll.

### 4.9 The bill table [LIVE]

`components/floor/floor-table.tsx`. Columns: ☐ · OBD (+date) · Invoice|Operator · Ship to · Route · Due · Vol / KG · Article · Status (`floor-table.tsx:555-563`). No `#` and no Picker column since 2026-09-10 (`floor-table.tsx:14-15`).
- **Area in place of Route** (`showArea`, 2026-09-19) — the tables a route CARD opens (§2.1) pass it: every bill there is on the route in its heading, so the column shows `area` instead. Same slot and width, header reads "Area". Flat, the route rows and the trip panel keep Route. Same pattern as `hideTripTag`.
- **Invoice** (`697b193b`) — SAP `invoiceNo` over `invoiceDate`, right after OBD; blank until SAP stamps it.
- **Due** (`e656ad80`) — the date leads, "Today" spelled out, future blue, overdue red, age chip beside it; `no slot` chip when the bill has no date (`floor-table.tsx:686-697`).
- **Duplicate SO** (`bc232f72`) — SOFT treatment: a `DuplicateSoTag variant="soft"` and a thin bar on rows whose `hasDuplicateSo` is true (`floor-table.tsx:654`, `:927`); the solid red is Picking's.
- **TINT / BASE word** (`0841b5c9`) — `ColourWorkBadge` from `components/picking/card-atoms` (`floor-table.tsx:1062`).
- **Ship-to redirect** — the ORIGINAL → REDIRECT pair (`floor-table.tsx:1070`).
- **Display date** — the OBD cell shows `resolveFloorDisplayDate(orderDateTime, obdEmailDate)` (`lib/floor/format.ts:176`, `8a4c1973`; called at `queries.ts:929`): `obdEmailDate` (the SAP punch) by default; when a mail match overwrote `orderDateTime` with the email time **on the same IST day**, the email time, flagged `isEmailTime`. Hold and Cancelled show `obdEmailDate ?? orderDateTime` (`queries.ts:1247`, `:1336`).

---

## 5. Live sync [LIVE]

**Two DIFFERENT mechanisms, no shared abstraction** (design §13):
- **Whole desk** → Mail Orders pattern: a **30s full refetch** via `useFloorRailPoll` (`lib/floor/use-floor-rail-poll.ts`, `FLOOR_RAIL_POLL_MS = 30_000`) calling `load()` — board, hold, cancelled and trips (`floor-page.tsx:1388-1391`). The hook name is historical; there is no rail.
- **Floor** → Picking pattern: a **15s marker probe** (`lib/hooks/use-picking-marker`, reused with its optional `url` param → `/api/floor/marker`). Refetch only when the cheap `{count, latest}` moved.

`GET /api/floor/marker` aggregates `{count, latest}` over `getFloorLiveMarkerWhere()` = `floorBoardWhere(getISTDayRange(), getISTTodayDateOnly())` AND hide (`lib/floor/queries.ts:508`) — the **same predicate the board renders** (§3), so marker and board cannot drift. It is the floor's OWN exact set, not picking's superset. The marker hook's `onProbe` drives the connection strip off the **same poll** — one probe, not two. Trip-only writes do not move it → `CLAUDE_FLOOR_TRIPS.md §17`.

The marker's `{count, latest}` semantics + the `orders_updatedAt_idx` behaviour are **owned by `CLAUDE_PICKING.md §10`** — not restated here. Difference from Picking: Floor watches its own set via the `url` param; the connection strip (`components/floor/connection-strip.tsx`) shows a grey "not connected — showing last update HH:MM" (a strip, never a modal; live mode only).

**Pause rules:** the 30s refetch pauses while the detail panel is open, a selection is up, or in History; the 15s marker pauses while the panel is open or in History (`floor-page.tsx:1375`, `:1389`). A **selected** row changed by someone else is **reconciled** — its tick is cleared and a toast shown — **without moving the visible board** (rule: never move the ground under a hand). READ-ONLY throughout: the marker adds no write.

---

## 6. Bugs fixed this build [LIVE]

Each with the one-line root cause so the class is recognisable again.

- **(a) Auto-slot scheduled Saturday-evening bills into Sunday** (depot closed). *Root cause:* `evaluateDispatchSlot()` rolled a late bill to the next **calendar** day. *Fix:* `nextWorkingDateOnlyUTC()` in `lib/dispatch/dispatch-engine.ts` skips Sunday only (Saturday is a working day; holidays not modelled). This was a **live enrichment bug independent of Floor Control**. Engine owned by CORE §7.4.
- **(b) Releasing a held bill was a silent no-op** (UI said OK, wrote nothing). *Root cause:* the release route required `workflowStage === "pending_support"`, but a floor-held bill sits at `pending_picking`; it was pushed to `failed[]`, the route returned **200**, and the client discarded the response. *Fix:* `FLOOR_RELEASABLE_STAGES` (§4.2) admits `pending_picking`; routes return 422 when nothing was written; the client now reads the response and `reportWrite()` surfaces every non-2xx / hard error / non-empty `failed[]` (the rail release path had the same swallow).
- **(c) A carried-over bill vanished the instant it was checked.** *Root cause:* the live "checked" arm fenced on `dispatchTargetDate = today`, so a bill due earlier failed both arms the moment it reached `pick_checked`. *Fix:* the checked arm now fences on `pick_assignments.checkedAt` within today's IST range (§3) — a bill can never disappear at completion. **This "done = check date" convention now has three implementations:** Floor (here, the original), the Billing Picking tab (`CLAUDE_BILLING.md §6`), and the Picking supervisor board (`e37cbe74`, 2026-08-02 — `CLAUDE_PICKING.md §5.2`). On the live board it applies to arm 1 only: arm 3 keeps a checked bill that is on no truck **whatever day it was checked** (`floorCarriedPoolWhere`, `36a39ba7`).

---

## 7. Live-data cleanup [LIVE] — completed one-off, do NOT repeat

**2026-07-23.** The rail opened with **261** undecided bills; only 23 were from the last two days, 151 over a week old. Confirmed the goods had physically shipped weeks earlier and the system was simply never updated. **238 bills** (older than 2 days) were closed to `workflowStage='dispatched'`, each with an `order_status_logs` row *"Bulk backfill: goods dispatched, never recorded in system"*. Rail 261 → 23; Support's pending backlog cleared by the same 238. Two of the 238 were `tinting_in_progress` with open splits — splits deliberately left alone.

This is a **completed one-off**, not a runbook. (It is also the source of the `dispatched`-stage rows to reconcile in `CLAUDE_PICKING.md`.)

---

## 8. Rail slot suggestion [DORMANT]

`lib/floor/suggest.ts` has no importer since the rail's retirement (`79bcc412`; `RAIL_SUGGESTIONS_ENABLED` removed, `lib/floor/queries.ts:326-332`); it stays on disk, pure and unchanged — full story in `archive/2026-09-floor-rail/README.md`.

## 8b. Deferred / not built [DEFERRED]

- **`byAssigned` on Floor — RESOLVED + SHIPPED (commit `661e4e61`).** Decided: it is deliberately **excluded** from Floor's sort — Floor sorts with `FLOOR_SPINE` (the picking spine **minus `byAssigned`**, `lib/floor/sort.ts`), so Assigned/Done rows hold their place instead of sinking/rising on each status change. Full detail: §3.
- **§7-gap follow-ups:** `Waiting` pills show no elapsed time (needs `releasedAt` on the floor payload); detail-panel header pill shows no elapsed time (not a live surface). The ship-to original→redirect pair on the floor table is built (`floor-table.tsx:1070`, `07bc5104`).
- **Out of scope for v1 (deliberate):** gift lines (no identifier exists anywhere in the codebase — no heuristic invented); free-text ship-to (needs a schema decision); the stats line / "pickers free" tile / floor-idle alarm (removed per design §7.13).

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
| The sort rule objects + `sortPickingQueue()` (`lib/picking/sort.ts`) | **Untouched.** Still imported by `lib/floor/sort.ts` → `FLOOR_SPINE`, `lib/floor/queries.ts` and `components/floor/trip-desk.tsx` |
| `lib/hooks/use-picking-marker.ts` | **Untouched behaviourally.** Four call sites became three; Floor's (`floor-page.tsx`, via the `url` param) is one of them. Only the dead `"rolling"` value left its `MarkerScope` union |

⚠ Two things DID go, and neither was Floor's: the `rolling` queue scope and the four payload
counters (`windows[]`/`totalCount`/`unmatchedCount`/`assignedCount` + `isStillWaiting`). Floor never
read either — it has its own predicate (`floorBoardWhere`, §3) and counts off its own rows.

## 9c. Floor decision rail retirement — DONE 2026-09-13 [LIVE]

Stopped rendering 2026-09-10 (`bbb9628c`), archived 2026-09-13 (`79bcc412`) → `archive/2026-09-floor-rail/README.md`. Its predicate `floorUnslottedWhere` is still live as board arm 2 (§3).

---

## 10. Landmines [LANDMINE]

- **Picker `suggested` prop is highlight-ONLY** — `value ?? suggested` precedence in `dispatch-slot-picker.tsx`; wiring `suggested` into the trigger's committed/filled look would make a proposal read as a decision.
- **`change-slot` never clears `dispatchSlotRuleId`** (`app/api/floor/actions/route.ts` — write verified 2026-09-18: sets date+window+`source:'manual'` only). 6 live rows (2026-08-03 count) carry an engine rule id beside a human-picked window — harmless today, misleading in any future audit. One-line fix, owner decision (ROADMAP).
- **The import-side twins of the clock bug live in IMPORT, not here:** `obdEmailDate` fake-midnight population + the `arrivalSlotId` Morning defect + `import_raw_summary.obdEmailTime` not-source-of-truth → `CLAUDE_IMPORT.md §12.1b`/`§12`/landmines. Cross-ref only.
- **`heldAt` is the ARRIVAL date, not the hold time** — the write is intentional and inherited from Support (§4.5); thousands of historical rows depend on it. Do NOT "fix" it to wall-clock; the Hold tab already handles it on the read side. Reading `heldAt` as "held since" shows a 3-week-old bill held 5 min ago as "21 days".
- **The board and the marker MUST stay on the one shared predicate** `floorBoardWhere` (§3/§5). Re-declaring the WHERE in either place reintroduces the marker/queue drift the Picking §10 landmine warns about. Widen it only by adding a named arm; never by dropping `dispatchStatus: "dispatch"` from an arm (measured at 2,545 finished bills onto a 40-row board, `queries.ts:436-449`).
- **`floorUnslottedWhere` is not dead code.** It was the rail's predicate and is board arm 2; removing it drops every undecided bill off the screen (`archive/2026-09-floor-rail/README.md`).
- **`floorTripBillsWhere`'s `tripDropId: { not: null }` is load-bearing** — deleting it turns the whole `OR` into a sequential scan (`queries.ts:226-240`).
- **Never add a second `orders.update` (or a log write to the dispatch engine)** in any floor path — the marker keys on `MAX(orders.updatedAt)`; a second write fires a false "changed" on every board.
- **Delivery-type scope is applied CLIENT-SIDE** — the DB queries return all types. A future "just filter in SQL" change would desync the marker (which watches all types) from the board.
- **`dispatched`-stage rows exist** — live 2026-09-18: **7,330** at `workflowStage='dispatched'` (Q09). The §7 backfill (238 rows) was a one-time manual sweep, not a code path. Who writes `dispatched` today, and why no trip closes → `CLAUDE_FLOOR_TRIPS.md §14`.
- **Parked data issues (not Floor bugs):** `Deco` (9 rows) — un-mapped raw XLS SMU value that should be `Deco Retail`, so those bills silently never auto-slot; the 103 Deco Retail bills that reached `pending_support` with `dispatchStatus` NULL are the class `applyNoMailOrderFallback` now releases at import (`b3dfe5b8`); four identical `Shree Rang Sarita` bills (22 Jul 18:31, 140 L, different OBDs — dup import unconfirmed); a `SAT FIN 93 BASE 3.7L` line carries pack chip `4L` so litres compute 16 vs 14.8 (a catalog value, Chandresh's cleanup list); three test bills marked urgent 23 Jul (clear unless genuine).

## 10b. Known issues [OPEN] — recorded, not fixed

- **Tint lock is inert** (§4.7): `tintLocked` requires `source === "rail"` (`detail-panel.tsx:413-418`), a source nothing opens since the rail retired; the server route has no tint guard.
- **A `pending_support` row has no Release on the desk.** Release renders for `source === "hold"` only (`detail-panel.tsx:583`) and is posted only by the Hold bar and that button (`floor-page.tsx:1010`, `:1221`); trips never write a bill's status or slot (`CLAUDE_FLOOR_TRIPS.md §13`). A restored bill therefore stays at `pending_support` unless it is held and released from the Hold tab. The `no slot` tooltip says "putting this bill on a trip gives it one" (`floor-table.tsx:693`), which no trip route does.
- **Dead payload:** `getFloorBoard` still computes `waitingSkus` and `oilSkus` (`lib/floor/queries.ts:1143-1165`, one extra `import_raw_line_items` read and, with `RULE2_ENABLED = true` at `:352`, one extra `sku_master_v2` read). No file under `components/floor/` reads either (grep); only `lib/floor/scope.ts:126-128` passes them through. Their only reader was the By group view.
- **Orphan components with zero importers** (two greps, 2026-09-18): `components/floor/assign-bar.tsx`, `assign-context-banner.tsx`, `trip-selection-bar.tsx`, and `lib/floor/suggest.ts`. Kept per the no-delete rule; owner instruction needed.
- **`FloorDetailSource` still lists `"rail"`** (`lib/floor/types.ts:422`); no opener passes it.
- **`GET /api/floor/trips/[id]` response shape** — `floor-page.tsx` `undoAdd` (`:572`) and the add receipt (`:707`) read the body as the trip, but the route returns `{ trip }`. Owned by `CLAUDE_FLOOR_TRIPS.md §17` (open item 13).
- **Stale code comments** (claims, for a later code-comment pass):
  - `lib/floor/queries.ts:6-14` (header describes a "Left rail"), `:151-153` ("the rail feed (which still exists)"), `:622` ("drives the assign-bar dropdown"), `:704` / `:844` / `:1172` ("See getFloorRail above"), `:818-819` ("putting one on a trip is what releases it").
  - `app/api/floor/actions/route.ts:10` ("floor/rail bills"), `:159-161` (restore → "back onto the left rail … getFloorRail").
  - `lib/floor/release.ts:5` ("the rail" as a caller). `lib/floor/hold-log.ts:27-28` (`FLOOR_CLEAR_HOLD_NOTE` "written by … action \"clear-hold\"" — no such action, `actions/route.ts:21-22`). `lib/floor/use-floor-rail-poll.ts:3-5` ("The RAIL's live-sync").
  - `components/floor/floor-page.tsx:13-14` ("Putting a bill on a trip is what gives it a slot"), `:24-27` (floor-rail "still on disk" — archived), `:878-886` ("per-bill release is what putting the bill on a trip does now … Nothing on this screen posts to it"), `:1017` ("back to the left rail").
  - `components/floor/floor-table.tsx:3-10` (slot-tab / Upcoming-strip render sites; "⋯ stays INERT"), `:34-35` ("# columns"), `:687-688` (a trip gives a bill its date).
  - `components/floor/detail-panel.tsx:391-409` (points at `rail-card.tsx` and `getFloorRail`), `:580`, `:603`, `:615-617` ("teal"; ship-to "owned by Support").
  - `app/api/floor/order/[orderId]/route.ts:142` ("the only place on the floor that reads `tint_assignments`" — `/api/floor/tint-operators` reads it too).

---

## 11. Key files index

Trip files are listed for completeness; their trip behaviour is **owned by `CLAUDE_FLOOR_TRIPS.md`** (marked ✈).

| File | Role |
|---|---|
| `app/(floor)/floor/page.tsx`, `layout.tsx` | Route shell |
| `components/floor/floor-page.tsx` | Composition root — tabs, state, feeds, write handlers, live-sync mounts, the single Esc listener, detail wiring |
| `components/floor/trip-desk.tsx` | The Floor tab: pool / trip / add states, client `FLOOR_SPINE` sort |
| `components/floor/floor-table.tsx`, `route-row.tsx`, `status-pill.tsx`, `progress-bar.tsx` | Bill table, By-route groups (tabs without clubs), status + tint pills |
| `components/floor/route-cards.tsx` | By route cards on a tab with clubs — model (`buildRouteCards`, `cardsHoldingTicks`), grid (`useCardColumns`), cards and panels (§2.1) |
| `lib/floor/route-clubs.ts` | `getRouteClubs()` — the clubs + each member's `reachFrom`, read for `GET /api/floor/board` (§2.1) |
| `components/floor/load-plan.tsx` | The Load plan view — summary, truck cards, the one panel, Make trip (§2.2) |
| `lib/trips/load-plan.ts`, `load-plan.test.ts` | `planLoads` / `parseLoadPlanConfig` / `summarisePlan` — the pure engine, and its tests (§2.2) |
| `lib/floor/load-plan-config.ts` | `getLoadPlanPayload()` — `load_plan_config` + route names for `GET /api/floor/board`; never throws (§2.2) |
| `components/floor/floor-bottom-bar.tsx` | Bottom bar (Add to / Remove from trip, ✕ clear) — ✈ for what it does to a trip |
| ✈ `components/floor/trip-rail.tsx`, `trip-bar.tsx`, `trip-detail-header.tsx`, `trip-add-band.tsx`, `trip-form.tsx`, `trip-vehicle-editor.tsx`, `trip-history.tsx`, `trip-options.ts`, `pick-gate-toggle.tsx` | Trip rail, trip header, add band, create form, vehicle editor, trip history, option lists, desk-control switch |
| `components/floor/hold-tab.tsx`, `hold-bar.tsx`, `cancelled-tab.tsx`, `pdf-preview.tsx` | Hold + Cancelled tabs, Hold-report PDF |
| `components/floor/detail-panel.tsx`, `detail-items.tsx`, `detail-details.tsx`, `detail-activity.tsx` | Detail panel |
| `components/floor/dispatch-slot-picker.tsx` | Slot picker (panel header, Hold bar, billing ribbon) |
| `components/floor/search-box.tsx`, `filter-sheet.tsx`, `connection-strip.tsx`, `floor-skeleton.tsx` | Search/filter, connection strip, skeleton |
| `components/floor/assign-bar.tsx`, `assign-context-banner.tsx`, `trip-selection-bar.tsx` | **Orphans** — zero importers (§10b) |
| `lib/floor/queries.ts` | Board / hold / cancelled / pickers feeds + `floorBoardWhere` and its four arms + `floorHistoryTripBillsWhere` + `getFloorLiveMarkerWhere` |
| `lib/floor/types.ts`, `selection.ts`, `search.ts`, `filter.ts`, `sort.ts`, `scope.ts`, `format.ts` | Types, selection, search/filter, `FLOOR_SPINE`, scope (incl. ✈ `tripInScope`/`tripMixLabel`), formatters incl. `resolveFloorDisplayDate` |
| `lib/floor/hold-log.ts`, `hold-pdf.ts`, `release.ts`, `release-stages.ts` | Hold notes + PDF, `releaseBillsToFloor`, releasable stages |
| ✈ `lib/floor/dispatch.ts` | `markBillsDispatched` (→ `CLAUDE_FLOOR_TRIPS.md §14`) |
| `lib/floor/suggest.ts` | **Dormant** — zero importers (§8) |
| `lib/floor/use-floor-rail-poll.ts` | Whole-desk 30s poll |
| `lib/dispatch/punch-clock.ts` | `hasClockTime` + `resolveArrivalClocks` (owned by `CLAUDE_IMPORT.md §12.1b`) |
| `app/api/floor/board/route.ts` | Board + pickers |
| `app/api/floor/hold/route.ts`, `cancelled/route.ts` | Hold / Cancelled feeds |
| `app/api/floor/release/route.ts`, `actions/route.ts` | Release / state actions (422-on-total-failure) |
| `app/api/floor/order/[orderId]/route.ts` | Detail payload |
| `app/api/floor/ship-to/route.ts`, `ship-to-search/route.ts` | Ship-to save + search |
| `app/api/floor/tint-operators/route.ts` | Tinting tab operator names |
| `app/api/floor/marker/route.ts` | Live-sync marker (floor-exact set) |
| ✈ `app/api/floor/pick-gate/route.ts`, `app/api/floor/trips/**` (9 route files) | Desk control + trips API |
| `lib/dispatch/dispatch-engine.ts` | Auto-slot engine (reused; **owned by CORE §7.4**) |

---

## Change log — v1.8 (2026-09-24, route cards: single-open chips)

Evidence: the code as committed — `ff7713ad` (chip row, single open card, Esc rung, `shownCards`) and the follow-up commit of 2026-09-24 (cards for any bill incl. upcoming, "Upcoming only", empty member lines hidden); `9bfcccb2` (the Upcountry club seed, `sql/2026-09-24-route-clubs-upcountry.sql`, not confirmed run at this entry).

- §2.1 rewritten: which cards are drawn (any bill, upcoming included; no empty cards; no empty member lines), "Upcoming only", the chip row (one chip when only one card is drawn — the "← Back to cards" layout was removed the same day), `openRouteCard` owned by `floor-page.tsx` with its new Esc rung, the ticks trade-off (was: multi-open with ticks, commit 4b), Upcountry clubs listed, Other routes on Upcountry (18, 22).
- §2 pool bullet: route clubs on Local and Upcountry.
- Schema stamp left at v27.24 on purpose (no reconciliation pass).

## Change log — v1.7 (2026-09-19, the Upcountry load plan)

Evidence: the code as committed — `ce10bfb1` (config SQL, engine, 12 tests), `a034709e` (view + panel + config read), `6fc2fb42` (Make trip through the New trip flow). `sql/2026-09-19-load-plan-config.sql` is NOT yet run live at this entry.

- New **§2.2 Load plan**: where it shows, what it plans (due only), the rules and their config, the algorithm, the view, Make trip, Kamrej in both views.
- §3: the board payload gains `loadPlan`. §11: `load-plan.tsx`, `lib/trips/load-plan.ts` (+ tests), `lib/floor/load-plan-config.ts`.
- Schema stamp left at v27.24 on purpose (as v1.6). The table is CORE §7.18.

## Change log — v1.6 (2026-09-19, route clubs + route cards)

Evidence: the code as pushed — `f8647a6b` → `9c584a24` (tables, data, cards, click-to-open, multi-open, upcoming-in-route, the equal grid, the 1470px breakpoint); the two SQL files run live 2026-09-19 with their checks returned; `lib/floor/scope.ts:62-64` read for the trip tab rule.

- §2: the pool bullet says By route is the default; new **§2.1 By route — the route cards** (where they show, clubs, the 4/3/2 grid and its 1470/1100 breakpoints, order, equal size, the numbers, the bar, click-to-open and multi-open, the panel, the Kamrej reach, placeholder routes 20/25, the tab rules).
- §3: the board payload gains `routeClubs`; rows gain `routeId` and `stopKey`.
- §4.9: `showArea` — Area in the Route column in a card's panel.
- §11: `route-cards.tsx` and `lib/floor/route-clubs.ts` added.
- §2.1, later the same day (`fb997f88`): the single-route cards are gone — every unclubbed route plus No route now share ONE display-only **"Other routes"** card, always last, lines by kg with No route as the last line; nothing is written to the club tables for it.
- Schema stamp **left at v27.24 on purpose.** This entry documents how Floor uses the route-club tables, but the file has not been reconciled against CORE v27.36 as a whole; per `CLAUDE.md §4` item 4 a stamp is the output of a reconciliation pass, never a tidy-up. The tables themselves are CORE §7.17.

## Change log — v1.5 (2026-09-18 reconciliation pass)

Evidence: code at HEAD `cc1e721a` (no code change after `ec6343ba`), the 2026-09-18 canon-sweep report, live results 2026-09-18 (Q02, Q03a, Q07a-c, Q09), `git show --stat` for every retirement commit, two-method importer greps.

- §1: rewritten around the trip desk; Access now names the PageKey `floor` vs role slug `floor_access` union, records user-mode access (live ACCESS_SOURCE=user, floor ticks 39/6/6/1, `floor_access` 4 holders) and marks the seed as seed; ownership table points trips at `CLAUDE_FLOOR_TRIPS.md`, auto-release at `applyNoMailOrderFallback`, Print tab at `CLAUDE_BILLING.md §7`.
- §2: the screen rewritten — four tabs, trip rail, pool/trip/add states, bottom bar; one retirement line each for the rail (`79bcc412`), slot tabs + By group (`bbb9628c`/`cdbf95b1`/`f41b52c9`), By picker, assign bar, upcoming strip.
- §3: board predicate is `floorBoardWhere` with four arms; rail feed removed; why arm 2 has bills (fallback + SMU gate + restore); history gains `FLOOR_HISTORY_STAGES` (`551069aa`) and the by-trip arm (`175c83fd`); client sort moved to `trip-desk.tsx`.
- §4: cancel deletes `pick_assignments` (`00d7da22`); restore lands as a `no slot` row; release goes through `releaseBillsToFloor` with the tint skip; assign is panel-only; §4.6 assign bar → bottom bar, "teal" → brand; §4.7 tint facts + tint lock (and that it is inert); new §4.8 Tint on the floor, new §4.9 the bill table (Invoice, Due, soft duplicate-SO, TINT/BASE, display date).
- §5: the 30s poll refetches the whole desk; marker shares `floorBoardWhere`.
- §6c: arm 3 note. §8 → DORMANT (one line). §8b trimmed. New §9c (rail retirement).
- §10: removed the RAIL_SUGGESTIONS, slot-tab and orderDateTime-display landmines (code gone or corrected in §4.9); predicate landmines renamed to `floorBoardWhere`; dispatched count → live 7,330 with pointer to FLOOR_TRIPS §14. New §10b known issues and stale code comments.
- §11: rebuilt from `ls components/floor lib/floor app/api/floor`; trip files marked ✈.
- Schema stamp v27.13 → v27.24 (reconciled against CORE v27.24 in this pass).

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

*CLAUDE_FLOOR.md v1.8 · Schema v27.24 · OrbitOMS · updated 2026-09-24*
