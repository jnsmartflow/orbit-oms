# Code discovery — FREIGHT TRIPS (report-only "paper trip" layer)
# 2026-10-01 · DISCOVERY ONLY · no code, no SQL run, nothing staged · HEAD `ed95227d`

Files read: CLAUDE.md (router v1.13), docs/CLAUDE_CORE.md (**v120 · Schema v27.49**),
docs/CLAUDE_UI.md (**v5.35**, no schema stamp by design), docs/CLAUDE_FLOOR.md (**v1.8 · Schema v27.24**),
docs/CLAUDE_FLOOR_TRIPS.md (**v1.0 · Schema v27.24**), archive/RETIREMENT-PLAYBOOK.md §4.
Stamp check: both domain files lag CORE (normal, router §4 item 4); none is ahead of CORE. No stop condition.

Method: every claim below is from the code at HEAD, with file:line. Where canon and code disagree the
**code wins** and the disagreement is listed in §G. "Called" means a call site was opened, not a grep hit.
Name sweeps were run two ways (MSYS `grep -rIi` and the Grep tool) and reconciled.

---

## A. HELD BILLS

### A1. What "on hold" means, and the On hold tab's exact predicate

- Column: **`orders.dispatchStatus = 'hold'`** (`prisma/schema.prisma:1059`, plain `String?`, no CHECK).
  `orders.heldAt` (`:1054`) is a stamp written beside it, NOT the flag (and it holds the ARRIVAL date — §A3).
  `orders.handAt` (`:1232`) is "Hand", never a `dispatchStatus` value (`:1228-1229`).
- The predicate, `lib/floor/queries.ts:1208-1210`:
  ```ts
  export function floorHoldWhere(): Prisma.ordersWhereInput {
    return { dispatchStatus: "hold", isRemoved: false };
  }
  ```
- The feed `getFloorHold` (`lib/floor/queries.ts:1212-1311`) ANDs one more term onto it:
  `where: { AND: [floorHoldWhere(), hide] }` (`:1225`), `hide = getHideExclusion()` (`:1223`).
  `getHideExclusion` (`lib/hide/visibility.ts:110-122`) = `isHidden = false` AND, per active
  `obd_visibility_rules` row (`:35-39`, `isActive: true`): a `tag/HOLD` rule keeps only non-held bills
  (so it would empty the tab entirely), a `daysOld` rule keeps `orderDateTime IS NULL OR >= now − N days`
  (`:75-96`). Other tag values are ignored (`:95`).
- **Every condition, complete:** `dispatchStatus='hold'` · `isRemoved=false` · `isHidden=false` · active hide
  rules. **No stage condition, no date window** ("all dates, a pure open state",
  `app/api/floor/hold/route.ts:14-15`). **No `tripDropId` condition** — a held bill that is on a Floor trip
  is still in this set (see Risks R3).
- Then two CLIENT-side narrowings, both display filters: delivery-type scope (`inScope` inside the server
  loop `queries.ts:1264`, re-applied client-side `components/floor/floor-page.tsx:1460-1463`) and
  search + flag filters (`:1499-1502`). The unscoped fetch is `floor-page.tsx:604`.
- Route gate: `app/api/floor/hold/route.ts:21` `checkAnyPermission(roles, "floor", "canView")`, call `:25`.
- Hold writers today (all write `dispatchStatus:"hold"` + `heldAt = obdEmailDate ?? now`):
  `lib/floor/bill-actions.ts:173` (Floor + Tint Manager), `app/api/billing/mail-order/actions/route.ts:323`,
  `app/api/import/obd/route.ts:413` (enrichment), `lib/billing/telephonic-apply.ts:238`.

### A2. Exported and reusable read-only?

**Yes.** `floorHoldWhere()` is `export`ed, pure (no I/O, no clock), and already shared by three callers —
`getFloorHold` (`queries.ts:1225`), the tab counts (`lib/floor/counts.ts:24`, `:53`) and the live-feed row
reload (`lib/floor/rows.ts:40`, `:70` via `getFloorHold`). A new module can `import { floorHoldWhere } from
"@/lib/floor/queries"` and `getHideExclusion` from `@/lib/hide/visibility` with **zero change to Floor**.
Server-only (the module imports prisma, `queries.ts:17`).

⚠ The hide exclusion is NOT inside `floorHoldWhere` — "AND-ed on by each caller" (`queries.ts:1205-1206`).
Freight must AND it too, or its pool will show bills the On hold tab hides.

⚠ `getFloorHold` itself is reusable but **not sufficient**: its row (`queries.ts:1276-1301`) has no kg
(`totalWeight` not selected, `:1229`), no `invoiceDate`, no `materialType`/`isGift`, and no raw ids for the
drop key. Freight needs its own `findMany` on the shared predicate (proposal §H).

### A3. Held-since date source (FLOOR §4.5)

Read side only, in `getFloorHold` (`queries.ts:1235-1274`):
1. latest `order_status_logs.createdAt` whose `note IN HOLD_LOG_NOTES` (`:1240-1251`) → source `log`;
2. else `orders.heldAt` (the ARRIVAL date, `obdEmailDate`) → source `approx`, rendered with `~`;
3. else `unknown` (`:1272-1274`).

`HOLD_LOG_NOTES` (`lib/floor/hold-log.ts:97-104`) is **seven** strings, not the "Floor + two Support notes"
canon describes: `Held from floor` (`:25`), the two Support notes (`:51-53`), `Held on import (Telephonic
tag)` (`:61`), `Held on import (CI marked in billing)` (`:70`), `Held from billing` (`:75`),
`Held from Tint Manager` (`:88`). Clear-hold notes are deliberately NOT in it (`:92-93`).
Reuse: import `HOLD_LOG_NOTES`; never retype them.

### A4. Can a held bill have no invoice number? Where are invoice / OBD stored?

- **Invoice:** `orders.invoiceNo String?` (`schema.prisma:1062`) + `orders.invoiceDate DateTime?` (`:1064`).
  Nullable. Written at import (`app/api/import/obd/route.ts` `orderData.invoiceNo`, e.g. `:1455`) and
  back-filled null→value only by the Auto-Import `patch-headers` action (`:4261-4263`, write `:4492`).
  Indexed, **not unique** (`@@index([invoiceNo])`, `:1254`).
  **Yes, a held bill can have none:** nothing in the hold path requires it, and holds are commonly applied at
  import (enrichment `:413`, telephonic tags) before SAP invoices. Canon already records 5.0% of
  *dispatched* bills with no invoice (`schema.prisma` ci_returns comment `:3156-3158`). Live count → SELECT
  block row `A1`.
- **OBD:** `orders.obdNumber String @unique` (`:1035`) — always present, the bill's identity at SAP level.
  OBD date = `obdEmailDate` (`:1065`) / `orderDateTime` (`:1066`) — see B5.
- **Consequence for owner decision 4** ("one INVOICE on at most one active freight trip"): the only stable,
  always-present, unique key is `orders.id` (= one OBD). Enforce on `orderId`. Because `invoiceNo` is
  nullable and not unique, an invoice-keyed constraint is impossible for no-invoice bills and would not
  cover two OBDs sharing an invoice (live check: SELECT row `A5`).

---

## B. BILL DISPLAY FIELDS

### B5. Source and helper per field

| Field | Source | Helper (file:line) | Reuse as-is? |
|---|---|---|---|
| OBD no | `orders.obdNumber` | — | yes |
| OBD date | `obdEmailDate ?? orderDateTime` (Hold tab, `queries.ts:1293`); the board uses `resolveFloorDisplayDate(orderDateTime, obdEmailDate)` (`lib/floor/format.ts:176`) | `resolveFloorDisplayDate` | **yes** — pure, client-safe (`format.ts` imports only `lib/article-tag-parse`, `:8`). Pick ONE: recommend the Hold tab's rule so the freight pool matches the On hold tab |
| Invoice no / date | `orders.invoiceNo` / `invoiceDate` | `formatDateIST` (`format.ts:125`) | yes |
| Ship-to name | EFFECTIVE dealer `shipToOverrideCustomer ?? customer` (`queries.ts:1262`), name via `dealerDisplayName(dealer?.customerName, order.shipToCustomerName)` (`queries.ts:1280`; `lib/orders/dealer-name.ts:31`) | `dealerDisplayName` | **yes** (pure). Bill-to: `billToByObd()` exported (`queries.ts:525`), server |
| Route | `dealer.area.primaryRoute.name` (`queries.ts:1284`) | stop-level label `rankRouteName` / `formatRouteLabel` + `PLACEHOLDER_ROUTE_IDS` (`lib/trips/route-label.ts:34-77`, client-safe) | yes |
| Delivery type | `dealer.area.deliveryType.name` (`queries.ts:1263`) | `inScope` (`lib/floor/scope.ts`) | yes |
| Litres | `import_obd_query_summary.totalVolume` via `orders.querySnapshot` (`schema.prisma:1014-1027`; `queries.ts:1291`) | `formatLitres` (`components/floor/status-pill.tsx:493`); gift rule `loadLitres` (`lib/orders/gift.ts:31`) | yes |
| Kg | `querySnapshot.totalWeight` (board `queries.ts:679`, `:1000`) | `formatWeightKg` (`status-pill.tsx:529`, **0 = missing**, returns null), `sumWeightKg` (`:555`), `loadKg` (`gift.ts:46`) | yes |
| Article | `querySnapshot.articleTag` (`queries.ts:1292`) | `formatArticleTag` (`format.ts:91`), totals `formatArticleBreakdown` (`format.ts:40`) | yes |

⚠ Two traps the freight report inherits:
- **Gift bills** (`materialType = 'GIFTS'`) must add 0 L / 0 kg to every total but still count as a bill and
  a stop (`lib/orders/gift.ts:9-13`). Use `isGiftBill` + `loadLitres`/`loadKg`, never raw sums.
- `orders.volume` / `orders.grossWeight` (`schema.prisma:1073-1074`) are SAP header values; every Floor
  surface reads the **query snapshot** instead. Decision 7 ("from the bill itself") should mean the snapshot.
- `FLOOR_DEALER_SELECT` (`queries.ts:362-376`) is **not exported** — copy its shape (5 lines) or export it
  in a Floor-owned commit; do not reach into a private const.

### B6. Stop grouping with `computeDropKey`, no `trip_drops` rows

**Yes.** `lib/trips/drop-key.ts` is declared PURE — "No Prisma, no clock, no I/O — so a route handler and a
future client preview can both import it" (`:8-9`). `computeDropKey(order)` (`:86-91`) takes a structural
`{ customerId, shipToOverrideCustomerId, shipToCustomerId }` (`:36-43`) and returns `c:<id>` / `s:<code>`.
It is **already used without any drop row**: Floor's board computes `stopKey: computeDropKey(order)` for
every pool row (`lib/floor/queries.ts:1105`), and the load plan does the same (`lib/floor/load-plan-v2-run.ts:87`).
Known limit carried along: 259 free-text redirects group under the original customer (`:79-84`).

---

## C. VEHICLES / TRANSPORTERS / DRIVER

### C7. `/api/floor/trips/options`

`app/api/floor/trips/options/route.ts`: gate `floor` canEdit (`:46`); vehicles = `vehicle_master` where
`isActive: true`, select `id, vehicleNo, driverName, transporterId`, by `vehicleNo` (`:60-64`); transporters
= `transporter_master` where **`isRealTransporter: true AND isActive: true`**, select `id, name` (`:76-80`).
The route's own comment says the transporter list is **empty until the marking UPDATE is run** (`:72-75`) —
live count in SELECT row `C1`.

**Reuse:** the logic is two inline `findMany` calls, not an exported helper. The freight module must NOT
call `/api/floor/trips/options` (it is floor-gated, `:46`; freight users may hold no floor tick). Copy the two
queries into `lib/freight-trips/options.ts` (same `where`, same `orderBy`) behind a `freight_trips` gate.
Do not refactor the floor route into a shared helper in this build — that edits a floor file (decision 1
spirit, and the route's own "ADDITIVE ONLY" note `:32-35`).

### C8. Driver snapshot

`app/api/floor/trips/route.ts`: when a master vehicle is chosen, `vehicle_master.findUnique` (`:264-270`)
then `driverName = vehicle.driverName; driverPhone = vehicle.driverPhone` (`:277-278`); transporter
defaults from the vehicle but a supplied one wins (`:282`); written on `trips.create` (`:304-330`, driver
`:315-316`). PATCH re-snapshots on a vehicle change and **clears** the driver when the vehicle is cleared
(`app/api/floor/trips/[id]/route.ts:265-290`). An ad-hoc plate never gets a driver on a Floor trip.
**Same pattern for freight: yes** — snapshot from the master on create/PATCH, never read through `vehicleId`
(`schema.prisma` vehicle_master comment `:1597-1602`). Open question Q4: may the user type a driver for an
ad-hoc plate (Floor cannot)?

---

## D. NUMBERING

### D9. Reuse `lib/trips/number.ts`, or own allocator? → **Own small allocator. Recommended.**

Reasons, from the code:
1. The allocator is hard-wired to the `trips` table and its delivery-type letter:
   `prisma.trips.findMany({ where: { tripDate, typeCode, status: { not: "cancelled" } } })` (`number.ts:246-264`),
   `TYPE_CODE_BY_DELIVERY_TYPE` throws for anything but L/U/I/C (`:80-85`, `:101-111`). An `F` path means
   editing a file FLOOR_TRIPS owns — the thing decision 1 says not to touch.
2. Its rule is **lowest free seq with -C rename on cancel** (`:13-22`, `:166-174`), backed by a PARTIAL unique.
   Freight's decision 6 (cancelled kept) does not require number reuse; MAX+1 over all rows with a FULL unique
   is simpler and gives a never-reused number for a report artifact (Q1).
3. `isTripNumberCollision` matches on the **field name** `"tripNumber"` (`:218`) — it would "work" for a
   freight P2002 by accident. Sharing code that works by accident means a future Floor edit silently changes
   freight. Copy, don't share (the file itself was copied from `lib/ci/number.ts`, `:6-11`).
4. What CAN be imported safely: the pure `formatTripDatePart` (`:126-131`, UTC getters on `@db.Date`) — or
   copy its 5 lines, to keep freight free of the trips module entirely (preferred).

Shape: `lib/freight-trips/number.ts` — `formatFreightTripNumber(tripDate, seq)` = `F-YYMMDD-NN` padded
min-2/never-truncated (same rule as `:150-152`), `allocateFreightTripNumber(tripDate)` = `MAX(seq)+1` over
**all** rows of that date (cancelled included), `allocateWithRetry(create)` = allocate → insert → on P2002
re-allocate and retry **once** (pattern `:298-313`). Never `$transaction`.

---

## E. ACCESS

### E10. Adding a page key end to end — what exists today

There is **no page/permission master table**. The key list lives in TypeScript (`ALL_PAGE_KEYS`) by design —
CORE §7.14: "There is no `pageKey` FK, on purpose … a lookup table here would be a second source of truth".
Grants are rows in `user_page_access`; an absent row ≡ all false (`lib/permissions.ts:784`).

Worked example — **CI** (`ci`, 2026-08-31, three commits):
| Commit | Files | What |
|---|---|---|
| `e8695f40` | `prisma/schema.prisma`, `prisma/seed.ts`, `sql/2026-08-31-ci-module.sql` | tables + role_permissions seed rows (pre-cutover) |
| `fb87bbae` | `lib/permissions.ts` (+10), `lib/ci/*`, 9 `app/api/ci/**` routes | `\| "ci"` into the `PageKey` union + `ALL_PAGE_KEYS`; routes gate on it |
| `55c3cdc6` | `lib/permissions.ts` (+17), `components/shared/role-sidebar.tsx`, `app/ci/page.tsx`, `components/ci/*`, `CLAUDE.md` | `PAGE_NAV_MAP` row after `mrn` (`permissions.ts:104`, position verified against `navItems[0]`), `ICON_MAP` `ci: Undo2` (`role-sidebar.tsx:84`) |

MRN did the same in one commit, `050d2b29` (`lib/permissions.ts`, `role-sidebar.tsx`, `prisma/seed.ts`).

Both predate the 2026-09-04 per-user cutover. **Today's full checklist** (post-cutover; grant pattern from
`sql/2026-09-24-billing-hand-ci-grants.sql:85-114`):
1. `lib/permissions.ts` — `| "freight_trips"` in `PageKey` (`:220-383`) and in `ALL_PAGE_KEYS` (`:416-442`).
2. `lib/permissions.ts` — `PAGE_NAV_MAP` row `{ pageKey: "freight_trips", label: "Freight Trips", href: "/freight-trips" }`.
   ⚠ **Position is behaviour**: MobileShell Home = `navItems[0]?.href` (`components/shared/mobile-shell.tsx:61`),
   `buildNavItems` keeps array order (`:190-215`). Put it AFTER `ci` (`:104`) and re-derive `navItems[0]` for
   every grantee before and after.
3. `lib/permissions.ts` — `ACTION_PAGES.canEdit` gets `"freight_trips"` (`:476-514`), or `/admin/access` draws a
   dash on Edit and the write tick is ungrantable (`:465-470`).
4. `lib/permissions.ts` — `ACCESS_SECTIONS` "Operations" (`:653-665`). **Required**: the access page asserts it
   (`app/(admin)/admin/access/page.tsx:44-48`) and shows a "Section map out of step" banner (`:146-149`).
   (Label: `PAGE_NAV_MAP` supplies it, so no `PAGE_LABEL_OVERRIDES` entry is needed.)
5. `components/shared/role-sidebar.tsx` — `ICON_MAP` entry (`:48`); else `DEFAULT_ICON = User` (`:87`).
6. Route group `app/(freight)/freight-trips/layout.tsx` — copy `app/(floor)/floor/layout.tsx` (session →
   `checkAnyPermission(roles, "freight_trips", "canView")` → `/unauthorized`, `buildNavItems`, dedupe,
   `RoleLayoutClient`) (`:19-55`).
7. **Middleware: nothing to add.** `middleware.ts` only exempts public paths and requires a session
   (`:33-92`); `PHASE1_BLOCKED = []` (`:31`). `/freight-trips` does not prefix-match any `PUBLIC_PATHS` entry
   (`:9-30`, `startsWith` at `:37`) — checked, including the `/po` and `/order` prefixes.
8. Admin app switcher (`lib/admin/app-switcher.ts`, `APP_SWITCHER_KEYS`) is curated and NOT permission-filtered —
   leave it alone unless the owner wants freight there.
9. `ROLE_REDIRECTS` (`lib/rbac.ts`) — no change; nobody lands on it.
10. Grants: a Smart Flow SQL file inserting one `user_page_access` row **per user** (dense, all-false except the
    named operations users), in the `billing_hand` style — so `/admin/access` does not show "N of the page rows
    are missing" (`components/admin/access-manager.tsx:457`). **Not seed** (post-cutover keys say "Grants are
    user_page_access data (Smart Flow SQL), never seed", `permissions.ts:268`). The v27.44 access-notebook
    triggers on `user_page_access` will bump the cache version on insert (CORE v114) — intended.
11. `role_permissions`: optional. In `user` mode it is not read (`permissions.ts:938-944`); a row only matters
    if `ACCESS_SOURCE` is flipped back to `role`. Recommend admin-only (superuser short-circuits anyway).

⚠ Found while checking: **`reports_trip_detail` (added 2026-10-01) is in `ALL_PAGE_KEYS` (`:440`) but NOT in
`ACCESS_SECTIONS`** (`:675-676` list only the two older report keys) — so `/admin/access` is showing the
"Section map out of step … missing: reports_trip_detail" banner today. Not freight's bug; whoever adds
`freight_trips` to `ACCESS_SECTIONS` will see it. Fix belongs to the reports owner.

### E11. Which ActionKey guards what

Gate every route on `freight_trips` only — never on `floor`.
- **canView**: GET pool, GET trips list, GET one trip, GET options, GET marker. (Do not repeat Floor's
  latent defect where the trips LIST is canEdit while the board is canView — FLOOR_TRIPS §10.)
- **canEdit**: POST create, PATCH vehicle/driver/note, POST bills add/remove, POST cancel.
- Page: layout admits canView; page resolves canEdit server-side and passes it down to hide write controls
  (the `app/(floor)/floor/page.tsx:10-14` pattern). Every route re-checks.

---

## F. SAFETY / ISOLATION

### F12. Live-sync markers

Every marker reads named tables; none can see a brand-new freight table:
| Marker | Reads |
|---|---|
| `app/api/floor/marker/route.ts:42` | `orders.aggregate` over `floorBoardWhere` |
| `app/api/picking/marker/route.ts:131` | `orders.aggregate` |
| `app/api/billing/picking/marker/route.ts:100` | `orders.aggregate` |
| `app/api/billing/print/marker/route.ts` | `getPrintMarkerLatest` / `getPrintCount` → `trips`, `trip_activity` (`lib/billing/print.ts:293-355`) |
| `app/api/billing/telephonic/marker` · `pick-delete/marker` · `tint/manager/*/marker` · `picking/tint-workload/marker` | `so_tags` / `pick_delete_decisions` / orders via their libs |
| `ci`, `mrn`, `mail-orders` markers | `ci_returns` (`:88`), `mrn` (`:101`), `mo_orders` + `app_tag_settings` (`:108`, `:114`) |

Because freight never writes `orders` (decision 1), `MAX(orders.updatedAt)` never moves, so no
orders-keyed marker fires.

🔴 **BUT the newer LIVE FEED is trigger-driven and canon tells you to wire it — do NOT, for these tables.**
CORE §13 (`docs/CLAUDE_CORE.md:1642`): "every table a screen reads needs a `live_changes` trigger … A new
table a screen reads goes on this list, with its trigger, in the same commit." The feed's topics are
`order | trip | config | mail_order | so_tag` (`lib/live/cursor.ts:76`); Floor asks `order,trip,config`
and a no-topics caller gets every topic (`:84-89`). Copying the trips trigger onto `freight_trips` would
publish **freight ids as `entity='trip'`** — Floor would then refetch `/api/floor/trips?ids=` for an id that
is an *Orbit* trip id in a different id space (false "changed", possibly the wrong trip). Recommendation:
**no `live_changes` trigger on any freight table in v1**, recorded as a deliberate exception to §13 when
canon is written; the freight screen polls its own read-only marker. If a feed is wanted later it needs a
new entity value (ALTER `chk_live_changes_entity`) that no existing caller requests.

Also safe: the `orders` live triggers (CORE §7 v27.45) fire only on `orders` writes, which freight never makes.

### F13. Name-collision sweep — "freight" / "Freight"

Method 1 (MSYS `grep -rIi freight`, excluding `node_modules`, `.git`, `.next*`) and method 2 (Grep tool,
case-insensitive) both return the **same 9 files**, all prose:
`components/shared/role-sidebar.tsx:73` (a comment: "Container reads as inbound freight"),
`docs/CLAUDE_IMPORT.md`, `docs/CLAUDE_TRIP_REPORT.md:45` (NTS `FRT` filter), `docs/mockups/floor-trips/floor-trips-v1.html:921,967`,
three drafts/archives and one backup copy. **Zero hits** in `app/`, `lib/`, `components/` (code),
`prisma/schema.prisma` (count 0), `sql/`, `db/`, `middleware.ts`, `next.config.mjs`, `vercel.json`.
Slash-safe check `[/]freight|freight[_-]trips|freight_trip` over those paths: zero. No `*freight*` path exists
under `app/`, `app/api/`, `components/`, `lib/`. Unrelated untracked `docs/Powershell/0-FrtIngestion.ps1`
is Breakwalls freight automation (canon-sweep draft `:1482`), not OrbitOMS.
**`/freight-trips`, `/api/freight-trips`, table `freight_trips` and page key `freight_trips` are free** in the
repo. The database side is checked by SELECT row `F1`.
`F-` prefix: Orbit trips admit only `L|U|I|C` (`chk_trips_type_code`), CI is `CI-YYYY-NNNNN`
(`lib/ci/number.ts:34-35`); no `` `F- `` string in code. Free.

### F14. FK delete rule onto `orders.id`, and soft-delete

- **No code hard-deletes orders**: no `prisma.orders.delete/deleteMany` in `app/`, `lib/`, `scripts/`; no
  `DELETE FROM orders` in `sql/` or `db/`. Removal is soft: `isRemoved` (`schema.prisma:1123`).
- The newest children all use **ON DELETE RESTRICT with a NAMED relation**: `ci_returns.orderId`
  `@relation("CiReturnOrder", … onDelete: Restrict)` (`:3151`), `so_tag_matches` `"SoTagMatchOrder"` (`:3434`),
  `pick_delete_decisions.deletedOrderId` `"PickDeleteDeletedOrder"` (`:3486`). Freight follows: RESTRICT.
- Reads must respect: `isRemoved = false` (CORE §3, and inside `floorHoldWhere`), `isHidden` + hide rules
  for the POOL (§A1). For the trip VIEW and the future report: a bill that becomes `isRemoved` while on a
  freight trip — Trip Detail drops removed bills (`lib/reports/trip-detail-data.ts:221-229`); freight should do
  the same at read time (no write). Q2 asks the owner.
- ⚠ `NULL <> 'hold'` trap: `dispatchStatus: { not: "hold" }` drops every NULL-status bill
  (`trip-detail-data.ts:221-224`). Any freight query that tests "not held" must use the OR form.

---

## G. Docs vs code — the code wins

| Canon says | Code says |
|---|---|
| FLOOR §3: Hold feed = `dispatchStatus="hold"`, all dates | also `isRemoved:false` and the hide exclusion (`queries.ts:1209`, `:1225`) |
| FLOOR §4.5: hold notes = the Floor note + two Support notes | `HOLD_LOG_NOTES` holds **seven** notes (`hold-log.ts:97-104`) |
| FLOOR_TRIPS §1/§10: `/api/floor/trips/*` is 9 route files | **10** — `app/api/floor/trips/lookup/route.ts` too |
| FLOOR_TRIPS §3.1: `trips` at `schema.prisma:3245-3315`, no `vehicleSize`/`isHand` | model now `:3620-3697`, with `vehicleSize` (`:3640`) and `isHand` (`:3644`) (CORE §7.16 has them) |
| CORE §5: `PageKey` has 39 keys | `ALL_PAGE_KEYS` has **51** (`permissions.ts:416-442`, counted) |
| CORE §3: fixed table standard is "`CLAUDE_UI.md §40`" | UI's table standard is **§27** (§40 is OT prompt screens) |
| CLAUDE.md §4 snapshot: CORE at v27.35 | CORE header v120 · **Schema v27.49** (a dated snapshot — expected) |
| `permissions.ts` comment: ACCESS_SECTIONS asserted complete | `reports_trip_detail` missing from it (§E10 note) |

---

## H. PROPOSED SCHEMA — for review only, NOT a .sql file, NOT run

Design choices:
- **One active freight trip per order is enforced by a PARTIAL UNIQUE INDEX on `freight_trip_bills("orderId")
  WHERE "removedAt" IS NULL`.** Remove = set `removedAt/ById/Reason='removed'`; cancel = set the same on every
  still-active row with `removedReason='trip_cancelled'`, then flip the trip. Rows are never deleted, so the
  full history (which trips a bill was on, when, who moved it) survives; the index only sees live membership,
  so a removed or cancelled bill is instantly free to join another trip. Rejected alternatives: a
  `tripActive` copy on the bill row (two facts to keep in step, nothing to catch drift); a trigger (hidden
  logic, and the live-feed rule above shows how triggers surprise); a full unique on `orderId` (would forbid
  re-planning).
- **Cancel write order, without `$transaction`:** (1) activity row `cancelled` listing every OBD; (2) ONE
  `updateMany` setting `removedAt` on the trip's active bills (single statement = atomic); (3) `update` the
  trip to `cancelled`. If (3) fails the trip is active-but-empty (recoverable by pressing Cancel again); the
  reverse order could leave a cancelled trip still holding locks on bills.
- **Numbering: never reused** (Q1) → plain UNIQUE (`tripDate`, `seq`) + UNIQUE (`tripNumber`), no `-C` rename.
- P2002 on the partial index arrives with `meta.target = ["orderId"]` (field names, measured on a partial index
  in `lib/trips/number.ts:190-202`) — that is how the add route says "Already on F-… — remove it first".
- Timestamps `timestamptz(6)`; camelCase quoted identifiers; constraint names chosen to equal Prisma's
  default names so no `map:` is needed.

```sql
-- DRAFT FOR REVIEW — DO NOT RUN. Smart Flow runs the final version in the Supabase SQL Editor.

CREATE TABLE freight_trips (
  id               serial       PRIMARY KEY,
  "tripNumber"     text         NOT NULL,
  "tripDate"       date         NOT NULL,
  seq              integer      NOT NULL,
  "vehicleId"      integer      NULL REFERENCES vehicle_master(id),
  "adhocVehicleNo" text         NULL,
  "transporterId"  integer      NULL REFERENCES transporter_master(id),
  "driverName"     text         NULL,           -- SNAPSHOT, never read through vehicleId
  "driverPhone"    text         NULL,           -- SNAPSHOT
  note             text         NULL,
  status           text         NOT NULL DEFAULT 'active',
  "cancelledAt"    timestamptz(6) NULL,
  "cancelledById"  integer      NULL REFERENCES users(id) ON DELETE SET NULL,
  "createdAt"      timestamptz(6) NOT NULL DEFAULT now(),
  "createdById"    integer      NOT NULL REFERENCES users(id),
  "updatedAt"      timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT "freight_trips_tripNumber_key"     UNIQUE ("tripNumber"),
  CONSTRAINT "freight_trips_tripDate_seq_key"   UNIQUE ("tripDate", seq),
  CONSTRAINT chk_freight_trips_status           CHECK (status IN ('active','cancelled')),
  CONSTRAINT chk_freight_trips_seq_positive     CHECK (seq >= 1),
  CONSTRAINT chk_freight_trips_number_shape     CHECK (
    "tripNumber" = 'F-' || to_char(("tripDate")::timestamp with time zone, 'YYMMDD') || '-'
                   || lpad(seq::text, greatest(2, length(seq::text)), '0')),
  CONSTRAINT chk_freight_trips_vehicle_one_of   CHECK (NOT ("vehicleId" IS NOT NULL AND "adhocVehicleNo" IS NOT NULL)),
  CONSTRAINT chk_freight_trips_cancelled_complete CHECK (
    status <> 'cancelled' OR ("cancelledAt" IS NOT NULL AND "cancelledById" IS NOT NULL))
);
-- The (tripDate, seq) unique's index leads on tripDate: it serves the day's list AND the
-- report's date-range scan. No separate tripDate index needed.

CREATE TABLE freight_trip_bills (
  id               serial       PRIMARY KEY,
  "freightTripId"  integer      NOT NULL REFERENCES freight_trips(id) ON DELETE RESTRICT,
  "orderId"        integer      NOT NULL REFERENCES orders(id)        ON DELETE RESTRICT,
  "addedAt"        timestamptz(6) NOT NULL DEFAULT now(),
  "addedById"      integer      NOT NULL REFERENCES users(id),
  "removedAt"      timestamptz(6) NULL,
  "removedById"    integer      NULL REFERENCES users(id) ON DELETE SET NULL,
  "removedReason"  text         NULL,
  CONSTRAINT chk_freight_trip_bills_removed_reason CHECK (
    "removedReason" IS NULL OR "removedReason" IN ('removed','trip_cancelled')),
  CONSTRAINT chk_freight_trip_bills_removed_complete CHECK (
    ("removedAt" IS NULL) = ("removedReason" IS NULL)
    AND ("removedById" IS NULL OR "removedAt" IS NOT NULL))
);
-- THE rule (decision 4): at most one ACTIVE freight trip per bill. Partial — not modellable in Prisma.
CREATE UNIQUE INDEX freight_trip_bills_order_active_key ON freight_trip_bills ("orderId") WHERE "removedAt" IS NULL;
CREATE INDEX "freight_trip_bills_freightTripId_idx" ON freight_trip_bills ("freightTripId");
CREATE INDEX "freight_trip_bills_orderId_idx"       ON freight_trip_bills ("orderId");   -- one bill's history

CREATE TABLE freight_trip_activity (
  id               serial       PRIMARY KEY,
  "freightTripId"  integer      NOT NULL REFERENCES freight_trips(id) ON DELETE RESTRICT,
  action           text         NOT NULL,
  "actorId"        integer      NOT NULL REFERENCES users(id),
  summary          text         NOT NULL,
  detail           jsonb        NULL,
  "createdAt"      timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT chk_freight_trip_activity_action CHECK (action IN
    ('created','bills_added','bills_removed','vehicle_changed','details_changed','cancelled'))
);
CREATE INDEX "freight_trip_activity_freightTripId_createdAt_idx" ON freight_trip_activity ("freightTripId", "createdAt");
CREATE INDEX freight_trip_activity_created_idx ON freight_trip_activity ("createdAt" DESC);

-- NO trg_live_changes_* trigger on any of the three (see §F12). Record the exception in CORE §13.
```

Index map against the three asked-for reads:
| Read | Index |
|---|---|
| The day's trip list (`tripDate = D`) | `freight_trips_tripDate_seq_key` (leading column) |
| "Is order X on an active freight trip" / pool exclusion | `freight_trip_bills_order_active_key` (partial) |
| Future report by date range | `freight_trips_tripDate_seq_key` range → `freight_trip_bills_freightTripId_idx` |

Prisma (hand-written; camelCase, no `@map`; every relation to `users` named because each table has ≥2 FKs to
`users` or `users` already has many relations; `orders` relation named in the `CiReturnOrder` style):

```prisma
model freight_trips {
  id             Int       @id @default(autoincrement())
  tripNumber     String    @unique
  tripDate       DateTime  @db.Date
  seq            Int
  vehicleId      Int?
  vehicle        vehicle_master?     @relation(fields: [vehicleId], references: [id])
  adhocVehicleNo String?
  transporterId  Int?
  transporter    transporter_master? @relation(fields: [transporterId], references: [id])
  driverName     String?   // SNAPSHOT — never read through vehicleId
  driverPhone    String?   // SNAPSHOT
  note           String?
  status         String    @default("active") // chk_freight_trips_status: active | cancelled
  cancelledAt    DateTime? @db.Timestamptz(6)
  cancelledById  Int?
  cancelledBy    users?    @relation("FreightTripCancelledBy", fields: [cancelledById], references: [id], onDelete: SetNull)
  createdAt      DateTime  @default(now()) @db.Timestamptz(6)
  createdById    Int
  createdBy      users     @relation("FreightTripCreatedBy", fields: [createdById], references: [id])
  updatedAt      DateTime  @default(now()) @updatedAt @db.Timestamptz(6)
  bills          freight_trip_bills[]
  activity       freight_trip_activity[]

  @@unique([tripDate, seq])
  // CHECKs (status, seq, number shape, vehicle one-of, cancelled-complete) are live-only.
}

model freight_trip_bills {
  id            Int       @id @default(autoincrement())
  freightTripId Int
  freightTrip   freight_trips @relation(fields: [freightTripId], references: [id], onDelete: Restrict)
  orderId       Int
  order         orders    @relation("FreightTripBillOrder", fields: [orderId], references: [id], onDelete: Restrict)
  addedAt       DateTime  @default(now()) @db.Timestamptz(6)
  addedById     Int
  addedBy       users     @relation("FreightTripBillAddedBy", fields: [addedById], references: [id])
  removedAt     DateTime? @db.Timestamptz(6)
  removedById   Int?
  removedBy     users?    @relation("FreightTripBillRemovedBy", fields: [removedById], references: [id], onDelete: SetNull)
  removedReason String?   // removed | trip_cancelled (chk_freight_trip_bills_removed_reason)

  @@index([freightTripId])
  @@index([orderId])
  // ⚠ freight_trip_bills_order_active_key = UNIQUE ("orderId") WHERE "removedAt" IS NULL is
  // PARTIAL and live-only. Do NOT model it as @@unique (same rule as trips_date_type_seq_live_key).
}

model freight_trip_activity {
  id            Int      @id @default(autoincrement())
  freightTripId Int
  freightTrip   freight_trips @relation(fields: [freightTripId], references: [id], onDelete: Restrict)
  action        String   // chk_freight_trip_activity_action
  actorId       Int
  actor         users    @relation("FreightTripActivityActor", fields: [actorId], references: [id])
  summary       String
  detail        Json?
  createdAt     DateTime @default(now()) @db.Timestamptz(6)

  @@index([freightTripId, createdAt])
  @@index([createdAt(sort: Desc)], map: "freight_trip_activity_created_idx")
}

// Back-relations to add:
//   users:              freightTripsCreated  freight_trips[] @relation("FreightTripCreatedBy")
//                       freightTripsCancelled freight_trips[] @relation("FreightTripCancelledBy")
//                       freightBillsAdded    freight_trip_bills[] @relation("FreightTripBillAddedBy")
//                       freightBillsRemoved  freight_trip_bills[] @relation("FreightTripBillRemovedBy")
//                       freightTripActivity  freight_trip_activity[] @relation("FreightTripActivityActor")
//   orders:             freightTripBills freight_trip_bills[] @relation("FreightTripBillOrder")
//   vehicle_master:     freightTrips freight_trips[]   (one FK from freight_trips → unnamed is legal)
//   transporter_master: freightTrips freight_trips[]   (same)
```

Conflicts / cautions with code found:
1. CORE §13 live-feed rule (§F12) — deliberate exception required.
2. `chk_*_cancelled_complete` + `cancelledById ON DELETE SET NULL` cannot both hold if a user row is ever
   deleted. Same latent shape as live `trips`; users are deactivated, never deleted. Accepted, noted.
3. `freight_trips.updatedAt` has `@updatedAt` — every Prisma update stamps it; a raw SQL fix must set it.
4. Adding `orders.freightTripBills` is a relation field only (no column on `orders`) — decision 1 holds.
5. Status vocabulary: one exported constant (`lib/freight-trips/status.ts`) — CORE §3 status-string rule.

---

## I. PROPOSED FILE LAYOUT

```
lib/freight-trips/
  status.ts       FREIGHT_TRIP_STATUS, FREIGHT_ACTIONS, REMOVED_REASON — the one vocabulary (client-safe)
  number.ts       F-YYMMDD-NN format, MAX+1 allocator, retry-once on P2002 (own copy, §D9)
  pool.ts         held pool: AND[floorHoldWhere(), getHideExclusion(), { freightTripBills: { none: { removedAt: null } } }]
                  + held-since ladder via HOLD_LOG_NOTES (server)
  queries.ts      trips for a date, one trip with stops (computeDropKey grouping), counts/totals (server)
  options.ts      active vehicles + real&active transporters (copied where-clauses, §C7) (server)
  activity.ts     the one writer, swallows its own failure (trips pattern); getFreightTripActivity
  types.ts        row/summary types (client-safe)
app/api/freight-trips/
  route.ts                GET ?date= (canView) · POST create (canEdit)
  options/route.ts        GET (canView)
  pool/route.ts           GET (canView)
  marker/route.ts         GET {count, latest} over freight tables + the held set (canView, read-only)
  [id]/route.ts           GET (canView) · PATCH vehicle/driver/transporter/note (canEdit)
  [id]/bills/route.ts     POST add | remove (canEdit) — writes freight_trip_bills ONLY
  [id]/cancel/route.ts    POST (canEdit)
app/(freight)/freight-trips/layout.tsx   copy of (floor) layout, gate freight_trips canView
app/(freight)/freight-trips/page.tsx     resolves canEdit, renders <FreightTripsPage canEdit />
components/freight-trips/
  freight-page.tsx  trip-rail.tsx  pool-view.tsx (Flat | By route)  trip-view.tsx (stops)
  bill-table.tsx  bottom-bar.tsx  trip-form.tsx  vehicle-editor.tsx  trip-history.tsx
```
Every route: `export const dynamic = "force-dynamic"`, sequential awaits, no `$transaction`, **no write to
`orders`, `trips`, `trip_drops`, `trip_activity`, `order_status_logs`** — a grep for those model names in
`lib/freight-trips` and `app/api/freight-trips` should be a build-time gate in the code step.

**Import read-only (no edit to the source file):**
`floorHoldWhere`, `billToByObd` (`lib/floor/queries.ts`) · `getHideExclusion` (`lib/hide/visibility.ts`) ·
`HOLD_LOG_NOTES` (`lib/floor/hold-log.ts`) · `computeDropKey`, `effectiveCustomerId` (`lib/trips/drop-key.ts`) ·
`rankRouteName`, `formatRouteLabel`, `PLACEHOLDER_ROUTE_IDS` (`lib/trips/route-label.ts`) ·
`formatArticleTag`, `formatArticleBreakdown`, `formatDateIST`, `resolveFloorDisplayDate` (`lib/floor/format.ts`) ·
`dealerDisplayName` (`lib/orders/dealer-name.ts`) · `isGiftBill`, `loadLitres`, `loadKg` (`lib/orders/gift.ts`) ·
`formatLitres`, `formatWeightKg` (`components/floor/status-pill.tsx` — exports only; the pill itself is NOT
used) · `FloorActionBar`, `MoreMenu`, `BarDivider`, `BAR_*` (`components/floor/floor-action-bar.tsx`, generic,
imports only React) · `toggleOne`, `toggleAllIds`, `isAllIdsSelected` (`lib/floor/selection.ts`) · `HandBadge`
(`components/shared/hand-badge`) · `getTodayIST`/`parseTripDate` if wanted.

**Must be COPIED (each hard-wires `/api/floor/trips` or Floor's row/status types):**
`trip-desk.tsx` (1,203 lines), `trip-rail.tsx` (`TripSummary`, `TripBar`, `tripInScope`, colour work —
`:56-63`), `floor-table.tsx` (`FloorBoardRow`, ⚡/status/picker columns — `:41-71`), `floor-bottom-bar.tsx`
(floor actions + Hold), `trip-form.tsx` (fetches `/api/floor/trips` `:93`, `:125`), `trip-vehicle-editor.tsx`
(`/api/floor/trips/${id}` `:149`), `trip-detail-header.tsx` (Send to billing / Show to floor / progress bar —
all banned by decision 10), `route-row.tsx` (`ProgressBar`, `countByStatus`), `search-box.tsx` (imports
types from `floor-page.tsx`, `:10`). Copy and strip, never edit the originals.

---

## J. RISKS

- **R1 — Header rule conflict.** CORE §3: "`<UniversalHeader />` is mandatory for all boards"; UI §6 names
  `/floor` as the ONE hand-rolled exception, and CI's commit (`55c3cdc6`) records that a new desk "does not
  earn a second". Copying the Floor layout literally would make freight a second exception. Recommend
  UniversalHeader (Q5).
- **R2 — Live-feed rule** (§F12). A session following CORE §13 to the letter would wire freight into Floor's
  feed. Write the exception into the build prompt.
- **R3 — A held bill can already be on a Floor trip** (`floorHoldWhere` has no `tripDropId` term). Decision 2
  says no floor trip appears, so the pool must not show or filter on it — but the same bill will then sit on
  both a Floor trip (real) and a freight trip (paper). The report rule ("freight wins if active") handles it;
  confirm (Q3). Live count: SELECT row `A1` v3.
- **R4 — The existing Trip Detail report EXCLUDES held bills** (`lib/reports/trip-detail-data.ts:221-229`).
  The future freight report therefore cannot be "Trip Detail with a vehicle override" — the freight bills are
  exactly the ones Trip Detail drops. It needs a second source (freight bills) unioned with Trip Detail.
- **R5 — A bill stops being held while on a freight trip** (released, cancelled, removed). Decision 1 means
  nothing reacts; the trip still lists it. Decide what the trip view and report show (Q2). Removed bills
  should be dropped at read time like Trip Detail does.
- **R6 — Transporter list may be empty** until `isRealTransporter` is marked (§C7). Not a bug, but the
  freight screen will look broken. SELECT row `C1`.
- **R7 — Hide rules.** An active `tag/HOLD` hide rule empties the On hold tab and therefore the freight pool.
  SELECT row `A4` lists active rules.
- **R8 — Invoice ≠ identity.** Decision 4 is phrased per invoice; it is enforced per `orderId` (§A4). Two OBDs
  that share an invoice could sit on two freight trips. SELECT row `A5` measures whether that happens.
- **R9 — Pre-existing `/admin/access` banner** for `reports_trip_detail` (§E10) will be visible when the
  freight key is added; don't mistake it for a freight error.

---

## K. LIVE SELECT BLOCK (read-only, for Smart Flow — Supabase SQL Editor)

One result grid, every value cast to text, every row labelled. Mirrors `floorHoldWhere` + `getHideExclusion`
+ the `HOLD_LOG_NOTES` ladder in SQL.

```sql
-- READ-ONLY · freight-trips discovery · 2026-10-01 · SELECT only, no BEGIN/COMMIT, no writes.
WITH held AS (
  SELECT o.id,
         o."invoiceNo",
         o."heldAt",
         o."tripDropId",
         o."handAt",
         (SELECT max(l."createdAt")
            FROM order_status_logs l
           WHERE l."orderId" = o.id
             AND l.note IN ('Held from floor',
                            'Placed on hold by support',
                            'Placed on hold by support (bulk)',
                            'Held on import (Telephonic tag)',
                            'Held on import (CI marked in billing)',
                            'Held from billing',
                            'Held from Tint Manager')) AS "holdLogAt"
    FROM orders o
   WHERE o."dispatchStatus" = 'hold'
     AND o."isRemoved" = false
     AND o."isHidden" = false
     AND NOT EXISTS (SELECT 1 FROM obd_visibility_rules r
                      WHERE r."isActive" AND r."conditionType" = 'tag' AND r."conditionTag" = 'HOLD')
     AND NOT EXISTS (SELECT 1 FROM obd_visibility_rules r
                      WHERE r."isActive" AND r."conditionType" = 'daysOld' AND r."conditionDaysGt" IS NOT NULL
                        AND o."orderDateTime" IS NOT NULL
                        AND o."orderDateTime" < now() - make_interval(days => r."conditionDaysGt"))
),
grid AS (
  -- A1: the On hold set today (Floor predicate + hide), and how many lack an invoice / sit on a Floor trip
  SELECT '01' AS sort, 'A1 held bills (floorHoldWhere + hide)' AS label,
         count(*)::text AS v1,
         ('no invoice: ' || count(*) FILTER (WHERE "invoiceNo" IS NULL OR btrim("invoiceNo") = ''))::text AS v2,
         ('on a Floor trip (tripDropId set): ' || count(*) FILTER (WHERE "tripDropId" IS NOT NULL))::text AS v3,
         ('Hand-marked: ' || count(*) FILTER (WHERE "handAt" IS NOT NULL))::text AS v4
    FROM held
  UNION ALL
  -- A2: the same without the hide exclusion, to show what hiding removes
  SELECT '02', 'A2 held bills raw (dispatchStatus=hold, not removed)',
         count(*)::text,
         ('isHidden: ' || count(*) FILTER (WHERE o."isHidden"))::text, NULL::text, NULL::text
    FROM orders o
   WHERE o."dispatchStatus" = 'hold' AND o."isRemoved" = false
  UNION ALL
  -- A3: held-since range, Floor's ladder (hold log → heldAt → unknown)
  SELECT '03', 'A3 held-since min / max (log ?? heldAt)',
         min(COALESCE("holdLogAt", "heldAt"))::text,
         max(COALESCE("holdLogAt", "heldAt"))::text,
         ('source log: ' || count(*) FILTER (WHERE "holdLogAt" IS NOT NULL))::text,
         ('approx: ' || count(*) FILTER (WHERE "holdLogAt" IS NULL AND "heldAt" IS NOT NULL)
          || ' · unknown: ' || count(*) FILTER (WHERE "holdLogAt" IS NULL AND "heldAt" IS NULL))::text
    FROM held
  UNION ALL
  -- A4: active hide rules (a tag/HOLD rule would empty the pool)
  SELECT '04', 'A4 active hide rules',
         count(*)::text,
         COALESCE(string_agg(r."conditionType" || ':' || COALESCE(r."conditionTag", r."conditionDaysGt"::text, '?'), ', '), 'none')::text,
         NULL::text, NULL::text
    FROM obd_visibility_rules r
   WHERE r."isActive"
  UNION ALL
  -- A5: invoice numbers shared by more than one live order (decision 4 is per invoice, enforcement per order)
  SELECT '05', 'A5 invoiceNo on >1 non-removed order',
         count(*)::text, ('max orders per invoice: ' || COALESCE(max(n), 0))::text, NULL::text, NULL::text
    FROM (SELECT "invoiceNo", count(*) AS n FROM orders
           WHERE "invoiceNo" IS NOT NULL AND btrim("invoiceNo") <> '' AND "isRemoved" = false
           GROUP BY "invoiceNo" HAVING count(*) > 1) d
  UNION ALL
  -- F1: anything named like freight already in the database
  SELECT '10', 'F1 relations like %freight% (table/index/sequence/view)',
         count(*)::text,
         COALESCE(string_agg(c.relname::text || ' [' || c.relkind::text || ']', ', '), 'none')::text,
         NULL::text, NULL::text
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname::text ILIKE '%freight%'
  UNION ALL
  SELECT '11', 'F1 constraints like %freight%',
         count(*)::text, COALESCE(string_agg(con.conname::text, ', '), 'none')::text, NULL::text, NULL::text
    FROM pg_constraint con
   WHERE con.conname::text ILIKE '%freight%'
  UNION ALL
  SELECT '12', 'F1 triggers / functions like %freight%',
         ((SELECT count(*) FROM pg_trigger t WHERE t.tgname::text ILIKE '%freight%')
          + (SELECT count(*) FROM pg_proc p WHERE p.proname::text ILIKE '%freight%'))::text,
         NULL::text, NULL::text, NULL::text
  UNION ALL
  SELECT '13', 'F1 page key freight_trips already granted?',
         ((SELECT count(*) FROM user_page_access WHERE "pageKey" = 'freight_trips')
          + (SELECT count(*) FROM role_permissions WHERE "pageKey" = 'freight_trips'))::text,
         NULL::text, NULL::text, NULL::text
  UNION ALL
  -- C1: dropdown sources the freight screen will show
  SELECT '20', 'C1 vehicles active / transporters real+active',
         (SELECT count(*) FROM vehicle_master WHERE "isActive")::text,
         (SELECT count(*) FROM transporter_master WHERE "isRealTransporter" AND "isActive")::text,
         ('transporters total: ' || (SELECT count(*) FROM transporter_master))::text,
         NULL::text
  UNION ALL
  -- C2: does Postgres RLS sit on the sibling tables (so freight tables match)?
  SELECT '21', 'C2 RLS on trips / ci_returns',
         (SELECT c.relrowsecurity::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relname = 'trips'),
         (SELECT c.relrowsecurity::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relname = 'ci_returns'),
         NULL::text, NULL::text
  UNION ALL
  -- E1: every page key present in the permission tables (there is no page master table — keys live in code)
  SELECT '30', 'E1 user_page_access key',
         upa."pageKey"::text,
         ('rows: ' || count(*))::text,
         ('canView: ' || count(*) FILTER (WHERE upa."canView"))::text,
         ('canEdit: ' || count(*) FILTER (WHERE upa."canEdit"))::text
    FROM user_page_access upa
   GROUP BY upa."pageKey"
  UNION ALL
  SELECT '31', 'E1 role_permissions keys (fallback table)',
         count(DISTINCT rp."pageKey")::text,
         string_agg(DISTINCT rp."pageKey"::text, ', ')::text,
         NULL::text, NULL::text
    FROM role_permissions rp
  UNION ALL
  -- E2: every active user, role, and floor ticks — to pick the operations users to grant
  SELECT '40', 'E2 user ' || u.id::text || ' · ' || u.name::text,
         ('primary: ' || rm.name::text)::text,
         ('also: ' || COALESCE((SELECT string_agg(r2.name::text, ', ')
                                  FROM user_roles ur JOIN role_master r2 ON r2.id = ur."roleId"
                                 WHERE ur."userId" = u.id AND ur."roleId" <> u."roleId"), '—'))::text,
         ('floor view=' || COALESCE(f."canView"::text, 'no row') || ' edit=' || COALESCE(f."canEdit"::text, 'no row'))::text,
         ('superuser=' || u."isSuperuser"::text)::text
    FROM users u
    JOIN role_master rm ON rm.id = u."roleId"
    LEFT JOIN user_page_access f ON f."userId" = u.id AND f."pageKey" = 'floor'
   WHERE u."isActive" = true
)
SELECT label, v1, v2, v3, v4 FROM grid ORDER BY sort, label;
```

---

## L. QUESTIONS FOR SMART FLOW (max 5)

1. **Numbers on cancel.** Floor trips give a cancelled number back (`L-…-03` → `L-…-03-C`, next trip reuses
   03). For freight I propose **no reuse**: `F-261001-03` stays cancelled-03 forever, the next is 04. OK?
2. **A bill that stops being held while on a freight trip** (released on Floor, cancelled, or removed): does it
   stay on the freight trip (and in the report) until someone removes it? Proposal: it stays, and only
   `isRemoved` bills are dropped at read time. Should the trip view at least mark "no longer held"?
3. **Held bills already on a Floor trip** (row `A1` v3 gives today's count): show them in the freight pool like
   any other held bill, with no hint of the Floor trip (decision 2), and let the report's rule "active freight
   trip wins" decide? Confirm.
4. **Driver for an ad-hoc plate.** Floor copies the driver only from a master vehicle; an ad-hoc plate gets
   none. Should freight let the user TYPE driver name/phone (both for ad-hoc plates and to override the
   master's snapshot)?
5. **Header.** CORE §3 makes `<UniversalHeader />` mandatory and `/floor` is the one named hand-rolled
   exception. Build freight on UniversalHeader (recommended) — or approve it as a second named exception?

*Discovery only. Nothing edited except this file; nothing staged or committed; no SQL run.*
