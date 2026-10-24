# CLAUDE_FLOOR.md — Floor Control
# v1.10 · Schema v27.74 · October 2026 · updated 2026-10-24
# Lives in: orbit-oms/docs/
# Load with: CLAUDE.md (repo root) + docs/CLAUDE_CORE.md + docs/CLAUDE_UI.md (+ docs/CLAUDE_FLOOR_TRIPS.md for anything trip-shaped)

Covers `/floor` — the desk operator's trip desk: plan which bills go on which truck, and watch what happens to them on the floor.

---

## 1. What Floor Control is [LIVE]

One desk screen for one person — the planner who puts bills on trucks and watches them get assigned, picked and checked. It was built to consolidate the **Support board** and the **Picking desktop board**; both have since been retired (2026-07-27 and 2026-07-28, §9 / §9b), so Floor is not "the merged view" any more — it is the only desk view. Since 2026-09-10 (`bbb9628c`) the Floor tab is the **trip desk**: trips on the left, bills on the right (§2).

**Route:** `/floor` (`app/(floor)/floor/page.tsx`). Hand-rolled shell, NOT `UniversalHeader` (§10).

**Access — name the union each time.** Two different things carry the word "floor":
- **PageKey `floor`** (`lib/permissions.ts`, in `ALL_PAGE_KEYS` and `PAGE_NAV_MAP` → `/floor`). Every floor route gates on it through `checkAnyPermission(roles, "floor", …)`.
- **Action tick `floor_add_invoices`** ("Floor · Add invoices", 2026-10-10) — canEdit is its only meaning, ON TOP OF `floor` canEdit (the `billing_*` / `tint_*` pattern). Without it the ··· More item is not drawn and save / undo answer 403 "You do not have the Add invoices tick". Holders live 2026-10-24: Ajay Vansiya #29, Dhanraj Shah #30, Priya Chaudhari #31 (per-user rows; no `role_permissions` row). Rule owner → `CLAUDE_ORDER_INVOICES.md §5`.
- **`challan_orders` canView** draws the Challan orders tab (§2).
- **Role slug `floor_access`** (`role_master` id 017, live 2026-09-18 Q07a) — a role, not a page key. 4 holders via `user_roles` (live 2026-09-18 Q07b: Ajay Vansiya #29, Dhanraj Shah #30, Prakash #32, Priya Chaudhari #31).

**How access is decided today: per-user ticks.** Live `ACCESS_SOURCE = user` (live 2026-09-18 Q02). In user mode `checkAnyPermission` returns the user's own `user_page_access` row for the page (`userPagePerms`, `lib/permissions.ts`); role rows are not consulted, except that the `admin` role slug and the superuser flag short-circuit to true. Live `floor` ticks: rows=39 · canView=6 · canEdit=6 · canExport=1 (live 2026-09-18 Q03a); **0** users hold floor canView without canEdit (Q07c). So holding the `floor_access` role slug is not what grants the page in user mode — the ticks are. **Seed says** `admin` + `operations` only, `canView`+`canEdit` (`prisma/seed.ts:117-118`); that is the role-mode seed, not the live grant. ⚠ **`floor_supervisor` and `picker`** are the `/picking` roles; `/floor` is not a fallback for them, which is why the Picking desktop retirement kept `/picking` live rather than redirecting (§9b). Access model: `CLAUDE_CORE.md §5`.

### Ownership boundary — READ BEFORE EDITING ANYTHING FLOOR

Floor Control **reuses Picking as a CALLER**. It did NOT fork or modify it — no Picking component or API file was changed. The one shared edit was `lib/hooks/use-picking-marker` gaining **optional** params (`url`, `onProbe`); all three Picking call sites pass neither and are byte-identical. Support was also a lender until its retirement; everything Floor borrowed from it now lives under `lib/floor/` or `app/api/floor/` and is **owned by this file** (§9).

| This file OWNS | This file does NOT own — cross-reference only, never restate |
|---|---|
| the screen shell: the five top tabs, `TripDesk`'s three states and layout, the bill table (§2, §4.9) · Floor's `FLOOR_SPINE` sort LIST + `keepPairsAdjacent` (`lib/floor/sort.ts`, §3) | assign / unassign + the sort rule OBJECTS + `sortPickingQueue` → **`CLAUDE_PICKING.md §3/§4`** |
| the read feeds and the board predicate `floorBoardWhere` + its four arms, as screen behaviour (§3) | the dispatch engine (`evaluateDispatchSlot`) → **`CLAUDE_CORE.md §7.4`** |
| floor routes: the eight bill actions, hold / release per invoice, Raise CI, release (§4) | **trips**: tables, `lib/trips/*`, `/api/floor/trips/*`, numbering, drops, add / remove / move, re-deliveries, which trips a desk shows, Show to floor / the pick gate, Send to billing → **`CLAUDE_FLOOR_TRIPS.md`** |
| ship-to search + save (§4.4) · the dispatch-slot picker (`components/floor/dispatch-slot-picker.tsx`) · `formatArticleTag` + `resolveFloorDisplayDate` (`lib/floor/format.ts`) | how a new bill reaches the floor without a release step → **`applyNoMailOrderFallback`** (`app/api/import/obd/route.ts`, `CLAUDE_IMPORT.md`) |
| the action surfaces — bottom bar / Cancel–Raise CI dialog / rail add–move confirm / panel header / slot picker / selection keys + Esc (§4.6) | the Billing Print tab that Send to billing feeds → **`CLAUDE_BILLING.md §7`** |
| the detail panel, incl. its invoice scope, the Add invoices dialog AS UI, the tint lock (§4.7) and tint on the floor (§4.8) | **Add invoices — the model and rules**: `order_invoices`, the derived OBD columns, the single writers, the lock rules, the permission's meaning, drift repair → **`CLAUDE_ORDER_INVOICES.md`** |
| one row per invoice, "k/n", the amber split-across-places mark, On hold / Cancel & CI per invoice, search by any invoice (§4.9, §4.10) | the CI itself (lines, register, billing's close) → **`CLAUDE_CI.md`** |
| **invoice pairs** — one invoice on several OBDs, no schema (§4.11) | the Challan orders screen the fifth tab mounts (`components/challan-orders/`) → no domain file yet; schema in **CORE §7** (v27.60) |
| the held-since read-side rule (§4.5) | the colour tokens (`pair`, `warn`, `direct`) and the pair / split row drawing standard → **`CLAUDE_UI.md §2.1`, §27** |
| floor live sync — the feed path and `<LegacyFloorSync>` + `/api/floor/marker` (§5) | the live feed itself (`lib/live/*`, `live_changes`) → **CORE §13** (+ `CLAUDE_PICKING.md §10.0`) |
| the hand-rolled header divergence (§10) | |

If you find yourself explaining borrowed behaviour here, replace it with a pointer.

### What is still live alongside Floor

`/picking` (`app/picking/page.tsx`) is **live and reachable** — `middleware.ts` `PHASE1_BLOCKED` is `[]`. Its supervisor + picker card boards were never in scope for retirement and stay; they now render at EVERY width. **The Picking DESKTOP board is RETIRED** — 2026-07-28, `archive/2026-07-picking-desktop/` (§9). **`/support` is gone** — retired 2026-07-27, §9.

---

## 2. The screen [LIVE]

`components/floor/floor-page.tsx` is the composition root; the Floor tab renders `<TripDesk>` (`components/floor/trip-desk.tsx`, since `bbb9628c`, 2026-09-10).

- **Five top tabs** — `type TopTab = "floor" | "tinting" | "hold" | "cancelled" | "challan"` (`floor-page.tsx`): **Floor** (with a grey "{n} waiting" readout) / **Tinting** / **On hold** / **Cancel & CI** / **Challan orders**, plus the slide-out **detail panel**. The `cancelled` key kept its name when the label became "Cancel & CI" (2026-09-22: today's cancels AND today's CIs, §3). **Challan orders** (2026-10-07, challan slice 5) renders the shared `<ChallanOrdersScreen mount="floor" />` (`components/challan-orders/`), only for a viewer with `challan_orders` canView; its count is "Not billed". The challan screen's own behaviour is not Floor's. The tab row sits inside the table column (`143706be`). Tinting is a client-side VIEW of board rows, not a feed (§4.8). *(This bullet said "Four top tabs … Cancelled" until 2026-10-24.)*
- **One row per INVOICE** (Add invoices Phase 4, 2026-10-13). A split OBD (one OBD that SAP billed as several invoices — `CLAUDE_ORDER_INVOICES.md`) draws one row per invoice, the OBD repeated on each; an invoice PAIR (one invoice shared by several OBDs) sits together with one merged tick. Drawing → §4.9 / §4.11.
- **Left: the trip rail** (`components/floor/trip-rail.tsx`). A "To plan" entry (the not-on-a-trip pool, the default) plus one card per trip, one flat list, newest-created first (`trip-rail.tsx:10-19`). What a trip card says and which trips are listed → `CLAUDE_FLOOR_TRIPS.md §6/§8`.
- **Right: the bills, in one of three states** (`trip-desk.tsx:14-20`):
  - **pool** — header + `Flat | By route` pivot + the table (the not-on-a-trip bills). **By route is the pool's default** (2026-09-19); on a tab with route clubs (Local, and Upcountry once its seed is run) it draws the route cards below (§2.1).
  - **trip** — the selected trip's header + its bills grouped under STOPS, one `FloorTable` per stop.
  - **add** — "+ Add bills" inside a trip: the trip unchanged, then a band, then the pool below it.
  Rows sort with `FLOOR_SPINE`; bills with no slot are ordinary rows marked `no slot` (§3, §4.9).
- **Bottom bar** (`components/floor/floor-bottom-bar.tsx` on the shared shell `floor-action-bar.tsx`) — pool selected → `+ New trip` (an existing trip is picked by clicking it on the rail, which asks first — §4.6); trip selected → `Remove from trip`; plus ··· More and the ✕ global clear. Full spec → §4.6. What those do to a trip → `CLAUDE_FLOOR_TRIPS.md`.
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
- **The bar** (4px, colour is the status, no words; `SEGMENTS` in `route-cards.tsx`): green = done + dispatched · near-black `direct` = Direct Loading (2026-10-03) · yellow = picked, not checked · blue = with picker · grey = waiting + tint done · pink = tinting. **No held segment and no amber in the bar**: a held bill — or a held invoice — is never in the pool. (Amber on the route cards is only the Missing customer card and its "Fix area".)
- **Open state — ONE card at a time** (2026-09-24). Clicking a card collapses the grid into a **wrapping row of chips**, one per drawn card in card order: a 190px box, 12/20px padding, 14px radius, 1px border, two lines — name (15px semibold), then "744 kg · 5 stops" (13px grey; "Upcoming only" when nothing is due). The open chip is **brand-filled with white text and a ✕**. "Esc to go back to cards" sits in small grey at the row's right end. **Another chip switches straight to it; the open chip, its ✕, or Esc goes back to the grid.** **One drawn card still gets the chip row** — one filled chip with its ✕ and the Esc hint — so Local and Upcountry look identical (2026-09-24; the short-lived "← Back to cards" layout is gone).
- **Who owns "open".** `openRouteCard` lives in **`floor-page.tsx`**, because it owns the floor's one window-level Esc listener (§4.6). Esc order gains one rung: … ··· More menus → **open route card → back to the cards** → clear selection → end the add band. **TripDesk clears `openRouteCard`** whenever that card is not on screen (another tab or view, a trip on the rail, a search, or its last bill gone onto a trip), so Esc never spends a press on an unseen card and By route always comes back on the grid.
- **Ticks and the chips.** ⚠ **Was:** every card holding a ticked bill stayed open beside the one last clicked (commit 4b, 2026-09-19), so no tick sat inside a closed card. **Now** only one card is open: ticks in other clubs survive a chip switch and going back to the grid, out of sight — the bottom bar still counts them, and the first Esc returns to the cards without clearing them. Do not reinstate multi-open beside the chips.
- **The table.** Full width under the chip row: one section per route with bills, main first — a heading (name · stops · kg, due bills only; "Upcoming only" when nothing is due), then that route's own `FloorTable` with **Area in the Route column** (§4.9). Today's and overdue bills first, then **upcoming bills by due date** — no "Upcoming" divider.
- **The reach (Kamrej).** A club route with **no area on the club's own tab** draws its bills from the one other tab its areas are on, and its line carries that tab's name in grey ("Upcountry"). `reachFrom` is worked out from `area_master` by `getRouteClubs`; today only Kamrej in the Local club qualifies (all 10 of its areas are Upcountry). In the Upcountry club it is a plain member. A club route with ANY area on the tab shows that tab's bills only.
- **Placeholder routes.** Route 20 "No Route" folds into the **No route** line of Other routes together with bills whose area has no route. Route 25 "TEST R" is hidden (inactive, no areas).
- **Tab rules.** A trip shows on the rail only under its own stored delivery type (`tripInScope`, `lib/floor/scope.ts`); All shows every trip; an opened trip still shows every bill on it whatever tab is selected. **A planned bill leaves the pool on every tab at once**: the pool test is `isPoolRow` (`trip-desk.tsx`) — not a tint-room row, and then an UNSPLIT bill is in the pool when its `tripDropId` is null, a SPLIT OBD when ANY of its invoices is `inPool` (`lib/floor/invoice-rows.ts`: on no trip, not held, no CI, not dispatched) — and only those invoices are drawn there. The tab only filters one unscoped payload in the browser, and every trip write reloads the whole board. *(The pool test was `tripDropId === null` for every bill until P5-3, 2026-10-17.)*

### 2.2 Load plan — suggested truckloads (Upcountry) [LIVE 2026-09-19]

`components/floor/load-plan.tsx` (the view) on `lib/trips/load-plan.ts` (the engine, PURE — no DB, no clock; tests `lib/trips/load-plan.test.ts`, `npm run test:load-plan`). **A suggestion screen: it never creates anything by itself**, and no trip action changes a bill's status or hold.

⚠ **Two corrections, read first (2026-10-24, code at `e817f01f`):**
- **The LIVE Upcountry Load plan is v2** (2026-09-21, `f6f15b1d`): `trip-desk.tsx` renders `LoadPlanV2View` (`components/floor/load-plan-v2.tsx`) for Upcountry outside History, planned SERVER-SIDE by `POST /api/floor/load-plan` → `lib/floor/load-plan-v2-run.ts` (rules: `docs/load-plan/LOGIC.md`; tables CORE §7, v27.38). It adds Replan with "Vehicles I have", pins, moving a stop between cards or to Waiting, and the same Make trip; no rate ever reaches the browser. **The v1 view below now renders only in History.** The v1 text is kept as the record of that view.
- **Load plan is no longer Upcountry's default** — every tab opens on By route (owner, 2026-09-22, `defaultPoolView`); Load plan is still offered on Upcountry only (`LOAD_PLAN_SCOPES`).

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
| Hold | `getFloorHold(scope, hide?, onlyIds?, extraWhere?)` | `GET /api/floor/hold` | `floorHoldWhere()` — not removed, not challan-linked, plus the hide exclusion, and **two arms** (6.1, 2026-10-19): **(1)** `dispatchStatus="hold"` (the whole OBD held); **(2)** a SPLIT OBD (a row with `seq > 1`), not cancelled, with at least one HELD invoice row that has no live CI. All dates (pure open state), recent-held-first. Still ONE data row per OBD; a split OBD's `invoiceRows` is narrowed to its held invoices and drawn one row per held invoice (§4.10). An invoice with its own CI is on Cancel & CI instead. **`extraWhere`** is AND-ed on by two other consumers, both read-only: the Tint Manager's Hold tab (`{ orderType: "tint" }`, `app/api/tint/manager/hold/route.ts`) and **Freight Trips** (not on an active freight trip, `lib/freight-trips/pool.ts` → `CLAUDE_FREIGHT_TRIPS.md` §5). Floor passes none. |
| Cancel & CI | `getFloorCancelled(scope, …)` | `GET /api/floor/cancelled` | **Today only** (IST). Three sources: (a) today's live (not voided, not draft) `ci_returns` on cancelled bills — `action:"ci"`; (a2) **per-invoice CIs** (6.3) — a CI naming an invoice row of a split OBD that is NOT cancelled, one OBD row carrying `invoiceCis[]`, narrowed to those invoices and drawn one row per invoice; (b) today's cancel logs not already listed — `action:"cancel"`. `anyDate` (with `onlyIds`) is for search. The tab was "Cancelled" until 2026-09-22. |

`GET /api/floor/board` returns `{ scope, floor, pickers, routeClubs, loadPlan }` (`app/api/floor/board/route.ts`); `floor` = `{ mode, date, rows, windows, total, waitingSkus, oilSkus }`; `pickers` = `getFloorPickers()` (active roster + on-hand load), read by the detail panel's Assign/Reassign; `routeClubs` = `getRouteClubs()` (§2.1); `loadPlan` = `getLoadPlanPayload()` (§2.2; never throws). Each board row also carries `routeId` and `stopKey` (`computeDropKey`) for the route cards, and, since October:

| Row field (`FloorBoardRow`, `lib/floor/types.ts`) | What it is |
|---|---|
| `invoiceRows` | **One Floor row per invoice** (Phase 4, 2026-10-13): every invoice of a SPLIT OBD as a `FloorInvoiceRow` (`lib/floor/invoice-rows.ts` — id, seq, number, date, tins, litres, kg + `kgExact`, its trip / stop, held, CI, dispatched). `[]` = unsplit — the row is the OBD, exactly as before |
| `invoiceRowsAll` | Every invoice, set only on a row narrowed to some of them (Hold, Cancel & CI, a trip stop) |
| `addedInvoiceNos` | The hand-typed numbers (seq 2..n), derived from `invoiceRows` |
| `invoicePartners` | The OTHER OBDs on this bill's invoice and where each is now — invoice pairs (§4.11) |
| `challanNumber` / `challanVoided` | The delivery challan for the DC column (2026-10-09) |
| `salesOfficerName` / `…Source` / `…Phone` / `…RawName` | Whose bill it is, by division (2026-10-06); the raw name is search-only |
| `shipToCopyCount` | Active typed-ship-to challan copies (v27.73) |
| `redelivery?` | Client-only RE-DEL mark on a trip (→ `CLAUDE_FLOOR_TRIPS.md`) |
| inherited from `PickingQueueRow` | `isChallanOrder` (CHALLAN pill), `isObdImport` (ODB pill, v27.68), `articleCount` (v27.58), `directLoadedAt` / `directLoadedByName` (Direct Loading, v27.52) |

`orders."partlyOnTrip"` is NOT on any Floor row — it exists only for the query plan (below). Board, hold, cancelled, marker, counts, rows, search, order detail, ship-to search, tint-operators and the Add invoices GET gate on `checkAnyPermission(roles,"floor","canView")`; actions, release, CI, ship-to save, pick-gate and trip writes on `canEdit`; Add invoices save / undo on `floor` canEdit AND `floor_add_invoices` canEdit (`CLAUDE_ORDER_INVOICES.md §5`). `load()` also fetches `GET /api/floor/trips?date=` in the same batch — trip routes → `CLAUDE_FLOOR_TRIPS.md`.

**Other Floor read routes** (since 2026-09-30): `GET /api/floor/search` (which tab a bill is on, by full OBD / SO / any invoice number — §4.9) · `POST /api/floor/rows` (live-feed row patches by id, ≤ 300, through the same three feeds with `onlyIds`; needs the `live.feed` switch — §5) · `GET /api/floor/counts` (On hold / Cancel & CI tab counts while those tabs are not loaded; `live.feed` switch) · `POST /api/floor/load-plan` (the Upcountry load plan v2 — §2.2) · `GET /api/floor/ci` (CI reasons).

**`floorBoardWhere(todayRange, todayDateOnly)` — the live predicate, SHARED by the board and the marker** (`lib/floor/queries.ts`; the marker's `getFloorLiveMarkerWhere`), so they cannot drift (§5). A union of **four named arms**, each a complete set of terms, never a term removed from another:
1. **`floorLiveBaseWhere(todayRange)`** — `dispatchStatus="dispatch"`, and either still OPEN (`workflowStage ∈ PICKING_OPEN_STAGES` — pending_picking / pick_assigned / pick_done, **any** dispatch date; Floor's carry-over arm, design §4.2) or **CHECKED TODAY** (`workflowStage=pick_checked` AND `pick_assignments.checkedAt` OR `directLoadedAt` ∈ `getISTDayRange()`, today IST, whatever day it was due).
2. **`floorUnslottedWhere()`** — `RAIL_STAGES` (rank < 60) AND `dispatchStatus IS NULL`, not removed: bills with no dispatch decision. The retired rail's own predicate; its feed went, this arm did not (`archive/2026-09-floor-rail/README.md`).
3. **`floorCarriedPoolWhere()`** — `pick_checked`, `dispatchStatus="dispatch"`, and **`HAS_ROW_OFF_TRIP_WHERE`** (`lib/order-invoices/trip-read.ts` = `"tripDropId" IS NULL OR "partlyOnTrip"`): checked and with at least one invoice on no truck, **whatever day it was checked** (`36a39ba7`; the invoice term since P5-2, `c10dffaf`, 2026-10-15 — it was `tripDropId IS NULL`).
4. **`floorTripBillsWhere(todayDateOnly)`** — `dispatchStatus="dispatch"`, `tripDropId: { not: null }`, and on a trip the desk is about, in TWO branches: the OBD's own stop's trip (`liveTripsOnDeskWhere`, `lib/trips/live-trips.ts` → `CLAUDE_FLOOR_TRIPS.md`), OR any `seq > 1` invoice row on such a trip (P5-2). Its `tripDropId: { not: null }` term is redundant by meaning and load-bearing by query plan (its header: "REDUNDANT AND LOAD-BEARING. DO NOT DELETE") — do not delete it.

🔴 **Arm 3's `partlyOnTrip` term and arm 4's second branch are shaped for query speed, not meaning.** Reading every invoice row there measured 60 ms vs 34 ms on the 15-second marker with a new Seq Scan on `order_invoices` (2026-10-15); the `seq > 1` filter rides `order_invoices_tripDropId_idx` (~1 ms). The desk rule `tripsOnDeskWhere` carries the same second branch. Never swap either for a bare `invoices: { some: … }` filter without an EXPLAIN before and after. Why the columns exist → `CLAUDE_ORDER_INVOICES.md §3` and §8.

Plain English: everything still open whatever day it was due, everything the floor finished today, everything nobody has decided on, everything checked with an invoice not yet on a truck, and everything with an invoice on a live trip.

**Why arm 2 has bills in it now.** Since 2026-09-11 every new non-tint bill with no mail order is released by the import itself — `applyNoMailOrderFallback` (`app/api/import/obd/route.ts:554`, `b3dfe5b8`; owner `CLAUDE_IMPORT.md`) writes `dispatchStatus="dispatch"` + `pending_picking` in one update, so those bills land in arm 1, not arm 2. The fallback skips `orderType='tint'` (`:571`), so tint bills in the tint room ride arm 2 (they are the Tinting tab's rows, §4.8). A Restore writes `pending_support` + null status, so a restored bill also lands in arm 2 as a `no slot` row (§4.1). **The SMU gate:** the fallback calls `evaluateDispatchSlot`, which declines any bill whose `smu` is not `Deco Retail` (`route.ts:520-528`); those bills are still released but carry no slot — arm 1 rows showing `no slot`. The comment there records about 12.5 such bills a day over the 30 days to 2026-09-10, and calls it a business rule.

**The HISTORY predicate (`mode="history"`)** (`queries.ts:727-804`) — two members under one `OR`:
- **The day's record.** Outer AND terms `dispatchStatus="dispatch"`, `isRemoved=false`, `workflowStage ∈ FLOOR_HISTORY_STAGES` (`= [...PICKING_ACTIVE_STAGES, DISPATCHED]`, `:101`, `551069aa`), with two date anchors:
  1. **promised for D** — `dispatchTargetDate = D`.
  2. **checked on D** — `workflowStage ∈ [pick_checked, dispatched]` AND `pick_assignments.checkedAt ∈ getISTDayRange(D)` (`:796`), whatever day it was promised. Same helper and same half-open shape as the live arm, with the viewed day instead of today.
- **The day's trips' bills** — `floorHistoryTripBillsWhere(D)` (`175c83fd`): every bill on a non-cancelled trip dated D, no stage and no status pin, so a History stop finds all its bills. Since v27.66 (readers B, `912f17ec`) it reads THROUGH the invoice rows (`onTripsWhere`, `lib/order-invoices/trip-read.ts`), so a split OBD is found on every trip any of its invoices rode. History still draws a split OBD as ONE row (open item → ROADMAP).

Plain English: what was owed that day, plus what was finished that day, plus what rode that day's trucks. A bill matching more than one appears **once**; a bill finished early appears under **two** days (its promise day and its check day) — both statements are true, and that is the owner decision, not a predicate accident. ⚠ This is the **same promise-vs-completion anchor class** as §6c / the 2026-08-02 picking `checkedAt` fix: a completion belongs to the day it happened. The checked-on-D anchor exists because without it a bill promised for D+1 but checked on D was on **no reachable screen at all** — live had dropped it, D's history never had it, and D+1's history is unreachable behind the stepper clamp (`floor-page.tsx:1283-1284`). The marker does **not** consume this predicate (§5 — it is live-only).

⚠ **Floor's carry-over is its OWN scope — NOT `lib/picking/queue.ts`'s WHERE.** Picking's carry-over deliberately excludes `pick_done`/`pick_checked` (a documented "workaround, not a fix"). Floor's arm 1 keeps anything not-yet-checked. Do not "align" the two.

Per row: `zone` (`due` | `upcoming`, from `dispatchTargetDate` vs today) and `ageDays`. Rows are sorted with Floor's OWN **`FLOOR_SPINE`** (`lib/floor/sort.ts`) = the picking spine **minus `byAssigned`**, so Assigned/Done rows HOLD their position instead of sinking on assign and rising on done (a convention Floor shared with the Picking desktop board, retired 2026-07-28 — §9b; Floor is now its only implementation). ⚠ **Ownership boundary:** the rule OBJECTS (`byWindow`/`byDeliveryType`/`byKeyCustomer`/`byPriority`/`byFifo`) and `sortPickingQueue()` are IMPORTED from `lib/picking/sort.ts` (never copied — that file stays owned by `CLAUDE_PICKING.md §3`); only the Floor rule LIST is Floor's own. `FLOOR_SPINE` is applied in the places that sort and must stay identical or the board flickers on refetch — the server sort (`getFloorBoard`) and the client (`trip-desk.tsx`, `lib/floor/live-merge.ts`, the load plans), all through **`sortFloorRows`** (`lib/floor/sort.ts`) = the spine sort, then **`keepPairsAdjacent`** (2026-10-08, `fd0fa9d6`): OBDs that share one invoice are pulled up to their best-ranked member's place, within one list, so an invoice pair sits together (§4.11; re-delivery rows excluded). `route-cards.tsx` and `lib/floor/division-blocks.ts` call `keepPairsAdjacent` on their own sub-lists. Shipped commit `661e4e61`.

---

## 4. Floor actions [LIVE]

Every write path: sequential awaits, **exactly ONE `orders.update` per bill**, **exactly ONE `order_status_logs` row per bill per action** (CORE §3 / the marker keys on `MAX(orders.updatedAt)` — a second write fires a false "changed" on every board). No Floor file contains `prisma.$transaction`. Writes to OTHER tables ride alongside and do not break the contract: cancel deletes `pick_assignments`; every OBD-level hold / release / cancel writer then calls **`mirrorObdHoldSafe`** (one `order_invoices.updateMany`, `CLAUDE_ORDER_INVOICES.md §4.4`); a challan (ORB) cancel releases its linked bills; a tint cancel stops tint work. The per-invoice hold path writes `orders` only when the derived status changes (below).

**Per OBD vs per invoice (Model A).** Picking, tint, cancel, ship-to, Hand and the slot stay per OBD; **hold, release, Raise CI and trip membership are per INVOICE** on a split OBD. Any invoice of an OBD on a trip refuses the per-OBD actions with "On trip {T} — remove it from the trip first" / "{k} of {n} invoices on {T} — remove them from the trip first" (`lib/order-invoices/trip-refusal.ts` `onTripMessage`). The rules → `CLAUDE_ORDER_INVOICES.md`; this section owns the routes.

### 4.1 `POST /api/floor/actions` — the eight bill actions

Batch `{ action, orderIds[], urgent?, dispatchTargetDate?, dispatchWindowId?, reasonKey?, remark?, invoiceRowIds? }`. **`BILL_ACTIONS`** (`lib/floor/bill-actions.ts`) is exactly eight: `mark-urgent` · `change-slot` · `hold` · `unhold` · `cancel` · `restore` · `hand` · `unhand`. Per bill (`applyBillAction`):
- **mark-urgent** — set/toggle `priorityLevel` (1 ↔ 3); notes "Marked urgent (P1)" / "Cleared urgent".
- **change-slot** — write `dispatchTargetDate`+`dispatchWindowId`+`dispatchSlotSource="manual"`, no stage change and no status change (a pre-set; also re-slots a floor bill).
- **hold** — `dispatchStatus="hold"`, `heldAt = obdEmailDate ?? now` (arrival anchor, §4.5). Log note = `FLOOR_HOLD_NOTE`. Refuses a cancelled bill; a SPLIT OBD with any invoice on a trip is refused (`onTripMessage`) — an unsplit bill on a trip may still be held. Undo for 8 s from the toast.
- **unhold** — the clear-hold action: `dispatchStatus = "dispatch"` at `FLOOR_CLEAR_HOLD_STAGES`, else null. Refuses "Bill is not on hold" and a live CI (`liveCiRefusal`).
- **cancel** — `workflowStage="cancelled"`, `dispatchStatus=null`, with a reason (`reasonKey`, `lib/floor/desk-cancel-reasons.ts`: Pick delete · Customer cancelled · Wrong order by SO · Duplicate bill · Material short · Other — "Other" needs a remark). Refused, in order: a challan (ORB) order ("Only admin can cancel a challan order."), then `offFloorRefusal` (`lib/floor/off-floor.ts`: already cancelled, dispatched, any invoice on a trip, or in the tint room — "In the tint room — use Stop & cancel on Tint Manager"). **Also deletes the bill's `pick_assignments` row** after the stage write (`00d7da22`) — a surviving row made a restored bill permanently un-assignable. Posted only from the Cancel / Raise CI dialog (§4.6).
- **restore** — cancelled → `pending_support` ("Restored to decisions"), or, for a tint bill that never finished, `pending_tint_assignment` ("Restored to tint queue"). Refuses "Order is not cancelled" and "Return {ciNumber} is with billing — it can't be restored here". A restored bill comes back as a `no slot` row through arm 2 (§3).
- **hand / unhand** — the Hand mark (`handAt` / `handById`, the dealer collects); refused while any invoice is on a trip; a repeat press is `skipped`.

**Per-invoice hold / release** (6.1, 2026-10-19): `invoiceRowIds: { [orderId]: rowIds[] }` with `hold` or `unhold` routes that OBD to `holdRows` / `releaseRows` (`lib/order-invoices/hold.ts`) instead — refused per invoice when it is on a trip or dispatched; `orders` is written only when the derived `dispatchStatus` changes (every invoice held ⇔ OBD `'hold'`); one log naming the rows. `invoiceRowIds` with any other action is a 400 ("invoiceRowIds is for hold / unhold only").

Returns `{ done, failed[{orderId, error, invoiceRowId?, invoiceNo?}], skipped?, doneRows? }`; **422 when nothing was written and something failed**; a partial success stays 200 with `failed[]`; an all-skipped press is 200.

### 4.1b `POST /api/floor/ci` — Raise CI from the floor

Body `{ orderIds, reasonId, remark?, invoiceRowIds? }`, `floor` canEdit (GET lists the reasons). Behaviour of the CI itself → `CLAUDE_CI.md`.
- **Whole bill** (`raiseFullBillCi`, `lib/floor/raise-ci.ts`): the CI, then the bill is cancelled, the hold mirror, the `pick_assignments` delete, and a log "CI raised — {ciNumber} · {reason}".
- **Ticked invoices of a split OBD** (`raiseInvoiceCi`, 6.3): one CI per invoice, **no `orders` write** (the OBD is not cancelled) unless the CI finishes the OBD under the done rule (`CLAUDE_ORDER_INVOICES.md §3`, §4.6). A held invoice may be returned. Refusals word for word: "{inv} is on {trip} — remove it from the trip first" · "{inv} is dispatched — it cannot be returned here" · "Already has {ciNumber}" · "A CI draft is open on /ci for this bill" · "Not a split OBD — raise the CI on the whole bill" · "The bill has no active lines to return" · "{n} line(s) have no delivered quantity, so it cannot be returned in full — use Part on /ci".
- 422 when nothing was raised. The invoice then leaves the board and shows on Cancel & CI (§3).

### 4.2 `POST /api/floor/release` — Hold-tab bulk release AND the panel's Release

Body `{ releases: [{ orderId, dispatchTargetDate, dispatchWindowId }] }` — WHOLE bills only. The write lives in `releaseBillsToFloor()` (`lib/floor/release.ts`), called once per bill by the route: the slot, `dispatchStatus="dispatch"`, `workflowStage=SUPPORT_DONE_OUTPUT` (pending_picking), `dispatchSlotSource="manual"`, in one update, then `mirrorObdHoldSafe`. Log `fromStage` = the bill's **real** prior stage. The live-CI guard runs first. A bill still in the tint room (`pending_tint_assignment` / `tint_assigned` / `tinting_in_progress`) is skipped as `waitingForTint`, which the route folds back into `failed[]`. Client callers: the Hold tab's bar and the detail panel's Release, which renders for `source === "hold"` only (§4.7). No trip route calls it (`CLAUDE_FLOOR_TRIPS.md`).

**A held INVOICE is released without a slot** — not through this route: the Hold bar (every tick a held invoice of a partly-held OBD → `slotOptional`, no slot needed) and the panel's "Release invoice" post `unhold` + `invoiceRowIds` to §4.1. A whole held OBD still goes through here.

**Releasable stages — `FLOOR_RELEASABLE_STAGES = ["pending_support","pending_picking"]`** (`lib/floor/release-stages.ts`). Floor's own explicit list, deliberately **NOT** `supportMayEdit()` (`lib/workflow-stages.ts`) — that predicate encoded Support's permission model, and Floor's release gate answers a different question. It is now dead code with zero callers, kept pending a ROADMAP cleanup; do not wire it back in here. `pending_support` = a bill with no dispatch decision (the stage name is historical — nothing named Support writes it any more); `pending_picking` = a bill held after auto-dispatch (hold flips status only, never stage). Same 422/partial contract as §4.1.

**A HELD bill at a picker stage (owner decision 2026-10-01).** Hold never moves the stage, so a bill held while a picker had it sat on the Hold tab and Release refused it ("Not releasable at stage pick_assigned") — the hold could never be cleared from the floor. `releaseBillsToFloor` now handles a held bill at these three stages **before** consulting `FLOOR_RELEASABLE_STAGES`, after the live-CI guard and the tint skip:

| Held at | Write | Log |
|---|---|---|
| `pick_assigned` | Picker REMOVED, released fresh: the full release columns (popup slot included) through the shared unassign helper `returnAssignedBillToQueue` (`lib/picking/unassign.ts`) — one `orders.update`, then `pick_assignments.deleteMany`, the same writes in the same order as `POST /api/picking/unassign`. No "Already assigned" trap. No push (unassign sends none) | `pick_assigned → pending_picking` · `Released to floor · picker removed ({name}) · {date} {window}` |
| `pick_done`, `pick_checked` | `dispatchStatus="dispatch"` only. Stage, slot (the popup's is ignored) and assignment untouched | `{stage} → {stage}` · `FLOOR_CLEAR_HOLD_NOTE` |

A picker-stage bill that is **not** held is still refused. `FLOOR_RELEASABLE_STAGES` is unchanged and must not gain these stages (a release writes `pending_picking`, which would move a picked bill backwards with its assignment row still in place). The response is `{ released, outcomes: [{ orderId, outcome: "released" | "picker_removed" | "hold_cleared" }], failed }` — `released` is every bill written, so the 422 rule is unchanged; the client's `reportRelease` (`floor-page.tsx`) turns `outcomes` into "3 released · 1 hold cleared · 1 picker removed".

⚠ Known, not fixed: a held `pick_checked` bill on an EARLIER-DAY trip, once cleared, is on no Floor surface unless its trip still holds an unfinished bill (`tripsOnDeskWhere`, `lib/trips/live-trips.ts`; arm 3 and `isPoolRow` need an invoice off every trip) — it does reappear on billing's Picking tab (`lib/billing/picking-where.ts`) and Print tab (`lib/billing/print.ts`). **Decided since (6.3, 2026-10-19): a held INVOICE cannot join a trip** — "{invoice} is on hold — release it first" (`planAddRows`, `lib/order-invoices/trip-bills.ts`) (split OBDs; a held unsplit bill is never in the pool) — and an invoice of a split OBD on a trip cannot be held. Trip side → `CLAUDE_FLOOR_TRIPS.md`.

### 4.3 Assign / unassign

**Reused from Picking, unchanged** — the detail panel's Assign/Reassign and ⋯ Unassign call `POST /api/picking/assign` and `/api/picking/unassign` as a caller (`floor-page.tsx:1241-1267`). Reassign = unassign (only if already assigned) then assign. Nothing on the desk assigns in bulk any more (`floor-page.tsx:995-1000`); that is the supervisor's job on `/picking`. → behaviour owned by **`CLAUDE_PICKING.md §4`**.

### 4.4 Ship-to change (detail panel) [LIVE] — Floor's OWN routes

Search `GET /api/floor/ship-to-search?q=` (min 2 chars, `take: 8`, gated on floor `canView`); write `POST /api/floor/ship-to`. Both are Floor's own as of commit `316eec6b`; nothing here calls a Support route. **Ship-to is per OBD** — refused while any invoice of the bill is on a trip (`lib/floor/ship-to.ts`, the same `onTripMessage`).

**Two bodies, chosen by Content-Type** (typed ship-to, 2026-10-19, Schema v27.73):
- `application/json` `{ orderId, customerId: number | null }` — the dealer / clear form; `null` clears the redirect.
- `multipart/form-data` from the **shared ship-to modal** (`components/shared/ship-to-modal.tsx`, "Change ship-to" / "Save ship-to", also Billing's) — `mode` `dealer` | `typed` | `reset` (`lib/ship-to/parse-form.ts`): a dealer; or a TYPED site (free text, or "As per challan", which needs the challan copy attached), with an area (required) and 0..n JPG / PNG / PDF copies (`ship_to_copies`, `lib/ship-to/copies-server.ts`); or ↺ Reset to customer. The modal replaced the panel's inline `ShipToEditor` on Floor (the Tint Manager still uses that editor). The panel header shows "→ ship-to changed", the area, "billed to …" and a 📎 copies pin; the table's DC column shows the pin too (§4.9). The typed site's stop key on a trip → `CLAUDE_FLOOR_TRIPS.md`.

The **save is a rewrite, not a copy**. Support's PATCH handled four unrelated fields at once and rode a `prisma.$transaction` (CORE §3). Floor's does one job, verifies the target, keeps the legacy `shipToOverride` boolean in sync, and **skips the write entirely when nothing changed** — sequential awaits, no `$transaction` in any Floor file. *(The "clear (✕) not built on the panel" gap recorded here until 2026-10-24 is closed: the modal's Reset is it.)*

### 4.5 Held-since — READ-SIDE rule [LIVE]

`orders.heldAt` stores the bill's **arrival** date (`obdEmailDate`), NOT the moment it was held — a convention inherited from Support, which anchored its amber hold footprint to arrival. **The write was deliberately NOT changed** when Support retired: thousands of historical rows carry arrival dates, and flipping the write to `now` would make old and new rows mean different things in the same column. The Hold tab needs the opposite, so "held since" is derived on the READ side in `getFloorHold()`:
- Take the hold **event's** wall-clock `order_status_logs.createdAt`, identified by the log **NOTE** via the shared constant `HOLD_LOG_NOTES` (`lib/floor/hold-log.ts`) — never a sentinel `toStage` (which would pollute the stage ladder). **`HOLD_LOG_NOTES` holds TEN notes** (code at `e817f01f`): `Held from floor`, `Held from Tint Manager`, `Held from billing`, `Held on import (Telephonic tag)`, `Held on import (CI marked in billing)`, `Held on import (mail order)`, `Held on import (billing hold on mail order)` (those two since `e1da66f0`, Schema v27.50), `Held on import (challan dealer mismatch)` (challan slice 6, `fa0348ef`, 2026-10-07 — held from "Billing · challan"), and the two historical Support notes (`"Placed on hold by support"`, `"Placed on hold by support (bulk)"`). *(This line said "the Floor note AND the two Support notes" until 2026-10-03, and "nine" until 2026-10-24.)* A HELD INVOICE's "held since" is its own wall-clock `order_invoices."heldAt"`, not this ladder (§4.10). Clear notes (`Hold cleared on floor` / `from billing` / `from Tint Manager`) are deliberately NOT in the list, so a re-held bill's age starts at its new hold. ⚠ **Keep both Support strings** — Support no longer writes them, but bills it held are still on hold today and would otherwise fall to the `~approximate` fallback.
- Fallback ladder: hold log → `orders.heldAt` (rendered with a leading `~` + "approximate" tooltip; mail-order enrichment holds before `e1da66f0` wrote no log) → unknown (banded separately under "Held date unknown"). Nothing can silently read as "held today".
- **Held from / Held by** (the same latest hold log, `efd397c4` + `876acb50`): `heldFrom` = `HOLD_SOURCE_BY_NOTE[note]` (`lib/floor/hold-log.ts`; Floor · Tint Manager · Billing · Billing · telephonic · Billing · CI · Billing · mail order · Auto (mail order) · Billing · challan · Support · Unknown). Two cases need a second read in `getFloorHold`, each skipped when it has no ids: the telephonic note is split by `so_tag_matches → so_tags.tag` (`ci` → "Billing · CI"), and a bill with NO hold log reads "Auto (mail order)" when its SO's newest mail order is on Hold, else "Unknown". `heldByName`: the log's user; **"System"** when `changedById = 1` on an import note (`SYSTEM_PERSON_NOTES` — the mail-order auto note and the CI-marked note) **or** when `heldFrom` is "Auto (mail order)" with no person (the old no-log holds); null ("—") only when nothing is known. User 1 is both the system id and the owner's own account — `docs/ROADMAP.md` → *Hold / import — parked during the Freight Trips build* (P5).

### 4.6 Action surfaces — bottom bar · panel header · slot picker · selection/Esc [LIVE]

The 2026-07-26 redesign (draft `web-update-2026-07-26-floor-action-surfaces.md`) minted five general DESIGN rules, owned by **`CLAUDE_UI.md §10`**; this section owns the floor-specific SPECS.

- **Bottom bar** (`floor-bottom-bar.tsx`, on the shared shell `floor-action-bar.tsx` that the Hold and Cancel & CI bars use too) — replaced the assign bar and `trip-selection-bar.tsx` on 2026-09-10 (`bbb9628c`).
  - **Main button:** pool → `+ New trip`; a trip → `Remove from trip`; filling a named trip → `Add N bills to {trip}`; "Working…" while busy. **No confirm on the bar's own buttons** (its header: "NO CONFIRM ON THE CTA" — each is reversible in one press and none touches `workflowStage`). The RAIL's add and move DO confirm (below).
  - **··· More:** **Hold** ("Off the floor until released · Undo for 8s" — never greyed by a partial tick) · **Add invoices / Edit invoices** (drawn only with the `floor_add_invoices` tick and exactly ONE OBD ticked, no re-delivery; greyed with the server's `blockedReason`, or with "Acts on the whole OBD — tick all {n} invoices" while a split OBD is only partly ticked — the ONLY item that needs every invoice ticked) · **Cancel / Raise CI…** (danger, divider above; opens the off-floor dialog; greyed "Remove from trip first" in a trip; on a partial tick it stays enabled with "Raise CI per ticked invoice · Cancel needs every invoice ticked").
  - **The count line** names what is ticked when invoices are involved (`selectionCountLabel`, `lib/floor/selection.ts`): "1 OBD · 2 of 4 invoices" (a split OBD partly ticked) · "1 OBD · 4 invoices" · "1 invoice · 2 OBDs" (an invoice pair) · "+ N not invoiced"; otherwise "N selected". Figures: L · kg (kg as "67+ kg" when some weight is missing — a lower bound) · articles · routes, summed over the TICKED invoices only.
  - A ticked re-delivery row allows only Remove ("Re-delivery selected — only Remove is available").
  - Change slot and bulk Assign are not on it: the slot is changed per bill in the panel header, and assigning is `/picking`'s job.
- **The Cancel / Raise CI dialog** (`components/floor/off-floor-dialog.tsx`, "Cancel or Raise CI — {n} bill(s)"): two tabs, **Raise CI** (default, "Return goes to billing") and **Cancel** ("Bill stops here", with the reason list of §4.1). When any single invoice is ticked the Cancel tab is disabled — "Cancel acts on the whole OBD — tick all its invoices". The result view reads "{done} done · {notDone} not done". Hold does not use it.
- **The rail's add / move confirm** (`AddToTripConfirm`, `components/floor/trip-rail.tsx`; add 2026-10-17 `34b7c6ab`, move `c460367a`). In add mode (pool ticks) or move mode (ticks on an open, live, non-dispatched trip) a rail card click or its pink "+" opens a centred dialog first — "Add {N bills} to {trip}?" / "Move {N bills} from {src} to {target}?", with the trip's current load, "After: …" / "{src} will be empty", and amber notes (bills being picked, waiting bills the gate would hide, Hand mismatches). Focus starts on **Cancel**; the scrim is Cancel; it closes itself if the ticks clear or the trip leaves the rail / is dispatched. Afterwards a 10 s **Undo** toast on add and move (remove has none). 🔴 *History, 2026-10-17: rail add confirms first because accidental card clicks were putting bills on the wrong truck. Do not remove it.* Behaviour (what add / move write) → `CLAUDE_FLOOR_TRIPS.md`.
- **Detail-panel header** — slot lives on the IDENTITY line as a clickable pencil chip
  (`DD-MM · HH:MM`, dashed "No slot" when unset, hidden on cancelled); the action row holds only
  jobs. **Exactly one filled brand (`brand-600`) button per state, on the state's real job:** Floor → Change ship-to;
  Held → Release (a scoped held invoice → **Release invoice**, no slot step); Cancelled → Restore. ··· holds Hold / Cancel / Raise CI / Unassign and, on Floor and Hold sources, **Add invoices / Edit invoices** (§4.7).
- **Slot picker behaviour** (`dispatch-slot-picker.tsx` — Floor-owned): commit-on-tap, **no confirm
  button** (a confirm would tax the most frequent action) → hence no filled brand button anywhere in the popover;
  near-black selection on a neutral strip; month tag only on tiles crossing a month. **Honest
  highlight:** opens on the bill's OWN day if visible, else highlights NOTHING (never claims today).
  **Consequence: tapping only a time keeps the bill on its own day** — it no longer silently drags
  the date to today. Auto-flip positioning: preferred direction if it fits, flips, else caps+scrolls;
  repositions on scroll/resize; already portalled. It also serves the Hold bar and the billing ribbon. The `suggested`/`hideTrigger` props stay (§8); no live caller passes them.
- **Selection keys** (`lib/floor/selection.ts`, `FloorDeskKey = number | RdKey | InvKey`; P5-3, 2026-10-17):
  an UNSPLIT bill is ticked by its `orderId`; **a SPLIT OBD by invoice, `inv:<order_invoices.id>` —
  never by its orderId**; a re-delivery row by `rd:<redeliveryId>` (never by its orderId). Every
  write handler turns the keys back into `orderIds` + `invoiceRowIds`. **An invoice pair's merged
  tick** ("Select invoice {no} — {n} OBDs") is checked when EVERY member is selected and a press adds
  or removes them ALL (`toggleThis` in `floor-table.tsx`); a split OBD is never merged into a pair.
  Hold, Cancel & CI, Freight Trips and Billing keep the plain number `FloorSelection`; the On hold
  tab adds its own `inv:` keys for held invoices (§4.10).
- **Selection + Esc — THE spec:**
  `toggleAll()` (and `toggleAllIds` / `toggleAllDesk` / `toggleAllHoldKeys`) on a PARTIAL selection **selects all, it does not clear**,
  and it is per-GROUP (one per route group / stop) — so a cross-group or search-auto-ticked
  selection cannot be cleared by any header checkbox. That is WHY the bar's ✕ global-clear exists —
  any proposal to remove it must solve this first. **`floor-page.tsx` is the window-level Esc
  owner** for the floor tree (`onEsc`, one bubble-phase listener). Guard order, exactly one branch per keypress:
  re-delivery info open → close · re-delivery dialog open → close · Add invoices dialog open → hand it the press (it asks "Discard these invoices?" when unsaved; ignored while saving) ·
  slot popover open (`[data-slot-popover="open"]` — the marker the picker carries for exactly this) → nothing · focus
  in input/textarea/select/contentEditable → nothing · Cancel / Raise CI dialog → close · panel open → close panel ·
  a ··· More menu open → close · an open route card → back to the cards (§2.1) · rows selected →
  clear selection · a targeted add band → end it · else nothing. (The comment above `onEsc` still lists an older order; the code is this.)
  **Never add a second BUBBLE-phase Esc listener under `components/floor/`** — two window-level listeners race
  in registration order, which is the bug this replaced. **Two named exceptions, both CAPTURE-phase + `stopPropagation`, mounted only while open:**
  the rail's `AddToTripConfirm` (otherwise `onEsc` would `clearSelection()` and throw away the very ticks
  being placed — Esc closes the dialog and KEEPS the ticks) and the shared `ShipToModal`
  (`components/shared/modal-shell.tsx`). The Add invoices, off-floor and re-delivery dialogs take no key
  listener of their own. The panel closes via ✕/backdrop as well; the slot picker dismisses on
  click-outside, not Esc.

### 4.7 Detail panel [LIVE]

`GET /api/floor/order/[orderId]` (floor `canView`; the payload is built in `lib/floor/order-detail.ts`) returns one payload: header + Details + Items + Activity, plus tint-room facts for a tint bill (operator, assignment status, assigned/started/completed times, shades done/total — `6b315729`). Items resolve via `sku_master_v2` on `material === skuCodeRaw` (CORE §13 — never a sku id), raw-text fallback preserved, gift lines out of scope. Activity = `order_status_logs` + ONE synthetic "auto-slot" line derived from `dispatchSlotSource`/`dispatchSlotRuleId` and labelled "enrichment" (the engine writes no log — do not add one; §5). 472px slide-in; primary action + Change ship-to + Update slot + ⋯ ; Prev/Next walks the source list. The panel's date is `obdEmailDate ?? orderDateTime` (`route.ts:205`).

**Sources** (`FloorDetailSource`, `lib/floor/types.ts`): `floor` · `hold` · `cancelled` · **`history` — READ-ONLY, the only one that is** (2026-08-25). Openers pass only these four (`floor-page.tsx`); the union's `rail` member is vestigial (§10b). A history-sourced panel reaches **zero write endpoints**: the whole action row is suppressed (it hosts Release, Restore, Ship-to, Assign/Reassign and the ⋯ Hold/Cancel/Unassign menu, and the only `setEditingShipTo(true)` trigger, so the ship-to editor is unreachable too), and the header slot chip — which writes `change-slot` — is gated off. Everything else excludes `history` **by default**, because each gate is written `source === "floor" | "rail" | "hold" | "cancelled"` and a new member matches none of them; that default-closed property is why this is a member of the existing union and not a separate `readOnly` prop. The one derived boolean is `readOnly` in `detail-panel.tsx`, mirroring `interactive` in `floor-table.tsx` — do not add a third read-only concept. Opened by a ⋯ on history rows (⋯ only — the live arm's ⚡ is `mark-urgent`, a write). `headerStatus` has an explicit `history` case placed **above** the `d.dispatchStatus === "hold"` term, so a bill held later cannot rewrite a past day's record. Prev/Next walks the history payload (`filteredFloor` IS the history rows in history mode) and cannot reach a live row.

**Scoped to an invoice** (Add invoices Phase 4 commit 3, `30293890`; `lib/floor/detail-scope.ts`). The panel key is (orderId, invoiceSeq). Opened from a split OBD's invoice row on the Floor source — or from a held invoice on On hold — the panel is that INVOICE: the header leads with the invoice number and its "k/n" chip (the OBD number and date move to the line under it); Items lists only that invoice's lines (pro-rata litres, the invoice's kg, "Lines changed in SAP — re-check invoices" when stale); Details shows "Invoice number" and an "Other invoices: 716 · 714" line (click to re-scope); Activity is filtered by the log's `orderInvoiceIds`; Prev/Next walks one key per invoice. Hold and Release act on the scoped invoice ("{inv} put on hold" with an 8 s Undo · "{inv} released" · "… is already on hold — nothing changed."; `6ec2d7c5`). Every other source — Cancel & CI, History, an unsplit bill — gets the whole-OBD view with an "n invoices" chip; a vanished invoice falls back to it.

**Add invoices — the UI** (rules, permission and lock messages → `CLAUDE_ORDER_INVOICES.md §5`; do not restate them here). Opened from the bar's ··· More (§4.6) or the panel's ··· "Add invoices" / "Edit invoices" (Floor and Hold sources; never greyed in the panel — the dialog shows any refusal). `components/floor/add-invoices-dialog.tsx`: title "Add invoices · {OBD}" / "Edit invoices · {OBD}", sub-line "N lines · T tins · X still to place"; one paper at a time ("Invoice {k}" — paper 1 is SAP's, read-only "from SAP"; later papers take "Number on the paper"), "Tick every item printed on this paper." with Item / Tins left / On this paper, "Put all that's left here", "Save this invoice →", saved papers as chips "✓ {no} · N tins"; then a summary with "← Change last invoice" and **Save invoices**. Edit mode has an "Undo split" link ("Undo the split?"). Rule errors list in amber, server errors in a red box, word for word. Modal pattern of CLAUDE_UI §13 at `z-[120]`, `w-[680px]`; the backdrop asks before discarding; Esc arrives from `onEsc` (§4.6). Approved mockup: `docs/mockups/add-invoices/add-invoices-flow.html`. 🔴 *History: the panel's Items tab had an "Invoices" section and the table a "+n" chip (`c7fef916`, 2026-10-10); both went in Phase 4 (2026-10-13) — the section for the scoped panel and the ··· item, the chip for "k/n" and "n invoices" (§4.9). `detail-invoices.tsx` is kept on disk, unmounted. Do not bring the section back.*

**Tint lock** (`56db79b8`, `4af18cc8`, 2026-09-08). Rule: a tint bill whose tinting is NOT FINISHED (`pending_tint_assignment` / `tint_assigned` / `tinting_in_progress`) cannot be held or cancelled from Floor — the ⋯ Hold and Cancel render greyed with `TINT_ROOM_REFUSAL`. ⚠ **The panel's lock is coded against `source === "rail"`** (`tintLocked`), and no opener passes `"rail"` since the rail retired — so in the panel it never fires. **The server now guards Cancel** (2026-10-01): `offFloorRefusal` refuses a tint-room bill ("In the tint room — use Stop & cancel on Tint Manager"); Hold has no tint guard. Recorded in §10b.

### 4.8 Tint on the floor [LIVE]

- **Pills** (`components/floor/status-pill.tsx`, `79bcc412`, `6b315729`): a tint bill's phase comes from `tintPhaseOf` (`lib/floor/tint-phase.ts`, moved out of `queries.ts` 2026-10-05 so Billing Print shares it) → pink Waiting / With operator / Tinting / Tint done. Built from `orders.workflowStage` alone; the board query does not read `tint_assignments`.
- **Tinting tab** (`143706be`) — tint bills not yet being mixed, split from the Floor tab by one predicate, `isTintRoomRow`, so the two tabs are exact complements and the badges cannot disagree. On this tab the Invoice column becomes **Operator**.
- **`GET /api/floor/tint-operators`** (floor `canView`) — who holds each `tint_assigned` bill (`tint_assignments`, `splitId: null`, latest row wins). Fetched only while the Tinting tab is open and on refresh, never by the board or the poll.

### 4.9 The bill table [LIVE]

`components/floor/floor-table.tsx`. Columns, in order (header labels): ☐ (interactive tables only) · **OBD** (+date) · **Invoice** | **Operator** (Tinting) · **Ship to** (not in a ship-to block) · **SO** · **Route** | **Area** · **Due** · **Vol / KG** · **Article tag** · **Article** · **DC** · **Status**. No `#` and no Picker column since 2026-09-10. ⚠ The file's top-of-file "COLUMNS:" comment omits SO and DC — the cell-order comment and the `<th>` row are right.
- **Area in place of Route** (`showArea`, 2026-09-19) — the tables a route CARD opens (§2.1) pass it: every bill there is on the route in its heading, so the column shows `area` instead. Same slot and width, header reads "Area". Flat, the route rows and the trip panel keep Route. Same pattern as `hideTripTag`.
- **Invoice** (`697b193b`) — SAP `invoiceNo` over `invoiceDate`, right after OBD; blank until SAP stamps it. On a split OBD each row shows ITS invoice (below).
- **SO** (2026-10-06, `222913d2`) — whose bill it is, chosen by division (`lib/floor/sales-officer.ts`, Floor's copy of the cascade); grey "Telecaller" for a depot mailbox, "—" when not found. Tap-to-call is in the panel's Details, not the table.
- **Article tag** (the old "Article", renamed 2026-10-06) = `formatArticleTag`; **Article** = the supervisor's article no. (`pick_assignments.articleCount`, v27.58), shown only for done / dispatched bills in `text-ok-text`.
- **DC** (2026-10-09, `45e25ce9`) — 📎 prints the delivery challan on top of Floor (`challan-cell.tsx`, `use-challan-print.ts`, a hidden same-origin frame); hover "Delivery Challan · CHN-…", faded when voided, "—" when none. Since 2026-10-20 it also shows the typed-ship-to copies pin (`ShipToCopiesPin`).
- **Due** (`e656ad80`) — the date leads, "Today" spelled out, future blue, overdue red, age chip beside it; `no slot` chip when the bill has no date.
- **Status** — `status-pill.tsx`; the picker / checker's FIRST name since 2026-10-09 (full label in the tooltip); **Direct Loading** pill (`bg-direct text-direct-text` + truck, v27.52) for a bill the supervisor sent straight to checked. Filter "Direct Loading" in `lib/floor/filter.ts`.
- **Badges in the OBD / Ship-to cells:** CHALLAN (`ChallanBadge`), **ODB** (`ObdBadge`, solid `data.plum` — visible text "ODB" since 2026-10-16; the code keeps `isObdImport`), Hand, GIFT, TINT / BASE.
- **Duplicate SO** (`bc232f72`) — SOFT treatment: a `DuplicateSoTag variant="soft"` and a thin bar on rows whose `hasDuplicateSo` is true; the solid red is Picking's.
- **TINT / BASE word** (`0841b5c9`) — `ColourWorkBadge` from `components/picking/card-atoms`.
- **Ship-to redirect** — the ORIGINAL → REDIRECT pair (and a typed site, §4.4).
- **Display date** — the OBD cell shows `resolveFloorDisplayDate(orderDateTime, obdEmailDate)` (`lib/floor/format.ts`, `8a4c1973`): `obdEmailDate` (the SAP punch) by default; when a mail match overwrote `orderDateTime` with the email time **on the same IST day**, the email time, flagged `isEmailTime`. Hold and Cancel & CI show `obdEmailDate ?? orderDateTime`.
- **In an open route card** (2026-10-06, `094506d0`): division bands in the order 70 → 77 → 74 → Other, one ship-to block per `stopKey` (`lib/floor/division-blocks.ts`, `ship-to-blocks.tsx`); the Ship to column then moves into the block header.
- **RE-DEL rows** on a trip — a re-delivered bill's row with its "RE-DEL" button ("Re-delivery · attempt {n} — click for its history"), key `rd:<id>`, never expanded per invoice. Behaviour → `CLAUDE_FLOOR_TRIPS.md`.

**A split OBD — one row per invoice** (Phase 4, `e8942595` + `d2852ebd`, 2026-10-13; `lib/floor/invoice-rows.ts` `drawRowsOf`, `bill-ref-cells.tsx`). The model → `CLAUDE_ORDER_INVOICES.md §2`. The colours → CLAUDE_UI §27 (Floor row drawing).
- One row per invoice in seq order, in its own `<tbody>`, a dashed line between its rows; React key `inv:<id>`, its own tick (§4.6).
- **The OBD repeats on every invoice row**, with an "{n} invoices" chip (`InvoiceCountChip`) under it. 🔴 *History: `e8942595` merged the OBD cell across the block (rowSpan); the owner looked on localhost and `d2852ebd` (same day) put it back on every row. Do not merge it again.*
- The Invoice cell shows that invoice's number with a **"{k}/{n}"** chip (`InvoicePartChip`, "Invoice {k} of this OBD's {n}") — k / n count the WHOLE OBD even where the row is narrowed to one place. Article tag and Article are empty on rows 2..n.
- **Vol / KG** are the invoice's own: litres, and kg as `~{kg} kg` when only approximate (`kgExact` false — "Approximate — the OBD's kg shared by litres"; the kg rule → `CLAUDE_ORDER_INVOICES.md §2`).
- **The amber "split across places" mark** (P5-3, `awayChipOf`, live tables only): when some of the OBD's invoices are NOT in this list, the FIRST drawn row carries an amber chip — "{k} on {trip}" · "{k} in To plan" · "{k} on a trip" · "{k} on hold" · "{k} with CI", joined " · " (title "{k} of {N} invoices … — not shown here") — and the block's left bar turns amber.
- Not expanded: the Operator (Tinting) arm and RE-DEL rows draw one row with "n invoices".

**Search** (`search-box.tsx`, `lib/floor/search.ts`; `9ee92a8b` + `e11e7115` + `39cd1699`). The box filters the loaded rows: text mode matches OBD, invoice, SO, ship-to, route and SO name; numbers mode matches an OBD by the full number or its last 3+ digits and an invoice or SO by the full number or its last 5+ digits — **an invoice means ANY invoice of the OBD**, added ones included. A full number also asks `GET /api/floor/search` (through `lib/trips/find-bill.ts`), which finds the bill wherever it is — `matchedInvoiceSeq` is the lowest seq that matched — and **jumps to its tab** (Cancel & CI > On hold > Tinting > trip > Floor) and scrolls to that invoice's row; several hits list as buttons. The hit row is marked **amber** (`SEARCH_HIT_ROW_CLS`: `warn-bg` ground + a 3px `warn` left edge, also on the Hold and Cancel & CI tables) and **stays marked** until Clear search, a new search or another row's panel. The SO number is searched but never shown. A search shows the pool Flat (§2.1).

### 4.10 The held-bills table — `components/floor/hold-table.tsx` [LIVE, SHARED]

`efd397c4` + `876acb50` (2026-10-02). **ONE table, Floor-owned, for every screen that lists held bills:**
Floor's On hold tab renders one `<HoldTable>` per age band (`hold-tab.tsx`), and **Freight Trips imports it
unchanged** (`CLAUDE_FREIGHT_TRIPS.md` §7). Rows are `FloorHoldRow` from `getFloorHold`.

- **Default columns:** ☐ · OBD (+ date) · Invoice (no + date, "—" when none) · Ship to (★ / ⚡ / site /
  TINT·BASE / HAND / billed-to / ship-to changed) · Route · Type (delivery type) · L (`loadLitres`, gift = 0) ·
  Kg (`loadKg`; "—" when missing) · Article (`formatArticleTag`) · Held since (`~` when approximate) ·
  Held by (§4.5). Widths per CLAUDE_UI §27 (tick 3% + 97% re-scaled for any column subset).
- **Held from** is NOT a default column since `876acb50` (owner); `row.heldFrom` stays in the data and a
  caller may still ask for it through `columns`.
- Props: `rows`, `now`, `selection?`, `onToggleRow?`, `onToggleAll?`, `onOpenRow?`, `selectable?`,
  `columns?`. **Nothing Floor-only is inside it** — Release, ··· More, Export PDF, the bands and the toolbar
  stay in `HoldTab`, so a caller simply does not render them.
- `FloorHoldRow` gained `invoiceDate`, `weightKg` (0 → null), `isGift`, `heldFrom`, `heldById`,
  `heldByName` — additive; the Tint Manager's `TintHoldRow` inherits and ignores them. The Hold PDF
  (`lib/floor/hold-pdf.ts`), the tab counts (`lib/floor/counts.ts`), live-merge, search and sort are unchanged.
- **Per invoice** (6.1, 2026-10-19): the prop `perInvoice` (default false) + `onToggleKey`, and `onOpenRow(orderId, invoiceSeq?)`. Floor's `hold-tab.tsx` passes `perInvoice`: a split OBD draws **one row per HELD invoice** — the OBD repeated, "k/n", the invoice's own number, litres, kg, held since and held by (from that invoice's own wall-clock `heldAt`, `CLAUDE_ORDER_INVOICES.md §3`) and its own `inv:<id>` tick; the amber away chip on the first row when other invoices are elsewhere, the dashed line between rows, the left bar as §4.9. Without `perInvoice` the Invoice cell reads "n invoices" — **Freight Trips** (`pool-view.tsx`, `trip-view.tsx`) passes none and keeps one row per OBD. The Hold bar releases a held invoice with no slot (§4.2). A partly-held OBD's `heldFrom` reads "Floor".
- **The Cancel & CI table** (`cancelled-tab.tsx`, not a `HoldTable`): Action · OBD · Invoice · Ship to · Area · Vol / KG · Reason · Remarks · CI no. · By · when; pills "Cancel" (`danger`) and "CI" (solid `ink-900`), "With billing" / "Closed by billing"; a split OBD's CIs draw one row per CI'd invoice with "k/n" (6.3). Its bar is Restore only.
- **Do not edit it for one caller's sake.** A change here lands on Floor and Freight at once.

### 4.11 Invoice pairs — one invoice, several OBDs [LIVE 2026-10-08/09]

**Floor owns this; there is NO schema.** SAP sometimes bills several OBDs on ONE invoice — they share `orders."invoiceNo"`. It is the OPPOSITE of a split OBD (one OBD, many invoices, `CLAUDE_ORDER_INVOICES.md`) and is not modelled in `order_invoices`. Live 2026-10-24: 22 invoices, each on 2 OBDs — 🔴 **but nothing hardcodes 2**: a group is any size, and "k of n" is derived from the group (`lib/floor/invoice-pairs.ts`, `pair-cells.tsx` both say so).
- **Data** (`fc21b712`, `64324b49`): `lib/floor/invoice-pairs.ts` gives every board and history row `invoicePartners` — the other OBDs on its invoice and where each is NOW (`partnerWhere`); the live feed carries partners to every row on the invoice.
- **Kept together** (`fd0fa9d6`): `keepPairsAdjacent` after the spine sort (§3) — the table, the route cards and the load plans.
- **Drawn** (`17a071de`, `6285f6b7`; `buildPairRenders` in `pair-cells.tsx`):
  - **TOGETHER** (every member in this list, one after another): one `<tbody>`; the ☐ cell and the Invoice cell are `rowSpan = n` (the invoice centred); ONE tick "Select invoice {no} — {n} OBDs" that ticks or unticks them all (§4.6); a dashed line between the OBD rows; "{x} at tint" (amber) when members are still tinting.
  - **SPLIT UP** (a member elsewhere): each row draws alone with a **"{k} of {n}"** chip (title "{k} of {n} OBDs on invoice {no}") and a place chip per absent partner — "{ks} {word}" with the words of `partnerWhere`: AMBER for removed · cancelled · on hold · at tint · on Floor · to plan · not on board · upcoming / due now · on another trip ("On {trip}") · elsewhere (with no board context); INK for on challan · dispatched · on this trip · elsewhere on the same tab and zone.
  - **The bar:** ONE 3px left edge, three states — `pair` periwinkle (#818CF8) when every member is fine, `warn` amber when one is not, `brand-600` when the group is ticked (selected outranks both). With a tick column it is one unbroken line on the rowSpan'd ☐ cell; without one, a left border on each OBD cell. Token and why it is not brand → CLAUDE_UI §2.1.
  - History and upcoming rows: "k of n" and the merge only — no place chips, no amber.
- **A split OBD is never merged into a pair**, even when one of its invoices is shared.
- **Not built (owner 2026-10-24 → ROADMAP, the "pair leftovers"):** the pair tint warning and a partner line in the detail panel. (The table's "{x} at tint" chip above IS live; what the leftover would add is in the ROADMAP entry.)

---

## 5. Live sync [LIVE]

**Two paths, one switch** (live feed 7b, `48a5e978`, 2026-09-30). `app_settings` **`live.feed`** decides; it is **ON live** (read 2026-10-24: `live.feed`, `.billing`, `.picking`, `.tint` all enabled since 2026-09-30 / 10-01). *(This section described only the marker + poll path until 2026-10-24, when the feed had been the live path for three weeks.)*

**1. The change feed — the live path.** `useLiveFeed({ scope: "floor", topics: "order,trip,config" })` (`lib/live/use-live-feed.ts` on the pure `lib/live/feed-core.ts`) glances at `GET /api/live/changes` every **15 s** while someone is using the screen, **60 s** once idle for 2 min, and only COLLECTS changed ids. `floor-page.tsx` applies them: changed bills are patched in BY ID through **`POST /api/floor/rows`** (≤ 300 ids, the board / hold / cancelled feeds with `onlyIds`; `lib/floor/live-merge.ts` re-sorts with `sortFloorRows`); trip changes refresh those trips by id; a `config` change (e.g. the pick gate flipped elsewhere) makes one full load and re-reads the gate; On hold and Cancel & CI load **lazily** (first opened), their tab labels meanwhile from `GET /api/floor/counts`; IST midnight reloads. The feed knows only what a `live_changes` trigger records — for Floor that includes **`order_invoices` (v27.65, + v27.66 trip lines) and `order_invoice_lines` (v27.67)**, both recorded as entity `order` of the parent OBD, so a split save, a per-invoice hold or a row's trip move reaches the board with no `orders` write. The trigger list and the never-`replica` rule → CORE §13.
**2. The old path — `<LegacyFloorSync>`**, mounted only when the feed is off, in `fallback` (repeated errors) or not known yet on a browser that never saw it on: the Mail Orders pattern **30 s full refetch** (`useFloorRailPoll`, `FLOOR_RAIL_POLL_MS = 30_000`, the hook name is historical) plus the Picking pattern **15 s marker probe** (`lib/hooks/use-picking-marker` with its optional `url` → `/api/floor/marker`; refetch only when the cheap `{count, latest}` moved).

`GET /api/floor/marker` aggregates `{count, latest}` over `getFloorLiveMarkerWhere()` = `floorBoardWhere(getISTDayRange(), getISTTodayDateOnly())` AND hide — the **same predicate the board renders** (§3), so marker and board cannot drift (its arms 3 / 4 carry the invoice terms, and that is where the 34 ms budget of §3 was measured). It is the floor's OWN exact set, not picking's superset. The marker's `{count, latest}` semantics + the `orders_updatedAt_idx` behaviour are **owned by `CLAUDE_PICKING.md §10`**. The connection strip (`components/floor/connection-strip.tsx`) shows a grey "not connected — showing last update HH:MM" (a strip, never a modal; live mode only); on the feed it is driven by the feed's health (`delayed`).

**Pause rules — never move the ground under a hand.** On the feed, glancing continues but nothing is APPLIED while the panel, a form, a menu or a write is open, while typing, or in History (`hardPaused`); while bills are ticked or a targeted add is on (`rowsPaused`) trips still refresh and ticked bills that left the board are unticked, but no board row moves. On the old path the 30 s refetch pauses while the panel is open, a selection is up, or in History, and the marker while the panel is open or in History. A **selected** row changed by someone else is **reconciled** — its tick is cleared and a toast shown — **without moving the visible board**. READ-ONLY throughout: neither path adds a write.

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
- **The board and the marker MUST stay on the one shared predicate** `floorBoardWhere` (§3/§5). Re-declaring the WHERE in either place reintroduces the marker/queue drift the Picking §10 landmine warns about. Widen it only by adding a named arm; never by dropping `dispatchStatus: "dispatch"` from an arm (measured at 2,545 finished bills onto a 40-row board — the comment in `lib/floor/queries.ts`).
- **`floorUnslottedWhere` is not dead code.** It was the rail's predicate and is board arm 2; removing it drops every undecided bill off the screen (`archive/2026-09-floor-rail/README.md`).
- **`floorTripBillsWhere`'s `tripDropId: { not: null }` is load-bearing** — deleting it turns the whole `OR` into a sequential scan (its header in `lib/floor/queries.ts`).
- 🔴 **Arm 3's `HAS_ROW_OFF_TRIP_WHERE` (`"tripDropId" IS NULL OR "partlyOnTrip"`) and the `seq > 1` second branch of arm 4 and of `tripsOnDeskWhere` are kept that way for query speed** (60 ms vs 34 ms on the marker, 2026-10-15). Never "simplify" one to a bare `invoices: { some: … }` filter without an EXPLAIN before and after (§3; `CLAUDE_ORDER_INVOICES.md §8`).
- 🔴 **Never hardcode 2** — not in an invoice pair (any group size, "k of n" from the group, §4.11), not in a split OBD (2..20 invoices). Live data being all-2 is a coincidence.
- 🔴 **An unsplit bill's invoice-row `isHeld` / `isDispatched` is never read for its screens** — `orders.dispatchStatus` / `workflowStage` are the truth; the row is a mirror. Floor's per-invoice branches test "split" (`invoiceRows.length >= 2`, i.e. a row with `seq > 1`). A new OBD-level hold writer on Floor must call `mirrorObdHoldSafe` (`CLAUDE_ORDER_INVOICES.md §4.4`).
- **Ticks of a split OBD are `inv:` keys, never its orderId** (§4.6) — a handler that reads a desk key as a number drops every split OBD's ticks.
- **Counts per OBD, litres / kg per invoice** — the bar's figures sum the TICKED invoices, a trip's "N bills" counts OBDs (`CLAUDE_ORDER_INVOICES.md §8`).
- **Never add a second `orders.update` (or a log write to the dispatch engine)** in any floor path — the marker keys on `MAX(orders.updatedAt)`; a second write fires a false "changed" on every board.
- **Delivery-type scope is applied CLIENT-SIDE** — the DB queries return all types. A future "just filter in SQL" change would desync the marker (which watches all types) from the board.
- **`dispatched`-stage rows exist** — live 2026-09-18: **7,330** at `workflowStage='dispatched'` (Q09). The §7 backfill (238 rows) was a one-time manual sweep, not a code path. Who writes `dispatched` today → `CLAUDE_FLOOR_TRIPS.md` (the trip dispatch route) and, per invoice + the OBD done rule, `CLAUDE_ORDER_INVOICES.md §4.5`. After any SQL sweep of `dispatched` / hold, run the unsplit mirror (`CLAUDE_ORDER_INVOICES.md §6`).
- **Parked data issues (not Floor bugs):** `Deco` (9 rows) — un-mapped raw XLS SMU value that should be `Deco Retail`, so those bills silently never auto-slot; the 103 Deco Retail bills that reached `pending_support` with `dispatchStatus` NULL are the class `applyNoMailOrderFallback` now releases at import (`b3dfe5b8`); four identical `Shree Rang Sarita` bills (22 Jul 18:31, 140 L, different OBDs — dup import unconfirmed); a `SAT FIN 93 BASE 3.7L` line carries pack chip `4L` so litres compute 16 vs 14.8 (a catalog value, Chandresh's cleanup list); three test bills marked urgent 23 Jul (clear unless genuine).

## 10b. Known issues [OPEN] — recorded, not fixed

- **Tint lock is inert in the panel** (§4.7): `tintLocked` requires `source === "rail"`, a source nothing opens since the rail retired. The server refuses a tint-room Cancel since 2026-10-01 (`offFloorRefusal`); Hold still has no tint guard.
- **A `pending_support` row has no Release on the desk.** Release renders for `source === "hold"` only and is posted only by the Hold bar and that button; trips never write a bill's status or slot (`CLAUDE_FLOOR_TRIPS.md`). A restored bill therefore stays at `pending_support` unless it is held and released from the Hold tab. The `no slot` tooltip says "putting this bill on a trip gives it one" (`floor-table.tsx`), which no trip route does.
- **Dead payload:** `getFloorBoard` still computes `waitingSkus` and `oilSkus` (one extra `import_raw_line_items` read and, with `RULE2_ENABLED = true`, one extra `sku_master_v2` read). No file under `components/floor/` reads either; only `lib/floor/scope.ts` passes them through. Their only reader was the By group view.
- **Dead prop:** `hold-bar.tsx` still reads `offFloorBlock` (greys Cancel / Raise CI), but nothing passes it since 6.3 ("no longer greyed", `hold-tab.tsx`). → ROADMAP.
- **History shows a split OBD whole** — the Prev/Next walk and the panel ("A split OBD seen as a whole (On hold, Cancel & CI, History)"). Whether History should go per invoice is an open owner question → ROADMAP.
- **`detail-invoices.tsx` is unmounted** since Phase 4 (§4.7); kept on disk per the no-delete rule.
- **`GET /api/floor/trips/[id]`'s header says "Gate: `floor` canEdit"** but its GET checks canView (the code is right; the comment is stale).
- **Orphan components with zero importers** (two greps, 2026-09-18): `components/floor/assign-bar.tsx`, `assign-context-banner.tsx`, `trip-selection-bar.tsx`, and `lib/floor/suggest.ts`. Kept per the no-delete rule; owner instruction needed.
- **`FloorDetailSource` still lists `"rail"`** (`lib/floor/types.ts`); no opener passes it.
- **`GET /api/floor/trips/[id]` response shape** — a code reading says `floor-page.tsx` `undoAdd` and the add receipt read the body as the trip while the route returns `{ trip }`; but the owner's hand test of 2026-10-17 (the trip-move draft, test 9) found **Undo on an add works**. Not reproduced, not fixed blind. Owned by `CLAUDE_FLOOR_TRIPS.md` (open item 13).
- **Stale code comments** (claims, for a later code-comment pass):
  - `lib/floor/queries.ts:6-14` (header describes a "Left rail"), `:151-153` ("the rail feed (which still exists)"), `:622` ("drives the assign-bar dropdown"), `:704` / `:844` / `:1172` ("See getFloorRail above"), `:818-819` ("putting one on a trip is what releases it").
  - `app/api/floor/actions/route.ts:10` ("floor/rail bills"), `:159-161` (restore → "back onto the left rail … getFloorRail").
  - `lib/floor/release.ts:5` ("the rail" as a caller). `lib/floor/hold-log.ts:27-28` (`FLOOR_CLEAR_HOLD_NOTE` "written by … action \"clear-hold\"" — no such action, `actions/route.ts:21-22`). `lib/floor/use-floor-rail-poll.ts:3-5` ("The RAIL's live-sync").
  - `components/floor/floor-page.tsx:13-14` ("Putting a bill on a trip is what gives it a slot"), `:24-27` (floor-rail "still on disk" — archived), `:878-886` ("per-bill release is what putting the bill on a trip does now … Nothing on this screen posts to it"), `:1017` ("back to the left rail").
  - `components/floor/floor-table.tsx:3-10` (slot-tab / Upcoming-strip render sites; "⋯ stays INERT"), `:34-35` ("# columns"), `:687-688` (a trip gives a bill its date).
  - `components/floor/detail-panel.tsx:391-409` (points at `rail-card.tsx` and `getFloorRail`), `:580`, `:603`, `:615-617` ("teal"; ship-to "owned by Support").
  - `app/api/floor/order/[orderId]/route.ts:142` ("the only place on the floor that reads `tint_assignments`" — `/api/floor/tint-operators` reads it too). *(That comment now lives in `lib/floor/order-detail.ts`.)*
  - ⚠ The line numbers above are as read on 2026-09-18 and have drifted; find each by its quoted words.
  - **Add invoices / pairs comments** (2026-10-24): the list is in the canon plan `docs/prompts/drafts/code-discovery-2026-10-24-canon-add-invoices.md` step 4c (batch B6) — Floor's are `lib/floor/selection.ts`, `floor-bottom-bar.tsx`, `floor-page.tsx`, `hold-bar.tsx` ("Cancel / Raise CI grey while partly ticked" — only Add invoices needs every invoice since 6.3), `lib/floor/types.ts` and `detail-panel.tsx` ("per-invoice hold / Cancel & CI is Phase 6" — shipped), `lib/floor/dispatch.ts`, `lib/floor/invoice-rows.ts` ("the OBD is still the unit of selection"; and its pointer to `detail-invoices.tsx` as the panel's Invoices section), `lib/permissions.ts` (`floor_add_invoices`: "Phase 2 is RECORD-ONLY"), the `floor-table.tsx` top-of-file COLUMNS (no SO / DC), and `onEsc`'s comment in `floor-page.tsx` (older rung order).

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
| `components/floor/floor-bottom-bar.tsx`, `floor-action-bar.tsx` | Bottom bar (New trip / Remove from trip / ··· More, ✕ clear) on the shared bar shell — ✈ for what it does to a trip |
| `components/floor/off-floor-dialog.tsx`, `lib/floor/off-floor.ts`, `lib/floor/desk-cancel-reasons.ts` | The Cancel / Raise CI dialog, its refusals, the cancel reasons (§4.1, §4.6) |
| `lib/floor/bill-actions.ts` | `BILL_ACTIONS` (eight) + `applyBillAction` (§4.1) |
| `lib/floor/raise-ci.ts`, `app/api/floor/ci/route.ts` | Raise CI from Floor — whole bill or per invoice (§4.1b) |
| `components/floor/pair-cells.tsx`, `lib/floor/invoice-pairs.ts` | Invoice pairs — data (`invoicePartners`, `partnerWhere`) and drawing (`buildPairRenders`, the bar, "k of n", place chips) (§4.11) |
| `lib/floor/invoice-rows.ts` (+ test), `components/floor/bill-ref-cells.tsx` | One row per invoice (`drawRowsOf`, `inPool`, `awayChipOf`, kg rule) and the "k/n" / "n invoices" chips (§4.9) |
| `lib/floor/detail-scope.ts` (+ test) | The panel scoped to an invoice (§4.7) |
| `components/floor/add-invoices-dialog.tsx`, `app/api/floor/orders/[orderId]/invoices/route.ts` | The Add invoices dialog (UI, §4.7) and its GET / save / undo route (rules → `CLAUDE_ORDER_INVOICES.md`) |
| `components/floor/detail-invoices.tsx` | **Unmounted** since Phase 4 (§4.7, §10b) |
| `lib/floor/sales-officer.ts`, `components/floor/challan-cell.tsx`, `use-challan-print.ts`, `lib/floor/division-blocks.ts`, `components/floor/ship-to-blocks.tsx`, `gift-badge.tsx` | SO column, DC column + challan print, division bands / ship-to blocks, GIFT pill (§4.9) |
| `components/shared/ship-to-modal.tsx`, `lib/floor/ship-to.ts`, `lib/ship-to/*` | Ship-to modal (shared with Billing), Floor's save, typed ship-to + copies (§4.4); `ship-to-editor.tsx` is the old inline editor |
| `components/floor/load-plan-v2.tsx`, `lib/floor/load-plan-v2-loader.ts`, `-run.ts`, `app/api/floor/load-plan/route.ts` | The LIVE Upcountry load plan v2 (§2.2); `load-plan-snapshot.ts`, `load-plan-check-data.ts` = the admin Load plan check |
| `lib/floor/live-merge.ts` (+ test), `app/api/floor/rows/route.ts`, `counts/route.ts`, `lib/floor/rows.ts`, `counts.ts` | Live feed row patches, lazy tab counts (§5) |
| `app/api/floor/search/route.ts`, `lib/floor/search.ts` | Search — filter + jump to a bill's tab (§4.9) |
| `lib/floor/tint-phase.ts`, `order-detail.ts` | Tint phase of a row; the detail payload builder (§4.7) |
| ✈ `components/floor/trip-rail.tsx`, `trip-bar.tsx`, `trip-detail-header.tsx`, `trip-add-band.tsx`, `trip-form.tsx`, `trip-vehicle-editor.tsx`, `trip-history.tsx`, `trip-options.ts`, `pick-gate-toggle.tsx` | Trip rail, trip header, add band, create form, vehicle editor, trip history, option lists, desk-control switch |
| `components/floor/hold-tab.tsx`, `hold-bar.tsx`, `cancelled-tab.tsx`, `pdf-preview.tsx` | Hold + Cancelled tabs, Hold-report PDF |
| `components/floor/hold-table.tsx` | The SHARED held-bills table (On hold tab + Freight Trips, §4.10) |
| `lib/floor/hold-log.ts` | Hold notes (`HOLD_LOG_NOTES`, 10), `HOLD_SOURCE_BY_NOTE`, `SYSTEM_PERSON_NOTES`, `heldByLabel`, bands (§4.5) |
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
| ✈ `app/api/floor/pick-gate/route.ts`, `app/api/floor/trips/**` (11 route files) | Desk control + trips API |
| `lib/dispatch/dispatch-engine.ts` | Auto-slot engine (reused; **owned by CORE §7.4**) |

---

## Change log — v1.10 (2026-10-24, canon batch B2: Add invoices + invoice pairs, and a reconciliation to Schema v27.74)

Evidence: the code at `e817f01f` (origin/main; Add invoices `6ac1d51e` → `a05769b7`, invoice pairs `fc21b712` → `6285f6b7`, the rail add / move confirm `34b7c6ab` / `c460367a`, and the other sessions' Floor commits since 2026-10-03 — challan slices, SO / DC / Article columns, division bands, Direct Loading, ODB pill, typed ship-to, load plan v2, the live feed), four read-only code sweeps re-checked at the claims below, and read-only SELECTs on 2026-10-24 (`app_settings` `live.*` all ON; `floor_add_invoices` holders #29 / #30 / #31). Plan: `docs/prompts/drafts/code-discovery-2026-10-24-canon-add-invoices.md` (step 4a, FLOOR rows). The model and rules are NOT restated here — they live in `docs/CLAUDE_ORDER_INVOICES.md` (B1), which this file points at.

- §1: `floor_add_invoices` tick (needs `floor` canEdit too; holders) and `challan_orders` for the fifth tab; ownership table rewritten — Floor owns one row per invoice, the scoped panel, the Add invoices dialog AS UI, invoice pairs; ORDER_INVOICES owns the model, CI the CI, UI the tokens and drawing standard, CORE the live feed. Line numbers dropped from the access paragraph.
- §2: **corrected** "four top tabs … Cancelled" → five tabs, "Cancel & CI" (since 2026-09-22) and "Challan orders" (2026-10-07). New bullet: one row per invoice, pairs together. Bottom bar points at §4.6. §2.1: the route-card bar has the Direct Loading segment and no amber; **corrected** the pool test (`isPoolRow` is per invoice since P5-3). §2.2: **corrected** — the live Upcountry Load plan is v2 (`load-plan-v2.tsx`, server-planned); v1 renders only in History; Load plan is no longer Upcountry's default (By route everywhere since 2026-09-22).
- §3: Hold feed has TWO arms (6.1) and draws held invoices; Cancelled → **Cancel & CI** with per-invoice CIs (6.3); the board payload's new row fields (table); the other read routes (search, rows, counts, load-plan, ci); **corrected** arm 3 (`HAS_ROW_OFF_TRIP_WHERE`, not `tripDropId IS NULL`) and arm 4 (the `seq > 1` second branch); arm 1 counts `directLoadedAt`; the query-speed rule; History reads trips through invoice rows; `sortFloorRows` = spine + `keepPairsAdjacent`. Drifted line numbers replaced by symbols.
- §4: intro — per OBD vs per invoice, the mirror writes, `onTripMessage`. §4.1 **corrected** "exactly these five" → the eight `BILL_ACTIONS` (+ unhold, hand, unhand), cancel reasons and refusals, restore to the tint queue, per-invoice hold / release, the response shape. New §4.1b Raise CI from Floor. §4.2: whole bills only; a held invoice is released without a slot through §4.1; the held-invoice-can't-join decision replaces "parked". §4.4: typed ship-to + copies, the shared modal, the closed "clear (✕)" gap. §4.5: TEN hold notes (+ challan dealer mismatch), "Billing · challan". §4.6: the bar's states, ··· More items and their greying (only Add invoices needs every invoice), the count line ("1 invoice · 2 OBDs"), the Cancel / Raise CI dialog, **corrected** "no confirm" → the rail's add / move confirm (with the 2026-10-17 history line), the `inv:` / `rd:` selection keys and the pair tick, the Esc rung list as coded and its two capture-phase exceptions. §4.7: the panel scoped to an invoice, the Add invoices dialog as UI, the history line for the retired Invoices section and "+n" chip, the server's tint-room Cancel guard. §4.8: `tintPhaseOf` moved to `tint-phase.ts`. §4.9: columns re-listed (SO, Article tag, Article, DC, Direct Loading, ODB …), division bands, RE-DEL rows, **the split OBD drawing** (OBD repeated — the `d2852ebd` reversal kept as a do-not-revert line — "k/n", the amber away chip, kg "~"), **search** by any invoice + jump + the amber persistent hit. §4.10: per-invoice rows on On hold; the Cancel & CI table. **New §4.11 Invoice pairs** (Floor-owned, no schema).
- §5: **rewritten** — the change feed (`live.feed`, ON live) is the path, with `order_invoices` / `order_invoice_lines` triggers reaching the board; the 30 s poll + 15 s marker are `<LegacyFloorSync>`, mounted only when the feed is not live.
- §10: landmines — the query-speed shape, never hardcode 2, unsplit rows' mirror never read, `inv:` keys, counts vs load; the dispatched landmine points at ORDER_INVOICES §4.5 / §6. §10b: tint lock and server guard, dead `offFloorBlock`, History whole, `detail-invoices.tsx` unmounted, the trips/[id] gate comment, open item 13's hand test; stale-comment list gains the Add invoices pointers.
- §11: ~20 files added (pairs, invoice rows, scope, dialog, off-floor, bill actions, raise CI, SO / DC / blocks, ship-to modal, load plan v2, live feed rows / counts, search); trip routes 11, not 9.
- Schema stamp **v27.24 → v27.74**: reconciled in this pass against CORE v150's chain for every version that touches a table Floor reads (v27.52 Direct Loading, v27.58 article no., v27.60 challan, v27.63–v27.74 invoice rows, v27.68 ODB, v27.73 typed ship-to, the live-feed triggers v27.45–v27.67).

## Change log — v1.9 (2026-10-03, the shared held-bills table + hold sources)

Evidence: the code as committed — `e1da66f0` (two mail-order hold notes, Schema v27.50), `efd397c4` (shared `HoldTable`, new `FloorHoldRow` fields, held from / held by), `876acb50` (Held from off the default columns; "System" for automatic holds); Freight Trips' use of `getFloorHold` + `extraWhere` (`c430208e`).

- §3 Hold row: `floorHoldWhere` + hide, and the two `extraWhere` consumers (Tint Manager, Freight Trips).
- §4.5: **corrected** — `HOLD_LOG_NOTES` holds nine notes, not "the Floor note and two Support notes"; held from / held by derivation added.
- New **§4.10** — `components/floor/hold-table.tsx`, shared with Freight Trips. §11 gains it and `lib/floor/hold-log.ts`.
- Schema stamp left at v27.24 on purpose (no reconciliation pass).

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

*CLAUDE_FLOOR.md v1.10 · Schema v27.74 · OrbitOMS · updated 2026-10-24 — Add invoices + invoice pairs on the floor (one row per invoice, `inv:` ticks, the scoped panel, hold / release / Raise CI per invoice, §4.11 pairs) and a reconciliation to v27.74: five tabs, eight actions, the live feed path, load plan v2. Rules → `CLAUDE_ORDER_INVOICES.md`. Prior, v1.9 (2026-10-03) — the shared held-bills table + hold sources.*
