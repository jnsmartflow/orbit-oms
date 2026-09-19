# Code discovery — Picking supervisor board v2 (five wanted changes)
# 2026-08-21 · diagnosis only, nothing built, nothing committed
# Context read: CLAUDE.md · CLAUDE_CORE.md v94 (Schema v27.15) · CLAUDE_PICKING.md v1.15 (Schema v27.15) · CLAUDE_UI.md v5.18 (no schema stamp by design)

Scope: `/picking`, supervisor face only (`PickingBoardMobile`). Every claim below carries a file
and a symbol. Where a doc and the code disagreed, the code won and the disagreement is recorded
in §4.

---

## 1. Answers

### Q1 — Route filter

**a. Which file/symbol builds the distinct route list, and from which rows?**

`components/picking/picking-board-mobile.tsx` → `availableRoutes` (a `useMemo`, lines 1202-1208).

```
const availableRoutes = useMemo(() => {
  const set = new Set<string>();
  for (const r of waitingRows) {          // ← the ONLY input
    if (r.route !== null) set.add(r.route);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
}, [waitingRows]);                        // ← activeType is NOT a dependency
```

Source rows: `waitingRows` (same file, lines 1175-1178) —
`data.rows.filter(r => !r.isAssigned && !r.isDone && !r.isChecked)`, i.e. the `pending_picking`
pool that feeds the Assign tab. `data` comes from `usePickingBoard()`
(`components/picking/picking-mobile-shell.tsx` → `SupervisorPickingShell.fetchQueue`, line 395,
`GET /api/picking/queue?scope=openPending`).

`r.route` itself is `PickingQueueRow.route` (`lib/picking/types.ts:13`).

**b. Is the Type filter applied BEFORE or AFTER that list is derived?**

**AFTER — and only to the counts, never to the list.** This is the whole of the reported bug.

| Symbol | File:line | Reads `activeType`? |
|---|---|---|
| `availableRoutes` | `picking-board-mobile.tsx:1202` | **NO** — deps are `[waitingRows]` |
| `routeCounts` | `picking-board-mobile.tsx:1210` | **YES** — `if (activeType !== "All" && r.deliveryType !== activeType) continue;` (:1214) |

The behaviour is deliberate and documented in the source comment directly above `availableRoutes`
(:1199-1201): *"distinct non-null `route` across ALL waiting rows (stable, not narrowed by the Type
pill). Counts DO reflect the current Type pill (live), mirroring the approved mockup's route sheet
exactly."* The sheet even advertises it in its own subtitle — `"Single-select · counts reflect the
current Type filter"` (:2418). **So change 1 is a reversal of a locked mockup decision, not a bug
fix.** That framing matters for Smart Flow (§5, Q-A).

**c. Where do the per-route counts come from, and why does a 0-count route still render?**

Counts: `routeCounts` (a `Map<string, number>`, :1210-1218), consumed at the sheet's `options` prop:

```
options={availableRoutes.map((route) => ({ value: route, label: route, count: routeCounts.get(route) ?? 0 }))}
```
`picking-board-mobile.tsx:2421`

A 0-count route renders because **the option LIST and the option COUNT come from two different
memos**. `availableRoutes` produces the row; `routeCounts.get(route)` returns `undefined` for a
route with no rows under the active type, and the **`?? 0` fallback prints a literal `0`**. There
is no `.filter(count > 0)` anywhere between the two. `FilterBottomSheet`
(`picking-board-mobile.tsx:851-919`) renders every option it is given unconditionally (`options.map`,
:894) — it has no notion of an empty option and must not grow one; it is shared by three call sites
(see e).

That is exactly the reported "Vapi 0" with Type = Local: Vapi is in `availableRoutes` because some
waiting bill is on route Vapi, and its count is 0 because none of those bills is `deliveryType ===
"Local"`.

**d. Is the route list derived from unassigned rows only, or the whole tab?**

**Unassigned only — and that IS the whole Assign tab.** `waitingRows` excludes `isAssigned`,
`isDone` and `isChecked`, so the list never sees a `pick_assigned` / `pick_done` / `pick_checked`
bill. The Picking and Done tabs have no route control at all (they use picker dropdowns — see e),
so no route list is derived for them anywhere.

**⚠ One nuance that is NOT the reported bug but will bite the same change.** `waitingRows` is not
zone-filtered, so `availableRoutes` AND `routeCounts` both span **Zone 1 (Due) + Zone 2 (Upcoming)**
— see `filteredWaitingDue` / `filteredWaitingUpcoming` (:1235, :1291), which partition only *after*
the filters run. Consequences already live today:

- A route whose only waiting bill is an **upcoming, locked, non-assignable** bill still lists, with
  a non-zero count.
- `allRoutesCount` (`= Array.from(routeCounts.values()).reduce(...)`, :1310) is the sheet's
  "All routes" number and therefore counts due + upcoming, while the lane strip immediately below
  the control shows `filteredWaitingDue.length` (:2038) — **due only**. The two numbers can already
  legitimately disagree on screen.

Whoever implements change 1 has to decide zone as well as type, or the "0" simply moves.

**e. Does the sheet exist once, or is it duplicated per tab?**

**One component, three instances, three independent state triples.** `FilterBottomSheet` is
declared once (`picking-board-mobile.tsx:851`) and mounted three times:

| # | File:line | Purpose | Options source | Value state |
|---|---|---|---|---|
| 1 | :2414-2424 | Assign → **Route** | `availableRoutes` + `routeCounts` | `activeRoute` / `routeSheetOpen` (:941-942) |
| 2 | :2427-2437 | Picking → **Picker** | `pickerOptions` (:1334) | `activePicker` / `pickerFilterSheetOpen` (:947-948) |
| 3 | :2442-2452 | Done → **Picker** | `checkedPickerOptions` (:1357) | `activeCheckedPicker` / `checkedPickerFilterSheetOpen` (:962-963) |

So the fix has exactly ONE render site (#1) but must not be made inside `FilterBottomSheet`, which
#2 and #3 also render. Note instances #2 and #3 have the identical 0-count shape via
`pickerCounts` (:1325) / `checkedPickerCounts` (:1348) — those DO apply their tab's type filter to
the map, but the option list is `Array.from(pickerCounts.keys())` (:1335), derived from the same
already-filtered map, so a picker never appears at 0. **The picker sheets are already correct; only
the route sheet splits its list and its counts.** Copy the picker sheets' shape and change 1 is
about four lines.

---

### Q2 — Route vs area on the card

**a. Does `PickingQueueRow` carry BOTH?**

Yes, both, both nullable, both non-optional fields:

```
lib/picking/types.ts:12   deliveryType: string | null;
lib/picking/types.ts:13   route:        string | null;
lib/picking/types.ts:14   area:         string | null;
```

**No new query is needed for change 2. The route is already on every row, on every tab.**

**b. Where does each come from in `lib/picking/queue.ts`?**

Both come off the **effective dealer's AREA**, not off `orders`. `orders` has no `route` and no
`area` column (verified in `prisma/schema.prisma:702-790`).

Join shape — `DEALER_SELECT`, `lib/picking/queue.ts:226-237`:

```
delivery_point_master
  → area           (area_master, FK delivery_point_master.areaId)
      → name           ⇒ row.area
      → primaryRoute   (route_master, FK area_master.primaryRouteId) → name  ⇒ row.route
      → deliveryType   (delivery_type_master, FK area_master.deliveryTypeId) → name ⇒ row.deliveryType
```

Assignment site — `lib/picking/queue.ts:676-678`:

```
deliveryType: effectiveDealer?.area?.deliveryType?.name ?? null,
route:        effectiveDealer?.area?.primaryRoute?.name ?? null,
area:         effectiveDealer?.area?.name ?? null,
```

`effectiveDealer` is resolved at `queue.ts:625-630` — **override first, plain customer second**
(`shipToOverrideCustomerId` → `dealerById`, falling through to `customerId`; a dangling override id
falls through, which the comment at :473-479 calls out explicitly).

**⚠ Load-bearing, and it is a comment in the source (`queue.ts:224-225`):**
*"`delivery_point_master.primaryRouteId` is stale and is never read (locked decision, step 1) — only
`area.primaryRoute` is used."* `delivery_point_master` has its OWN `primaryRouteId`
(`schema.prisma:507`, relation `CustomerPrimaryRoute`). **Do not switch change 2 onto it.** The
route on the card must be the same value the route filter already keys on, or the filter and the
card will name different things.

**c. Exact JSX that renders the area on the where-row.**

**Supervisor board — ONE where-row, shared by all five variants.** There is no per-variant
where-row: `PickingCard` (`components/picking/picking-board-mobile.tsx`, the component whose
`variant` prop is `"assign" | "assignLocked" | "picking" | "doneCheck" | "doneChecked"`) renders a
single block, and the variant only affects what sits at its right end:

| Line | Content |
|---|---|
| `picking-board-mobile.tsx:597` | `<div className="flex items-center justify-between gap-2.5 mt-1.5">` — the where-row root |
| `picking-board-mobile.tsx:599` | `<RouteDot deliveryType={row.deliveryType} onRed={dup} />` |
| **`picking-board-mobile.tsx:604`** | **`{row.area ?? "—"}`** ← THE AREA, all five variants |
| `picking-board-mobile.tsx:606-621` | `· {volumeLitres} L` — gated `rich`, i.e. `assign \| assignLocked \| picking` only |
| `picking-board-mobile.tsx:622` | `{whereRightNode}` → `whereRight` (:411-416, picker name, `picking \| doneCheck \| doneChecked` only) + `SmuBadge` |

Per variant, then: area renders on **all five**; volume on three (`rich`); picker name on three.

**Picker board (`components/picking/picker-my-picks-board.tsx`) — ONE where-row, both bands:**

| Line | Content |
|---|---|
| `:1503` | where-row root |
| `:1505` | `<RouteDot deliveryType={row.deliveryType} onRed={dup} />` |
| **`:1510`** | **`{row.area ?? "—"}`** ← THE AREA |
| `:1511-1522` | `· {row.articleTag}` — DIVERGENCE 1, picker-only |
| `:1523-1541` | `· {volumeLitres} L` |
| `:1543` | `{isSmuBadged(row.smuCode) && <SmuBadge …/>}` |

**`components/picking/card-atoms.tsx` renders NEITHER.** It has no `area` and no `route` reference
anywhere — `AgeBadge`, `SmuBadge`, `FamilyChip`, `UnlistedChip`, `CardShelf` and `RouteDot` never
touch either field. `CardShelf` takes the whole `row` but reads only `families` and
`unresolvedLineCount`. So change 2 is **two JSX lines in two files, zero shared-atom churn.**

**Detail-screen headers also print the area, and the brief does not mention them** —
`picking-board-mobile.tsx:2568` and `picker-my-picks-board.tsx:1646`, both
`` `${obdNumber} · ${area ?? "Unmatched"}${windowTime}` ``. Flagged as an open question (§5, Q-B):
leaving them on area while the card says route is a silent inconsistency the floor will notice.

**Verified two ways** (per the brief's grep rule). `grep -rn "\.route\b" components/picking/` and a
second pass `grep -rn "row[.]route" --include=*.tsx .` both return the **same four hits, all in
`picking-board-mobile.tsx` (1205, 1213, 1215, 1224), all inside `availableRoutes` /
`routeCounts` / `filteredWaitingAll`.** **`route` is used exclusively as a filter key today and is
rendered on no picking surface at all.** (Floor does render it —
`components/floor/floor-table.tsx:404`, `components/floor/hold-tab.tsx:114` — and Floor's search
already matches on it, `lib/floor/search.ts:52`. Precedent exists; Picking just never adopted it.)

**d. Does `RouteDot` still key on `deliveryType`, and would it clash?**

**Still true, verified in code.** `card-atoms.tsx`:

```
const ROUTE_DOT_COLOR: Record<string, string> = { Local: "#2563eb", Upcountry: "#ea580c", Cross: "#e11d48" };
export function RouteDot({ deliveryType, onRed = false }: { deliveryType: string | null; onRed?: boolean })
  const color = (deliveryType !== null && ROUTE_DOT_COLOR[deliveryType]) || "#9ca3af";
```

with the inline warning kept: *"⚠ Keys on `deliveryType`, NOT on route — there is no route→colour
data in the payload at all (`CLAUDE_UI.md §62.3`). The name is the trap."* `CLAUDE_UI.md §62.3` says
the same and is accurate.

**Would it clash?** Not functionally — the dot and the text would carry two different facts, which
is fine. But it becomes actively **misleading**: today the reader can rationalise `[dot] Pal` as
"the dot belongs to the area/lane"; `[dot] Vapi` reads as "this dot is Vapi's colour", which it is
not — a Local route and an Upcountry route both landing in `#9ca3af`-vs-`#2563eb` by *delivery
type* will look arbitrary. Two options, both cheap, both a design call not a code call (§5, Q-C):
rename the component's meaning in the UI docs and accept it, or drop the dot from the row that
prints a route name. **Do not add a route→colour map** — there is no route colour in the payload
and `route_master` (`schema.prisma:390-399`) has no colour column either; inventing one is a schema
change and CORE §3 forbids doing it here.

**e.** Nothing was changed. This is a report.

---

### Q3 — Assign sheet picker list

**a. What `app/api/warehouse/pickers/route.ts` returns, and what the number counts.**

Read in full (86 lines). It was NOT modified.

Returns, per picker (`route.ts:64-77`):
`{ id, name, avatarInitial, status: "picking" | "available", assignedCount, pickedCount, pendingCount, totalKg }`,
sorted picking-first then by name (:80-83). Client-side type mirror: `interface Picker`,
`picking-board-mobile.tsx:55-64` — it already declares all eight fields.

**The number rendered behind each picker is `assignedCount`**, at
`picking-board-mobile.tsx:3252`:

```
{p.status === "available" ? "Free" : `${p.assignedCount} jobs`}
```

The two where-clauses, quoted verbatim (`app/api/warehouse/pickers/route.ts:16-31`):

```ts
const todayStart = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00");
const todayEnd   = new Date(new Date().toISOString().slice(0, 10) + "T23:59:59");

const pickerUsers = await prisma.users.findMany({
  where: { role: { name: "picker" }, isActive: true },
  select: { id: true, name: true },
  orderBy: { name: "asc" },
});

const assignments = await prisma.pick_assignments.findMany({
  where: {
    pickerId:   { in: pickerUsers.map((u) => u.id) },
    assignedAt: { gte: todayStart, lte: todayEnd },
    status:     { in: ["assigned", "picked"] },
  },
  …
});
```

Aggregation (:51-61): `s.assigned++` on **every** row; `s.picked++` only when `status === "picked"`.
So **`assignedCount` = every assignment made to him today, in any state.** Table:
`pick_assignments`. Stage: **none — `orders.workflowStage` is never read by this route.**

🔴 **`status: { in: ["assigned", "picked"] }` is a no-op filter.** The live CHECK constraint
`chk_pick_assignments_status` restricts the column to exactly those two values
(`CLAUDE_PICKING.md §7`, confirmed by a `pg_constraint` query on 2026-07-17). It cannot exclude
anything. It reads like a state filter and filters nothing.

🔴 **`approve` never writes this column.** `app/api/picking/approve/route.ts` stamps
`checkedAt`/`checkedById` only (grep of `status:` in that file returns HTTP status codes and
nothing else). Only `assign` writes `"assigned"` (`assign/route.ts:126`) and `done` writes
`"picked"` (`done/route.ts:119`, with a `"assigned"` rollback at :131). **A `pick_checked` bill's
assignment row still reads `status: "picked"` forever.**

**b. Where is "Free" decided, and against what value?**

Decided **server-side**, not in the client. `app/api/warehouse/pickers/route.ts:66,71`:

```
const pendingCount = s.assigned - s.picked;
status: (pendingCount > 0 ? "picking" : "available")
```

The client only reads the string (`picking-board-mobile.tsx:3247`, and again at :3252 for the
label). So "Free" means **"has no assignment made today that is still at `status: 'assigned'`"** —
which, given (a), is a proxy for "holds no `pick_assigned` bill assigned today".

**c. All-time, today-only, or open-only? Plainly:**

**`assignedCount` — the number actually on screen — is TODAY-ONLY and CUMULATIVE, not open.** It is
"how many bills I handed this man since midnight", including every one he has already finished and
every one a supervisor has already approved. It is not a workload number and it never was.

**`pendingCount` — already returned, already correct in shape, NOT rendered — is TODAY-ONLY AND
OPEN.** It excludes finished bills. It does not exclude carry-over.

🔴 **"Today" is the wrong day.** `new Date().toISOString().slice(0,10)` takes the **UTC** date, then
`new Date("YYYY-MM-DDT00:00:00")` parses an **offset-less** string, which per the ES spec is read in
the **host's local zone** — this is precisely CORE §3's `Date.parse` landmine and the reference fix
is `pickedAtMs()` in `lib/picking/picker-split.ts`. On Vercel (UTC) the window is
`[UTC 00:00, UTC 23:59:59]` = **05:30 IST today → 05:29 IST tomorrow.** Two live consequences:

- Between **00:00 and 05:30 IST** the window is still yesterday's UTC date, so a bill assigned at
  01:00 IST is counted against the previous day.
- `lte: todayEnd` at `23:59:59` **excludes the final second** of the window (a half-open `lt` on
  the next midnight is the pattern every other picking date fence uses — `getISTDayRange()`).

**d. Smallest change that would yield a true open count — DESCRIPTION ONLY, no code.**

`pendingCount` already exists and is already wired into the client type. The smallest honest change
is three edits inside `app/api/warehouse/pickers/route.ts` plus one line in the sheet:

1. **Drop the `assignedAt` window entirely** from the `pick_assignments` query. It is the only
   reason a carry-over bill vanishes from the count, and an *open* count has no business being
   date-fenced — the picker's own Pending tab deliberately is not
   (`lib/picking/picker-split.ts`, `CLAUDE_PICKING.md §5.4`). Removing it also removes the UTC-day
   bug in (c) without needing an IST helper, because there is no longer a day to get wrong.
2. **Replace the `status` filter with a stage test on the joined order** — the query already
   traverses `order` for `querySnapshot.totalWeight`, so add
   `order: { workflowStage: PICK_ASSIGNED, isRemoved: false }` and read `PICK_ASSIGNED` from
   `lib/workflow-stages.ts` (never a string literal — that registry is the one owner, §2 of the
   picking doc). This is strictly better than `status`: `status` cannot see a cancelled or removed
   order, and `approve` never advances it.
3. **`pendingCount` becomes the row count** and `status` becomes `pendingCount > 0 ? "picking" :
   "available"` — the existing expression, now over a correct input. Keep `assignedCount` /
   `pickedCount` / `totalKg` in the payload so nothing that reads them breaks (nothing does today,
   but the type is exported shape).
4. **`picking-board-mobile.tsx:3252` renders `p.pendingCount`, not `p.assignedCount`.**

Read-only, one route, no schema change, no migration, no new table. **It is not free of risk** —
see §3, Blocker B3 (the roster is fetched exactly once per session).

**e. Confirm the second picker dropdown is still derived from `assignedToName`.**

**Confirmed — and there are TWO of them, not one.** `CLAUDE_PICKING.md §7` says "the Picking-tab
FILTER derives its list from `assignedToName` on the loaded rows"; the code has that plus a third
dropdown on the Done tab with the same derivation:

| Dropdown | Symbol | File:line | Derivation |
|---|---|---|---|
| Assign sheet (the roster) | `pickers` | `picking-board-mobile.tsx:973`, fetched :1117 | `GET /api/warehouse/pickers` — real `users` rows, `isActive: true` |
| Picking-tab filter | `pickerCounts` → `pickerOptions` | :1325-1338 | `Map` keyed on `r.assignedToName` over `assignedRows` |
| Done-tab filter | `checkedPickerCounts` → `checkedPickerOptions` | :1348-1361 | same, over `[...doneRows, ...checkedRows]` |

**Two sources, two questions — and change 3 touches exactly one of them.** The roster answers
*"who can I hand work to?"* (a switched-off picker vanishes immediately). The two filters answer
*"whose outstanding bills am I looking at?"* (a switched-off picker stays as long as bills carry
his name). Change 3 lives entirely in the roster; **`pickerCounts` and `checkedPickerCounts` are
untouched by it and must stay that way** — §7 of the picking doc explicitly warns against unifying
the sources without deciding which question each list answers.

⚠ One consequence worth naming: change 3 asks the Assign sheet's chip to show a **pending count**,
and the Picking tab's filter already shows a **count of loaded assigned rows per picker**. Those two
numbers will sit two taps apart and will *usually* agree — but not always: `pickerCounts` reflects
the Picking tab's own type-pill filter (:1328) and the roster count will not. Deliberate divergence,
worth stating in the UI rather than "fixing".

---

### Q4 — Picking tab shape

**a. How the list is built today.**

Rows → `assignedRows` (`picking-board-mobile.tsx:1179-1182`), `data.rows.filter(r => r.isAssigned)`.
`isAssigned` is strictly `workflowStage === PICK_ASSIGNED` (`lib/picking/types.ts:74-81`).

Filtered → `filteredStillPicking` (:1371-1378): type pill `checkTypeFilter` **AND** picker
`activePicker` (matched on `assignedToName`) **AND** the shared search `q`.

Sort → **none in this file.** The server's order survives: `lib/picking/sort.ts`'s `PICKING_SPINE`
applied in `getPickingQueue`, then `Array.filter` (which preserves order) all the way down. The
source comment at :1164-1166 is explicit: *"NOTHING here re-sorts or re-groups."* Note
`byAssigned` is spine rule #1, so within this tab it is a no-op (every row is assigned) and the
effective order is window → deliveryType → keyCustomer → priority → FIFO → obdNumber.

Card → `<PickingCard variant="picking" …/>` (:2320-2326), opened with
`openDetail(row.orderId, "stillPicking")` (:2325).

**b. Does every row carry a `pickerId`?**

**Yes — both fields, on every row, from one join.**

- `lib/picking/types.ts:103-104`: `pickerId: number | null;` and `assignedToName: string | null;`
- `lib/picking/queue.ts:455`: `pickerId: true` inside the `pickAssignment` select
- `lib/picking/queue.ts:724-725`: `pickerId: order.pickAssignment?.pickerId ?? null,` /
  `assignedToName: …`

`types.ts:100-102` states the reason directly: *"Numeric FK … a display-name match is not a scope
boundary."* **So change 4 can group on the real FK and must — never on `assignedToName`.** No new
query, no new column. What the row does **not** carry is the picker's `avatarInitial` — that lives
only on the roster payload (`/api/warehouse/pickers`), which the board already fetches, so a join
in memory covers it.

**c. Per-bill state the Picking-tab card shows.**

| Thing | Present? | Where |
|---|---|---|
| Elapsed pill | **Yes** | `captionRight = checkCardPill(row, "still", nowTick, dup)` — `picking-board-mobile.tsx:405`; pill classes `ELAPSED_PILL_CLASS` :154-158 (grey / amber ≥30m / red ≥60m), label from `elapsedSinceAssigned(row.assignedAt, nowTick)` :215 |
| Picker name | Yes | `whereRight`, :411-416 (right end of the where-row) |
| SMU badge | Yes | `whereRightNode`, :434-441 |
| Shelf (pack chips) | Yes | `rich` is true for `picking`, :624-634 |
| **Detail arrow** | **No** | `showViewItems={variant === "assign"}` (:631) — the whole card body opens detail instead (`onClick={variant === "assign" ? … : onOpen}`, :519) |
| **Undo** | **No, not on the card** | It is on the DETAIL screen, :3077-3083, gated on the ROW's `isAssigned` — not on the tab |
| Selection | **No** | tap-select is `variant === "assign"` only (:519); the teal check badge at :467 is `variant === "assign" && selected` |

**The elapsed clock:** `nowTick`, `picking-board-mobile.tsx:967-971` —
`setInterval(() => setNowTick(Date.now()), 30_000)`, board-local, **no fetch**. The comment at
:965-966 is explicit: *"ticks independently of any data fetch so '4m' keeps advancing toward '5m'
without a refetch."* The only refetch is the separate 15s marker in the shell
(`picking-mobile-shell.tsx:464-470`). **Two independent clocks. Do not merge them** — they exist so
elapsed time advances without network traffic.

**d. What a grouped list would break — every behaviour keyed off a bill-per-row list.**

1. **`openDetail(id, "stillPicking")` → `activeDetailList` (:1525-1532).** The switch maps
   `"stillPicking"` → `filteredStillPicking`, a flat `PickingQueueRow[]`. Grouping does not break
   this *if* the caller still hands the pager a flat array — but a **per-picker** array is a
   different array, so `DetailListKey` gains a variant dimension it does not have today
   (`type DetailListKey = "waiting" | "needsCheck" | "stillPicking" | "checked"`, :103). The comment
   at :97-102 warns that these are LIST identities, not tab identities, and that deriving one from
   `activeTab` re-couples them. A per-picker list is a **fifth kind of list identity** that a plain
   string union cannot express — it needs a picker id alongside it.
2. **The bill pager (`components/picking/use-bill-pager.ts`).** Its item constraint is
   `interface PagerItem { orderId: number }` (:67-69) and it derives `index` live from
   `list` + `currentOrderId` (:85-86). A **picker card has no `orderId`**, so a grouped list cannot
   be the pager's `list`. See (e).
3. **Selection pruning.** Not affected. `selectedRows` (:1461) is
   `filteredWaitingDue.filter(r => selected.has(r.orderId))` — **Assign tab only.** The Picking tab
   has no selection at all. This one is free.
4. **The marker pause rule.** Not affected. `paused: detailOpen || overlayBusy`
   (`picking-mobile-shell.tsx:469`), where `overlayBusy` is `pickerSheetOpen || releaseTarget !== null
   || cancelTarget !== null` (:1065-1066 in the board). None of these is a list concept.
5. **Also keys off the flat list, not in the brief's list:** the tab BADGE
   (`workflowTabs`, `picking-mobile-shell.tsx:509`, `rows.filter(r => r.isAssigned).length` — a
   BILL count, which must stay a bill count even when the tab shows pickers), the summary strip
   `{filteredStillPicking.length} picking` (:2078), `overThresholdCount` (:1425-1430, the
   "N over 30m" figure — a per-bill elapsed test), and the empty-state copy at :2316
   (`"Nobody is picking right now."` vs `"No bills match."`).

**e. Can the bill pager survive a grouped list? — Honestly:**

**No, not directly — but it survives intact one level down, and that is the shape to build.**

The hook cannot page a list of pickers: `PagerItem` requires `orderId` and `index` is resolved by
`orderId` match. There is no cheap way around that and no reason to try — swiping sideways from one
*picker* to another is not a gesture anyone asked for.

**The picker card must open a plain bill list first.** Three levels: `pickers → that picker's bills
→ one bill`. At level 3 the pager is handed `filteredStillPicking.filter(r => r.pickerId === id)` —
a flat `PickingQueueRow[]` — and works **completely unchanged**: correct `count`, correct arrows,
correct "N of M", correct live re-derivation when a refetch removes a bill (`index → -1`, paging
goes inert, a past-threshold swipe snaps back rather than committing — `use-bill-pager.ts:85-86`
and `CLAUDE_PICKING.md §5.3`).

The cost is `DetailListKey`. Today it is a four-string union whose whole design point is that a
band carries its key when it moves tabs (:97-102). A per-picker list needs
`{ kind: "stillPicking"; pickerId: number }` or equivalent, which turns a `switch` into a lookup.
That is the real cost of change 4 and it is not visible from the outside. See §3, Blocker B4.

---

### Q5 — Search

**a. Does a filter exist, or is the icon wired to nothing?**

**It exists and it works.** The chain, end to end:

1. `ModuleMobileHeader … searchActive={searching} onSearchToggle={() => setSearching(v => !v)}`
   — `picking-board-mobile.tsx:1970-1977`
2. `const [searching, setSearching] = useState(false); const [query, setQuery] = useState("");` — :938-939
3. When `searching`, the filter row is **replaced** by the input — :1992-2015. Placeholder:
   `"Search customer or OBD…"`. `autoFocus`. A Cancel button clears both (`setSearching(false);
   setQuery("")`, :2007-2010).
4. `const q = query.trim().toLowerCase();` — :1220
5. `q` is applied in all four list memos (see b).

⚠ **The `searchActive` prop it passes is genuinely inert** — `components/shared/module-mobile-header.tsx`
declares it (:61) and never destructures it. `CLAUDE_UI.md §59.7` documents this correctly as a
deliberate one-className job left for whenever an active treatment is designed. The **toggle**
(`onSearchToggle`) is fully wired; only the icon's active *look* is not.

**b. Which fields, which tabs, case handling, debounce.**

**Fields — exactly two, everywhere:** `dealerName` and `obdNumber`. The identical expression appears
four times:

```
if (q && !(r.dealerName.toLowerCase().includes(q) || r.obdNumber.toLowerCase().includes(q))) return false;
```

| List | File:line | Tab |
|---|---|---|
| `filteredWaitingAll` | :1225 | Assign |
| `filteredStillPicking` | :1375 | Picking |
| `filteredNeedsCheck` | :1391 | Done (top band) |
| `filteredChecked` | :1407 | Done (lower band) |

**Tabs — all three.** The search input sits *above* the tab branch in the JSX (`{searching ? … :
activeTab === "assign" ? …}`, :1992/:2016), so toggling search replaces the filter row on whichever
tab is open, and `q` is a single shared state read by all four lists. One box, one query, board-wide.

**Case:** both sides lowercased — `q` once at :1220, each field per-comparison. Plain `.includes()`
substring; no accent folding, no token splitting, no last-N-digits OBD matching.

**Debounce: none.** `onChange={(e) => setQuery(e.target.value)}` (:2000) re-filters on every
keystroke. Verified two ways — `grep -rniE "debounce|setTimeout.*query" components/picking/` and a
second pass `grep -rnE "debounc|useDeferredValue|startTransition" components/picking lib/picking`
— **both clean.** At current board size (~112 live bills) this is fine; it is worth naming only
because change 5 widens the per-row work.

**c. Which wish-list fields are already on `PickingQueueRow`?**

**All five. Change 5 needs no new query, no new column, no payload change.**

| Wanted | Field | `types.ts` line | Note |
|---|---|---|---|
| picker name | `assignedToName` | :104 | null on an unassigned bill — harmless, `(x ?? "")` |
| customer name | `dealerName` | :7 | already searched |
| area | `area` | :14 | nullable |
| route | `route` | :13 | nullable |
| order number | `obdNumber` | :6 | already searched |

**There is a ready-made precedent — and an ownership question with it.**
`lib/floor/search.ts` already does most of this: its `Searchable` interface is
`{ orderId, obdNumber, dealerName, route }` and `PickingQueueRow` **structurally satisfies it
today**; `matchesText` (:49-56) matches OBD ∪ dealer ∪ route, and `parseSearch` adds a numbers mode
(paste a list of OBDs, match on the full number or a 3+-digit tail). It is missing `area` and
`assignedToName`. Reusing it means editing a Floor-owned module for a Picking need — a decision, not
a detail (§5, Q-D).

**d. Does the picker face have search?**

**No — confirmed in code, and `CLAUDE_UI.md §59.7` is right.**
`components/picking/picker-my-picks-board.tsx:1164` passes `showSearch={false}`, and
`ModuleMobileHeader` (:106) renders the button only under `{showSearch && …}`. The picker board has
no `searching` state, no `query` state and no `q` in any filter — its only search-shaped control is
the DETAIL screen's pack-filter chips, which is a different thing. Change 5 does not touch that
face.

---

## 2. SQL for Smart Flow

Read-only. Single paste, no `BEGIN`/`COMMIT`, one `UNION ALL` so the last statement shows
everything. **Not run.**

Two things it deliberately mirrors from `lib/picking/queue.ts`, so its answers match the board's:
route/area come from the dealer's **area** (`area_master.primaryRouteId → route_master`), never from
`delivery_point_master.primaryRouteId` (stale, `queue.ts:224-225`); and the effective dealer is
resolved by **two LEFT JOINs then COALESCE on the resolved values**, not `COALESCE` on the ids —
that is what reproduces `queue.ts:625-630`'s fall-through when a `shipToOverrideCustomerId` points
at a row that does not exist.

```sql
-- READ-ONLY. Picking board — route vs area coverage, 2026-08-21.
-- Live picking pool only. Mirrors lib/picking/queue.ts's dealer/area/route resolution.
WITH base AS (
  SELECT
    o.id,
    a.name  AS area_name,
    r.name  AS route_name,
    dt.name AS delivery_type
  FROM orders o
  LEFT JOIN delivery_point_master ov ON ov.id = o."shipToOverrideCustomerId"
  LEFT JOIN delivery_point_master cu ON cu.id = o."customerId"
  -- effective dealer = override first, plain customer second (queue.ts:625-630);
  -- a dangling override id leaves ov.* NULL and falls through, exactly as the JS does.
  LEFT JOIN area_master          a  ON a.id  = COALESCE(ov."areaId", cu."areaId")
  LEFT JOIN route_master         r  ON r.id  = a."primaryRouteId"
  LEFT JOIN delivery_type_master dt ON dt.id = a."deliveryTypeId"
  WHERE o."workflowStage" IN ('pending_picking','pick_assigned','pick_done','pick_checked')
    AND o."dispatchStatus" = 'dispatch'
    AND o."isRemoved" = false
)
SELECT 1 AS sort_key, 'TOTAL live picking rows'        AS label, ''::text AS detail, COUNT(*) AS n FROM base
UNION ALL
SELECT 2, 'rows WITH a route (non-null, non-empty)',   '',
       COUNT(*) FILTER (WHERE route_name IS NOT NULL AND btrim(route_name) <> '') FROM base
UNION ALL
SELECT 3, 'rows WITH an area  (non-null, non-empty)',  '',
       COUNT(*) FILTER (WHERE area_name  IS NOT NULL AND btrim(area_name)  <> '') FROM base
UNION ALL
SELECT 4, 'rows with an AREA but NO route',            '',
       COUNT(*) FILTER (WHERE area_name  IS NOT NULL AND btrim(area_name)  <> ''
                          AND (route_name IS NULL OR btrim(route_name) = '')) FROM base
UNION ALL
SELECT 5, 'TOP 15 ROUTES (route · deliveryType)',
       COALESCE(route_name, '(no route)') || '  ·  ' || COALESCE(delivery_type, '(no type)'),
       COUNT(*)
FROM base
GROUP BY COALESCE(route_name, '(no route)'), COALESCE(delivery_type, '(no type)')
ORDER BY sort_key, n DESC, detail
LIMIT 19;   -- 4 summary rows + the top 15 routes
```

**Two caveats on reading the output.**

1. The `LIMIT 19` caps the *whole* result, and the four summary rows sort first by `sort_key`, so
   the route rows are the 15 that follow. If a route ties at the boundary, `detail` breaks the tie
   deterministically. If Smart Flow wants all routes rather than 15, drop the `LIMIT`.
2. A route + deliveryType pair is one output row. If one route name legitimately spans two delivery
   types (possible — the pair comes from `area_master`, and two areas can share a route while
   differing in type), it appears twice. That is information, not noise: it is exactly the case that
   makes change 1's "routes under the active type" question non-trivial.

---

## 3. Blockers

**B1 — Change 1 reverses a locked mockup decision, it does not fix a bug.**
The source comment (`picking-board-mobile.tsx:1199-1201`) says the stable-list/live-count split
"mirror[s] the approved mockup's route sheet exactly", and the sheet's own subtitle advertises it to
the user (:2418). Someone chose this. Reversing it is fine, but the subtitle at :2418 must change
with it or the control will describe behaviour it no longer has. **Also decide zone** (Q1d): the
list and the counts both span due + upcoming, so filtering by type alone will still leave routes
whose only bill is locked and unassignable.

**B2 — Change 2 has a second, unmentioned render site.**
Both detail-screen headers print the area (`picking-board-mobile.tsx:2568`,
`picker-my-picks-board.tsx:1646`). Changing only the cards means a bill reads "Vapi" on the card and
"Pal" one tap later. Either both move or neither does.

**B3 — Change 3's numbers will be stale within seconds of opening the board.**
The roster is fetched **exactly once, on mount, with an empty dep array** —
`picking-board-mobile.tsx:1113-1131`, and the comment says so: *"fetched once (the picker roster
doesn't change within a session)."* That was true of a NAME list. It is false of a live pending
count: the moment the supervisor assigns three bills, every count in that sheet is wrong until the
page is reloaded, and "Free" will still say Free. **Change 3 is not a route change plus a label
change — it needs the roster to refresh.** Cheapest correct option: refetch on `pickerSheetOpen`
transitioning to true. Do **not** fold it into the 15s marker's `refetchQueue` — CORE §3 and
`CLAUDE_PICKING.md §10` both warn that the marker keys on `MAX(orders.updatedAt)` and must not grow
new work; and the sheet is only visible for a few seconds at a time.

**B4 — Change 3 hides pickers who are actually busy, unless the date fence goes.**
"Free" today means "no assignment made **since UTC midnight** still open". A picker holding two
bills assigned yesterday reads **Free**, and the "show free pickers only, expand for busy" design
would put him at the top of the list as available. That is a wrong-work-to-the-wrong-man defect, not
a cosmetic one. The `assignedAt` window must be removed (Q3d step 1) *before* the sheet starts
hiding people based on the answer. Same root cause as the UTC-day bug in Q3c — one fix covers both.

**B5 — Change 4 costs `DetailListKey`, which is load-bearing and deliberately simple.**
It is a four-string union whose design note (:97-102) explicitly says these are LIST identities and
that deriving them from `activeTab` re-couples them and breaks paging. A per-picker bill list is a
list identity that a bare string cannot carry. The pager itself survives untouched (Q4e), but
`activeDetailList`'s `switch` (:1525-1532) becomes a lookup and every `openDetail` call site on the
Picking tab changes shape. Budget for that, not for "add a grouping memo".

**B6 — Change 4 changes what four other numbers on that tab mean.**
The tab badge (`picking-mobile-shell.tsx:509`), the summary strip's "N picking" (:2078),
`overThresholdCount`'s "N over 30m" (:1425), and the empty-state copy (:2316) are all **bill**
counts on a screen that would now show **pickers**. Each needs a decision (bills? pickers? both?),
and the badge in particular is owned by a different file than the tab content.

**B7 — Change 5 crosses a module ownership line if it reuses Floor's helper.**
`lib/floor/search.ts` is the natural home for this (Q5c) and `PickingQueueRow` already satisfies its
`Searchable` interface — but adding `area` and `assignedToName` edits a Floor-owned module for a
Picking requirement, and Floor's own board would inherit the widened match silently. Either extend
it deliberately and re-verify Floor, or give Picking its own predicate and accept two
implementations of "search a bill".

**B8 — Change 5 with no debounce, on five fields.**
There is no debounce anywhere in picking (verified two ways, Q5b). Five `.toLowerCase().includes()`
per row per keystroke across four list memos is still nothing at ~112 bills, but if change 5 also
adopts Floor's numbers mode (paste a list of OBDs) the per-keystroke work becomes
tokens × rows. Worth deciding up front, not after a floor complaint.

**B9 — None of the five is testable from this session.**
There is no login here and the standing rule is that no prod credentials are used to smoke-test
(the dev server points at the production DB). Every one of these changes is a phone-visible change
on a face that cannot be seen from here, and `CLAUDE_PICKING.md §5.4` records that this module has
already shipped a bug that *"no build or type-check catches — only a phone does."* Whatever is
built, the hand-test list is the deliverable, not the tsc pass.

---

## 4. Doc drift

**D1 — `CLAUDE_PICKING.md §7` says the supervisor board has TWO picker dropdowns. It has THREE.**
The entry *"The supervisor board has TWO picker dropdowns fed from DIFFERENT sources"* names the
Assign sheet and "the Picking-tab FILTER". The Done tab has a third
(`checkedPickerCounts`/`checkedPickerOptions`, `picking-board-mobile.tsx:1348-1361`, sheet at
:2442-2452), derived from `assignedToName` exactly like the Picking one but over
`[...doneRows, ...checkedRows]`. The *lesson* of that entry is unaffected — it is still two
SOURCES — but the count is wrong and a reader auditing "the two dropdowns" will miss one.

**D2 — `CLAUDE_UI.md §59.7`'s prop table for `ModuleMobileHeader` is missing `subtitle`.**
The table lists `title`, `avatarInitials`, `onAvatarClick`, `onMenuClick`, `showSearch`,
`searchActive`, `onSearchToggle`. The component now also takes `subtitle?: string`
(`components/shared/module-mobile-header.tsx:39`, rendered at :87-93), and it is **live** — the
picker board passes it for the Combined tab (`picker-my-picks-board.tsx:1155-1162`). Its own source
comment says it is "a new capability, NOT a restyle", i.e. added deliberately after §59.7 was
written. Everything else in §59.7 verified correct, including the `searchActive`-is-inert warning.

**D3 — `CLAUDE_PICKING.md §5.1`'s "narrow, never cast" rule is not applied on the SUPERVISOR shell.**
§5.1 records the `PickerTabKey` fix in a boxed warning and the picker shell does it properly
(`PICKER_TAB_KEYS` + `isPickerTabKey()`, `picking-mobile-shell.tsx:104-108`, used at :354-356).
The supervisor shell four functions below still casts:
`onTabChange={(key) => setActiveTab(key as "assign" | "picking" | "done")}` (:531). Same file, same
hazard, same `WorkflowTab.key: string` input. Not a live bug (nothing feeds it an unknown key), but
the doc reads as if the rule is applied module-wide and it is applied on one of two shells.

**D4 — `PickerBoardContextValue`'s own comment contradicts the code twelve lines later.**
`picking-mobile-shell.tsx:84-86` says *"This face fetches nothing client-side (app/picking/page.tsx
resolves its rows server-side and passes them as props), so there is no data/loading/error/refetch to
share"* — and the very next interface field is `refetchQueue` (:126), implemented as a client
`fetch` at :298-311 for reasons the same file documents at length (:232-244). A leftover from before
2026-07-29. Harmless to the compiler, actively misleading to a reader deciding where a refetch
belongs — which is precisely the decision change 3 (Blocker B3) requires.

**D5 — `CLAUDE_PICKING.md §5.2` "Card DNA" describes the where-row as carrying the picker name on
Picking/Done. Correct, but it never says the left half is the AREA.** The section says
"route dot + area + volume", which is accurate — flagged only because a reader skimming for
"route" on that line will find the word and conclude the route is displayed. It is not: the word
"route" there belongs to `RouteDot`, which keys on `deliveryType`. §62.3 of the UI doc has this
right; §5.2's phrasing is what invites the mistake. This is presumably how "the card shows the
route" became a belief worth a change request.

---

## 5. Open questions for Smart Flow

**Q-A · Change 1 — was the stable route list a decision or an accident?**
The code says decision (mockup-mirrored, advertised in the sheet subtitle). Two readings of what you
actually want:
(i) **list = routes with ≥1 bill under the active type** — the literal ask, "Vapi 0" disappears;
(ii) **list unchanged, 0-count routes just hidden** — same visible result today, but a route with
bills under *another* type still vanishes, which is the same thing said differently.
They differ only when a route has zero bills of the active type but some of another. Also: **do
upcoming (locked) bills count toward a route's presence?** They do today. Nobody has decided.

**Q-B · Change 2 — does the detail header follow the card?**
Card says route, header says area, one tap apart (Blocker B2). Three options: both to route; card
route + header keeps area (defensible — the header is where you confirm a specific bill); or
`route · area` on the card and accept the width. At 390px with a truncating area and a shrink-0
volume, `route · area · N L` will truncate hard on a long pair — this needs a look at real data,
which the Q6 SQL will give you.

**Q-C · Change 2 — what happens to `RouteDot` when the text beside it becomes a route name?**
It keys on `deliveryType` and always has (`CLAUDE_UI.md §62.3`). Beside "Pal" the ambiguity is
harmless; beside "Vapi" it reads as a route colour it is not. Keep it, drop it on that row, or
replace it with the Type letter? **A route→colour map is not on the table** — there is no colour in
the payload and none on `route_master`, so it would be a schema change.

**Q-D · Change 5 — extend Floor's search helper, or give Picking its own?**
`lib/floor/search.ts`'s `Searchable` is already structurally satisfied by `PickingQueueRow`, and it
brings the numbers mode (paste OBDs, match on a 3+-digit tail) for free. But it is Floor-owned, it
lacks `area` and `assignedToName`, and widening it changes Floor's board silently. One owner per
behaviour is the module's own rule (§3/§4 of the picking doc). Your call which side of it this sits.

**Q-E · Change 5 — does search stay live-per-keystroke, or move to Enter?**
Floor deliberately runs on Enter, and its source says why: *"live filtering would make the list jump
mid-paste and '2' would match forty bills before '237' is finished."* Picking is live today on two
fields. Five fields plus a possible numbers mode makes Floor's reasoning apply here too.

**Q-F · Change 3 — what exactly is "busy"?**
Q3 establishes that no number currently on that sheet answers it. The candidates:
*holds ≥1 `pick_assigned` bill* (the honest open count, and what Q3d builds);
*holds ≥1 bill assigned today* (today's cumulative — what is shown now);
*holds ≥1 bill in any unfinished state including `pick_done` awaiting a check* (arguably he is free —
he has physically finished). The third is a real question, not a quibble: a picker whose bills are
all `pick_done` is available to fetch, but a supervisor may reasonably want to see he has work
outstanding.

**Q-G · Change 3 — how many pickers is "expand to reveal the busy ones" hiding?**
The live roster is small (`CLAUDE_PICKING.md §1`: ~9-10 pickers; the SELECT-verified live test
accounts are ids 34-36). A collapse control that hides three names on a sheet that already scrolls
may cost more taps than it saves. Worth confirming the real headcount before designing the
expand affordance.

**Q-H · Change 4 — what does a picker card show, and does the tab badge stay a bill count?**
Blocker B6 lists four numbers that change meaning. Specifically: does the Picking tab's badge count
bills (today) or pickers (the new list)? The badge is computed in a different file
(`picking-mobile-shell.tsx:509`) from the tab content, so the two can silently disagree —
`CLAUDE_PICKING.md §5.1`'s "one fetch, no drift" guarantee covers the data, not the semantics.

**Q-I · Change 4 — does the picker-first Picking tab imply the same for Done?**
The Done tab has the same picker dimension and the same third dropdown (D1). Doing one and not the
other leaves two adjacent tabs with opposite shapes. Not necessarily wrong — Done is a checking
queue, not a workload view — but it should be a decision rather than a consequence.

---

*Diagnosis only. No code written, nothing committed. Report: `docs/prompts/drafts/code-discovery-2026-08-21-picking-board-v2.md`*
